import { OFFER } from "../../config/loans.js";
import { buildFeatures } from "../features/buildFeatures.js";
import { loanGate } from "../engine/loans.js";
import { addResult, allocation, chooseApproach, type Stats } from "../engine/playbook.js";
import { detectProblem } from "../models/problems.js";
import { LOAN_BAD_AT_BAD_MOMENT, LOAN_BAD_AT_GOOD_MOMENT, LOAN_TAKE_UP } from "./groundTruth.js";
import { makeRng } from "./rng.js";
import { KEEP_WINDOW_DAYS, OUTREACH_START_DAY, TODAY, segmentOf, type Merchant } from "./types.js";
import type { AllocationRow, ContactRow } from "./simulator.js";

const PROBLEM = "loan_opportunity" as const;
export const NO_TIMING_ARM = "no_timing_rule";
// Bench only: a small sample gets the same offer with the timing rules off, to show what the rules are worth.
// Production never offers a loan outside the rules.
const NO_TIMING_SAMPLE = 0.01;

const weekOf = (day: number) => Math.floor((day - OUTREACH_START_DAY) / 7) + 1;

// Past loan offers. Runs after the main history on its own random stream, so that history never changes.
// Stops 30 days before today, so every row has its result.
export function simulateLoans(merchants: Merchant[], seed: number) {
  const rng = makeRng(`${seed}-loans`);
  const stats: Stats = new Map();
  const contacts: ContactRow[] = [];
  const allocations: AllocationRow[] = [];
  const lastOffer = new Map<string, number>();
  const waiting: { c: ContactRow; kept: boolean }[] = [];

  for (let day = OUTREACH_START_DAY; day <= TODAY - KEEP_WINDOW_DAYS; day++) {
    if ((day - OUTREACH_START_DAY) % 7 === 0) {
      for (const w of waiting.splice(0)) {
        if (w.c.day + KEEP_WINDOW_DAYS > day) waiting.push(w);
        else if (w.c.approachId.startsWith("loan_")) addResult(stats, PROBLEM, w.c.approachId, w.c.segment, w.kept);
      }
      for (const s of allocation(stats, PROBLEM, "*", rng)) allocations.push({ week: weekOf(day), problem: PROBLEM, approachId: s.approachId, share: s.share });
    }
    for (const m of merchants) {
      if (m.isDemo || (m.churnDay !== null && m.churnDay <= day)) continue;
      const seen = lastOffer.get(m.id);
      if (seen !== undefined && day - seen < OFFER.cooldownDays) continue;
      const f = buildFeatures(m, day);
      if (f.monthlyCollections < OFFER.minMonthlyInr) continue;
      const gate = loanGate(m, f, day);
      if (!gate.sized) continue;
      const rightMoment = gate.check === "ready" && !detectProblem(f);
      if (!rightMoment && (m.holdout || rng() >= NO_TIMING_SAMPLE)) continue;
      const segment = segmentOf(m);
      const approachId = !rightMoment ? NO_TIMING_ARM : m.holdout ? "holdout" : chooseApproach(stats, PROBLEM, segment, rng).approachId;
      lastOffer.set(m.id, day);
      const took = rng() < LOAN_TAKE_UP[approachId]!;
      const shut = m.churnDay !== null && m.churnDay <= day + KEEP_WINDOW_DAYS;
      const bad = shut || rng() < (rightMoment ? LOAN_BAD_AT_GOOD_MOMENT : LOAN_BAD_AT_BAD_MOMENT);
      const kept = took && !bad;
      const c: ContactRow = { merchantId: m.id, day, week: weekOf(day), problem: PROBLEM, approachId, trueCause: "none", segment, city: m.city, category: m.category, kept: +kept };
      contacts.push(c);
      waiting.push({ c, kept });
    }
  }
  return { contacts, allocations };
}

