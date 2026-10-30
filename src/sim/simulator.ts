import { feeOn } from "../../config/fees.js";
import { PLAYBOOK } from "../../config/playbook.js";
import { buildFeatures } from "../features/buildFeatures.js";
import { detectProblem } from "../models/problems.js";
import { addResult, allocation, chooseApproach, type Stats } from "../engine/playbook.js";
import type { ReasonCode } from "../engine/reasons.js";
import { buildDemoMerchants } from "./demoMerchants.js";
import { BACKFIRE_SEGMENT, FIX_PROBABILITY } from "./groundTruth.js";
import { QUOTES } from "./quoteTemplates.js";
import { makeRng, normal, pick, weighted, type Rng } from "./rng.js";
import {
  FEE_START_DAY,
  KEEP_WINDOW_DAYS,
  OUTREACH_START_DAY,
  SIM_DAYS,

  segmentOf,
  type DayRow,
  type Merchant,
} from "./types.js";

const CITIES = [
  ["Delhi", 1, 10], ["Mumbai", 1, 10], ["Bengaluru", 1, 8], ["Pune", 1, 6], ["Hyderabad", 1, 6],
  ["Lucknow", 2, 7], ["Jaipur", 2, 7], ["Indore", 2, 7], ["Bhopal", 2, 6], ["Nagpur", 2, 6],
  ["Patna", 2, 6], ["Kanpur", 2, 6], ["Meerut", 3, 5], ["Gorakhpur", 3, 5], ["Ajmer", 3, 5],
] as const;

const CATEGORIES = [
  ["kirana", "grocery", 30], ["fruits", "fresh", 12], ["vegetables", "fresh", 12], ["tea stall", "food", 12],
  ["snacks", "food", 10], ["chemist", "health", 10], ["electronics", "retail", 7], ["clothing", "retail", 7],
] as const;

const PRESSURE: Partial<Record<ReasonCode, number>> = {
  fee_confusion: 0.022,
  device_fault: 0.026,
  settlement_delay: 0.022,
  rival_offer: 0.035,
  rent_too_high: 0.02,
  low_sales_season: 0.012,
};

const NAMES = ["Sharma", "Verma", "Gupta", "Yadav", "Khan", "Singh", "Jain", "Patel", "Mishra", "Ansari", "Kumar", "Reddy"];

interface Live {
  m: Merchant;
  base: number;
  health: number;
  lowDays: number;
  resilience: number;
  resolved: boolean;
  backfired: boolean;
}

export interface ContactRow {
  merchantId: string;
  day: number;
  week: number;
  problem: ReasonCode;
  approachId: string; // "holdout" for the control arm
  trueCause: string;
  segment: string;
  city: string;
  category: string;
  kept: number | null;
}

export interface ReasonEventRow {
  merchantId: string;
  day: number;
  week: number;
  code: ReasonCode;
  quote: string;
  city: string;
  category: string;
}

export interface AllocationRow {
  week: number;
  problem: string;
  approachId: string;
  share: number;
}

function newMerchant(i: number, rng: Rng, holdoutShare: number): Live {
  const [city, cityTier] = weighted(rng, CITIES.map((c) => [c, c[2]] as const));
  const [category, categoryGroup] = weighted(rng, CATEGORIES.map((c) => [c, c[2]] as const));
  const base = Math.exp(Math.log(1500) + 0.9 * normal(rng));
  const monthly = base * 30;
  const feeCategory = monthly > 100_000 ? "P2M" : "P2PM";
  const [planId, monthlyRent] = rng() < 0.5 ? ["SB_149", 149] : ["SB_129", 129];

  let trueCause: Merchant["trueCause"] = weighted(rng, [
    ["none", 60],
    ["device_fault", 9],
    ["settlement_delay", 9],
    ["rival_offer", 4],
    ["low_sales_season", 5],
    ["rent_too_high", monthly < 25000 ? 22 : 0],
    ["fee_confusion", feeCategory === "P2M" ? 40 : 0],
  ] as const);
  let onset = 25 + Math.floor(rng() * 154);
  if (trueCause === "fee_confusion") onset = FEE_START_DAY + 5 + Math.floor(rng() * 130);
  // Rival offers cluster in Indore in recent weeks.
  if (city === "Indore" && rng() < 0.3) {
    trueCause = "rival_offer";
    onset = 150 + Math.floor(rng() * 28);
  }

  const m: Merchant = {
    id: `S${String(i).padStart(4, "0")}`,
    name: `${pick(rng, NAMES)} ${category === "kirana" ? "Stores" : category[0]!.toUpperCase() + category.slice(1)}`,
    firstName: "ji",
    city,
    cityTier,
    category,
    categoryGroup,
    language: "hi-en",
    deviceType: "soundbox",
    planId,
    monthlyRent,
    onboardDay: -Math.floor(rng() * 900),
    feeCategory,
    consentProfiling: rng() > 0.02,
    consentMessages: rng() > 0.02,
    optedOut: rng() < 0.01,
    holdout: rng() < holdoutShare,
    isDemo: false,
    days: [],
    tickets: [],
    lastContactDay: null,
    trueCause,
    causeOnset: trueCause === "none" ? -1 : onset,
    churnDay: null,
  };
  return { m, base, health: 0.75 + 0.2 * rng(), lowDays: 0, resilience: Math.exp(0.45 * normal(rng)), resolved: false, backfired: false };
}

