import { readFileSync } from "node:fs";
import { FIXED_ROUTES, PLAYBOOK, approachById } from "../../config/playbook.js";
import { MAX_MONTHLY_DISCOUNT_INR } from "../../config/plans.js";
import { buildFeatures } from "../features/buildFeatures.js";
import { detectProblem } from "../models/problems.js";
import { scoreRisk, type RiskModel } from "../models/risk.js";
import { audit, type DB } from "../server/db.js";
import { loadMerchants } from "../server/store.js";
import { makeRng } from "../sim/rng.js";
import { TODAY, segmentOf } from "../sim/types.js";
import { ACTION_NAMES, Brief, ESCALATE_IF, MUST_NOT, MUST_SAY, type ActionName } from "./brief.js";
import { VISITS_PER_DAY, channelFor } from "./channels.js";
import { factsFor } from "./facts.js";
import { learnedSkips, ruleSkips, type HistoryRow } from "./leaveAlone.js";
import { addResult, chooseApproach, type Stats } from "./playbook.js";
import { REASON_LABELS, type ReasonCode } from "./reasons.js";

export const ATTENTION_RISK = 0.15;

const GOALS: Partial<Record<ReasonCode, string>> = {
  fee_confusion: "Merchant understands the fee and keeps the device",
  device_fault: "Device fault is confirmed and a replacement ticket is raised",
  rent_too_high: "Merchant moves to a plan that fits, or keeps the current one with reasons",
  settlement_delay: "Merchant knows the settlement status and a ticket is raised",
  support_unresolved: "A person calls back with full context",
  rival_offer: "Salesperson understands the offer and compares plans fairly",
  low_sales_season: "Merchant feels supported through a slow period",
};

function actionsFor(problem: ReasonCode): ActionName[] {
  const always: ActionName[] = ["getMerchantSummary", "raiseTicket", "scheduleHumanCallback", "recordOutcome", "recordOptOut", "sendAppMessage"];
  if (problem === "fee_confusion") return [...always, "explainFee"];
  if (problem === "device_fault") return [...always, "checkDeviceHealth"];
  if (problem === "rent_too_high") return [...always, "proposePlan", "changePlan"];
  return always;
}

export interface TodayPlan {
  checked: number;
  active: number;
  needAttention: number;
  handledByRishta: number;
  salespersonVisits: number;
  humanCallbacks: number;
  leftAlone: number;
  holdoutWatched: number;
  learnedSegments: string[];
}

