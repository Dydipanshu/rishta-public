import { FEES } from "../../config/fees.js";
import { MAX_MONTHLY_DISCOUNT_INR, eligiblePlans } from "../../config/plans.js";
import { buildFeatures } from "../features/buildFeatures.js";
import type { Merchant } from "../sim/types.js";
import type { ReasonCode } from "./reasons.js";

const round = (n: number) => Math.round(n);
const round2 = (n: number) => Math.round(n * 100) / 100;

export function summaryFacts(m: Merchant, day: number) {
  const last30 = m.days.slice(Math.max(0, day - 29), day + 1);
  const latest = m.days[day]!;
  return {
    collections30DaysInr: round(last30.reduce((s, d) => s + d.value, 0)),
    payments30Days: last30.reduce((s, d) => s + d.count, 0),
    customers30Days: last30.reduce((s, d) => s + d.uniquePayers, 0),
    latestSettlementGrossInr: round2(latest.value),
    latestSettlementNetInr: round2(latest.value - latest.fee - latest.gst),
  };
}

export function feeFacts(m: Merchant, day: number) {
  const d = m.days[day]!;
  return {
    paymentsAbove2000Count: d.countAbove,
    paymentsAbove2000TotalInr: round2(d.valueAbove),
    feeInr: d.fee,
    gstInr: d.gst,
    feePlusGstInr: round2(d.fee + d.gst),
    freeUptoInr: FEES.freeUptoInr,
    feeRatePct: FEES.ratePct,
    gstPct: FEES.gstPct,
  };
}

export function deviceFacts(m: Merchant, day: number) {
  const f = buildFeatures(m, day);
  return {
    batteryAlerts7Days: f.battery7,
    offlineHours7Days: round(f.offline7),
    failedPaymentsPct7Days: round(f.failRate7 * 100),
    paymentDropPct3Weeks: round(f.drop3Weeks * 100),
  };
}

export function rentFacts(m: Merchant, day: number) {
  const f = buildFeatures(m, day);
  const plans = eligiblePlans(m.monthlyRent, MAX_MONTHLY_DISCOUNT_INR);
  return {
    monthlyRentInr: m.monthlyRent,
    rentSharePct: round2(f.rentShare * 100),
    cheapestEligibleRentInr: plans.at(-1)?.monthlyRent ?? m.monthlyRent,
  };
}

export function settlementFacts(m: Merchant, day: number) {
  const f = buildFeatures(m, day);
  return { avgSettlementHours7Days: round(f.avgDelay7), openTickets: f.openTickets };
}

export function factsFor(m: Merchant, day: number, problem: ReasonCode, headsUp: boolean): Record<string, number | string> {
  const base = { firstName: m.firstName, businessName: m.name, ...summaryFacts(m, day) };
  if (headsUp) return { ...base, zeroFeeLimitInr: FEES.zeroFeeMonthlyLimitInr, monthsAboveLimit: 2, monthsToMove: FEES.monthsAboveToMove, freeUptoInr: FEES.freeUptoInr };
  if (problem === "fee_confusion") return { ...base, ...feeFacts(m, day) };
  if (problem === "device_fault") return { ...base, ...deviceFacts(m, day) };
  if (problem === "rent_too_high") return { ...base, ...rentFacts(m, day) };
  return { ...base, ...settlementFacts(m, day) };
}
