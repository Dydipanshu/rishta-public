import { PLAYBOOK, approachById } from "../../config/playbook.js";
import { audit, type Sql } from "../data/sql.js";
import type { PaytmCore } from "../ports.js";
import { makeRng } from "../sim/rng.js";
import { KEEP_WINDOW_DAYS, OUTREACH_START_DAY } from "../sim/types.js";
import { prepare } from "./dailyRun.js";
import { allocation } from "./playbook.js";
import type { ReasonCode } from "./reasons.js";

export interface Settled {
  merchantId: string;
  name: string;
  problem: string;
  approach: string;
  kept: boolean;
  resultsBefore: number;
  resultsAfter: number;
  shareBefore: number | null;
  shareAfter: number | null;
}

async function latestShare(sql: Sql, problem: string, approachId: string) {
  const row = await sql.get<{ share: number }>("SELECT share FROM playbook_stats WHERE problem = ? AND approach_id = ? ORDER BY week DESC LIMIT 1", [problem, approachId]);
  return row ? Number(row.share) : null;
}

const resultCount = async (sql: Sql, problem: string, approachId: string) =>
  Number((await sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM contact_history WHERE problem = ? AND approach_id = ? AND kept IS NOT NULL", [problem, approachId]))?.n ?? 0);

// The weekly update: a live contact counts once it is 30 days old.
// Safe to repeat: only rows still empty are filled in.
export async function settleOutcomes(sql: Sql, core: PaytmCore, seed: number, asOfDay: number) {
  const due = await sql.all<{ merchant_id: string; day: number; problem: string; approach_id: string }>(
    "SELECT merchant_id, day, problem, approach_id FROM contact_history WHERE true_cause = 'live' AND kept IS NULL AND day <= ?",
    [asOfDay - KEEP_WINDOW_DAYS],
  );
  const settled: Settled[] = [];
  for (const c of due) {
    const resultsBefore = await resultCount(sql, c.problem, c.approach_id);
    const kept = await core.isActive(c.merchant_id, asOfDay);
    const changed = await sql.run("UPDATE contact_history SET kept = ? WHERE merchant_id = ? AND day = ? AND approach_id = ? AND kept IS NULL", [+kept, c.merchant_id, c.day, c.approach_id]);
    if (changed === 0) continue;
    await audit(sql, c.merchant_id, "settled", { approachId: c.approach_id, kept });
    settled.push({
      merchantId: c.merchant_id,
      name: (await core.merchant(c.merchant_id)).name,
      problem: c.problem,
      approach: approachById(c.approach_id)?.label ?? c.approach_id,
      kept,
      resultsBefore,
      resultsAfter: resultsBefore + 1,
      shareBefore: await latestShare(sql, c.problem, c.approach_id),
      shareAfter: null,
    });
  }
  if (settled.length === 0) return settled;

  const { stats } = await prepare(sql);
  const week = Math.floor((asOfDay - OUTREACH_START_DAY) / 7) + 1;
  await sql.tx(async (tx) => {
    await tx.run("DELETE FROM playbook_stats WHERE week = ?", [week]);
    for (const problem of Object.keys(PLAYBOOK) as ReasonCode[]) {
      for (const s of allocation(stats, problem, "*", makeRng(`${seed}-${week}-${problem}`))) {
        await tx.run("INSERT INTO playbook_stats (week, problem, approach_id, share) VALUES (?, ?, ?, ?)", [week, problem, s.approachId, s.share]);
      }
    }
  });
  for (const c of due) {
    const row = settled.find((x) => x.merchantId === c.merchant_id && x.problem === c.problem);
    if (row) row.shareAfter = await latestShare(sql, c.problem, c.approach_id);
  }
  return settled;
}
