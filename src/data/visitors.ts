import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { EventBus } from "../ports.js";
import { startRelay } from "./outbox.js";
import { sqliteSql, type Sql } from "./sql.js";

// The public site gives every visitor a private copy of Rishta: their own small database,
// reading one shared file of daily history. Nothing a visitor does can reach anyone else.
export interface Visitor {
  id: string;
  sql: Sql | null;
  relay: { kick: () => void; stop: () => void } | null;
  lastSeen: number;
  turns: number;
  voiceTurns: number;
  shops: number;
}

export const visitorScope = new AsyncLocalStorage<Visitor>();

// Every query goes to the current visitor's database, or to the bench outside a visit.
export function routedSql(base: Sql): Sql {
  const now = () => visitorScope.getStore()?.sql ?? base;
  return {
    dialect: base.dialect,
    get benchDays() { return now().benchDays; },
    all: (q, p) => now().all(q, p),
    get: (q, p) => now().get(q, p),
    run: (q, p) => now().run(q, p),
    tx: (fn) => now().tx(fn),
    bulk: (t, c, r) => now().bulk(t, c, r),
    close: () => base.close(),
  } as Sql;
}

export const newVisitorId = () => randomBytes(16).toString("hex");
export const VISITOR_ID = /^[a-f0-9]{32}$/;

export interface PoolOptions {
  dir: string;
  template: string;
  days: string;
  bus: EventBus;
  onError: (err: unknown) => void;
  maxOpen?: number;
  maxKept?: number;
  idleMs?: number;
}

export async function visitorPool(o: PoolOptions) {
  const { maxOpen = 200, maxKept = 3000, idleMs = 6 * 3_600_000 } = o;
  // A restart starts clean: the disk on a free host doesn't survive one anyway.
  await rm(o.dir, { recursive: true, force: true });
  await mkdir(o.dir, { recursive: true });
  const all = new Map<string, Visitor>();
  const opening = new Map<string, Promise<Visitor>>();
  const path = (id: string) => join(o.dir, `${id}.db`);

  async function shut(v: Visitor) {
    v.relay?.stop();
    v.relay = null;
    const sql = v.sql;
    v.sql = null;
    await sql?.close();
  }
  const forget = async (v: Visitor) => {
    await shut(v);
    all.delete(v.id);
    await rm(path(v.id), { force: true });
  };

  async function open(id: string) {
    let v = all.get(id);
    if (!v) {
      await copyFile(o.template, path(id));
      v = { id, sql: null, relay: null, lastSeen: Date.now(), turns: 0, voiceTurns: 0, shops: 0 };
      all.set(id, v);
    }
    v.sql = sqliteSql(path(id), o.days);
    // Timers started here keep this visitor's scope, so its events stay with its own screens.
    const opened = v;
    visitorScope.run(opened, () => { opened.relay = startRelay(opened.sql!, o.bus, o.onError); });
    const live = [...all.values()].filter((x) => x.sql).sort((a, b) => a.lastSeen - b.lastSeen);
    for (const x of live.slice(0, Math.max(0, live.length - maxOpen))) if (Date.now() - x.lastSeen > 60_000) await shut(x);
    const kept = [...all.values()].sort((a, b) => a.lastSeen - b.lastSeen);
    for (const x of kept.slice(0, Math.max(0, kept.length - maxKept))) if (x !== opened) await forget(x);
    return opened;
  }

  return {
    async enter(id: string) {
      const known = all.get(id);
      if (known?.sql) {
        known.lastSeen = Date.now();
        return known;
      }
      let pending = opening.get(id);
      if (!pending) {
        pending = open(id).finally(() => opening.delete(id));
        opening.set(id, pending);
      }
      const v = await pending;
      v.lastSeen = Date.now();
      return v;
    },
    knows: (id: string) => all.has(id),
    size: () => all.size,
    // Runs a job once for each visitor who is here now.
    async each(job: () => Promise<unknown>) {
      for (const v of all.values()) if (v.sql) await visitorScope.run(v, job);
    },
    async expire(now = Date.now()) {
      for (const v of [...all.values()]) if (now - v.lastSeen > idleMs) await forget(v);
    },
    async close() {
      for (const v of all.values()) await shut(v);
    },
  };
}

export type VisitorPool = Awaited<ReturnType<typeof visitorPool>>;
