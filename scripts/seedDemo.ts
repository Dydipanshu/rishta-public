// Builds the test bench, trains the stand-in risk score, runs the engine and reports gates.
import { existsSync, rmSync } from "node:fs";
import { loadSettings } from "../config/settings.js";
import { PLAYBOOK } from "../config/playbook.js";
import { dailyRun } from "../src/engine/dailyRun.js";
import { buildFeatures } from "../src/features/buildFeatures.js";
import { evaluate, scoreRisk, trainRisk } from "../src/models/risk.js";
import { benchCore } from "../src/adapters/benchCore.js";
import { resetLive } from "../src/data/reset.js";
import { SQLITE_PATH, openSql } from "../src/data/sql.js";
import { saveSim } from "../src/data/store.js";
import type { ReasonCode } from "../src/engine/reasons.js";
import { BACKFIRE_SEGMENT, FIX_PROBABILITY, LOAN_TAKE_UP } from "../src/sim/groundTruth.js";
import { simulate } from "../src/sim/simulator.js";
import { KEEP_WINDOW_DAYS, type Merchant } from "../src/sim/types.js";

if (existsSync(".env")) process.loadEnvFile(".env");
const s = process.env.SKIP_KEYS ? null : loadSettings();
const seed = s?.DEMO_SEED ?? 7;
const holdout = s?.HOLDOUT_SHARE ?? 0.15;

if (process.env.SEED_ONCE) {
  const existing = await openSql();
  const seeded = await existing.get("SELECT 1 AS ok FROM kv WHERE key = 'risk_model'");
  await existing.close();
  if (seeded) {
    console.log("Already seeded, leaving the data alone");
    process.exit(0);
  }
}

const t0 = performance.now();
if (!process.env.DATABASE_URL) for (const f of [SQLITE_PATH, `${SQLITE_PATH}-wal`, `${SQLITE_PATH}-shm`]) if (existsSync(f)) rmSync(f);
const sim = simulate(seed, 5000, holdout);
console.log(`Simulated ${sim.merchants.length} merchants in ${((performance.now() - t0) / 1000).toFixed(1)}s`);

const db = await openSql();
await resetLive(db);
await saveSim(db, sim);

// Risk stand-in: train on some merchants at earlier days, test on unseen merchants later.
const churnsSoon = (m: Merchant, day: number) => (m.churnDay !== null && m.churnDay <= day + KEEP_WINDOW_DAYS ? 1 : 0);
const isActive = (m: Merchant, day: number) => m.churnDay === null || m.churnDay > day;
const hash = (id: string) => [...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 1000, 7);
const train = sim.merchants.filter((m) => hash(m.id) % 10 < 7);
const test = sim.merchants.filter((m) => hash(m.id) % 10 >= 7);
const rows = [100, 115, 130].flatMap((d) =>
  train.filter((m) => isActive(m, d)).map((m) => ({ f: buildFeatures(m, d), y: churnsSoon(m, d) })),
);
const model = trainRisk(rows);
await db.run("DELETE FROM kv WHERE key = 'risk_model'");
await db.run("INSERT INTO kv (key, value) VALUES ('risk_model', ?)", [JSON.stringify(model)]);
const metrics = evaluate(test.filter((m) => isActive(m, 145)).map((m) => ({ s: scoreRisk(model, buildFeatures(m, 145)).score, y: churnsSoon(m, 145) })));
console.log(`\nGate 1, risk: PR-AUC ${metrics.prAuc.toFixed(2)}, top-10% lift ${metrics.lift.toFixed(1)}x, base rate ${(metrics.baseRate * 100).toFixed(1)}% (needs lift >= 3)`);

const withCause = sim.contacts.filter((c) => c.trueCause !== "none");
const match = withCause.filter((c) => c.problem === c.trueCause).length;
console.log(`Gate 2, problems: right reason on ${((match / withCause.length) * 100).toFixed(0)}% of ${withCause.length} cases with a planted cause`);
const noCause = sim.contacts.filter((c) => c.trueCause === "none").length;
console.log(`  ${noCause} cases had no planted cause (false alarms)`);

const lastWeek = Math.max(...sim.allocations.map((a) => a.week));
for (const problem of Object.keys(PLAYBOOK)) {
  const shares = sim.allocations.filter((a) => a.week === lastWeek && a.problem === problem).map((a) => `${a.approachId} ${Math.round(a.share * 100)}%`);
  console.log(`Gate 3, playbook week ${lastWeek}, ${problem}: ${shares.join(", ")}`);
}

const plan = await dailyRun(db, benchCore(db), seed, Number(process.env.SEED_SHARDS ?? 1));
const planned = plan.learnedSegments;
console.log(`Gate 4, leave alone: learned ${JSON.stringify(planned)}, planted ${BACKFIRE_SEGMENT}, match ${planned.length === 1 && planned[0] === BACKFIRE_SEGMENT}`);

let winnersFound = 0;
const problems = Object.keys(PLAYBOOK);
for (const problem of problems) {
  const week = Math.max(...sim.allocations.filter((a) => a.problem === problem).map((a) => a.week));
  const shares = sim.allocations.filter((a) => a.week === week && a.problem === problem).sort((a, b) => b.share - a.share);
  const truth = (problem === "loan_opportunity" ? Object.entries(LOAN_TAKE_UP).filter(([id]) => id.startsWith("loan_")).map(([id, p]) => [id, { [problem]: p }] as [string, Partial<Record<ReasonCode, number>>]) : Object.entries(FIX_PROBABILITY)).filter(([, v]) => v[problem as ReasonCode] !== undefined).sort((a, b) => b[1][problem as ReasonCode]! - a[1][problem as ReasonCode]!);
  if (shares[0]?.approachId === truth[0]?.[0]) winnersFound++;
}
await db.run("DELETE FROM kv WHERE key = 'report_card'");
await db.run("INSERT INTO kv (key, value) VALUES ('report_card', ?)", [JSON.stringify({
  reasonAccuracy: match / withCause.length,
  reasonCases: withCause.length,
  riskLift: metrics.lift,
  winnersFound,
  problems: problems.length,
  backfireFound: planned.length === 1 && planned[0] === BACKFIRE_SEGMENT,
})]);
console.log("\nToday's plan:", plan);
const demo = await db.all<{ merchant_id: string; json: string; meta: string }>("SELECT merchant_id, json, meta FROM briefs WHERE merchant_id LIKE 'M%' ORDER BY merchant_id");
for (const d of demo) {
  const b = JSON.parse(d.json);
  const meta = JSON.parse(d.meta);
  console.log(`${d.merchant_id} ${meta.name}: ${b.problem} -> ${b.approachId} via ${b.channel}, risk ${meta.risk} | ${meta.why}`);
}
console.log("Left alone demo:", await db.all("SELECT merchant_id, kind, reasons FROM left_alone WHERE is_demo = 1"));
console.log(`\nDone in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
await db.close();
