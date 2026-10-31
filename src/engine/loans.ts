import { LENDER_RULES, LOAN_TERMS, OFFER, STOCK } from "../../config/loans.js";
import { VALUE } from "../../config/value.js";
import type { Features } from "../features/buildFeatures.js";
import { TODAY, type Merchant } from "../sim/types.js";

export interface ActiveLoan {
  emiInr: number;
  missedEmis: number;
  onTimeMonths: number;
  remainingEmis: number;
}

const DEMO_LOANS: Record<string, ActiveLoan> = { M007: { emiInr: 2400, missedEmis: 3, onTimeMonths: 14, remainingEmis: 10 } };
const hash = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 9973, 7);

// The bench's loan book, stable per shop. In production this is a read from the lending system.
export function loanOf(m: Merchant, f: Features): ActiveLoan | null {
  if (m.isDemo) return DEMO_LOANS[m.id] ?? null;
  const h = hash(m.id);
  if (h % 100 >= 6) return null;
  const emiInr = Math.max(500, Math.round((f.monthlyCollections * 0.04) / 100) * 100);
  const missedEmis = f.drop3Weeks >= 0.3 ? 1 + (h % 3) : h % 20 === 0 ? 2 : 0;
  return { emiInr, missedEmis, onTimeMonths: 3 + (h % 18), remainingEmis: 4 + (h % 12) };
}

const pct = (f: Features) => Math.round(f.drop3Weeks * 100);

// Decided from the shop's own sales and record, never from what the model thinks.
export function hardship(loan: ActiveLoan, f: Features) {
  const salesDropPct = Math.max(0, pct(f));
  const genuine = salesDropPct >= LENDER_RULES.minSalesDropPct && loan.onTimeMonths >= 6;
  return {
    hasLoan: true, emiInr: loan.emiInr, missedEmis: loan.missedEmis, overdueInr: loan.emiInr * loan.missedEmis, remainingEmis: loan.remainingEmis, totalLeftToPayInr: loan.emiInr * (loan.remainingEmis + loan.missedEmis), onTimeMonthsBefore: loan.onTimeMonths, salesDropPct, genuineHardship: genuine,
    reducedEmiInr: genuine ? Math.ceil((loan.emiInr * (100 - LENDER_RULES.maxEmiCutPct)) / 100) : null,
    reliefMonths: genuine ? LENDER_RULES.maxReliefMonths : null,
    nextStep: genuine ? "Offer the reduced EMI." : "No reduced EMI is available. A person can review this.",
  };
}

// What the shop's next stock costs, from its own recent sales.
export function stockPlan(m: Merchant, day = TODAY) {
  const recent = m.days.slice(day - 20, day + 1);
  const dailySalesInr = Math.round(recent.reduce((s, d) => s + d.value, 0) / recent.length);
  return { dailySalesInr, stockCoverDays: STOCK.coverDays, stockNeedInr: Math.round(dailySalesInr * STOCK.coverDays * STOCK.costShare), salesGrowthPct: growthPct(m, day) };
}

export function loanOffer(m: Merchant, f: Features, day = TODAY) {
  if (loanOf(m, f)) return { eligible: false as const, why: "The shop already has a Paytm loan." };
  const ready = f.monthlyCollections >= VALUE.loanReadyMonthlyCollections && f.failRate7 < 0.1;
  const stock = stockPlan(m, day);
  // Sized to the shop's next stock, never above one month's collections.
  const amountInr = Math.max(OFFER.minAmountInr, Math.min(OFFER.maxAmountInr, Math.floor(Math.min(f.monthlyCollections, stock.stockNeedInr) / OFFER.roundToInr) * OFFER.roundToInr));
  if (!ready || amountInr < OFFER.minAmountInr) return { eligible: false as const, why: "The shop needs a few more months of steady collections." };
  return {
    eligible: true as const,
    ...stock,
    stockMonths: 1,
    amountBasis: "Set from a month of this shop's stock and never above one month's collections. A bigger amount needs higher collections.",
    options: LOAN_TERMS.map((t) => ({ optionId: t.optionId, amountInr, days: t.days, dailyInr: Math.ceil((amountInr * t.repayFactor) / t.days), totalRepayInr: Math.ceil((amountInr * t.repayFactor) / t.days) * t.days, extraCostInr: Math.ceil((amountInr * t.repayFactor) / t.days) * t.days - amountInr })),
    note: "Illustrative offer. The lender makes the final decision.",
  };
}

