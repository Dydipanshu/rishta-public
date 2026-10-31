// Bench terms, illustrative. In production these come from the lender.
export const LENDER_RULES = { minSalesDropPct: 30, maxEmiCutPct: 50, maxReliefMonths: 2 };
export const LOAN_TERMS = [
  { optionId: "days_360", days: 360, repayFactor: 1.296 },
  { optionId: "days_540", days: 540, repayFactor: 1.404 },
];
export const OFFER = { minAmountInr: 30_000, maxAmountInr: 5_00_000, roundToInr: 10_000, minGrowthPct: 30, minMonthlyInr: 50_000 };
