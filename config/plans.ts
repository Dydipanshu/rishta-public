// Illustrative plan catalogue. Rents of 129 and 149 are public; 99 is a stand-in.
export const PLANS = [
  { id: "SB_149", name: "Soundbox Plus", monthlyRent: 149 },
  { id: "SB_129", name: "Soundbox Standard", monthlyRent: 129 },
  { id: "SB_99", name: "Soundbox Lite", monthlyRent: 99 },
] as const;

export type PlanId = (typeof PLANS)[number]["id"];

export const MAX_MONTHLY_DISCOUNT_INR = 50;

export function eligiblePlans(currentRent: number, maxDiscountInr: number) {
  return PLANS.filter((p) => p.monthlyRent < currentRent && currentRent - p.monthlyRent <= maxDiscountInr);
}
