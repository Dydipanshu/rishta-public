// UPI merchant fee rules (section 7 of CLAUDE.md).
export const FEES = {
  ratePct: 0.4,
  freeUptoInr: 2000,
  capPerPaymentInr: 300,
  gstPct: 18,
  zeroFeeMonthlyLimitInr: 100_000,
  monthsAboveToMove: 3,
} as const;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function feeOn(valueAboveThreshold: number) {
  const fee = round2((valueAboveThreshold * FEES.ratePct) / 100);
  const gst = round2((fee * FEES.gstPct) / 100);
  return { fee, gst, total: round2(fee + gst) };
}
