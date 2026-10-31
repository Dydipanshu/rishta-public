import { LENDER_RULES, LOAN_TERMS, OFFER } from "../../config/loans.js";
import { VALUE } from "../../config/value.js";
import type { Features } from "../features/buildFeatures.js";
import { TODAY, type Merchant } from "../sim/types.js";

export interface ActiveLoan {
  emiInr: number;
  missedEmis: number;
  onTimeMonths: number;
}

const DEMO_LOANS: Record<string, ActiveLoan> = { M007: { emiInr: 2400, missedEmis: 3, onTimeMonths: 14 } };
const hash = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 9973, 7);

// The bench's loan book, stable per shop. In production this is a read from the lending system.
export function loanOf(m: Merchant, f: Features): ActiveLoan | null {
  if (m.isDemo) return DEMO_LOANS[m.id] ?? null;
  const h = hash(m.id);
  if (h % 100 >= 6) return null;
  const emiInr = Math.max(500, Math.round((f.monthlyCollections * 0.04) / 100) * 100);
  const missedEmis = f.drop3Weeks >= 0.3 ? 1 + (h % 3) : h % 20 === 0 ? 2 : 0;
  return { emiInr, missedEmis, onTimeMonths: 3 + (h % 18) };
}

const pct = (f: Features) => Math.round(f.drop3Weeks * 100);

// Decided from the shop's own sales and record, never from what the model thinks.
export function hardship(loan: ActiveLoan, f: Features) {
  const salesDropPct = Math.max(0, pct(f));
  const genuine = salesDropPct >= LENDER_RULES.minSalesDropPct && loan.onTimeMonths >= 6;
  return {
    hasLoan: true, emiInr: loan.emiInr, missedEmis: loan.missedEmis, overdueInr: loan.emiInr * loan.missedEmis, onTimeMonthsBefore: loan.onTimeMonths, salesDropPct, genuineHardship: genuine,
    reducedEmiInr: genuine ? Math.ceil((loan.emiInr * (100 - LENDER_RULES.maxEmiCutPct)) / 100) : null,
    reliefMonths: genuine ? LENDER_RULES.maxReliefMonths : null,
    nextStep: genuine ? "Offer the reduced EMI." : "No reduced EMI is available. A person can review this.",
  };
}

export function loanOffer(m: Merchant, f: Features) {
  if (loanOf(m, f)) return { eligible: false as const, why: "The shop already has a Paytm loan." };
  const ready = f.monthlyCollections >= VALUE.loanReadyMonthlyCollections && f.failRate7 < 0.1;
  const amountInr = Math.min(OFFER.maxAmountInr, Math.floor(f.monthlyCollections / OFFER.roundToInr) * OFFER.roundToInr);
  if (!ready || amountInr < OFFER.minAmountInr) return { eligible: false as const, why: "The shop needs a few more months of steady collections." };
  return {
    eligible: true as const,
    options: LOAN_TERMS.map((t) => ({ optionId: t.optionId, amountInr, days: t.days, dailyInr: Math.ceil((amountInr * t.repayFactor) / t.days), totalRepayInr: Math.ceil((amountInr * t.repayFactor) / t.days) * t.days })),
    note: "Illustrative offer. The lender makes the final decision.",
  };
}

// Last 21 days against the 30 before them.
function growthPct(m: Merchant) {
  const avg = (from: number, to: number) => m.days.slice(from, to + 1).reduce((s, d) => s + d.value, 0) / (to - from + 1);
  const before = avg(TODAY - 50, TODAY - 21);
  return before > 0 ? Math.round((avg(TODAY - 20, TODAY) / before - 1) * 100) : 0;
}

// Which loan conversation the morning run should start, if any.
export function loanCase(m: Merchant, f: Features) {
  const loan = loanOf(m, f);
  if (loan && loan.missedEmis > 0) return "loan_overdue" as const;
  const offer = loanOffer(m, f);
  return offer.eligible && growthPct(m) >= OFFER.minGrowthPct && f.monthlyCollections >= OFFER.minMonthlyInr ? ("loan_opportunity" as const) : null;
}
