import { loanCase } from "./loans.js";
import { FIXED_ROUTES, PLAYBOOK, approachById } from "../../config/playbook.js";
import { MAX_MONTHLY_DISCOUNT_INR } from "../../config/plans.js";
import { buildFeatures } from "../features/buildFeatures.js";
import { detectProblem } from "../models/problems.js";
import { scoreRisk, type RiskModel } from "../models/risk.js";
import { randomUUID } from "node:crypto";
import { TOPICS } from "../contracts/events.js";
import { enqueue } from "../data/outbox.js";
import { audit, type Sql } from "../data/sql.js";
import { SHARDS, shardOf, shardRange } from "../data/store.js";
import type { PaytmCore } from "../ports.js";
import { makeRng } from "../sim/rng.js";
import { TODAY, segmentOf, type Merchant } from "../sim/types.js";
import { ACTION_NAMES, Brief, ESCALATE_IF, MUST_NOT, MUST_SAY, type ActionName } from "./brief.js";
import { VISITS_PER_DAY, channelFor } from "./channels.js";
import { factsFor } from "./facts.js";
import { learnedSkips, ruleSkips, type HistoryRow, type SegmentCheck } from "./leaveAlone.js";
import { addResult, chooseApproach, keepEstimate, type Stats } from "./playbook.js";
import { REASON_LABELS, type ReasonCode } from "./reasons.js";
import { keptWorth, moveCost, valueOf } from "./value.js";

export const ATTENTION_RISK = 0.15;

const GOALS: Partial<Record<ReasonCode, string>> = {
  fee_confusion: "Merchant understands the fee and keeps the device",
  device_fault: "Device fault is confirmed and a replacement ticket is raised",
  rent_too_high: "Merchant moves to a plan that fits, or keeps the current one with reasons",
  settlement_delay: "Merchant knows the settlement status and a ticket is raised",
  support_unresolved: "A person calls back with full context",
  rival_offer: "Salesperson understands the offer and compares plans fairly",
  low_sales_season: "Merchant feels supported through a slow period",
  loan_overdue: "Loan repayment is back on track, within the lender's rules",
  loan_opportunity: "Merchant understands the offer and decides freely",
};

const LOAN_WHY = { loan_overdue: "Loan payments missed; sales need checking before anything else", loan_opportunity: "Sales are growing, no loan yet, and festival stock is coming" };

