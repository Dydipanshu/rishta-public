import { feeOn } from "../../config/fees.js";
import type { DayRow, Merchant, Ticket } from "./types.js";
import { SIM_DAYS, TODAY } from "./types.js";
import { makeRng, normal, type Rng } from "./rng.js";

const dayRow = (rng: Rng, value: number, failRate: number, ticketSize: number): DayRow => {
  const v = Math.max(0, Math.round(value * (1 + 0.12 * normal(rng))));
  const count = Math.max(0, Math.round(v / ticketSize));
  return {
    count,
    value: v,
    countAbove: 0,
    valueAbove: 0,
    failed: Math.round(count * failRate),
    uniquePayers: Math.round(count * 0.7),
    repeatShare: 0.55,
    offlineHours: 0,
    batteryAlerts: 0,
    errors: 0,
    delayHours: 12,
    fee: 0,
    gst: 0,
  };
};

interface Spec extends Omit<Partial<Merchant>, "tickets"> {
  id: string;
  name: string;
  firstName: string;
  city: string;
  cityTier: 1 | 2 | 3;
  category: string;
  categoryGroup: string;
  daily: (day: number) => number;
  failRate?: (day: number) => number;
  patch?: (d: DayRow, day: number) => void;
  tickets?: Omit<Ticket, "id">[];
}

const SPECS: Spec[] = [
  {
    id: "M001",
    name: "Ramesh General Store",
    firstName: "Ramesh",
    city: "Lucknow",
    cityTier: 2,
    category: "kirana",
    categoryGroup: "grocery",
    feeCategory: "P2M",
    planId: "SB_149",
    monthlyRent: 149,
    daily: (day) => (day > TODAY - 14 ? 3300 : 5600),
    tickets: [
      { type: "settlement", openedDay: TODAY - 1, closedDay: null, note: "Settlement looks less than expected" },
      { type: "device", openedDay: TODAY - 1, closedDay: null, note: "Asked how to return the device" },
    ],
    patch: (d, day) => {
      if (day === TODAY) {
        // The figures the whole demo depends on.
        const { fee, gst } = feeOn(9500);
        Object.assign(d, { count: 46, value: 14250, countAbove: 4, valueAbove: 9500, fee, gst });
      }
    },
  },
  {
    id: "M002",
    name: "Sharma Medicos",
    firstName: "Sharma",
    city: "Pune",
    cityTier: 1,
    category: "chemist",
    categoryGroup: "health",
    planId: "SB_149",
    monthlyRent: 149,
    daily: (day) => 7000 * (day > TODAY - 21 ? 1 - (0.45 * (day - (TODAY - 21))) / 21 : 1),
    failRate: (day) => (day > TODAY - 21 ? 0.2 : 0.03),
    patch: (d, day) => {
      if (day > TODAY - 21) Object.assign(d, { batteryAlerts: 2, offlineHours: 2, errors: 1 });
    },
  },
  {
    id: "M003",
    name: "Raju Tea Point",
    firstName: "Raju",
    city: "Delhi",
    cityTier: 1,
    category: "tea stall",
    categoryGroup: "food",
    planId: "SB_129",
    monthlyRent: 129,
    daily: (day) => 2400 * (day > TODAY - 14 ? 0.8 : 1),
    tickets: [
      { type: "settlement", openedDay: TODAY - 12, closedDay: null, note: "Settlement delayed" },
      { type: "settlement", openedDay: TODAY - 8, closedDay: null, note: "Second complaint, no reply" },
      { type: "settlement", openedDay: TODAY - 3, closedDay: null, note: "Angry, asked for a person" },
    ],
    patch: (d, day) => {
      if (day > TODAY - 14) d.delayHours = 44;
    },
  },
  {
    id: "M004",
    name: "Gupta Snacks",
    firstName: "Gupta",
    city: "Indore",
    cityTier: 2,
    category: "snacks",
    categoryGroup: "food",
    planId: "SB_149",
    monthlyRent: 149,
    daily: (day) => (day > TODAY - 14 ? 130 : 210),
    tickets: [{ type: "rent", openedDay: TODAY - 6, closedDay: null, note: "Rent feels high; mentioned a cheaper box from another company" }],
  },
  {
    id: "M005",
    name: "Jaipur Mobile Hub",
    firstName: "Anil",
    city: "Jaipur",
    cityTier: 2,
    category: "electronics",
    categoryGroup: "retail",
    planId: "SB_149",
    monthlyRent: 149,
    daily: (day) => (day > TODAY - 60 ? 3550 : 2800),
  },
  {
    id: "M007",
    name: "Verma Footwear",
    firstName: "Verma",
    city: "Nagpur",
    cityTier: 2,
    category: "footwear",
    categoryGroup: "retail",
    daily: (day) => (day > TODAY - 21 ? 2400 : 4000),
  },
  {
    id: "M008",
    name: "Anand Sweets",
    firstName: "Anand",
    city: "Kanpur",
    cityTier: 2,
    category: "sweets",
    categoryGroup: "grocery",
    daily: (day) => (day > TODAY - 21 ? 2000 : 1400),
  },
  {
    id: "M006",
    name: "Fresh Fruits Corner",
    firstName: "Salim",
    city: "Bhopal",
    cityTier: 2,
    category: "fruits",
    categoryGroup: "fresh",
    planId: "SB_129",
    monthlyRent: 129,
    daily: () => 2100,
    lastContactDay: TODAY - 2,
    tickets: [{ type: "settlement", openedDay: TODAY - 5, closedDay: null, note: "Asked when settlement arrives" }],
    patch: (d, day) => {
      if (day > TODAY - 7) d.delayHours = 30;
    },
  },
];

export function buildDemoMerchants(seed: number): Merchant[] {
  return SPECS.map((s) => {
    const rng = makeRng(`${seed}-${s.id}`);
    const { daily, failRate, patch, tickets, ...rest } = s;
    const days = Array.from({ length: SIM_DAYS }, (_, day) => {
      const d = dayRow(rng, daily(day), failRate?.(day) ?? 0.03, 110);
      patch?.(d, day);
      return d;
    });
    return {
      language: "hi-en",
      deviceType: "soundbox",
      planId: "SB_149",
      monthlyRent: 149,
      onboardDay: -400,
      feeCategory: "P2PM",
      consentProfiling: true,
      consentMessages: true,
      optedOut: false,
      holdout: false,
      lastContactDay: null,
      trueCause: "none",
      causeOnset: -1,
      churnDay: null,
      ...rest,
      isDemo: true,
      days,
      tickets: (tickets ?? []).map((t, i) => ({ ...t, id: `T-${s.id}-${i + 1}` })),
    } satisfies Merchant;
  });
}

