import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type DB = Database.Database;

export const DB_PATH = "data/rishta.db";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS merchants (
  id TEXT PRIMARY KEY, name TEXT, first_name TEXT, city TEXT, city_tier INTEGER, category TEXT, category_group TEXT,
  language TEXT, device_type TEXT, plan_id TEXT, monthly_rent REAL, onboard_day INTEGER, fee_category TEXT,
  consent_profiling INTEGER, consent_messages INTEGER, opted_out INTEGER, holdout INTEGER, is_demo INTEGER,
  last_contact_day INTEGER, true_cause TEXT, cause_onset INTEGER, churn_day INTEGER
);
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
CREATE TABLE IF NOT EXISTS contact_history (
  merchant_id TEXT, day INTEGER, week INTEGER, problem TEXT, approach_id TEXT, true_cause TEXT, segment TEXT, city TEXT, category TEXT, kept INTEGER
);
CREATE TABLE IF NOT EXISTS playbook_stats (week INTEGER, problem TEXT, approach_id TEXT, share REAL);
CREATE TABLE IF NOT EXISTS reason_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, merchant_id TEXT, day INTEGER, week INTEGER, code TEXT, quote TEXT, city TEXT, category TEXT, live INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS daily_plan (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT);
CREATE TABLE IF NOT EXISTS briefs (brief_id TEXT PRIMARY KEY, merchant_id TEXT, sort_key REAL, json TEXT, meta TEXT);
CREATE INDEX IF NOT EXISTS briefs_merchant ON briefs (merchant_id);
CREATE TABLE IF NOT EXISTS left_alone (merchant_id TEXT PRIMARY KEY, name TEXT, city TEXT, kind TEXT, reasons TEXT, is_demo INTEGER);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY, brief_id TEXT, merchant_id TEXT, started_at TEXT, ended_at TEXT, transcript TEXT, numbers_verified INTEGER
);
CREATE TABLE IF NOT EXISTS outcomes (brief_id TEXT, merchant_id TEXT, json TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS handoffs (id INTEGER PRIMARY KEY AUTOINCREMENT, merchant_id TEXT, reason TEXT, summary TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS inbox (id INTEGER PRIMARY KEY AUTOINCREMENT, merchant_id TEXT, text TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS plan_changes (merchant_id TEXT, from_plan TEXT, to_plan TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS consents (merchant_id TEXT, kind TEXT, granted INTEGER, day INTEGER);
CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, merchant_id TEXT, kind TEXT, detail TEXT);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
`;

export function openDb(path = DB_PATH): DB {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(SCHEMA);
  return db;
}

export function audit(db: DB, merchantId: string | null, kind: string, detail: unknown) {
  db.prepare("INSERT INTO audit_log (at, merchant_id, kind, detail) VALUES (?, ?, ?, ?)").run(
    new Date().toISOString(),
    merchantId,
    kind,
    JSON.stringify(detail),
  );
}
