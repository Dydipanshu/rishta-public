import { z } from "zod";
import { ReasonCode } from "./reasons.js";

export const ACTION_NAMES = [
  "getMerchantSummary",
  "explainFee",
  "checkDeviceHealth",
  "raiseTicket",
  "proposePlan",
  "changePlan",
  "scheduleHumanCallback",
  "recordOutcome",
  "recordOptOut",
  "sendAppMessage",
  "requestDeviceReturn",
  "confirmFix",
  "checkLoan",
  "setReducedEmi",
  "proposeLoan",
  "acceptLoan",
] as const;
export const ActionName = z.enum(ACTION_NAMES);
export type ActionName = z.infer<typeof ActionName>;

export const Channel = z.enum(["soundbox", "app", "salesperson_visit", "human_callback", "inbound"]);
export type Channel = z.infer<typeof Channel>;

export const Brief = z.object({
  briefId: z.string(),
  merchantId: z.string(),
  displayName: z.string(),
  language: z.string(),
  channel: Channel,
  problem: ReasonCode,
  approachId: z.string(),
  goal: z.string(),
  facts: z.record(z.string(), z.union([z.number(), z.string()])),
  allowedActions: z.array(ActionName),
  limits: z.object({ maxDiscountInr: z.number() }),
  mustSay: z.array(z.string()),
  mustNot: z.array(z.string()),
  escalateIf: z.array(z.string()),
  successCriteria: z.string(),
});
export type Brief = z.infer<typeof Brief>;

export const OutcomeKind = z.enum(["stayed", "plan_changed", "ticket_raised", "fix_confirmed", "emi_reset", "loan_accepted", "handed_off", "return_requested", "later", "undecided", "opted_out", "left", "no_response"]);
export type OutcomeKind = z.infer<typeof OutcomeKind>;

export const Outcome = z.object({
  briefId: z.string(),
  outcome: OutcomeKind,
  reasons: z.array(z.object({ code: ReasonCode, quote: z.string() })),
  actionsTaken: z.array(ActionName),
  durationSec: z.number(),
  numbersVerified: z.boolean(),
  numbersChecked: z.number().default(0),
  summary: z.string(),
  handledBy: z.enum(["ai", "human"]).default("ai"),
});
export type Outcome = z.infer<typeof Outcome>;

// A problem only counts as solved when the shop says so. A raised ticket is work in progress.
export const SOLVED: readonly OutcomeKind[] = ["stayed", "plan_changed", "fix_confirmed", "emi_reset", "loan_accepted"];

export const MUST_SAY = ["Main Paytm ki AI assistant hoon.", "Paytm kabhi OTP ya PIN nahi maangta."];
export const MUST_NOT = [
  "Ask for OTP, PIN, password, card or bank details",
  "Send links",
  "Advise splitting payments or accounts to avoid the fee",
  "Suggest charging customers extra",
  "Ask about competitors",
  "Promise a refund, a waiver or a date",
  "Offer a discount unless the shop says it is leaving",
  "Threaten, shame or pressure anyone over dues",
  "State any loan figure that a tool did not give",
];
export const ESCALATE_IF = ["Merchant asks for a person", "Merchant is abusive", "Merchant mentions legal action or fraud", "Merchant is still unhappy after one explanation"];
