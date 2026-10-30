import type { ContactRow, ReasonEventRow, SimResult, AllocationRow } from "../sim/simulator.js";
import type { DayRow, Merchant, Ticket } from "../sim/types.js";
import { SIM_DAYS } from "../sim/types.js";
import type { Sql } from "./sql.js";

type Row = Record<string, any>;

export const SHARDS = 1024;

// Stable across languages and machines, so any worker agrees where a merchant lives.
export function shardOf(id: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return (h >>> 0) % SHARDS;
}

export function shardRange(index: number, count: number) {
  return { lo: Math.floor((index * SHARDS) / count), hi: Math.floor(((index + 1) * SHARDS) / count) - 1 };
}

function toMerchant(r: Row): Merchant {
  return {
    id: r.id, name: r.name, firstName: r.first_name, city: r.city, cityTier: r.city_tier, category: r.category,
    categoryGroup: r.category_group, language: r.language, deviceType: r.device_type, planId: r.plan_id,
    monthlyRent: r.monthly_rent, onboardDay: r.onboard_day, feeCategory: r.fee_category,
    consentProfiling: !!r.consent_profiling, consentMessages: !!r.consent_messages, optedOut: !!r.opted_out,
    holdout: !!r.holdout, isDemo: !!r.is_demo, lastContactDay: r.last_contact_day, trueCause: r.true_cause,
    causeOnset: r.cause_onset, churnDay: r.churn_day, days: [], tickets: [],
  };
}

function fillDays(rows: Row[], get: (id: string) => Merchant | undefined) {
  for (const r of rows) {
    const m = get(r.merchant_id);
    if (!m) continue;
    const d: DayRow = {
      count: r.count, value: r.value, countAbove: r.count_above_2000, valueAbove: r.value_above_2000, failed: r.failed_count,
      uniquePayers: r.unique_payers, repeatShare: r.repeat_share, offlineHours: r.offline_hours, batteryAlerts: r.battery_alerts,
      errors: r.error_count, delayHours: r.delay_hours, fee: r.fee, gst: r.gst_on_fee,
    };
    m.days[r.day] = d;
  }
}

const DAY_SQL = `SELECT p.*, h.offline_hours, h.battery_alerts, h.error_count, s.fee, s.gst_on_fee, s.delay_hours
  FROM daily_payments p
  JOIN device_health h ON h.merchant_id = p.merchant_id AND h.day = p.day
  JOIN settlements s ON s.merchant_id = p.merchant_id AND s.day = p.day`;

const toTicket = (t: Row): Ticket => ({ id: t.id, type: t.type, openedDay: t.opened_day, closedDay: t.closed_day, note: t.note });

// Reads one page of a shard range, so a run never holds the whole base in memory.
export async function loadMerchantPage(sql: Sql, lo: number, hi: number, afterId: string, limit: number): Promise<Merchant[]> {
  const list = (await sql.all("SELECT * FROM merchants WHERE shard >= ? AND shard <= ? AND id > ? ORDER BY id LIMIT ?", [lo, hi, afterId, limit])).map(toMerchant);
  if (list.length === 0) return list;
  const byId = new Map(list.map((m) => [m.id, m]));
  const ids = list.map((m) => m.id);
  const marks = ids.map(() => "?").join(",");
  fillDays(await sql.all(`${DAY_SQL} WHERE p.merchant_id IN (${marks})`, ids), (id) => byId.get(id));
  for (const t of await sql.all(`SELECT * FROM tickets WHERE merchant_id IN (${marks})`, ids)) byId.get(t.merchant_id)?.tickets.push(toTicket(t));
  return list;
}

export async function loadMerchant(sql: Sql, id: string): Promise<Merchant> {
  const row = await sql.get("SELECT * FROM merchants WHERE id = ?", [id]);
  if (!row) throw new Error(`Unknown merchant ${id}`);
  const m = toMerchant(row);
  fillDays(await sql.all(`${DAY_SQL} WHERE p.merchant_id = ?`, [id]), () => m);
  m.tickets = (await sql.all("SELECT * FROM tickets WHERE merchant_id = ?", [id])).map(toTicket);
  return m;
}