// Last 21 days against the 30 before them.
function growthPct(m: Merchant, day: number) {
  const avg = (from: number, to: number) => m.days.slice(from, to + 1).reduce((s, d) => s + d.value, 0) / (to - from + 1);
  const before = avg(day - 50, day - 21);
  return before > 0 ? Math.round((avg(day - 20, day) / before - 1) * 100) : 0;
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export type LoanCheck = "ready" | "ticket" | "failing" | "falling" | "repayment" | "growth";

// Whether Rishta may raise a loan itself today. Every "no" comes with the reason, in the shop's own numbers.
// "sized" means the shop is big enough to be worth checking at all.
export function loanGate(m: Merchant, f: Features, day = TODAY): { sized: boolean; check: LoanCheck | null; why: string } {
  const offer = loanOffer(m, f, day);
  if (!offer.eligible) return { sized: false, check: null, why: offer.why };
  if (f.monthlyCollections < OFFER.minMonthlyInr) return { sized: false, check: null, why: `Collects ${inr(f.monthlyCollections)} a month, under the ${inr(OFFER.minMonthlyInr)} needed.` };
  const no = (check: LoanCheck, why: string) => ({ sized: true, check, why });
  if (f.openTickets > 0) return no("ticket", `${f.openTickets} open ${f.openTickets === 1 ? "ticket" : "tickets"}. Fix that before selling anything.`);
  const sum = (from: number, to: number) => m.days.slice(from, to).reduce((s, d) => s + d.value, 0);
  const [week, before] = [sum(day - 6, day + 1), sum(day - 13, day - 6)];
  if (week < 0.9 * before) return no("falling", `Sales down ${Math.round((1 - week / before) * 100)}% this week. Not the moment for new debt.`);
  const sharePct = Math.round((offer.options[0]!.dailyInr / offer.dailySalesInr) * 100);
  if (sharePct > STOCK.maxDailyShareOfSales * 100) return no("repayment", `Repaying ${inr(offer.options[0]!.dailyInr)} a day would take ${sharePct}% of daily sales. The limit is ${STOCK.maxDailyShareOfSales * 100}%.`);
  if (offer.salesGrowthPct < OFFER.minGrowthPct) return no("growth", `Sales up ${offer.salesGrowthPct}%, under the ${OFFER.minGrowthPct}% that shows new stock is needed.`);
  return { sized: true, check: "ready", why: `Sales up ${offer.salesGrowthPct}% and steady.` };
}

// The shop itself asked how to grow. Rishta may ask once if it wants to see the loan option, even when it would not raise a loan unprompted.
// Never if the repayment wouldn't be affordable: that is the one rule a shop's interest can't lift.
export function canMentionLoan(m: Merchant, f: Features, day = TODAY) {
  if (m.holdout || m.optedOut) return false;
  const offer = loanOffer(m, f, day);
  return offer.eligible && offer.options[0]!.dailyInr <= offer.dailySalesInr * STOCK.maxDailyShareOfSales;
}

// Which loan conversation the morning run should start, if any.
export function loanCase(m: Merchant, f: Features, day = TODAY) {
  const loan = loanOf(m, f);
  if (loan && loan.missedEmis > 0) return "loan_overdue" as const;
  return loanGate(m, f, day).check === "ready" ? ("loan_opportunity" as const) : null;
}
