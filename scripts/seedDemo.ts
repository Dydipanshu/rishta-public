// Builds the test bench, trains the stand-in risk score, runs the engine and reports gates.
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { loadSettings } from "../config/settings.js";
import { PLAYBOOK } from "../config/playbook.js";
import { dailyRun } from "../src/engine/dailyRun.js";
import { buildFeatures } from "../src/features/buildFeatures.js";
import { evaluate, scoreRisk, trainRisk } from "../src/models/risk.js";
import { DB_PATH, openDb } from "../src/server/db.js";
import { saveSim } from "../src/server/store.js";
import { BACKFIRE_SEGMENT } from "../src/sim/groundTruth.js";
import { simulate } from "../src/sim/simulator.js";
import { KEEP_WINDOW_DAYS, type Merchant } from "../src/sim/types.js";

const s = process.env.SKIP_KEYS ? null : loadSettings();
const seed = s?.DEMO_SEED ?? 7;
const holdout = s?.HOLDOUT_SHARE ?? 0.15;

const t0 = performance.now();
for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) if (existsSync(f)) rmSync(f);
const sim = simulate(seed, 5000, holdout);
console.log(`Simulated ${sim.merchants.length} merchants in ${((performance.now() - t0) / 1000).toFixed(1)}s`);

const db = openDb();
saveSim(db, sim);

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
writeFileSync("data/risk.json", JSON.stringify(model));
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

const plan = dailyRun(db, seed);
const planned = plan.learnedSegments;
console.log(`Gate 4, leave alone: learned ${JSON.stringify(planned)}, planted ${BACKFIRE_SEGMENT}, match ${planned.length === 1 && planned[0] === BACKFIRE_SEGMENT}`);

console.log("\nToday's plan:", plan);
const demo = db.prepare("SELECT merchant_id, json, meta FROM briefs WHERE merchant_id LIKE 'M%' ORDER BY merchant_id").all() as { merchant_id: string; json: string; meta: string }[];
for (const d of demo) {
  const b = JSON.parse(d.json);
  const meta = JSON.parse(d.meta);
  console.log(`${d.merchant_id} ${meta.name}: ${b.problem} -> ${b.approachId} via ${b.channel}, risk ${meta.risk} | ${meta.why}`);
}
console.log("Left alone demo:", db.prepare("SELECT merchant_id, kind, reasons FROM left_alone WHERE is_demo = 1").all());
console.log(`\nDone in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
