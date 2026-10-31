import { CARE_DAYS, FOLLOW_UP_DAYS } from "../../config/value.js";
import type { Sql } from "../data/sql.js";
import { TODAY } from "../sim/types.js";

export interface Promise_ { id: number; ticket_id: string | null; kind: string; text: string; due_day: number; status: string }

const now = () => new Date().toISOString();

export async function addPromise(sql: Sql, merchantId: string, ticketId: string | null, kind: string, text: string, day = TODAY) {
  await sql.run("INSERT INTO promises (merchant_id, ticket_id, kind, text, due_day, status, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?)", [merchantId, ticketId, kind, text, day + FOLLOW_UP_DAYS, now()]);
}

export const openPromises = (sql: Sql, merchantId: string) => sql.all<Promise_>("SELECT * FROM promises WHERE merchant_id = ? AND status = 'open' ORDER BY id", [merchantId]);

export async function closePromises(sql: Sql, merchantId: string, status: "kept" | "failed") {
  await sql.run("UPDATE promises SET status = ?, closed_at = ? WHERE merchant_id = ? AND status = 'open'", [status, now(), merchantId]);
}

export async function addNote(sql: Sql, merchantId: string, kind: string, text: string, day = TODAY) {
  await sql.run("INSERT INTO notes (merchant_id, kind, text, day, until_day) VALUES (?, ?, ?, ?, ?)", [merchantId, kind, text, day, day + CARE_DAYS]);
}

export const careNote = (sql: Sql, merchantId: string, day = TODAY) => sql.get<{ text: string }>("SELECT text FROM notes WHERE merchant_id = ? AND kind = 'care' AND until_day >= ? ORDER BY id DESC LIMIT 1", [merchantId, day]);

export interface TimelineEntry { when: string; text: string }

// Everything anyone should know before speaking to this shop. Salespeople see the same thing as the agent.
export async function timeline(sql: Sql, merchantId: string, limit = 8): Promise<TimelineEntry[]> {
  const outcomes = await sql.all<{ json: string; created_at: string }>("SELECT json, created_at FROM outcomes WHERE merchant_id = ? ORDER BY created_at DESC LIMIT ?", [merchantId, limit]);
  const promises = await sql.all<{ text: string; status: string; created_at: string }>("SELECT text, status, created_at FROM promises WHERE merchant_id = ? ORDER BY id DESC LIMIT ?", [merchantId, limit]);
  const notes = await sql.all<{ text: string; day: number }>("SELECT text, day FROM notes WHERE merchant_id = ? ORDER BY id DESC LIMIT ?", [merchantId, limit]);
  const tickets = await sql.all<{ type: string; note: string; opened_day: number; closed_day: number | null; live: number }>("SELECT type, note, opened_day, closed_day, live FROM tickets WHERE merchant_id = ? AND live = 0 ORDER BY opened_day DESC LIMIT 3", [merchantId]);
  const label = { open: "Waiting", kept: "Confirmed by the shop", failed: "Failed, sent to a person" } as Record<string, string>;
  return [
    ...notes.map((n) => ({ when: "Note", text: n.text })),
    ...promises.map((p) => ({ when: label[p.status] ?? p.status, text: p.text })),
    ...outcomes.map((o) => ({ when: "Conversation", text: (JSON.parse(o.json) as { summary: string }).summary })),
    ...tickets.map((t) => ({ when: TODAY - t.opened_day === 1 ? "Yesterday" : `${TODAY - t.opened_day} days ago`, text: `${t.type} ticket: ${t.note}${t.closed_day === null ? " (open)" : ""}` })),
  ].filter((e) => e.text).slice(0, limit);
}

export const memoryForAgent = (entries: TimelineEntry[]) => entries.map((e) => `- ${e.when}: ${e.text}`).join("\n") || "- Nothing yet.";
