import { z } from "zod";
import { feeOn } from "../../config/fees.js";
import { FEE_START_DAY, SIM_DAYS, TODAY, type Merchant, type Ticket } from "./types.js";
import { dayRow } from "./demoMerchants.js";
import { makeRng } from "./rng.js";

export const CATEGORIES = {
  kirana: "grocery", sweets: "grocery", chemist: "health", "tea stall": "food", snacks: "food", restaurant: "food",
  electronics: "retail", clothing: "retail", footwear: "retail", fruits: "fresh", vegetables: "fresh",
} as const;

const METROS = new Set(["delhi", "mumbai", "bengaluru", "bangalore", "chennai", "kolkata", "hyderabad", "pune", "ahmedabad"]);
// Names go to the model and the speech step, so only letters and simple marks get through.
const clean = (s: string) => s.replace(/[^\p{L}\p{M} .&'-]/gu, "").replace(/\s+/g, " ").trim();
const text = (min: number, max: number) => z.string().transform(clean).pipe(z.string().min(min).max(max));

export const CustomShop = z.object({
  name: text(2, 40),
  owner: text(2, 20),
  city: text(2, 30),
  category: z.enum(Object.keys(CATEGORIES) as [keyof typeof CATEGORIES, ...(keyof typeof CATEGORIES)[]]),
  monthlySales: z.number().int().min(3000).max(2_000_000),
  trend: z.enum(["growing", "steady", "falling"]),
  rent: z.union([z.literal(99), z.literal(129), z.literal(149)]),
  problem: z.enum(["none", "fee", "device", "settlement", "rent"]),
}).strict();
export type CustomShop = z.infer<typeof CustomShop>;

// The fee only applies above ₹1 lakh a month, so a shop that wants to see it needs those sales.
const FEE_SALES = 140_000;

export function buildCustomShop(id: string, input: CustomShop, seed: number): Merchant {
  const { problem, trend } = input;
  const monthly = problem === "fee" ? Math.max(input.monthlySales, FEE_SALES) : input.monthlySales;
  const paysFee = monthly > 100_000;
  const rng = makeRng(`${seed}-${id}-${input.name}`);
  const recent = (day: number) => day > TODAY - 21;
  const shift = trend === "growing" ? 1.3 : trend === "falling" ? 0.62 : 1;
  const base = (monthly / 30) * (problem === "device" ? 1.25 : 1);
  const days = Array.from({ length: SIM_DAYS }, (_, day) => {
    const fault = problem === "device" && recent(day);
    const worn = fault ? 1 - (0.45 * (day - (TODAY - 21))) / 21 : 1;
    const d = dayRow(rng, base * worn * (recent(day) ? shift : 1), fault ? 0.2 : 0.03, 110);
    if (fault) Object.assign(d, { batteryAlerts: 2, offlineHours: 2, errors: 1 });
    if (problem === "settlement" && day > TODAY - 14) d.delayHours = 44;
    if (paysFee && day >= FEE_START_DAY) {
      const above = Math.max(1, Math.round(d.count * 0.08));
      const valueAbove = Math.min(above * 2375, Math.round(d.value * 0.6));
      const { fee, gst } = feeOn(valueAbove);
      Object.assign(d, { countAbove: above, valueAbove, fee, gst });
    }
    return d;
  });
  const notes: Partial<Record<CustomShop["problem"], Omit<Ticket, "id" | "closedDay">>> = {
    fee: { type: "settlement", openedDay: TODAY - 1, note: "Settlement looks less than expected" },
    settlement: { type: "settlement", openedDay: TODAY - 8, note: "Settlement delayed" },
    rent: { type: "rent", openedDay: TODAY - 6, note: "Rent feels high" },
  };
  const ticket = notes[problem];
  return {
    id,
    name: input.name,
    firstName: input.owner.split(" ")[0]!,
    city: input.city,
    cityTier: METROS.has(input.city.toLowerCase()) ? 1 : 2,
    category: input.category,
    categoryGroup: CATEGORIES[input.category],
    language: "hi-en",
    deviceType: "soundbox",
    planId: `SB_${input.rent}`,
    monthlyRent: input.rent,
    onboardDay: -400,
    feeCategory: paysFee ? "P2M" : "P2PM",
    consentProfiling: true,
    consentMessages: true,
    optedOut: false,
    holdout: false,
    isDemo: true,
    days,
    tickets: ticket ? [{ ...ticket, id: `T-${id}-1`, closedDay: null }] : [],
    lastContactDay: null,
    trueCause: "none",
    causeOnset: -1,
    churnDay: null,
  };
}
