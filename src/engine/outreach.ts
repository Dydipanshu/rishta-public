import { OFFER } from "../../config/loans.js";
import { randomUUID } from "node:crypto";
import { TOPICS } from "../contracts/events.js";
import { enqueue } from "../data/outbox.js";
import { audit, type Sql } from "../data/sql.js";
import type { PaytmCore } from "../ports.js";
import type { Brief } from "./brief.js";
import { outreachBlock } from "./guardrails.js";

export type SendResult = { sent: boolean; blocked?: string };

const forPeople = (b: Brief) => b.channel === "human_callback" || b.channel === "salesperson_visit";

// The one way a nudge leaves Rishta, whether the morning run or a person triggered it.
export async function sendOutreach(sql: Sql, core: PaytmCore, brief: Brief, now: Date, production: boolean): Promise<SendResult> {
  if (forPeople(brief)) return { sent: false, blocked: "Rishta held this shop back for a person" };
  const block = outreachBlock(await core.merchant(brief.merchantId), now, production);
  if (block) {
    await audit(sql, brief.merchantId, "outreach_blocked", { reason: block });
    return { sent: false, blocked: block };
  }
  if (brief.approachId === "loan_offer") {
    const since = new Date(now.getTime() - OFFER.cooldownDays * 86_400_000).toISOString();
    const recent = await sql.get("SELECT 1 AS ok FROM outcomes o JOIN briefs b ON b.brief_id = o.brief_id WHERE o.merchant_id = ? AND o.created_at >= ? AND b.json LIKE '%\"approachId\":\"loan_offer\"%'", [brief.merchantId, since]);
    if (recent) {
      await audit(sql, brief.merchantId, "outreach_blocked", { reason: "loan cooldown" });
      return { sent: false, blocked: "This shop already heard about a loan recently" };
    }
  }
  const at = now.toISOString();
  const sent = await sql.tx(async (tx) => {
    const added = await tx.run("INSERT INTO outreach (brief_id, merchant_id, channel, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (brief_id) DO NOTHING", [brief.briefId, brief.merchantId, brief.channel, at]);
    // The bench can replay a nudge between rehearsals; production sends each brief once.
    if (added === 0 && production) return false;
    await audit(tx, brief.merchantId, "outreach", { channel: brief.channel, approachId: brief.approachId });
    await enqueue(tx, TOPICS.outreach, brief.merchantId, { id: randomUUID(), type: "outreach.requested", version: 1, at, merchantId: brief.merchantId, briefId: brief.briefId, channel: brief.channel });
    return true;
  });
  return { sent };
}

// The morning run: every brief goes out with no person involved. Guardrails are re-checked per shop.
export async function sendMorningOutreach(sql: Sql, core: PaytmCore, now: Date, production: boolean) {
  const rows = await sql.all<{ json: string }>("SELECT json FROM briefs WHERE channel IN ('soundbox', 'app')");
  const totals = { sent: 0, blocked: 0 };
  for (const row of rows) {
    const result = await sendOutreach(sql, core, JSON.parse(row.json) as Brief, now, production);
    if (result.sent) totals.sent++;
    else totals.blocked++;
  }
  return totals;
}
