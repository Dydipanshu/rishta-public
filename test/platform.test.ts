// Runs on SQLite by default, and on Postgres when TEST_DATABASE_URL is set.
import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { benchCore } from "../src/adapters/benchCore.js";
import { memoryBus } from "../src/adapters/memoryBus.js";
import { Conversation } from "../src/agent/brain.js";
import type { LLMAdapter, LLMEvent } from "../src/agent/llmAdapter.js";
import { enqueue, startRelay } from "../src/data/outbox.js";
import { resetLive } from "../src/data/reset.js";
import { openSql, type Sql } from "../src/data/sql.js";
import { SHARDS, shardOf, shardRange } from "../src/data/store.js";
import { Brief } from "../src/engine/brief.js";
import { finalizeRun } from "../src/engine/dailyRun.js";
import { withinContactHours } from "../src/engine/guardrails.js";
import { recordOutcome } from "../src/engine/outcomes.js";
import { sendMorningOutreach } from "../src/engine/outreach.js";
import { issueMerchantToken, merchantFromToken } from "../src/server/auth.js";

const FILE = "data/test-platform.db";

// Replays fixed replies, so these tests need no keys and no network.
function fakeLlm(script: LLMEvent[][]): LLMAdapter {
  let i = 0;
  return {
    async *turn() {
      yield* script[Math.min(i++, script.length - 1)]!;
    },
    extract: async () => ({ reasons: [{ code: "fee_confusion", quote: "पैसे कम" }], teamSummary: "Explained.", merchantMessage: "जानकारी दी गई।" }) as never,
  };
}
const says = (delta: string): LLMEvent[] => [{ type: "text", delta }, { type: "done", items: [{ role: "assistant", content: delta }], calls: [] }];

const brief = Brief.parse({
  briefId: "B-T1-179", merchantId: "T1", displayName: "Test Store", language: "hi", channel: "soundbox", problem: "fee_confusion", approachId: "fee_own_numbers",
  goal: "g", facts: { firstName: "Asha", feeInr: 38 }, allowedActions: ["raiseTicket", "recordOutcome"], limits: { maxDiscountInr: 50 },
  mustSay: ["x"], mustNot: ["y"], escalateIf: ["z"], successCriteria: "s",
});

