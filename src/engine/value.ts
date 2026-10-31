import { COST, VALUE } from "../../config/value.js";
import { PLANS } from "../../config/plans.js";
import type { Features } from "../features/buildFeatures.js";
import type { Merchant } from "../sim/types.js";

export interface ShopValue {
  rentYear: number;
  marginYear: number;
  loanYear: number;
  total: number;
  loanReady: boolean;
}

const round = (n: number) => Math.round(n);

export function shopValue(m: Pick<Merchant, "monthlyRent">, monthlyCollections: number, tenureDays: number, failRate: number): ShopValue {
  const rentYear = m.monthlyRent * 12;
  const marginYear = monthlyCollections * 12 * VALUE.paymentMargin;
  const loanReady = monthlyCollections >= VALUE.loanReadyMonthlyCollections && tenureDays >= VALUE.loanReadyTenureDays && failRate < 0.1;
  const loanYear = loanReady ? VALUE.financialRevenuePerCustomerYear * VALUE.loanTakeUpIfReady : 0;
  return { rentYear: round(rentYear), marginYear: round(marginYear), loanYear: round(loanYear), total: round(rentYear + marginYear + loanYear), loanReady };
}

export const valueOf = (m: Merchant, f: Features, day: number) => shopValue(m, f.monthlyCollections, day - m.onboardDay, f.failRate7);

// One move's cost, whether or not it works.
export function moveCost(approachId: string) {
  const talk = COST.conversationPerMinute * COST.conversationMinutes;
  if (approachId === "device_ticket_first") return talk + COST.ticket + COST.replacementDevice;
  if (approachId === "device_troubleshoot_first") return talk + 0.5 * (COST.ticket + COST.replacementDevice);
  if (approachId === "settlement_status_and_ticket") return talk + COST.ticket;
  if (approachId.endsWith("_offer_human")) return talk + COST.humanCallback;
  if (approachId === "salesperson_visit") return COST.salespersonVisit;
  if (approachId === "human_callback") return COST.humanCallback;
  return talk;
}

// Rent given up over a year if the shop takes the cheapest allowed plan.
export function discountYear(rent: number) {
  const cheapest = Math.min(...PLANS.map((p) => p.monthlyRent));
  return Math.max(0, rent - cheapest) * 12;
}

// What a shop kept by this move earns Paytm, after the moves that come with it.
export function keptWorth(approachId: string, value: number, rent: number) {
  return approachId === "rent_right_size_plan" ? value - COST.discountTakeRate * discountYear(rent) : value;
}
