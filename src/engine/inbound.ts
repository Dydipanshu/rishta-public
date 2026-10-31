import { MAX_MONTHLY_DISCOUNT_INR } from "../../config/plans.js";
import { FIXED_ROUTES } from "../../config/playbook.js";
import { buildFeatures } from "../features/buildFeatures.js";
import { detectProblem } from "../models/problems.js";
import type { Sql } from "../data/sql.js";
import type { PaytmCore } from "../ports.js";
import { TODAY, type Merchant } from "../sim/types.js";
import { ACTION_NAMES, Brief, ESCALATE_IF, MUST_NOT, MUST_SAY } from "./brief.js";
import { factsFor, feeRuleFacts } from "./facts.js";
import { openPromises } from "./memory.js";
import { REASON_LABELS } from "./reasons.js";

// A brief for a shop that pressed the button itself, or that we are checking back on.
// Works for any shop: left-alone and no-contact shops still get normal service.
function serviceBrief(m: Merchant, id: string, channel: "inbound" | "app", goal: string, approachId: string) {
  const problem = detectProblem(buildFeatures(m, TODAY))?.problem ?? "unknown";
  return Brief.parse({
    briefId: id, merchantId: m.id, displayName: m.name, language: m.language, channel, problem, approachId, goal,
    facts: { ...factsFor(m, TODAY, problem, false), ...factsFor(m, TODAY, "rent_too_high", false), ...factsFor(m, TODAY, "fee_confusion", false), ...feeRuleFacts(m, TODAY) },
    allowedActions: ACTION_NAMES, limits: { maxDiscountInr: MAX_MONTHLY_DISCOUNT_INR }, mustSay: MUST_SAY, mustNot: MUST_NOT, escalateIf: ESCALATE_IF,
    successCriteria: "The shop's question is answered, or a person has it",
  });
}

async function store(sql: Sql, brief: Brief, m: Merchant, why: string, sort: number) {
  const meta = { name: m.name, city: m.city, category: m.category, why, reasonLabel: REASON_LABELS[brief.problem], risk: 0, riskReasons: [], approachLabel: FIXED_ROUTES[brief.approachId]?.label ?? brief.approachId, approachShare: null, segment: "", isDemo: m.isDemo };
  await sql.run("INSERT INTO briefs (brief_id, merchant_id, sort_key, json, meta, channel, value, shard) VALUES (?, ?, ?, ?, ?, ?, 0, -1) ON CONFLICT (brief_id) DO NOTHING", [brief.briefId, m.id, sort, JSON.stringify(brief), JSON.stringify(meta), brief.channel]);
}

// A check-back still waiting for the shop's answer.
export async function pendingFollowUp(sql: Sql, merchantId: string) {
  const row = await sql.get<{ json: string }>("SELECT b.json FROM briefs b WHERE b.merchant_id = ? AND b.brief_id LIKE 'F-%' AND NOT EXISTS (SELECT 1 FROM outcomes o WHERE o.brief_id = b.brief_id) ORDER BY b.brief_id DESC LIMIT 1", [merchantId]);
  return row ? Brief.parse(JSON.parse(row.json)) : null;
}

export async function inboundBrief(sql: Sql, core: PaytmCore, merchantId: string) {
  const m = await core.merchant(merchantId);
  const n = Number((await sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM briefs WHERE merchant_id = ?", [merchantId]))?.n ?? 0);
  const brief = serviceBrief(m, `I-${m.id}-${TODAY}-${n + 1}`, "inbound", "Answer what the shop came to ask", "inbound_service");
  await store(sql, brief, m, "The shop pressed the button itself", -1);
  return brief;
}

// Rishta checks back on what it promised, and only the shop can close it.
export async function followUpBrief(sql: Sql, core: PaytmCore, merchantId: string) {
  const open = await openPromises(sql, merchantId);
  if (open.length === 0) return null;
  const m = await core.merchant(merchantId);
  const brief = serviceBrief(m, `F-${m.id}-${open[0]!.id}`, "app", "Find out if the promised fix really worked", "follow_up_fix");
  await store(sql, brief, m, `Checking back: ${open[0]!.text}`, -1);
  return brief;
}
