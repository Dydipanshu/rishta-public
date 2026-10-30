import type { Sql } from "./sql.js";

// Clears everything a demo run wrote. Seeded data stays.
export async function resetLive(sql: Sql) {
  await sql.tx(async (tx) => {
    for (const r of await tx.all<{ merchant_id: string; from_plan: string }>("SELECT merchant_id, from_plan FROM plan_changes")) {
      const rent = r.from_plan === "SB_149" ? 149 : r.from_plan === "SB_129" ? 129 : 99;
      await tx.run("UPDATE merchants SET plan_id = ?, monthly_rent = ? WHERE id = ?", [r.from_plan, rent, r.merchant_id]);
    }
    await tx.run("UPDATE merchants SET opted_out = 0 WHERE is_demo = 1");
    for (const t of ["conversations", "outcomes", "handoffs", "inbox", "plan_changes", "outreach", "ticket_numbers"]) await tx.run(`DELETE FROM ${t}`);
    await tx.run("DELETE FROM tickets WHERE live = 1");
    await tx.run("DELETE FROM reason_events WHERE live = 1");
    await tx.run("DELETE FROM contact_history WHERE true_cause = 'live'");
  });
}
