// Splits the seeded bench for the public site: one shared file of daily history, one small template per visitor.
import { copyFileSync, rmSync, statSync } from "node:fs";
import Database from "better-sqlite3";
import { resetLive } from "../src/data/reset.js";
import { SQLITE_PATH, openSql } from "../src/data/sql.js";

const DAYS = ["daily_payments", "device_health", "settlements"];
export const TEMPLATE = "data/visitor-template.db";
export const BENCH_DAYS = "data/bench-days.db";

const sql = await openSql(SQLITE_PATH);
await resetLive(sql);
await sql.close();

const source = new Database(SQLITE_PATH);
source.pragma("wal_checkpoint(TRUNCATE)");
rmSync(TEMPLATE, { force: true });
rmSync(BENCH_DAYS, { force: true });
source.prepare("VACUUM INTO ?").run(TEMPLATE);
source.close();
copyFileSync(TEMPLATE, BENCH_DAYS);

const template = new Database(TEMPLATE);
for (const t of DAYS) template.exec(`DELETE FROM ${t}`);
template.exec("VACUUM");
template.close();

const days = new Database(BENCH_DAYS);
const others = days.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
for (const { name } of others) if (!DAYS.includes(name)) days.exec(`DROP TABLE ${name}`);
days.exec("VACUUM");
days.close();

console.log(`Template ${(statSync(TEMPLATE).size / 1e6).toFixed(1)} MB, shared history ${(statSync(BENCH_DAYS).size / 1e6).toFixed(1)} MB`);
