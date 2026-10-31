// The nightly decision job. One process: `pnpm daily`.
// Weekly learning update: `pnpm daily --settle`.
// Morning send, no person involved: `pnpm daily --send`. Publishing needs the server's outbox relay running.
// Many: `pnpm daily --start`, then `pnpm daily --shard i/n` for each i, then `pnpm daily --finalize`.
import { existsSync } from "node:fs";
import { benchCore } from "../adapters/benchCore.js";
import { openSql } from "../data/sql.js";
import { shardRange } from "../data/store.js";
import { dailyRun, finalizeRun, runShards } from "../engine/dailyRun.js";
import { followUpBrief } from "../engine/inbound.js";
import { sendMorningOutreach } from "../engine/outreach.js";
import { settleOutcomes } from "../engine/settle.js";
import { TODAY } from "../sim/types.js";

if (existsSync(".env")) process.loadEnvFile(".env");
const sql = await openSql();
const core = benchCore(sql);
const seed = Number(process.env.DEMO_SEED ?? 7);
const arg = process.argv[2];

if (arg === "--settle") {
  console.log("Settled:", await settleOutcomes(sql, core, seed, TODAY));
} else if (arg === "--send") {
  console.log("Morning send:", await sendMorningOutreach(sql, core, new Date(), process.env.APP_ENV === "production"));
  // Promises come due by themselves: nobody has to remember to go back.
  const due = await sql.all<{ merchant_id: string }>("SELECT DISTINCT merchant_id FROM promises WHERE status = 'open' AND due_day <= ?", [TODAY]);
  for (const p of due) {
    if (await followUpBrief(sql, core, p.merchant_id)) await core.notify(p.merchant_id, "आपकी शिकायत के बारे में पूछना था: क्या दिक्कत ठीक हो गई? बताने के लिए बटन दबाइए।");
  }
  console.log("Check-backs:", due.length);
} else if (arg === "--start") {
  await sql.run("DELETE FROM run_shards");
  console.log("Run started");
} else if (arg === "--shard") {
  const [i, n] = process.argv[3]!.split("/").map(Number) as [number, number];
  const { lo, hi } = shardRange(i, n);
  console.log(`Shard ${i}/${n}:`, await runShards(sql, core, seed, lo, hi));
} else if (arg === "--finalize") {
  console.log("Today's plan:", await finalizeRun(sql));
} else {
  console.log("Today's plan:", await dailyRun(sql, core, seed));
}
await sql.close();
