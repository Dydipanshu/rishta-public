import { randomUUID } from "node:crypto";
import { TOPICS } from "../contracts/events.js";
import { enqueue } from "../data/outbox.js";
import { audit, type Sql } from "../data/sql.js";
import { OUTREACH_START_DAY, TODAY } from "../sim/types.js";
import type { Brief, Outcome } from "./brief.js";

export interface Place {
  city: string;
  category: string;
  cityTier: number;
  categoryGroup: string;
}

// The one write path for results, whichever agent held the conversation.
// Safe to repeat: a second call for the same conversation changes nothing.
export async function recordOutcome(tx: Sql, conversationId: string, brief: Brief, outcome: Outcome, m: Place) {
  const at = new Date().toISOString();
  const added = await tx.run("INSERT INTO outcomes (conversation_id, brief_id, merchant_id, json, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (conversation_id) DO NOTHING", [conversationId, brief.briefId, brief.merchantId, JSON.stringify(outcome), at]);
  if (added === 0) return false;
  const week = Math.floor((TODAY - OUTREACH_START_DAY) / 7) + 1;
  for (const r of outcome.reasons) {
    await tx.run("INSERT INTO reason_events (merchant_id, day, week, code, quote, city, category, live) VALUES (?, ?, ?, ?, ?, ?, ?, 1)", [brief.merchantId, TODAY, week, r.code, r.quote, m.city, m.category]);
  }
  // Kept stays empty for 30 days; the weekly update will count it then.
  await tx.run("INSERT INTO contact_history (merchant_id, day, week, problem, approach_id, true_cause, segment, city, category, kept) VALUES (?, ?, ?, ?, ?, 'live', ?, ?, ?, NULL)", [brief.merchantId, TODAY, week, brief.problem, brief.approachId, `T${m.cityTier}-${m.categoryGroup}`, m.city, m.category]);
  await audit(tx, brief.merchantId, "outcome", outcome);
  await enqueue(tx, TOPICS.outcomes, brief.merchantId, { id: randomUUID(), type: "conversation.outcome", version: 1, at, merchantId: brief.merchantId, conversationId, outcome });
  return true;
}
