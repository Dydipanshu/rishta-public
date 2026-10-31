// Bench terms, illustrative. In production these come from the lender.
export const LENDER_RULES = { minSalesDropPct: 30, maxEmiCutPct: 50, maxReliefMonths: 2 };
export const LOAN_TERMS = [
  { optionId: "days_360", days: 360, repayFactor: 1.296 },
  { optionId: "days_540", days: 540, repayFactor: 1.404 },
];
// A month's stock, at what a small shop typically pays for goods. Bench assumption, shown as an estimate.
export const STOCK = { coverDays: 30, costShare: 0.7, maxDailyShareOfSales: 0.15 };
// When Rishta may raise a loan itself. All of these must hold; change them here. A shop that asks always gets an answer.
// No loan already, 50k+ a month, sales up 30%+, last 7 days not down more than 10%, no open ticket, failed payments under 10%,
// daily repayment at most 15% of daily sales, and no loan conversation in the last 60 days.
export const OFFER = { minAmountInr: 30_000, maxAmountInr: 5_00_000, roundToInr: 10_000, minGrowthPct: 30, minMonthlyInr: 50_000, cooldownDays: 60 };