function actionsFor(problem: ReasonCode): ActionName[] {
  const always: ActionName[] = ["getMerchantSummary", "raiseTicket", "scheduleHumanCallback", "recordOutcome", "recordOptOut", "sendAppMessage", "requestDeviceReturn", "checkLoan", "proposeLoan", "acceptLoan", "setReducedEmi"];
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

export const PAGE_SIZE = 1000;

interface RunContext {
  risk: RiskModel;
  stats: Stats;
  checks: SegmentCheck[];
  learned: Map<string, SegmentCheck>;
  holdoutKeep: Map<string, number>;
  care: Set<string>;
}

export async function prepare(sql: Sql): Promise<RunContext> {
  const stored = await sql.get<{ value: string }>("SELECT value FROM kv WHERE key = 'risk_model'");
  if (!stored) throw new Error("No risk model found. Run pnpm seed first.");
  const history = await sql.all<{ problem: string; approach_id: string; segment: string; kept: number; n: number }>(
    "SELECT problem, approach_id, segment, kept, COUNT(*) AS n FROM contact_history WHERE kept IS NOT NULL GROUP BY problem, approach_id, segment, kept",
  );
  const stats: Stats = new Map();
  const rows: HistoryRow[] = [];
  for (const h of history) {
    rows.push({ segment: h.segment, arm: h.approach_id === "holdout" ? "holdout" : "contacted", kept: h.kept, n: h.n });
    if (PLAYBOOK[h.problem as ReasonCode] && h.approach_id !== "holdout" && h.approach_id !== "route") {
      addResult(stats, h.problem, h.approach_id, h.segment, h.kept === 1, h.n);
    }
  }
  const checks = learnedSkips(rows);
  const control = new Map<string, { kept: number; n: number }>();
  for (const h of history) {
    if (h.approach_id !== "holdout") continue;
    const t = control.get(h.problem) ?? { kept: 0, n: 0 };
    t.kept += h.kept * h.n;
    t.n += h.n;
    control.set(h.problem, t);
  }
  const holdoutKeep = new Map([...control].filter(([, t]) => t.n >= 20).map(([p, t]) => [p, t.kept / t.n]));
  const care = new Set((await sql.all<{ merchant_id: string }>("SELECT merchant_id FROM notes WHERE kind = 'care' AND until_day >= ?", [TODAY])).map((r) => r.merchant_id));
  return { risk: JSON.parse(stored.value) as RiskModel, stats, checks, learned: new Map(checks.filter((c) => c.skip).map((c) => [c.segment, c])), holdoutKeep, care };
}

interface ShardCounts {
  checked: number;
  active: number;
  leftAlone: number;
  holdoutWatched: number;
}

function decide(m: Merchant, ctx: RunContext, seed: number, counts: ShardCounts) {
  const { risk, stats, learned } = ctx;
  const f = buildFeatures(m, TODAY);
  if (f.daysSinceLastPayment >= 14) return null;
  counts.active++;
  const found = detectProblem(f);
  const loan = loanCase(m, f);
  // Missed payments come first. A loan offer only goes to a shop with nothing wrong.
  const detected = loan && (loan === "loan_overdue" || !found) ? { problem: loan, why: LOAN_WHY[loan], thresholdHeadsUp: false } : found;
  if (!detected) return null;
  const { score, reasons } = scoreRisk(risk, f);
  // An open complaint always gets attention, whatever the score says.
  if (score < ATTENTION_RISK && !detected.thresholdHeadsUp && f.openTickets === 0 && !loan) return null;

  const segment = segmentOf(m);
  const skipReasons = ruleSkips({ ...m, monthlyCollections: f.monthlyCollections }, TODAY);
  if (ctx.care.has(m.id)) skipReasons.push("Hard time at home: no proactive contact for 30 days");
  const rule = skipReasons.length > 0;
  const seg = learned.get(segment);
  if (seg) {
    skipReasons.push(`Learned (simulated): in ${segment} shops, ${Math.round(seg.contactedKeep * 100)}% of contacted shops stayed vs ${Math.round(seg.holdoutKeep * 100)}% of holdout`);
  }
  if (m.holdout) {
    counts.holdoutWatched++;
    return null;
  }
  if (skipReasons.length > 0) {
    return { skip: { m, kind: rule && seg ? "rule + learned" : rule ? "rule" : "learned", reasons: skipReasons } };
  }

  const worth = valueOf(m, f, TODAY);
  const headsUp = detected.thresholdHeadsUp === true;
  const loanRoute = detected.problem === "loan_overdue" ? FIXED_ROUTES.loan_hardship : detected.problem === "loan_opportunity" ? FIXED_ROUTES.loan_offer : null;
  const channel = loanRoute ? "soundbox" : channelFor(detected.problem, f, score, headsUp);
  let approachId: string;
  let share: number | null = null;
  if (loanRoute) approachId = loanRoute.id;
  else if (headsUp) approachId = FIXED_ROUTES.fee_threshold_headsup!.id;
  else if (PLAYBOOK[detected.problem]) {
    // Picks the approach that earns the most for this shop, not just the one that keeps the most.
    const choice = chooseApproach(stats, detected.problem, segment, makeRng(`${seed}-${m.id}`), (id, p) => p * keptWorth(id, worth.total, m.monthlyRent) - moveCost(id));
    approachId = choice.approachId;
    share = choice.share;
    const control = ctx.holdoutKeep.get(detected.problem);
    const keep = keepEstimate(stats, detected.problem, approachId);
    const net = control === undefined || keep === null ? null : (keep - control) * keptWorth(approachId, worth.total, m.monthlyRent) - moveCost(approachId);
    if (net !== null && net < 0 && f.openTickets === 0 && !m.isDemo) {
      return { skip: { m, kind: "learned", reasons: [`Not worth it: helping is expected to earn ₹${Math.round(net + moveCost(approachId))} and cost ₹${Math.round(moveCost(approachId))} (simulated)`] } };
    }
  } else if (channel === "human_callback") approachId = FIXED_ROUTES.human_callback!.id;
  else if (channel === "salesperson_visit") approachId = FIXED_ROUTES.salesperson_visit!.id;
  else approachId = FIXED_ROUTES.app_checkin!.id;

  let why = detected.why;
  if (m.tickets.some((t) => t.note.includes("return") && t.closedDay === null)) why += "; asked about returning the device";

  const brief = Brief.parse({
    briefId: `B-${m.id}-${TODAY}`,
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
  return {
    candidate: {
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
        valueYear: worth,
        segment,
        isDemo: m.isDemo,
      },
    },
  };
}

// Decides for one range of shards. Re-running a range replaces its own results.
export async function runShards(sql: Sql, core: PaytmCore, seed: number, lo: number, hi: number, ctx?: RunContext) {
  const context = ctx ?? (await prepare(sql));
  const counts: ShardCounts = { checked: 0, active: 0, leftAlone: 0, holdoutWatched: 0 };
  await sql.tx(async (tx) => {
    await tx.run("DELETE FROM briefs WHERE shard >= ? AND shard <= ?", [lo, hi]);
    await tx.run("DELETE FROM left_alone WHERE shard >= ? AND shard <= ?", [lo, hi]);
  });
  let after = "";
  for (;;) {
    const page = await core.merchantPage(lo, hi, after, PAGE_SIZE);
    if (page.length === 0) break;
    after = page.at(-1)!.id;
    const briefs: unknown[][] = [];
    const left: unknown[][] = [];
    for (const m of page) {
      counts.checked++;
      const d = decide(m, context, seed, counts);
      if (d?.skip) {
        counts.leftAlone++;
        left.push([d.skip.m.id, d.skip.m.name, d.skip.m.city, d.skip.kind, JSON.stringify(d.skip.reasons), d.skip.m.isDemo ? 1 : 0, shardOf(m.id)]);
      }
      if (d?.candidate) {
        const c = d.candidate;
        briefs.push([c.brief.briefId, c.brief.merchantId, c.sortKey, JSON.stringify(c.brief), JSON.stringify(c.meta), c.brief.channel, c.value, shardOf(m.id)]);
      }
    }
    await sql.tx(async (tx) => {
      await tx.bulk("briefs", ["brief_id", "merchant_id", "sort_key", "json", "meta", "channel", "value", "shard"], briefs);
      await tx.bulk("left_alone", ["merchant_id", "name", "city", "kind", "reasons", "is_demo", "shard"], left);
    });
  }
  await sql.tx(async (tx) => {
    await tx.run("DELETE FROM run_shards WHERE lo = ? AND hi = ?", [lo, hi]);
    await tx.run("INSERT INTO run_shards (lo, hi, json) VALUES (?, ?, ?)", [lo, hi, JSON.stringify(counts)]);
  });
  return counts;
}

// Runs once all shards finish: applies the shared limits and publishes the plan.
export async function finalizeRun(sql: Sql, ctx?: RunContext): Promise<TodayPlan> {
  const context = ctx ?? (await prepare(sql));
  const done = await sql.all<{ lo: number; hi: number; json: string }>("SELECT lo, hi, json FROM run_shards");
  const covered = done.reduce((a, r) => a + r.hi - r.lo + 1, 0);
  // A crashed worker must stop the plan, not shrink it silently.
  if (covered !== SHARDS) throw new Error(`Run incomplete: ${covered} of ${SHARDS} shards finished`);
  const parts = done.map((r) => JSON.parse(r.json) as ShardCounts);
  const sum = (k: keyof ShardCounts) => parts.reduce((a, p) => a + p[k], 0);
  return sql.tx(async (tx) => {
    // Salesperson time is limited: keep the most valuable visits, the rest go to the app.
    const extra = await tx.all<{ brief_id: string; json: string }>("SELECT brief_id, json FROM briefs WHERE channel = 'salesperson_visit' ORDER BY value DESC LIMIT 1000000 OFFSET ?", [VISITS_PER_DAY]);
    for (const b of extra) {
      await tx.run("UPDATE briefs SET channel = 'app', json = ? WHERE brief_id = ?", [JSON.stringify({ ...JSON.parse(b.json), channel: "app" }), b.brief_id]);
    }
    const byChannel = new Map((await tx.all<{ channel: string; n: number }>("SELECT channel, COUNT(*) AS n FROM briefs GROUP BY channel")).map((r) => [r.channel, Number(r.n)]));
    const n = (c: string) => byChannel.get(c) ?? 0;
    const candidates = [...byChannel.values()].reduce((a, b) => a + b, 0);
    const plan: TodayPlan = {
      checked: sum("checked"),
      active: sum("active"),
      needAttention: candidates + sum("leftAlone"),
      handledByRishta: n("soundbox") + n("app"),
      salespersonVisits: n("salesperson_visit"),
      humanCallbacks: n("human_callback"),
      leftAlone: sum("leftAlone"),
      holdoutWatched: sum("holdoutWatched"),
      learnedSegments: [...context.learned.keys()],
    };
    await tx.run("DELETE FROM daily_plan");
    await tx.run("INSERT INTO daily_plan (id, json) VALUES (1, ?)", [JSON.stringify({ ...plan, checks: context.checks })]);
    await audit(tx, null, "daily_run", plan);
    await enqueue(tx, TOPICS.plans, "plan", { id: randomUUID(), type: "plan.ready", version: 1, at: new Date().toISOString(), plan });
    return plan;
  });
}

export async function dailyRun(sql: Sql, core: PaytmCore, seed: number, shardCount = 1): Promise<TodayPlan> {
  const ctx = await prepare(sql);
  await sql.run("DELETE FROM run_shards");
  for (let i = 0; i < shardCount; i++) {
    const { lo, hi } = shardRange(i, shardCount);
    await runShards(sql, core, seed, lo, hi, ctx);
  }
  return finalizeRun(sql, ctx);
}