export async function saveSim(sql: Sql, sim: SimResult) {
  const merchants: unknown[][] = [], consents: unknown[][] = [], payments: unknown[][] = [], health: unknown[][] = [];
  const settlements: unknown[][] = [], tickets: unknown[][] = [];
  for (const x of sim.merchants) {
    merchants.push([
      x.id, x.name, x.firstName, x.city, x.cityTier, x.category, x.categoryGroup, x.language, x.deviceType, x.planId, x.monthlyRent, x.onboardDay,
      x.feeCategory, +x.consentProfiling, +x.consentMessages, +x.optedOut, +x.holdout, +x.isDemo, x.lastContactDay, x.trueCause, x.causeOnset, x.churnDay, shardOf(x.id),
    ]);
    consents.push([x.id, "profiling", +x.consentProfiling, 0], [x.id, "messages", +x.consentMessages, 0]);
    for (let day = 0; day < SIM_DAYS; day++) {
      const d = x.days[day]!;
      payments.push([x.id, day, d.count, d.value, d.countAbove, d.valueAbove, d.failed, d.uniquePayers, d.repeatShare]);
      health.push([x.id, day, d.offlineHours, d.batteryAlerts, d.errors]);
      settlements.push([x.id, day, d.value, d.fee, d.gst, d.value - d.fee - d.gst, d.delayHours]);
    }
    for (const k of x.tickets) tickets.push([k.id, x.id, k.type, k.closedDay === null ? "open" : "closed", k.note, k.openedDay, k.closedDay]);
  }
  await sql.tx(async (tx) => {
    for (const t of ["merchants", "daily_payments", "device_health", "settlements", "tickets", "contact_history", "playbook_stats", "reason_events", "consents"]) await tx.run(`DELETE FROM ${t}`);
    await tx.bulk("merchants", ["id", "name", "first_name", "city", "city_tier", "category", "category_group", "language", "device_type", "plan_id", "monthly_rent", "onboard_day", "fee_category", "consent_profiling", "consent_messages", "opted_out", "holdout", "is_demo", "last_contact_day", "true_cause", "cause_onset", "churn_day", "shard"], merchants);
    await tx.bulk("consents", ["merchant_id", "kind", "granted", "day"], consents);
    await tx.bulk("daily_payments", ["merchant_id", "day", "count", "value", "count_above_2000", "value_above_2000", "failed_count", "unique_payers", "repeat_share"], payments);
    await tx.bulk("device_health", ["merchant_id", "day", "offline_hours", "battery_alerts", "error_count"], health);
    await tx.bulk("settlements", ["merchant_id", "day", "gross", "fee", "gst_on_fee", "net", "delay_hours"], settlements);
    await tx.bulk("tickets", ["id", "merchant_id", "type", "status", "note", "opened_day", "closed_day"], tickets);
    await tx.bulk("contact_history", ["merchant_id", "day", "week", "problem", "approach_id", "true_cause", "segment", "city", "category", "kept"], (sim.contacts as ContactRow[]).map((r) => [r.merchantId, r.day, r.week, r.problem, r.approachId, r.trueCause, r.segment, r.city, r.category, r.kept]));
    await tx.bulk("playbook_stats", ["week", "problem", "approach_id", "share"], (sim.allocations as AllocationRow[]).map((r) => [r.week, r.problem, r.approachId, r.share]));
    await tx.bulk("reason_events", ["merchant_id", "day", "week", "code", "quote", "city", "category"], (sim.reasonEvents as ReasonEventRow[]).map((r) => [r.merchantId, r.day, r.week, r.code, r.quote, r.city, r.category]));
  });
}
