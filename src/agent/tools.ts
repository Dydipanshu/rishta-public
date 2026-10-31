import { z } from "zod";
import { eligiblePlans } from "../../config/plans.js";
import { deviceFacts, feeFacts, summaryFacts } from "../engine/facts.js";
import { OutcomeKind, type ActionName, type Brief } from "../engine/brief.js";
import { audit, type Sql } from "../data/sql.js";
import type { PaytmCore } from "../ports.js";
import { TODAY } from "../sim/types.js";
import { buildFeatures } from "../features/buildFeatures.js";
import { hardship, loanOf, loanOffer } from "../engine/loans.js";
import { addPromise, closePromises, openPromises } from "../engine/memory.js";
import type { LLMTool } from "./llmAdapter.js";

export interface ToolContext {
  sql: Sql;
  core: PaytmCore;
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
const RENT_WORRY = /rent|किराया|किराए|महँगा|महंगा|ज़्यादा|expensive/i;
export const YES = /हाँ|हां|ठीक|कर दो|कर दीजिए|चलेगा|\b(haan|han|ok|okay|yes|theek|kar do|sure)\b/i;
export const NO = /नहीं|नही|मत|सोच|बाद में|रुको|\b(no|nahi|mat|later|wait)\b/i;

const recordLoan = (sql: Sql, id: string, kind: string, amountInr: number, detail: unknown) =>
  sql.run("INSERT INTO loan_actions (merchant_id, kind, amount_inr, detail, created_at) VALUES (?, ?, ?, ?, ?)", [id, kind, amountInr, JSON.stringify(detail), new Date().toISOString()]);

export const TOOLS: Record<ActionName, ToolDef> = {
  getMerchantSummary: {
    description: "Last 30 days: collections, payments, customers and the latest settlement.",
    args: none,
    run: async ({ core, brief }) => summaryFacts(await core.merchant(brief.merchantId), TODAY),
  },
  explainFee: {
    description: "This shop's latest fee figures. Call only if the figures are not already in the facts.",
    args: z.object({ period: z.string() }).strict(),
    run: async ({ core, brief }) => ({ ...feeFacts(await core.merchant(brief.merchantId), TODAY), note: "Payments up to the free limit have no fee." }),
  },
  checkDeviceHealth: {
    description: "Offline hours, battery alerts and failed payment trend.",
    args: none,
    run: async ({ core, brief }) => deviceFacts(await core.merchant(brief.merchantId), TODAY),
  },
  raiseTicket: {
    description: "Raise a support ticket. Returns the ticket id and next step.",
    args: z.object({ type: z.enum(["settlement", "rent", "device", "fee"]), note: z.string() }).strict(),
    run: async ({ sql, core, brief }, { type, note }) => {
      // One problem, one ticket: the same complaint twice must not become two jobs for the team.
      const same = (await openPromises(sql, brief.merchantId)).find((p) => p.kind === type && p.ticket_id);
      if (same) return { ticketId: same.ticket_id, existing: true };
      const { ticketId } = await core.raiseTicket(brief.merchantId, type, note);
      await addPromise(sql, brief.merchantId, ticketId, type, `${type} ticket ${ticketId}: ${note}`);
      return { ticketId, nextStep: type === "device" ? "The device team will contact the shop about a replacement." : "The support team will review this ticket." };
    },
  },
  proposePlan: {
    description: "Eligible cheaper plans from the catalogue, within this shop's budget.",
    args: none,
    run: async ({ core, brief, transcriptText }) => {
      const m = await core.merchant(brief.merchantId);
      // A discount costs Paytm real money, so a passing mention of a rival doesn't earn one.
      const said = transcriptText().split("\n").filter((l) => l.startsWith("merchant:"));
      if (said.length < 2 && !RENT_WORRY.test(said.join(" ")) && brief.problem !== "rent_too_high") return { error: "Listen first. Offer a plan only if the shop says rent is too high or says again it will leave." };
      return { currentRentInr: m.monthlyRent, plans: eligiblePlans(m.monthlyRent, brief.limits.maxDiscountInr) };
    },
  },
  changePlan: {
    description: "Change the plan. Only after the merchant clearly agreed; pass their exact words.",
    args: z.object({ planId: z.string(), agreedQuote: z.string() }).strict(),
    run: async ({ core, brief, lastUserText }, { planId, agreedQuote }) => {
      const m = await core.merchant(brief.merchantId);
      const plan = eligiblePlans(m.monthlyRent, brief.limits.maxDiscountInr).find((p) => p.id === planId);
      if (!plan) return { error: "That plan is not available for this shop." };
      const last = lastUserText();
      // The shop's own last words decide. What the model quotes can't overrule a no.
      const agreed = YES.test(last) && !NO.test(last) && !!agreedQuote;
      if (!agreed) return { error: "The merchant has not clearly agreed yet. Ask them first." };
      await core.changePlan(m.id, m.planId, plan);
      return { changed: true, newPlan: plan.name, newRentInr: plan.monthlyRent };
    },
  },
  checkLoan: {
    description: "This shop's loan: EMI, missed payments, sales drop and whether a reduced EMI is allowed.",
    args: none,
    run: async ({ core, brief }) => {
      const m = await core.merchant(brief.merchantId);
      const f = buildFeatures(m, TODAY);
      const loan = loanOf(m, f);
      return loan ? hardship(loan, f) : { hasLoan: false };
    },
  },
  setReducedEmi: {
    description: "Set the reduced EMI. Only after checkLoan allowed it and the merchant clearly agreed; pass their exact words.",
    args: z.object({ agreedQuote: z.string() }).strict(),
    run: async ({ sql, core, brief, lastUserText }, { agreedQuote }) => {
      const m = await core.merchant(brief.merchantId);
      const f = buildFeatures(m, TODAY);
      const loan = loanOf(m, f);
      const state = loan && hardship(loan, f);
      if (!state?.genuineHardship) return { error: "A reduced EMI is not allowed for this shop. Offer a person." };
      const last = lastUserText();
      if (!(YES.test(last) && !NO.test(last) && agreedQuote)) return { error: "The merchant has not clearly agreed yet. Ask them first." };
      await recordLoan(sql, m.id, "emi_reset", state.overdueInr, state);
      await core.notify(m.id, `आपकी EMI ${state.reliefMonths} महीने के लिए ₹${state.reducedEmiInr} हो गई है।`);
      return { done: true, reducedEmiInr: state.reducedEmiInr, reliefMonths: state.reliefMonths };
    },
  },
  proposeLoan: {
    description: "Loan options this shop qualifies for, with daily amount and total repayable. The only source of loan figures.",
    args: none,
    run: async ({ core, brief }) => {
      const m = await core.merchant(brief.merchantId);
      return loanOffer(m, buildFeatures(m, TODAY));
    },
  },
  acceptLoan: {
    description: "Send the chosen loan option for approval in the merchant's app. Only after a clear yes; pass their exact words.",
    args: z.object({ optionId: z.string(), agreedQuote: z.string() }).strict(),
    run: async ({ sql, core, brief, lastUserText }, { optionId, agreedQuote }) => {
      const m = await core.merchant(brief.merchantId);
      const offer = loanOffer(m, buildFeatures(m, TODAY));
      const option = offer.eligible ? offer.options.find((o) => o.optionId === optionId) : null;
      if (!option) return { error: "That loan option is not available for this shop." };
      const last = lastUserText();
      if (!(YES.test(last) && !NO.test(last) && agreedQuote)) return { error: "The merchant has not clearly agreed yet. Ask them first." };
      await recordLoan(sql, m.id, "loan_accepted", option.amountInr, option);
      await core.notify(m.id, `₹${option.amountInr.toLocaleString("en-IN")} का loan आपकी approval के लिए app में है। रोज़ ₹${option.dailyInr}, ${option.days} दिन, कुल ₹${option.totalRepayInr.toLocaleString("en-IN")}। Lender अंतिम फ़ैसला करेगा।`);
      return { sent: true, ...option };
    },
  },
  scheduleHumanCallback: {
    description: "Hand over to a person. Creates a card for the team with a summary.",
    args: z.object({ reason: z.string() }).strict(),
    run: async ({ core, brief, transcriptText, onOutcome }, { reason }) => {
      await core.scheduleCallback(brief.merchantId, reason, transcriptText());
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
    run: async ({ core, brief, onOutcome }) => {
      await core.optOut(brief.merchantId);
      onOutcome("opted_out", "Merchant asked to stop outreach.");
      return { optedOut: true };
    },
  },
  requestDeviceReturn: {
    description: "The merchant insists on returning the device after hearing the facts. Books the pickup and tells the team.",
    args: z.object({ reason: z.string() }).strict(),
    run: async ({ core, brief, transcriptText, onOutcome }, { reason }) => {
      const { ticketId } = await core.raiseTicket(brief.merchantId, "device_return", reason);
      await core.scheduleCallback(brief.merchantId, `Device return: ${reason}`, transcriptText());
      onOutcome("return_requested", reason);
      return { ticketId, nextStep: "The pickup team will contact the shop." };
    },
  },
  confirmFix: {
    description: "On a check-back call: record what the shop says about the promised fix.",
    args: z.object({ fixed: z.boolean() }).strict(),
    run: async ({ sql, core, brief, onOutcome, transcriptText }, { fixed }) => {
      if ((await openPromises(sql, brief.merchantId)).length === 0) return { error: "Nothing is waiting on a fix." };
      await closePromises(sql, brief.merchantId, fixed ? "kept" : "failed");
      if (!fixed) await core.scheduleCallback(brief.merchantId, "A promised fix did not work", transcriptText());
      onOutcome(fixed ? "fix_confirmed" : "handed_off", fixed ? "Shop confirmed the fix worked." : "Shop says the fix did not work.");
      return { recorded: true };
    },
  },
  sendAppMessage: {
    description: "Send a message to the merchant's Paytm for Business inbox.",
    args: z.object({ text: z.string() }).strict(),
    run: async ({ core, brief }, { text }) => {
      await core.notify(brief.merchantId, text);
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

export async function runTool(ctx: ToolContext, name: string, rawArgs: string): Promise<unknown> {
  const def = TOOLS[name as ActionName];
  if (!def || !ctx.brief.allowedActions.includes(name as ActionName)) return { error: `Tool ${name} is not allowed` };
  const parsed = def.args.safeParse(JSON.parse(rawArgs || "{}"));
  if (!parsed.success) return { error: "Invalid arguments" };
  const result = await def.run(ctx, parsed.data);
  await audit(ctx.sql, ctx.brief.merchantId, "tool", { name, args: parsed.data, result });
  return result;
}

