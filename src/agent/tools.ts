import { z } from "zod";
import { eligiblePlans } from "../../config/plans.js";
import { deviceFacts, feeFacts, summaryFacts } from "../engine/facts.js";
import { OutcomeKind, type ActionName, type Brief } from "../engine/brief.js";
import { audit, type DB } from "../server/db.js";
import { loadMerchant } from "../server/store.js";
import { TODAY } from "../sim/types.js";
import type { LLMTool } from "./llmAdapter.js";

export interface ToolContext {
  db: DB;
  brief: Brief;
  lastUserText: () => string;
  onOutcome: (outcome: z.infer<typeof OutcomeKind>, summary: string) => void;
  transcriptText: () => string;
}

interface ToolDef {
  description: string;
  args: z.ZodObject;
  run: (ctx: ToolContext, args: any) => unknown;
}

const none = z.object({}).strict();
const now = () => new Date().toISOString();

export const TOOLS: Record<ActionName, ToolDef> = {
  getMerchantSummary: {
    description: "Last 30 days: collections, payments, customers and the latest settlement.",
    args: none,
    run: ({ db, brief }) => summaryFacts(loadMerchant(db, brief.merchantId), TODAY),
  },
  explainFee: {
    description: "This shop's latest fee figures. Call only if the figures are not already in the facts.",
    args: z.object({ period: z.string() }).strict(),
    run: ({ db, brief }) => ({ ...feeFacts(loadMerchant(db, brief.merchantId), TODAY), note: "Payments up to the free limit have no fee." }),
  },
  checkDeviceHealth: {
    description: "Offline hours, battery alerts and failed payment trend.",
    args: none,
    run: ({ db, brief }) => deviceFacts(loadMerchant(db, brief.merchantId), TODAY),
  },
  raiseTicket: {
    description: "Raise a support ticket. Returns the ticket id and next step.",
    args: z.object({ type: z.enum(["settlement", "rent", "device", "fee"]), note: z.string() }).strict(),
    run: ({ db, brief }, { type, note }) => {
      const n = (db.prepare("SELECT COUNT(*) c FROM tickets WHERE live = 1").get() as { c: number }).c + 4821;
      const id = `T${n}`;
      db.prepare("INSERT INTO tickets (id, merchant_id, type, status, note, opened_day, closed_day, live) VALUES (?, ?, ?, 'open', ?, ?, NULL, 1)").run(id, brief.merchantId, type, note, TODAY);
      return { ticketId: id, nextStep: type === "device" ? "The device team will contact the shop about a replacement." : "The support team will review this ticket." };
    },
  },
  proposePlan: {
    description: "Eligible cheaper plans from the catalogue, within this shop's budget.",
    args: none,
    run: ({ db, brief }) => {
      const m = loadMerchant(db, brief.merchantId);
      return { currentRentInr: m.monthlyRent, plans: eligiblePlans(m.monthlyRent, brief.limits.maxDiscountInr) };
    },
  },
  changePlan: {
    description: "Change the plan. Only after the merchant clearly agreed; pass their exact words.",
    args: z.object({ planId: z.string(), agreedQuote: z.string() }).strict(),
    run: ({ db, brief, lastUserText }, { planId, agreedQuote }) => {
      const m = loadMerchant(db, brief.merchantId);
      const plan = eligiblePlans(m.monthlyRent, brief.limits.maxDiscountInr).find((p) => p.id === planId);
      if (!plan) return { error: "That plan is not available for this shop." };
      if (!agreedQuote.trim() || !lastUserText().includes(agreedQuote.trim())) return { error: "The merchant has not clearly agreed yet. Ask them first." };
      db.prepare("INSERT INTO plan_changes VALUES (?, ?, ?, ?)").run(m.id, m.planId, plan.id, now());
      db.prepare("UPDATE merchants SET plan_id = ?, monthly_rent = ? WHERE id = ?").run(plan.id, plan.monthlyRent, m.id);
      return { changed: true, newPlan: plan.name, newRentInr: plan.monthlyRent };
    },
  },
  scheduleHumanCallback: {
    description: "Hand over to a person. Creates a card for the team with a summary.",
    args: z.object({ reason: z.string() }).strict(),
    run: ({ db, brief, transcriptText, onOutcome }, { reason }) => {
      db.prepare("INSERT INTO handoffs (merchant_id, reason, summary, created_at) VALUES (?, ?, ?, ?)").run(brief.merchantId, reason, transcriptText(), now());
      onOutcome("handed_off", reason);
      return { scheduled: true, nextStep: "A person from Paytm will call back." };
    },
  },
  recordOutcome: {
    description: "Record how the conversation ended.",
    args: z.object({ outcome: OutcomeKind, summary: z.string() }).strict(),
    run: ({ onOutcome }, { outcome, summary }) => {
      onOutcome(outcome, summary);
      return { recorded: true };
    },
  },
  recordOptOut: {
    description: "Stop all outreach to this merchant.",
    args: none,
    run: ({ db, brief, onOutcome }) => {
      db.prepare("UPDATE merchants SET opted_out = 1 WHERE id = ?").run(brief.merchantId);
      onOutcome("opted_out", "Merchant asked to stop outreach.");
      return { optedOut: true };
    },
  },
  sendAppMessage: {
    description: "Send a message to the merchant's Paytm for Business inbox.",
    args: z.object({ text: z.string() }).strict(),
    run: ({ db, brief }, { text }) => {
      db.prepare("INSERT INTO inbox (merchant_id, text, created_at) VALUES (?, ?, ?)").run(brief.merchantId, text, now());
      return { sent: true };
    },
  },
};

export function toolsFor(brief: Brief): LLMTool[] {
  return brief.allowedActions.map((name) => {
    const def = TOOLS[name];
    return { name, description: def.description, parameters: z.toJSONSchema(def.args, { target: "draft-7" }) as Record<string, unknown> };
  });
}

export function runTool(ctx: ToolContext, name: string, rawArgs: string): unknown {
  const def = TOOLS[name as ActionName];
  if (!def || !ctx.brief.allowedActions.includes(name as ActionName)) return { error: `Tool ${name} is not allowed` };
  const parsed = def.args.safeParse(JSON.parse(rawArgs || "{}"));
  if (!parsed.success) return { error: "Invalid arguments" };
  const result = def.run(ctx, parsed.data);
  audit(ctx.db, ctx.brief.merchantId, "tool", { name, args: parsed.data, result });
  return result;
}

