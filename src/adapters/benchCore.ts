import type { Sql } from "../data/sql.js";
import { loadMerchant, loadMerchantPage } from "../data/store.js";
import type { PaytmCore } from "../ports.js";
import { TODAY } from "../sim/types.js";

const now = () => new Date().toISOString();

// Test-bench stand-in for Paytm's merchant, ticketing and plan services.
export function benchCore(sql: Sql): PaytmCore {
  return {
    merchant: (id) => loadMerchant(sql, id),
    merchantPage: (lo, hi, afterId, limit) => loadMerchantPage(sql, lo, hi, afterId, limit),
    openTickets: async (id) =>
      (await sql.all<{ note: string; opened_day: number }>("SELECT note, opened_day FROM tickets WHERE merchant_id = ? AND (closed_day IS NULL OR closed_day > ?) ORDER BY opened_day", [id, TODAY])).map((t) => ({ note: t.note, openedDay: t.opened_day })),
    raiseTicket: (merchantId, type, note) =>
      sql.tx(async (tx) => {
        const row = await tx.get<{ id: number }>("INSERT INTO ticket_numbers (created_at) VALUES (?) RETURNING id", [now()]);
        const ticketId = `T${4820 + Number(row!.id)}`;
        await tx.run("INSERT INTO tickets (id, merchant_id, type, status, note, opened_day, closed_day, live) VALUES (?, ?, ?, 'open', ?, ?, NULL, 1)", [ticketId, merchantId, type, note, TODAY]);
        return { ticketId };
      }),
    changePlan: (merchantId, from, to) =>
      sql.tx(async (tx) => {
        await tx.run("INSERT INTO plan_changes (merchant_id, from_plan, to_plan, created_at) VALUES (?, ?, ?, ?)", [merchantId, from, to.id, now()]);
        await tx.run("UPDATE merchants SET plan_id = ?, monthly_rent = ? WHERE id = ?", [to.id, to.monthlyRent, merchantId]);
      }),
    scheduleCallback: async (merchantId, reason, summary) => {
      await sql.run("INSERT INTO handoffs (merchant_id, reason, summary, created_at) VALUES (?, ?, ?, ?)", [merchantId, reason, summary, now()]);
    },
    optOut: async (merchantId) => {
      await sql.run("UPDATE merchants SET opted_out = 1 WHERE id = ?", [merchantId]);
    },
    notify: async (merchantId, text) => {
      await sql.run("INSERT INTO inbox (merchant_id, text, created_at) VALUES (?, ?, ?)", [merchantId, text, now()]);
    },
  };
}
