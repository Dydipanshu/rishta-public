import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import pg from "pg";

// One async SQL surface. SQLite runs the laptop demo; Postgres runs production.
export interface Sql {
  dialect: "sqlite" | "postgres";
  // True on a visitor database: daily history lives in the shared bench file.
  benchDays?: boolean;
  all<T = Record<string, any>>(query: string, params?: unknown[]): Promise<T[]>;
  get<T = Record<string, any>>(query: string, params?: unknown[]): Promise<T | undefined>;
  run(query: string, params?: unknown[]): Promise<number>;
  tx<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
  bulk(table: string, columns: string[], rows: unknown[][]): Promise<void>;
  close(): Promise<void>;
}

export const SQLITE_PATH = "data/rishta.db";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS merchants (
  id TEXT PRIMARY KEY, name TEXT, first_name TEXT, city TEXT, city_tier INTEGER, category TEXT, category_group TEXT,
  language TEXT, device_type TEXT, plan_id TEXT, monthly_rent REAL, onboard_day INTEGER, fee_category TEXT,
  consent_profiling INTEGER, consent_messages INTEGER, opted_out INTEGER, holdout INTEGER, is_demo INTEGER,
  last_contact_day INTEGER, true_cause TEXT, cause_onset INTEGER, churn_day INTEGER, shard INTEGER
);
CREATE INDEX IF NOT EXISTS merchants_shard ON merchants (shard, id);
CREATE TABLE IF NOT EXISTS daily_payments (
  merchant_id TEXT, day INTEGER, count INTEGER, value REAL, count_above_2000 INTEGER, value_above_2000 REAL,
  failed_count INTEGER, unique_payers INTEGER, repeat_share REAL, PRIMARY KEY (merchant_id, day)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS device_health (
  merchant_id TEXT, day INTEGER, offline_hours REAL, battery_alerts INTEGER, error_count INTEGER, PRIMARY KEY (merchant_id, day)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS settlements (
  merchant_id TEXT, day INTEGER, gross REAL, fee REAL, gst_on_fee REAL, net REAL, delay_hours REAL, PRIMARY KEY (merchant_id, day)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY, merchant_id TEXT, type TEXT, status TEXT, note TEXT, opened_day INTEGER, closed_day INTEGER, live INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS tickets_merchant ON tickets (merchant_id);
CREATE TABLE IF NOT EXISTS ticket_numbers (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT);
CREATE TABLE IF NOT EXISTS contact_history (
  merchant_id TEXT, day INTEGER, week INTEGER, problem TEXT, approach_id TEXT, true_cause TEXT, segment TEXT, city TEXT, category TEXT, kept INTEGER
);
CREATE INDEX IF NOT EXISTS contact_history_problem ON contact_history (problem, approach_id);
CREATE TABLE IF NOT EXISTS playbook_stats (week INTEGER, problem TEXT, approach_id TEXT, share REAL);
CREATE TABLE IF NOT EXISTS reason_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, merchant_id TEXT, day INTEGER, week INTEGER, code TEXT, quote TEXT, city TEXT, category TEXT, live INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS reason_events_day ON reason_events (day);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS daily_plan (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT);
CREATE TABLE IF NOT EXISTS run_shards (lo INTEGER, hi INTEGER, json TEXT, PRIMARY KEY (lo, hi));
CREATE TABLE IF NOT EXISTS briefs (
  brief_id TEXT PRIMARY KEY, merchant_id TEXT, sort_key REAL, json TEXT, meta TEXT, channel TEXT, value REAL, shard INTEGER
);
CREATE INDEX IF NOT EXISTS briefs_merchant ON briefs (merchant_id);
CREATE INDEX IF NOT EXISTS briefs_sort ON briefs (sort_key);
CREATE INDEX IF NOT EXISTS briefs_channel ON briefs (channel, brief_id);
CREATE TABLE IF NOT EXISTS left_alone (merchant_id TEXT PRIMARY KEY, name TEXT, city TEXT, kind TEXT, reasons TEXT, is_demo INTEGER, shard INTEGER);
CREATE TABLE IF NOT EXISTS outreach (brief_id TEXT PRIMARY KEY, merchant_id TEXT, channel TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY, brief_id TEXT, merchant_id TEXT, started_at TEXT, updated_at TEXT, ended_at TEXT,
  state TEXT, version INTEGER DEFAULT 0, finished INTEGER DEFAULT 0, transcript TEXT, numbers_verified INTEGER
);
CREATE INDEX IF NOT EXISTS conversations_open ON conversations (finished, merchant_id);
CREATE TABLE IF NOT EXISTS outcomes (conversation_id TEXT PRIMARY KEY, brief_id TEXT, merchant_id TEXT, json TEXT, created_at TEXT);
CREATE INDEX IF NOT EXISTS outcomes_merchant ON outcomes (merchant_id);
CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, topic TEXT, key TEXT, value TEXT, sent INTEGER DEFAULT 0, claimed_until TEXT);
CREATE INDEX IF NOT EXISTS outbox_unsent ON outbox (sent, id);
CREATE TABLE IF NOT EXISTS handoffs (id INTEGER PRIMARY KEY AUTOINCREMENT, merchant_id TEXT, reason TEXT, summary TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS inbox (id INTEGER PRIMARY KEY AUTOINCREMENT, merchant_id TEXT, text TEXT, created_at TEXT);
CREATE INDEX IF NOT EXISTS inbox_merchant ON inbox (merchant_id);
CREATE TABLE IF NOT EXISTS plan_changes (merchant_id TEXT, from_plan TEXT, to_plan TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS consents (merchant_id TEXT, kind TEXT, granted INTEGER, day INTEGER);
CREATE TABLE IF NOT EXISTS promises (
  id INTEGER PRIMARY KEY AUTOINCREMENT, merchant_id TEXT, ticket_id TEXT, kind TEXT, text TEXT, due_day INTEGER, status TEXT, created_at TEXT, closed_at TEXT
);
CREATE INDEX IF NOT EXISTS promises_merchant ON promises (merchant_id);
CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY AUTOINCREMENT, merchant_id TEXT, kind TEXT, text TEXT, day INTEGER, until_day INTEGER);
CREATE INDEX IF NOT EXISTS notes_merchant ON notes (merchant_id);
CREATE TABLE IF NOT EXISTS loan_actions (merchant_id TEXT, kind TEXT, amount_inr REAL, detail TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS loan_checks (merchant_id TEXT PRIMARY KEY, name TEXT, city TEXT, kind TEXT, why TEXT, sales REAL, shard INTEGER);
CREATE TABLE IF NOT EXISTS leads (merchant_id TEXT PRIMARY KEY, kind TEXT, why TEXT, value_inr REAL, status TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, merchant_id TEXT, kind TEXT, detail TEXT);
`;

const SQLITE_AUDIT = `CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;`;
const POSTGRES_AUDIT = `
CREATE OR REPLACE FUNCTION audit_append_only() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'audit_log is append-only'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS audit_no_update ON audit_log;
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_append_only();`;

const postgresSchema = () =>
  SCHEMA.replaceAll("INTEGER PRIMARY KEY AUTOINCREMENT", "BIGSERIAL PRIMARY KEY").replaceAll(" WITHOUT ROWID", "").replaceAll(" REAL", " DOUBLE PRECISION");

// A visitor's database holds everything except the daily history, which all visitors read from one shared file.
export function sqliteSql(path: string, benchDays?: string): Sql {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma(`journal_mode = ${benchDays ? "MEMORY" : "WAL"}`);
  db.pragma(`synchronous = ${benchDays ? "OFF" : "NORMAL"}`);
  if (benchDays) db.prepare("ATTACH DATABASE ? AS bench").run(benchDays);
  db.pragma("busy_timeout = 5000");
  db.exec(SCHEMA + SQLITE_AUDIT);

  const raw: Sql = {
    dialect: "sqlite",
    benchDays: !!benchDays,
    all: async <T>(q: string, p: unknown[] = []) => db.prepare(q).all(...p) as T[],
    get: async <T>(q: string, p: unknown[] = []) => db.prepare(q).get(...p) as T | undefined,
    run: async (q, p = []) => db.prepare(q).run(...p).changes,
    tx: (fn) => fn(raw),
    bulk: async (table, columns, rows) => {
      const ins = db.prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`);
      for (const r of rows) ins.run(...r);
    },
    close: async () => void db.close(),
  };

  // Keeps other requests out of an open transaction on the single connection.
  let lock: Promise<unknown> = Promise.resolve();
  const queued = <T>(fn: () => Promise<T>) => {
    const next = lock.then(fn, fn);
    lock = next.catch(() => undefined);
    return next;
  };
  return {
    ...raw,
    all: (q, p) => queued(() => raw.all(q, p)),
    get: (q, p) => queued(() => raw.get(q, p)),
    run: (q, p) => queued(() => raw.run(q, p)),
    bulk: (t, c, r) => queued(() => raw.bulk(t, c, r)),
    tx: (fn) =>
      queued(async () => {
        db.exec("BEGIN");
        try {
          const result = await fn(raw);
          db.exec("COMMIT");
          return result;
        } catch (err) {
          db.exec("ROLLBACK");
          throw err;
        }
      }),
  };
}