export function dailyRun(db: DB, seed: number): TodayPlan {
  const merchants = loadMerchants(db);
  const risk = JSON.parse(readFileSync("data/risk.json", "utf8")) as RiskModel;

  const history = db.prepare("SELECT * FROM contact_history WHERE kept IS NOT NULL").all() as {
    problem: string; approach_id: string; segment: string; kept: number;
  }[];
  const stats: Stats = new Map();
  const rows: HistoryRow[] = [];
  for (const h of history) {
    rows.push({ segment: h.segment, arm: h.approach_id === "holdout" ? "holdout" : "contacted", kept: h.kept });
    if (PLAYBOOK[h.problem as ReasonCode] && h.approach_id !== "holdout" && h.approach_id !== "route") {
      addResult(stats, h.problem, h.approach_id, h.segment, h.kept === 1);
    }
  }
  const checks = learnedSkips(rows);
  const learned = new Map(checks.filter((c) => c.skip).map((c) => [c.segment, c]));

  type Candidate = { brief: Brief; meta: Record<string, unknown>; sortKey: number; value: number };
  const candidates: Candidate[] = [];
  const skipped: { m: (typeof merchants)[number]; kind: string; reasons: string[] }[] = [];
  let active = 0;
  let holdoutWatched = 0;

  for (const m of merchants) {
    const f = buildFeatures(m, TODAY);
    if (f.daysSinceLastPayment >= 14) continue;
    active++;
    const detected = detectProblem(f);
    if (!detected) continue;
    const { score, reasons } = scoreRisk(risk, f);
    // An open complaint always gets attention, whatever the score says.
    if (score < ATTENTION_RISK && !detected.thresholdHeadsUp && f.openTickets === 0) continue;

    const segment = segmentOf(m);
    const skipReasons = ruleSkips({ ...m, monthlyCollections: f.monthlyCollections }, TODAY);
    const rule = skipReasons.length > 0;
    const seg = learned.get(segment);
    if (seg) {
      skipReasons.push(`Learned (simulated): in ${segment} shops, ${Math.round(seg.contactedKeep * 100)}% of contacted shops stayed vs ${Math.round(seg.holdoutKeep * 100)}% of holdout`);
    }
    if (m.holdout) {
      holdoutWatched++;
      continue;
    }
    if (skipReasons.length > 0) {
      skipped.push({ m, kind: rule && seg ? "rule + learned" : rule ? "rule" : "learned", reasons: skipReasons });
      continue;
    }

    const headsUp = detected.thresholdHeadsUp === true;
    let channel = channelFor(detected.problem, f, score, headsUp);
    let approachId: string;
    let share: number | null = null;
    if (headsUp) approachId = FIXED_ROUTES.fee_threshold_headsup!.id;
    else if (PLAYBOOK[detected.problem]) {
      const choice = chooseApproach(stats, detected.problem, segment, makeRng(`${seed}-${m.id}`));
      approachId = choice.approachId;
      share = choice.share;
    } else if (channel === "human_callback") approachId = FIXED_ROUTES.human_callback!.id;
    else if (channel === "salesperson_visit") approachId = FIXED_ROUTES.salesperson_visit!.id;
    else approachId = FIXED_ROUTES.app_checkin!.id;

    let why = detected.why;
    if (m.tickets.some((t) => t.note.includes("return") && t.closedDay === null)) why += "; asked about returning the device";

    const briefId = `B-${m.id}-${TODAY}`;
    const brief = Brief.parse({
      briefId,
      merchantId: m.id,
      displayName: m.name,
      language: m.language,
      channel,
      problem: detected.problem,
      approachId,
      goal: headsUp ? "Merchant knows the threshold early and is not surprised" : (GOALS[detected.problem] ?? "Understand what changed for the shop"),
      facts: factsFor(m, TODAY, detected.problem, headsUp),
      allowedActions: actionsFor(detected.problem).filter((a) => ACTION_NAMES.includes(a)),
      limits: { maxDiscountInr: MAX_MONTHLY_DISCOUNT_INR },
      mustSay: MUST_SAY,
      mustNot: MUST_NOT,
      escalateIf: ESCALATE_IF,
      successCriteria: "Merchant is still active after 30 days",
    });
    candidates.push({
      brief,
      value: f.monthlyCollections * score,
      sortKey: (m.isDemo ? 1e12 : 0) + (m.isDemo ? -Number(m.id.slice(1)) : f.monthlyCollections * score),
      meta: {
        name: m.name,
        city: m.city,
        category: m.category,
        why,
        reasonLabel: REASON_LABELS[detected.problem],
        risk: Math.round(score * 100) / 100,
        riskReasons: reasons,
        approachLabel: approachById(approachId)?.label ?? approachId,
        approachShare: share,
        segment,
        isDemo: m.isDemo,
      },
    });
  }

  // Salesperson time is limited: keep the most valuable visits, the rest go to the app.
  const visits = candidates.filter((c) => c.brief.channel === "salesperson_visit").sort((a, b) => b.value - a.value);
  for (const c of visits.slice(VISITS_PER_DAY)) c.brief.channel = "app";

  const plan: TodayPlan = {
    checked: merchants.length,
    active,
    needAttention: candidates.length + skipped.length,
    handledByRishta: candidates.filter((c) => c.brief.channel === "soundbox" || c.brief.channel === "app").length,
    salespersonVisits: candidates.filter((c) => c.brief.channel === "salesperson_visit").length,
    humanCallbacks: candidates.filter((c) => c.brief.channel === "human_callback").length,
    leftAlone: skipped.length,
    holdoutWatched,
    learnedSegments: [...learned.keys()],
  };

  const write = db.transaction(() => {
    for (const t of ["briefs", "left_alone", "daily_plan"]) db.prepare(`DELETE FROM ${t}`).run();
    const ins = db.prepare("INSERT INTO briefs (brief_id, merchant_id, sort_key, json, meta) VALUES (?, ?, ?, ?, ?)");
    for (const c of candidates) ins.run(c.brief.briefId, c.brief.merchantId, c.sortKey, JSON.stringify(c.brief), JSON.stringify(c.meta));
    const skip = db.prepare("INSERT INTO left_alone (merchant_id, name, city, kind, reasons, is_demo) VALUES (?, ?, ?, ?, ?, ?)");
    for (const s of skipped) skip.run(s.m.id, s.m.name, s.m.city, s.kind, JSON.stringify(s.reasons), s.m.isDemo ? 1 : 0);
    db.prepare("INSERT INTO daily_plan (id, json) VALUES (1, ?)").run(JSON.stringify({ ...plan, checks }));
    audit(db, null, "daily_run", plan);
  });
  write();
  return plan;
}
