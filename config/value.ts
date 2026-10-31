// What a shop is worth to Paytm, and what each move costs. Every figure is an assumption you can change.
// Source: Paytm Q2 FY27 earnings release, unless marked as our estimate.
export const VALUE = {
  // Estimate: Paytm's margin on a shop's payments. Conservative; the release reports over 4 bps of processing margin expansion, not a level.
  paymentMargin: 0.0003,
  // ₹912 Cr a quarter across 8.8 lakh financial-services customers is about ₹41,000 a year each.
  // That figure includes consumers, so we use half.
  financialRevenuePerCustomerYear: 20_000,
  // 8.8 lakh of 1.64 Cr is about 5%. A shop that passes the checks below is assumed to be twice as likely.
  loanTakeUpIfReady: 0.1,
  loanReadyMonthlyCollections: 30_000,
  loanReadyTenureDays: 180,
} as const;

export const COST = {
  conversationPerMinute: 3, // list prices: speech to text, text to speech, model
  conversationMinutes: 1,
  ticket: 25, // estimate
  replacementDevice: 560, // Paytm says refurbishing costs 25–30% of a new device; assumes a ₹2,000 device
  humanCallback: 30, // estimate: 10 minutes of the cost per sales employee below
  // ₹370 Cr a quarter across 51,832 sales staff is ₹23,800 a month each. Assumes 250 visits a month.
  salespersonVisit: 95,
  // Share of shops that take a cheaper plan when offered. Estimate.
  discountTakeRate: 0.35,
} as const;

export const FOLLOW_UP_DAYS = 3;
export const CARE_DAYS = 30;
export const FRAUD_HELPLINE = "1930"; // India's national cybercrime helpline

// Rough size of loan a person can discuss: one month's collections, rounded down. Illustrative; the lender decides.
export const LOAN_GUIDE = { monthsOfCollections: 1, roundTo: 10_000 };