const season = (day: number) => (day >= 30 && day <= 45 ? 1.2 : 1) + 0.08 * Math.sin(day / 12);

function stepDay(l: Live, day: number, rng: Rng) {
  const { m } = l;
  const churned = m.churnDay !== null;
  const active = !l.resolved && m.trueCause !== "none" && day >= m.causeOnset;
  const cause = active ? (m.trueCause as ReasonCode) : null;

  if (!churned) {
    const pressure = (cause ? (PRESSURE[cause] ?? 0) * l.resilience : 0) + (l.backfired ? 0.03 : 0);
    l.health += 0.01 * (1 - l.health) - pressure + 0.006 * normal(rng);
    l.health = Math.min(1, l.health);
    l.lowDays = l.health < 0.25 ? l.lowDays + 1 : 0;
    if (l.lowDays >= 7 || rng() < 0.00025) m.churnDay = day;
  }

  const row: DayRow = {
    count: 0, value: 0, countAbove: 0, valueAbove: 0, failed: 0, uniquePayers: 0, repeatShare: 0,
    offlineHours: rng() < 0.03 ? 1 : 0,
    batteryAlerts: rng() < 0.02 ? 1 : 0,
    errors: rng() < 0.02 ? 1 : 0,
    delayHours: 10 + 6 * rng(),
    fee: 0,
    gst: 0,
  };

  if (cause === "device_fault") {
    row.batteryAlerts = rng() < 0.7 ? 1 + Math.floor(rng() * 2) : 0;
    row.offlineHours = 1 + 3 * rng();
    row.errors = rng() < 0.5 ? 2 : 0;
  }
  if (cause === "settlement_delay") row.delayHours = 26 + 30 * rng();

  if (m.churnDay === null) {
    let v = l.base * season(day) * (0.35 + 0.65 * Math.max(0, l.health)) * (1 + 0.18 * normal(rng));
    if (cause === "rival_offer") v *= 0.6;
    if (cause === "device_fault") v *= 0.8;
    row.value = Math.max(0, Math.round(v));
    row.count = Math.round(row.value / (90 + 40 * rng()));
    const aboveShare = (m.feeCategory === "P2M" ? 0.35 : 0.1) * (cause === "fee_confusion" ? 0.7 : 1);
    row.valueAbove = Math.round(row.value * aboveShare);
    row.countAbove = Math.round(row.valueAbove / 3000);
    row.failed = Math.round(row.count * (cause === "device_fault" ? 0.2 : 0.03));
    row.uniquePayers = Math.round(row.count * 0.7);
    row.repeatShare = 0.5 + 0.2 * rng();
    if (m.feeCategory === "P2M" && day >= FEE_START_DAY) {
      const f = feeOn(row.valueAbove);
      row.fee = f.fee;
      row.gst = f.gst;
    }
  }
  m.days[day] = row;

  const open = (type: "settlement" | "rent" | "device" | "fee", note: string, closeAfter: number | null) =>
    m.tickets.push({ id: `T-${m.id}-${m.tickets.length + 1}`, type, openedDay: day, closedDay: closeAfter === null ? null : day + closeAfter, note });

  if (m.churnDay === null) {
    if (cause) {
      const since = day - m.causeOnset;
      if (cause === "fee_confusion" && since > 1 && rng() < 0.08) open(rng() < 0.5 ? "fee" : "settlement", "Asked why settlement was less", 6);
      if (cause === "settlement_delay" && since > 1 && rng() < 0.08) open("settlement", "Settlement delayed", 12);
      if (cause === "rent_too_high" && since > 1 && rng() < 0.05) open("rent", "Asked to reduce rent", 8);
      if (cause === "device_fault" && rng() < 0.02) open("device", "Device not working well", 8);
    } else if (rng() < 0.0012) {
      open("settlement", "General settlement query", 3);
    }
  }
}