describe("platform", () => {
  let sql: Sql;

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) rmSync(FILE, { force: true });
    sql = await openSql(process.env.TEST_DATABASE_URL ?? FILE);
    await resetLive(sql);
    await sql.run("DELETE FROM briefs WHERE merchant_id = 'T1'");
    await sql.run("DELETE FROM merchants WHERE id = 'T1'");
    await sql.run("DELETE FROM outbox");
    await sql.run("INSERT INTO merchants (id, name, city, category, city_tier, category_group, plan_id, monthly_rent, shard) VALUES ('T1', 'Test Store', 'Pune', 'Kirana', 1, 'food', 'SB_149', 149, 5)");
    await sql.run("INSERT INTO briefs (brief_id, merchant_id, sort_key, json, meta, channel, value, shard) VALUES (?, 'T1', 1, ?, ?, 'soundbox', 1, 5)", [brief.briefId, JSON.stringify(brief), JSON.stringify({ why: "test" })]);
  });
  afterAll(() => sql.close());

  const deps = (llm: LLMAdapter) => ({ sql, core: benchCore(sql), llm });

  // Reported bugs from real runs: each of these once embarrassed the agent in front of a merchant.
  describe("ending a conversation", () => {
    const call = (name: string, args: unknown, callId = name) => ({ callId, name, args: JSON.stringify(args) });
    const acts = (text: string, ...calls: { callId: string; name: string; args: string }[]): LLMEvent[] => [...(text ? [{ type: "text" as const, delta: text }] : []), { type: "done", items: [], calls }];
    const run = async (script: LLMEvent[][], ...turns: string[]) => {
      await resetLive(sql);
      const conv = await Conversation.start(deps(fakeLlm(script)), brief, "test");
      conv.opening();
      const replies: string[] = [];
      for (const turn of turns) {
        let text = "";
        for await (const chunk of conv.reply(turn)) text += `${chunk} `;
        replies.push(text.trim());
        await conv.save();
      }
      return { conv, replies };
    };

    it("tells the merchant the real ticket number, even if the model stays silent", async () => {
      const { conv, replies } = await run([acts("", call("raiseTicket", { type: "device", note: "battery" }), call("recordOutcome", { outcome: "ticket_raised", summary: "done" }))], "battery खराब है");
      expect(replies[0]).toMatch(/ticket T\d+ बन गया है/);
      expect(replies[0]).not.toContain("बहुत अच्छा");
      expect(conv.ended).toBe(true);
      expect((await conv.finish())!.outcome).toBe("ticket_raised");
    });

    it("won't hang up on a complaint it hasn't answered", async () => {
      const { conv, replies } = await run([acts("", call("recordOutcome", { outcome: "stayed", summary: "x" })), says("जी, fee ₹38 है।")], "पैसे कम आए");
      expect(replies[0]).toContain("₹38");
      expect(conv.ended).toBe(false);
    });

    it("won't end while waiting for an answer to its own question", async () => {
      const { conv } = await run([acts("क्या मैं plan बदल दूँ?", call("recordOutcome", { outcome: "no_response", summary: "x" }))], "rent ज़्यादा है");
      expect(conv.ended).toBe(false);
    });

    it("reports a result that matches what really happened", async () => {
      const { conv } = await run([acts("जी, धन्यवाद।", call("recordOutcome", { outcome: "plan_changed", summary: "x" }))], "ठीक है", "और कुछ नहीं");
      expect((await conv.finish())!.outcome).toBe("stayed");
    });

    it("treats a spoken goodbye as the end, even with no outcome recorded", async () => {
      const { conv } = await run([says("जी, fee ₹38 है।"), says("जी, धन्यवाद। आपका दिन शुभ हो।")], "कितना कटा", "ठीक है, रख लेता हूँ");
      expect(conv.ended).toBe(true);
      expect((await conv.finish())!.outcome).toBe("stayed");
    });

    it("refuses an offered OTP without the model, a ticket or the merchant's digits", async () => {
      const { conv, replies } = await run([says("यह नहीं आना चाहिए")], "मेरा OTP 482913 है");
      expect(replies[0]).toContain("OTP");
      expect(replies[0]).not.toContain("482913");
      expect(conv.actions).toEqual([]);
    });

    it("continues after a blocked sentence instead of repeating the good one", async () => {
      const { conv, replies } = await run([says("जी, fee ₹38 है। और ₹777 भी।"), says("बस इतना ही।")], "कितना कटा");
      expect(replies[0]).toBe("जी, fee ₹38 है। बस इतना ही।");
      expect(conv.actions).toEqual([]);
      expect(conv.numbersVerified).toBe(true);
    });
  });

  it("the morning run sends every brief with no person, and skips a shop that opted out", async () => {
    await resetLive(sql);
    await sql.run("UPDATE merchants SET opted_out = 1, consent_messages = 1 WHERE id = 'T1'");
    const blocked = await sendMorningOutreach(sql, benchCore(sql), new Date(), false);
    await sql.run("UPDATE merchants SET opted_out = 0 WHERE id = 'T1'");
    const sent = await sendMorningOutreach(sql, benchCore(sql), new Date(), false);
    expect(blocked).toEqual({ sent: 0, blocked: 1 });
    expect(sent).toEqual({ sent: 1, blocked: 0 });
    await resetLive(sql);
  });

  it("resumes a conversation on another server, and finishes it only once", async () => {
    const serverA = deps(fakeLlm([says("आपकी fee ₹38 है।")]));
    const a = await Conversation.start(serverA, brief, "test");
    a.opening();
    for await (const _ of a.reply("पैसे कम क्यों आए")) void _;
    expect(await a.save()).toBe(true);

    const serverB = deps(fakeLlm([says("जी, धन्यवाद।")]));
    const b = (await Conversation.resume(serverB, "T1"))!;
    expect(b.id).toBe(a.id);
    expect(b.transcript).toHaveLength(3);
    for await (const _ of b.reply("ठीक है")) void _;
    expect(await b.save()).toBe(true);

    expect(await a.save()).toBe(false); // the stale copy is refused
    const [first, second] = await Promise.all([b.finish(), (await Conversation.resume(serverB, "T1"))!.finish()]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(await sql.all("SELECT * FROM outcomes WHERE merchant_id = 'T1'")).toHaveLength(1);
    expect(await sql.all("SELECT * FROM reason_events WHERE merchant_id = 'T1' AND live = 1")).toHaveLength(1);
  });

  it("hands over to a person when a service fails", async () => {
    const conv = await Conversation.start(deps(fakeLlm([says("x")])), brief, "test");
    await conv.failover("Model timed out");
    const outcome = await conv.finish();
    expect(outcome?.outcome).toBe("handed_off");
    expect(await sql.all("SELECT * FROM handoffs WHERE merchant_id = 'T1'")).toHaveLength(1);
  });

  it("records an outside agent's outcome once, however many retries", async () => {
    const outcome = { briefId: brief.briefId, outcome: "stayed" as const, reasons: [], actionsTaken: [], durationSec: 1, numbersVerified: true, summary: "ok" };
    const m = { city: "Pune", category: "Kirana", cityTier: 1, categoryGroup: "food" };
    expect(await sql.tx((tx) => recordOutcome(tx, "ext-1", brief, outcome, m))).toBe(true);
    expect(await sql.tx((tx) => recordOutcome(tx, "ext-1", brief, outcome, m))).toBe(false);
  });

  it("gives every outbox event to the bus, even with two relays", async () => {
    const bus = memoryBus();
    const got: string[] = [];
    await bus.subscribe({ topics: ["t"], handler: async (_t, v) => void got.push(v) });
    await sql.tx((tx) => enqueue(tx, "t", "k", { n: 1 }));
    const relays = [startRelay(sql, bus, () => {}, 5), startRelay(sql, bus, () => {}, 7)];
    await expect.poll(() => got.length).toBe(1);
    await new Promise((r) => setTimeout(r, 40));
    relays.forEach((r) => r.stop());
    expect(got).toEqual(['{"n":1}']);
  });

  it("rolls back a failed transaction", async () => {
    await expect(sql.tx(async (tx) => {
      await tx.run("INSERT INTO kv (key, value) VALUES ('rollback', '1')");
      throw new Error("boom");
    })).rejects.toThrow("boom");
    expect(await sql.get("SELECT * FROM kv WHERE key = 'rollback'")).toBeUndefined();
  });

  it("refuses to publish a plan when a worker did not finish", async () => {
    await sql.run("DELETE FROM run_shards");
    await sql.run("DELETE FROM kv WHERE key = 'risk_model'");
    await sql.run("INSERT INTO kv (key, value) VALUES ('risk_model', '{}')");
    await sql.run("INSERT INTO run_shards (lo, hi, json) VALUES (0, 255, '{}')");
    await expect(finalizeRun(sql)).rejects.toThrow("256 of 1024");
  });

  it("keeps the audit log append-only", async () => {
    await sql.run("INSERT INTO audit_log (at, kind) VALUES ('now', 'test')");
    await expect(sql.run("UPDATE audit_log SET kind = 'changed'")).rejects.toThrow(/append-only/);
  });
});

describe("shards", () => {
  it("covers every shard exactly once", () => {
    const seen = [0, 1, 2].flatMap((i) => {
      const { lo, hi } = shardRange(i, 3);
      return Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
    });
    expect(seen).toEqual(Array.from({ length: SHARDS }, (_, i) => i));
  });
  it("is stable", () => expect(shardOf("M001")).toBe(shardOf("M001")));
});

describe("merchant tokens", () => {
  const secret = "s".repeat(32);
  it("identifies the merchant", () => expect(merchantFromToken(secret, issueMerchantToken(secret, "M001", 60))).toBe("M001"));
  it("rejects a tampered token", () => expect(merchantFromToken(secret, `${issueMerchantToken(secret, "M001", 60)}x`)).toBeNull());
  it("rejects an expired token", () => expect(merchantFromToken(secret, issueMerchantToken(secret, "M001", 60), Date.now() + 61_000)).toBeNull());
});

describe("contact hours", () => {
  it("allows 10am IST", () => expect(withinContactHours(new Date("2026-11-20T04:30:00Z"))).toBe(true));
  it("blocks 9pm IST", () => expect(withinContactHours(new Date("2026-11-20T15:30:00Z"))).toBe(false));
});
