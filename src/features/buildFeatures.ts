import type { Merchant } from "../sim/types.js";

export interface Features {
  avg7: number;
  avg28: number;
  avg90: number;
  trend7v28: number;
  trend28v90: number;
  drop3Weeks: number;
  aboveTrend: number;
  failRate7: number;
  failRate28: number;
  rentShare: number;
  monthlyCollections: number;
  openTickets: number;
  settlementTickets28: number;
  feeTickets28: number;
  rentTickets28: number;
  deviceTickets28: number;
  avgDelay7: number;
  battery7: number;
  offline7: number;
  errors7: number;
  feePaid28: number;
  daysSinceLastPayment: number;
  tenureDays: number;
  monthsNearThreshold: number;
}

const sum = (m: Merchant, day: number, n: number, pick: (d: Merchant["days"][number]) => number) => {
  let total = 0;
  for (let d = Math.max(0, day - n + 1); d <= day; d++) total += pick(m.days[d]!);
  return total;
};

export function buildFeatures(m: Merchant, day: number): Features {
  const avg = (n: number) => sum(m, day, n, (d) => d.value) / Math.min(n, day + 1);
  const avg7 = avg(7);
  const avg28 = avg(28);
  const avg90 = avg(90);
  const beforeDays = Math.max(1, Math.min(29, day - 21));
  const beforeAvg = sum(m, Math.max(0, day - 21), beforeDays, (d) => d.value) / beforeDays;
  const drop3Weeks = beforeAvg > 0 ? Math.max(0, 1 - avg7 / beforeAvg) : 0;
  const count7 = sum(m, day, 7, (d) => d.count);
  const count28 = sum(m, day, 28, (d) => d.count);
  const failed7 = sum(m, day, 7, (d) => d.failed);
  const failed28 = sum(m, day, 28, (d) => d.failed);
  const above7 = sum(m, day, 7, (d) => d.valueAbove) / 7;
  const above28 = sum(m, day, 28, (d) => d.valueAbove) / 28;
  const monthly = sum(m, day, 30, (d) => d.value);
  const prevMonthly = day >= 59 ? sum(m, day - 30, 30, (d) => d.value) : 0;
  const prev2Monthly = day >= 89 ? sum(m, day - 60, 30, (d) => d.value) : 0;

  const recent = (type: string) =>
    m.tickets.filter((t) => t.type === type && t.openedDay <= day && t.openedDay > day - 28).length;

  let daysSinceLastPayment = 0;
  for (let d = day; d >= 0 && m.days[d]!.count === 0; d--) daysSinceLastPayment++;

  const limit = 100_000;
  const monthsNearThreshold =
    m.feeCategory === "P2PM" && monthly > limit && prevMonthly > limit && prev2Monthly <= limit ? 2 : 0;

  return {
    avg7,
    avg28,
    avg90,
    trend7v28: avg28 > 0 ? avg7 / avg28 - 1 : 0,
    trend28v90: avg90 > 0 ? avg28 / avg90 - 1 : 0,
    drop3Weeks,
    aboveTrend: above28 > 0 ? above7 / above28 - 1 : 0,
    failRate7: failed7 / Math.max(1, count7 + failed7),
    failRate28: failed28 / Math.max(1, count28 + failed28),
    rentShare: m.monthlyRent / Math.max(1, monthly),
    monthlyCollections: monthly,
    openTickets: m.tickets.filter((t) => t.openedDay <= day && (t.closedDay === null || t.closedDay > day)).length,
    settlementTickets28: recent("settlement"),
    feeTickets28: recent("fee"),
    rentTickets28: recent("rent"),
    deviceTickets28: recent("device"),
    avgDelay7: sum(m, day, 7, (d) => d.delayHours) / 7,
    battery7: sum(m, day, 7, (d) => d.batteryAlerts),
    offline7: sum(m, day, 7, (d) => d.offlineHours),
    errors7: sum(m, day, 7, (d) => d.errors),
    feePaid28: sum(m, day, 28, (d) => d.fee + d.gst),
    daysSinceLastPayment,
    tenureDays: day - m.onboardDay,
    monthsNearThreshold,
  };
}

// Model inputs: name, plain-word template, and how to read the value.
export const MODEL_FEATURES: { key: string; get: (f: Features) => number; say: (f: Features) => string }[] = [
  { key: "trend7v28", get: (f) => Math.max(-1, Math.min(1, f.trend7v28)), say: (f) => `Payments ${Math.round(-f.trend7v28 * 100)}% down this week` },
  { key: "trend28v90", get: (f) => Math.max(-1, Math.min(1, f.trend28v90)), say: (f) => `Payments ${Math.round(-f.trend28v90 * 100)}% down over 3 months` },
  { key: "failRate7", get: (f) => f.failRate7, say: (f) => `${Math.round(f.failRate7 * 100)}% of payments failing` },
  { key: "rentShare", get: (f) => Math.min(0.05, f.rentShare), say: (f) => `Rent is ${(f.rentShare * 100).toFixed(1)}% of collections` },
  { key: "openTickets", get: (f) => Math.min(5, f.openTickets), say: (f) => `${f.openTickets} open tickets` },
  { key: "settlementTickets28", get: (f) => Math.min(5, f.settlementTickets28), say: (f) => `${f.settlementTickets28} settlement complaints this month` },
  { key: "avgDelay7", get: (f) => Math.min(96, f.avgDelay7), say: (f) => `Settlements taking ${Math.round(f.avgDelay7)} hours` },
  { key: "battery7", get: (f) => Math.min(30, f.battery7), say: (f) => `${f.battery7} battery alerts this week` },
  { key: "offline7", get: (f) => Math.min(100, f.offline7), say: (f) => `Device offline ${Math.round(f.offline7)} hours this week` },
  { key: "feePaid28", get: (f) => Math.log1p(f.feePaid28), say: () => "Newly paying the UPI fee" },
  { key: "daysSinceLastPayment", get: (f) => Math.min(14, f.daysSinceLastPayment), say: (f) => `No payments for ${f.daysSinceLastPayment} days` },
  { key: "tenure", get: (f) => Math.log1p(Math.max(0, f.tenureDays)), say: () => "Newer merchant" },
];