const numbered = (q: string) => {
  let n = 0;
  return q.replace(/\?/g, () => `$${++n}`);
};

function postgresOver(client: pg.Pool | pg.PoolClient): Omit<Sql, "tx" | "close"> {
  return {
    dialect: "postgres",
    all: async <T>(q: string, p: unknown[] = []) => (await client.query(numbered(q), p)).rows as T[],
    get: async <T>(q: string, p: unknown[] = []) => (await client.query(numbered(q), p)).rows[0] as T | undefined,
    run: async (q, p = []) => (await client.query(numbered(q), p)).rowCount ?? 0,
    bulk: async (table, columns, rows) => {
      const size = Math.floor(30000 / columns.length);
      for (let i = 0; i < rows.length; i += size) {
        const part = rows.slice(i, i + size);
        const marks = part.map((_, r) => `(${columns.map((_, c) => `$${r * columns.length + c + 1}`).join(",")})`);
        await client.query(`INSERT INTO ${table} (${columns.join(",")}) VALUES ${marks.join(",")}`, part.flat());
      }
    },
  };
}

async function postgresSql(url: string, poolSize: number): Promise<Sql> {
  pg.types.setTypeParser(pg.types.builtins.INT8, Number);
  const pool = new pg.Pool({ connectionString: url, max: poolSize });
  // Servers and workers often start together; only one may change the schema at a time.
  const setup = await pool.connect();
  try {
    await setup.query("SELECT pg_advisory_lock(7424)");
    await setup.query(postgresSchema() + POSTGRES_AUDIT);
  } finally {
    await setup.query("SELECT pg_advisory_unlock(7424)");
    setup.release();
  }
  return {
    ...postgresOver(pool),
    tx: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const inner: Sql = { ...postgresOver(client), tx: (f) => f(inner), close: async () => {} };
        const result = await fn(inner);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

export const openSql = (url = process.env.DATABASE_URL, poolSize = 20): Promise<Sql> =>
  url?.startsWith("postgres") ? postgresSql(url, poolSize) : Promise.resolve(sqliteSql(url || SQLITE_PATH));

export async function audit(sql: Sql, merchantId: string | null, kind: string, detail: unknown) {
  await sql.run("INSERT INTO audit_log (at, merchant_id, kind, detail) VALUES (?, ?, ?, ?)", [new Date().toISOString(), merchantId, kind, JSON.stringify(detail)]);
}
