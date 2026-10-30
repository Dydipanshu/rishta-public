import type { DB } from "./db.js";

// Clears everything a demo run wrote. Seeded data stays.
export function resetLive(db: DB) {
  const run = db.transaction(() => {
    for (const r of db.prepare("SELECT merchant_id, from_plan FROM plan_changes").all() as { merchant_id: string; from_plan: string }[]) {
      const rent = r.from_plan === "SB_149" ? 149 : r.from_plan === "SB_129" ? 129 : 99;
      db.prepare("UPDATE merchants SET plan_id = ?, monthly_rent = ? WHERE id = ?").run(r.from_plan, rent, r.merchant_id);
    }
    db.prepare("UPDATE merchants SET opted_out = 0 WHERE is_demo = 1").run();
    for (const t of ["conversations", "outcomes", "handoffs", "inbox", "plan_changes"]) db.prepare(`DELETE FROM ${t}`).run();
    db.prepare("DELETE FROM tickets WHERE live = 1").run();
    db.prepare("DELETE FROM reason_events WHERE live = 1").run();
    db.prepare("DELETE FROM contact_history WHERE true_cause = 'live'").run();
  });
  run();
}
