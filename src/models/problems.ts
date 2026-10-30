import type { Features } from "../features/buildFeatures.js";
import type { ReasonCode } from "../engine/reasons.js";

export interface Detected {
  problem: ReasonCode;
  why: string; // plain words for the console
  thresholdHeadsUp?: boolean;
}

// Median rent ÷ collections across all active shops on the bench.
export const TYPICAL_RENT_SHARE = 0.0036;

const pct = (n: number) => `${Math.round(Math.abs(n) * 100)}%`;

// Rules map data signals to likely reasons. Order is priority.
export function detectProblem(f: Features): Detected | null {
  if (f.openTickets >= 3) {
    return { problem: "support_unresolved", why: `${f.openTickets} tickets still open with no fix` };
  }
  if (f.battery7 >= 5 && f.failRate7 >= 0.1) {
    return { problem: "device_fault", why: `Payments down ${pct(f.drop3Weeks)} in 3 weeks, ${f.battery7} battery alerts, ${pct(f.failRate7)} of payments failing` };
  }
  if (f.feePaid28 > 0 && (f.feeTickets28 > 0 || (f.settlementTickets28 > 0 && f.avgDelay7 < 24))) {
    return { problem: "fee_confusion", why: "Settlement looked short after the fee started" };
  }
  if (f.avgDelay7 >= 24 || f.settlementTickets28 >= 1) {
    return { problem: "settlement_delay", why: `Settlements taking ${Math.round(f.avgDelay7)} hours, ${f.settlementTickets28} complaints this month` };
  }
  if (f.rentTickets28 > 0 || (f.rentShare >= 0.006 && f.trend28v90 <= -0.1)) {
    return { problem: "rent_too_high", why: `Rent takes ${(f.rentShare * 100).toFixed(1)}% of collections, ${Math.round(f.rentShare / TYPICAL_RENT_SHARE)}× a typical shop${f.rentTickets28 > 0 ? "; the shop has complained about it" : ""}` };
  }
  if (f.monthsNearThreshold >= 2) {
    return { problem: "fee_confusion", why: "2 months above ₹1 lakh; a 3rd moves the shop to the paying category", thresholdHeadsUp: true };
  }
  if (f.trend7v28 <= -0.3) {
    return { problem: "rival_offer", why: `Sudden ${pct(f.trend7v28)} drop with no device fault` };
  }
  if (f.trend28v90 <= -0.2) {
    return { problem: "low_sales_season", why: `Payments ${pct(f.trend28v90)} down, no complaints` };
  }
  return null;
}
