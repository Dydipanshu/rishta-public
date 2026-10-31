import type { EventBus } from "../ports.js";
import type { Sql } from "./sql.js";

// Written in the same transaction as the change it announces, so no event is lost.
export const enqueue = (tx: Sql, topic: string, key: string, value: unknown) =>
  tx.run("INSERT INTO outbox (topic, key, value) VALUES (?, ?, ?)", [topic, key, JSON.stringify(value)]);

// Delivery is at-least-once; after a crash consumers can see a repeat and dedupe on the event id.
export function startRelay(sql: Sql, bus: EventBus, onError: (err: unknown) => void, everyMs = 1000) {
  let running = false;
  let again = false;
  const flush = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        const rows = await sql.all<{ id: number; topic: string; key: string; value: string }>("SELECT id, topic, key, value FROM outbox WHERE sent = 0 ORDER BY id LIMIT 200");
        for (const r of rows) {
          // A short claim keeps two servers off the same row; a crash lets it retry.
          const now = new Date().toISOString();
          const until = new Date(Date.now() + 30_000).toISOString();
          if ((await sql.run("UPDATE outbox SET claimed_until = ? WHERE id = ? AND sent = 0 AND (claimed_until IS NULL OR claimed_until < ?)", [until, r.id, now])) === 0) continue;
          await bus.publish(r.topic, r.key, r.value);
          await sql.run("UPDATE outbox SET sent = 1 WHERE id = ?", [r.id]);
        }
        if (rows.length === 200) again = true;
      } while (again);
    } catch (err) {
      onError(err);
    }
    running = false;
  };
  const timer = setInterval(() => void flush(), everyMs);
  return { kick: () => void flush(), stop: () => clearInterval(timer) };
}
