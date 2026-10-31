import { FEES } from "../../config/fees.js";
import { MAX_MONTHLY_DISCOUNT_INR, eligiblePlans } from "../../config/plans.js";
import { buildFeatures } from "../features/buildFeatures.js";
import { TYPICAL_RENT_SHARE } from "../models/problems.js";
import type { Merchant } from "../sim/types.js";
import { stockPlan } from "./loans.js";
import type { ReasonCode } from "./reasons.js";

const round = (n: number) => Math.round(n);
const round2 = (n: number) => Math.round(n * 100) / 100;

export function summaryFacts(m: Merchant, day: number) {
  const last30 = m.days.slice(Math.max(0, day - 29), day + 1);
  const latest = m.days[day]!;
  // Same day the phone shows as today's collection, so the agent and the screen always agree.
  const today = m.days[day - 1]!;
  const yesterday = m.days[day - 2]!;
  const sum = (from: number, to: number) => round(m.days.slice(Math.max(0, from), to).reduce((s, d) => s + d.value, 0));
  const week = sum(day - 7, day);
  const lastWeek = sum(day - 14, day - 7);
  return {
    salesTodayInr: round(today.value),
    paymentsToday: today.count,
    salesYesterdayInr: round(yesterday.value),
    salesLast7DaysInr: week,
    salesPrevious7DaysInr: lastWeek,
    salesChange7DaysPct: lastWeek > 0 ? round(((week - lastWeek) / lastWeek) * 100) : 0,
    salesChange7DaysInr: Math.abs(week - lastWeek),
    salesWindowDays: 7,
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
    paymentsInSettlement: d.count,
    paymentsFreeOfFee: Math.max(0, d.count - d.countAbove),
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

// Everything on record for this shop, for questions the brief didn't plan for. Never holds phone, bank or KYC data.
// Whether the zero-fee limit applies to this shop, worked out month by month from its own payments.
export function feeRuleFacts(m: Merchant, day: number) {
  const month = (back: number) => m.days.slice(Math.max(0, day - 30 * (back + 1)), day - 30 * back).reduce((s, d) => s + d.value, 0);
  let monthsAboveLimit = 0;
  while (monthsAboveLimit < 6 && month(monthsAboveLimit) > FEES.zeroFeeMonthlyLimitInr) monthsAboveLimit++;
  return { zeroFeeLimitInr: FEES.zeroFeeMonthlyLimitInr, monthsAboveLimit, monthsToMove: FEES.monthsAboveToMove, shopPaysFeeNow: m.feeCategory === "P2M" ? "yes" : "no", feeRatePct: FEES.ratePct, gstPct: FEES.gstPct, freeUptoInr: FEES.freeUptoInr };
}

export function shopProfile(m: Merchant, day: number) {
  const f = buildFeatures(m, day);
  const last = m.days[day - 1]!;
  const sum = (from: number, to: number, pick: (d: Merchant["days"][number]) => number) => round(m.days.slice(Math.max(0, from), to).reduce((s, d) => s + pick(d), 0));
  const calendar = (ago: number) => {
    const date = new Date(Date.now() - ago * 86_400_000);
    return { dayOfMonth: date.getDate(), month: date.toLocaleString("en-IN", { month: "long" }), weekday: date.toLocaleString("en-IN", { weekday: "long" }) };
  };
  // Oldest index is 30 days back. Rupees per day, with the date, so "15 tarikh" can be answered.
  const days = Array.from({ length: 30 }, (_, ago) => {
    const d = m.days[day - 1 - ago]!;
    return { ...calendar(ago), salesInr: round(d.value), payments: d.count, receivedInr: round2(d.value - d.fee - d.gst) };
  });
  const best = days.reduce((a, b) => (b.salesInr > a.salesInr ? b : a));
  const worst = days.reduce((a, b) => (b.salesInr < a.salesInr ? b : a));
  const weeks = Array.from({ length: 8 }, (_, i) => round(m.days.slice(Math.max(0, day - 7 * (i + 1)), day - 7 * i).reduce((s, d) => s + d.value, 0)));
  return {
    category: m.category, city: m.city, planId: m.planId, monthlyRentInr: m.monthlyRent,
    salesPerWeekNewestFirstInr: weeks,
    sales30DaysInr: sum(day - 30, day, (d) => d.value),
    salesPrevious30DaysInr: sum(day - 60, day - 30, (d) => d.value),
    received30DaysInr: sum(day - 30, day, (d) => d.value - d.fee - d.gst),
    feeAndGst30DaysInr: round2(m.days.slice(day - 30, day).reduce((s, d) => s + d.fee + d.gst, 0)),
    bestDay: best, slowestDay: worst, last30Days: days,
    ...feeRuleFacts(m, day),
    averagePaymentInr: last.count > 0 ? round(last.value / last.count) : 0,
    repeatCustomerSharePct: round(last.repeatShare * 100),
    ...summaryFacts(m, day), ...deviceFacts(m, day), ...settlementFacts(m, day), ...stockPlan(m),
  };
}

export function deviceFacts(m: Merchant, day: number) {
  const f = buildFeatures(m, day);
  return {
    periodDays: 7,
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
    typicalRentSharePct: round2(TYPICAL_RENT_SHARE * 100),
    cheapestEligibleRentInr: plans.at(-1)?.monthlyRent ?? m.monthlyRent,
  };
}

export function settlementFacts(m: Merchant, day: number) {
  const f = buildFeatures(m, day);
  return { periodDays: 7, avgSettlementHours7Days: round(f.avgDelay7), openTickets: f.openTickets };
}

export function factsFor(m: Merchant, day: number, problem: ReasonCode, headsUp: boolean): Record<string, number | string> {
  // Bench shops have no owner name, so they are addressed by the shop's first word.
  const firstName = /^(ji|जी)$/i.test(m.firstName) ? m.name.split(" ")[0]! : m.firstName;
  const base = { firstName, businessName: m.name, noContactDaysAfterHardTime: 30, ...summaryFacts(m, day) };
  if (problem === "loan_opportunity") return { ...base, ...stockPlan(m) };
  if (headsUp) return { ...base, zeroFeeLimitInr: FEES.zeroFeeMonthlyLimitInr, monthsAboveLimit: 2, monthsToMove: FEES.monthsAboveToMove, freeUptoInr: FEES.freeUptoInr };
  if (problem === "fee_confusion") return { ...base, ...feeFacts(m, day) };
  if (problem === "device_fault") return { ...base, ...deviceFacts(m, day) };
  if (problem === "rent_too_high") return { ...base, ...rentFacts(m, day) };
  return { ...base, ...settlementFacts(m, day) };
}
