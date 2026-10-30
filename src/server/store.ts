import type { DayRow, Merchant, Ticket } from "../sim/types.js";
import { SIM_DAYS } from "../sim/types.js";
import type { ContactRow, ReasonEventRow, SimResult, AllocationRow } from "../sim/simulator.js";
import type { DB } from "./db.js";

type Row = Record<string, any>;

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

export function loadMerchants(db: DB): Merchant[] {
  const list = (db.prepare("SELECT * FROM merchants").all() as Row[]).map(toMerchant);
  const byId = new Map(list.map((m) => [m.id, m]));
  fillDays(db.prepare(DAY_SQL).all() as Row[], (id) => byId.get(id));
  for (const t of db.prepare("SELECT * FROM tickets").all() as Row[]) byId.get(t.merchant_id)?.tickets.push(toTicket(t));
  return list;
}

export function loadMerchant(db: DB, id: string): Merchant {
  const row = db.prepare("SELECT * FROM merchants WHERE id = ?").get(id) as Row | undefined;
  if (!row) throw new Error(`Unknown merchant ${id}`);
  const m = toMerchant(row);
  fillDays(db.prepare(`${DAY_SQL} WHERE p.merchant_id = ?`).all(id) as Row[], () => m);
  m.tickets = (db.prepare("SELECT * FROM tickets WHERE merchant_id = ?").all(id) as Row[]).map(toTicket);
  return m;
}

export function saveSim(db: DB, sim: SimResult) {
  const tables = ["merchants", "daily_payments", "device_health", "settlements", "tickets", "contact_history", "playbook_stats", "reason_events", "consents"];
  const run = db.transaction(() => {
    for (const t of tables) db.prepare(`DELETE FROM ${t}`).run();
    const m = db.prepare(`INSERT INTO merchants VALUES (@id,@name,@first,@city,@tier,@cat,@grp,@lang,@dev,@plan,@rent,@onb,@fee,@cp,@cm,@opt,@hold,@demo,@last,@cause,@onset,@churn)`);
    const p = db.prepare("INSERT INTO daily_payments VALUES (?,?,?,?,?,?,?,?,?)");
    const h = db.prepare("INSERT INTO device_health VALUES (?,?,?,?,?)");
    const s = db.prepare("INSERT INTO settlements VALUES (?,?,?,?,?,?,?)");
    const t = db.prepare("INSERT INTO tickets (id, merchant_id, type, status, note, opened_day, closed_day) VALUES (?,?,?,?,?,?,?)");
    const c = db.prepare("INSERT INTO consents VALUES (?,?,?,0)");
    for (const x of sim.merchants) {
      m.run({
        id: x.id, name: x.name, first: x.firstName, city: x.city, tier: x.cityTier, cat: x.category, grp: x.categoryGroup,
        lang: x.language, dev: x.deviceType, plan: x.planId, rent: x.monthlyRent, onb: x.onboardDay, fee: x.feeCategory,
        cp: +x.consentProfiling, cm: +x.consentMessages, opt: +x.optedOut, hold: +x.holdout, demo: +x.isDemo,
        last: x.lastContactDay, cause: x.trueCause, onset: x.causeOnset, churn: x.churnDay,
      });
      c.run(x.id, "profiling", +x.consentProfiling);
      c.run(x.id, "messages", +x.consentMessages);
      for (let day = 0; day < SIM_DAYS; day++) {
        const d = x.days[day]!;
        p.run(x.id, day, d.count, d.value, d.countAbove, d.valueAbove, d.failed, d.uniquePayers, d.repeatShare);
        h.run(x.id, day, d.offlineHours, d.batteryAlerts, d.errors);
        s.run(x.id, day, d.value, d.fee, d.gst, d.value - d.fee - d.gst, d.delayHours);
      }
      for (const k of x.tickets) t.run(k.id, x.id, k.type, k.closedDay === null ? "open" : "closed", k.note, k.openedDay, k.closedDay);
    }
    const ch = db.prepare("INSERT INTO contact_history VALUES (?,?,?,?,?,?,?,?,?,?)");
    for (const r of sim.contacts as ContactRow[]) ch.run(r.merchantId, r.day, r.week, r.problem, r.approachId, r.trueCause, r.segment, r.city, r.category, r.kept);
    const ps = db.prepare("INSERT INTO playbook_stats VALUES (?,?,?,?)");
    for (const r of sim.allocations as AllocationRow[]) ps.run(r.week, r.problem, r.approachId, r.share);
    const re = db.prepare("INSERT INTO reason_events (merchant_id, day, week, code, quote, city, category) VALUES (?,?,?,?,?,?,?)");
    for (const r of sim.reasonEvents as ReasonEventRow[]) re.run(r.merchantId, r.day, r.week, r.code, r.quote, r.city, r.category);
  });
  run();
}