export interface SimResult {
  merchants: Merchant[];
  contacts: ContactRow[];
  reasonEvents: ReasonEventRow[];
  allocations: AllocationRow[];
}

const weekOf = (day: number) => Math.floor((day - OUTREACH_START_DAY) / 7) + 1;

export function simulate(seed: number, count: number, holdoutShare: number): SimResult {
  const rng = makeRng(seed);
  const decisionRng = makeRng(`${seed}-decide`);
  const live = Array.from({ length: count - 6 }, (_, i) => newMerchant(i + 7, rng, holdoutShare));
  const demo = buildDemoMerchants(seed);

  const contacts: ContactRow[] = [];
  const reasonEvents: ReasonEventRow[] = [];
  const allocations: AllocationRow[] = [];
  const stats: Stats = new Map();
  const counted = new Set<ContactRow>();
  const lastTouched = new Map<string, number>();
  const byId = new Map(live.map((l) => [l.m.id, l.m]));

  const logQuote = (m: Merchant, day: number) => {
    const code = m.trueCause === "none" ? "unknown" : m.trueCause;
    const quotes = QUOTES[code];
    if (!quotes || rng() > 0.75) return;
    reasonEvents.push({ merchantId: m.id, day, week: weekOf(day), code, quote: pick(rng, quotes), city: m.city, category: m.category });
  };

  for (let day = 0; day < SIM_DAYS; day++) {
    for (const l of live) stepDay(l, day, rng);
    if (day < OUTREACH_START_DAY || (day - OUTREACH_START_DAY) % 7 !== 0) continue;

    // Weekly update: only results at least 30 days old can be counted.
    for (const c of contacts) {
      if (counted.has(c) || c.day + KEEP_WINDOW_DAYS > day) continue;
      counted.add(c);
      const m = byId.get(c.merchantId)!;
      c.kept = m.churnDay === null || m.churnDay > c.day + KEEP_WINDOW_DAYS ? 1 : 0;
      if (c.approachId !== "holdout" && c.approachId !== "route") addResult(stats, c.problem, c.approachId, c.segment, c.kept === 1);
    }
    for (const problem of Object.keys(PLAYBOOK) as ReasonCode[]) {
      for (const s of allocation(stats, problem, "*", decisionRng)) {
        allocations.push({ week: weekOf(day), problem, approachId: s.approachId, share: s.share });
      }
    }

    for (const l of live) {
      const { m } = l;
      if (m.churnDay !== null || m.optedOut) continue;
      const touched = lastTouched.get(m.id);
      if (touched !== undefined && day - touched < 28) continue;
      const detected = detectProblem(buildFeatures(m, day));
      if (!detected) continue;
      lastTouched.set(m.id, day);
      const segment = segmentOf(m);
      const base = { merchantId: m.id, day, week: weekOf(day), problem: detected.problem, trueCause: m.trueCause, segment, city: m.city, category: m.category, kept: null };

      if (m.holdout) {
        contacts.push({ ...base, approachId: "holdout" });
        continue;
      }
      m.lastContactDay = day;
      logQuote(m, day);
      if (PLAYBOOK[detected.problem]) {
        const { approachId } = chooseApproach(stats, detected.problem, segment, decisionRng);
        contacts.push({ ...base, approachId });
        const p = FIX_PROBABILITY[approachId]?.[m.trueCause as ReasonCode] ?? 0;
        if (rng() < p) l.resolved = true;
      } else {
        contacts.push({ ...base, approachId: "route" });
        if (rng() < 0.3) l.resolved = true;
      }
      if (segment === BACKFIRE_SEGMENT) {
        l.resolved = false;
        l.backfired = true;
      }
    }
  }

  return { merchants: [...demo, ...live.map((l) => l.m)], contacts, reasonEvents, allocations };
}
