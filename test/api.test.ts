import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Settings } from "../config/settings.js";
import { benchCore } from "../src/adapters/benchCore.js";
import { benchGateway } from "../src/adapters/benchGateway.js";
import { memoryBus } from "../src/adapters/memoryBus.js";
import type { LLMAdapter } from "../src/agent/llmAdapter.js";
import { openSql, type Sql } from "../src/data/sql.js";
import { Brief } from "../src/engine/brief.js";
import { buildApp } from "../src/server/app.js";
import { issueMerchantToken } from "../src/server/auth.js";

const FILE = "data/test-api.db";
const secret = "s".repeat(32);
const settings = { APP_ENV: "production", RISHTA_API_KEY: "key", SESSION_SECRET: secret, LOG_LEVEL: "silent", OUTREACH_ENABLED: true } as Settings;
const llm: LLMAdapter = {
  async *turn() {
    throw new Error("Model down");
  },
  extract: async () => ({ reasons: [], teamSummary: "", merchantMessage: "" }) as never,
};
const tts = { prepare: () => "/api/tts/x", verify: () => null, prewarm: async () => {}, stream: async function* () {} };
const brief = Brief.parse({
  briefId: "B-A1-179", merchantId: "A1", displayName: "Shop", language: "hi", channel: "soundbox", problem: "fee_confusion", approachId: "fee_own_numbers",
  goal: "g", facts: { firstName: "Asha" }, allowedActions: ["recordOutcome"], limits: { maxDiscountInr: 50 }, mustSay: ["x"], mustNot: ["y"], escalateIf: ["z"], successCriteria: "s",
});

describe("production API", () => {
  let sql: Sql;
  let app: Awaited<ReturnType<typeof buildApp>>["app"];
  const auth = { authorization: "Bearer key" };
  const asMerchant = (id: string) => ({ authorization: `Bearer ${issueMerchantToken(secret, id, 60)}` });

  async function setup(s: Settings) {
    const bus = memoryBus();
    return (await buildApp({ s, sql, core: benchCore(sql), llm, bus, gateway: benchGateway(bus), stt: (async () => ({ text: "", language: "hi-IN" })) as never, translate: async (t: string) => t, tts: tts as never, kickRelay: () => {} })).app;
  }

  beforeAll(async () => {
    rmSync(FILE, { force: true });
    sql = await openSql(FILE);
    await sql.run("INSERT INTO merchants (id, name, city, category, city_tier, category_group, plan_id, monthly_rent, consent_messages, opted_out, shard) VALUES ('A1', 'Shop', 'Pune', 'Kirana', 1, 'food', 'SB_149', 149, 1, 1, 1)");
    await sql.run("INSERT INTO briefs (brief_id, merchant_id, sort_key, json, meta, channel, value, shard) VALUES (?, 'A1', 1, ?, ?, 'soundbox', 1, 1)", [brief.briefId, JSON.stringify(brief), JSON.stringify({ why: "t" })]);
    app = await setup(settings);
  });
  afterAll(() => sql.close());

  it("locks service routes", async () => {
    expect((await app.inject({ url: "/v1/briefs" })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/console" })).statusCode).toBe(401);
    expect((await app.inject({ url: "/metrics" })).statusCode).toBe(401);
    expect((await app.inject({ url: "/v1/briefs", headers: auth })).statusCode).toBe(200);
  });

  it("keeps merchants to their own data", async () => {
    const res = await app.inject({ method: "POST", url: "/api/talk/A1", headers: asMerchant("OTHER"), payload: { text: "hi" } });
    expect(res.statusCode).toBe(401);
  });

  it("has no reset route", async () => {
    expect((await app.inject({ method: "POST", url: "/api/reset", headers: auth })).statusCode).toBe(404);
  });

  it("blocks outreach to an opted-out merchant at send time", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/outreach/A1", headers: auth });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/opted out/i);
  });

  it("stops all outreach with the kill switch", async () => {
    const paused = await setup({ ...settings, OUTREACH_ENABLED: false });
    expect((await paused.inject({ method: "POST", url: "/v1/outreach/A1", headers: auth })).statusCode).toBe(503);
  });

  it("hands over to a person when the model is down", async () => {
    await sql.run("INSERT INTO outreach (brief_id, merchant_id, channel, created_at) VALUES (?, 'A1', 'soundbox', '2026-01-01')", [brief.briefId]);
    const res = await app.inject({ method: "POST", url: "/api/talk/A1", headers: asMerchant("A1"), payload: { text: "मदद चाहिए" } });
    expect(res.payload).toContain("Paytm से एक व्यक्ति");
    expect(await sql.all("SELECT * FROM handoffs WHERE merchant_id = 'A1'")).toHaveLength(1);
  });

  it("lets an outside agent report an outcome, once", async () => {
    const payload = { briefId: brief.briefId, outcome: "stayed", reasons: [], actionsTaken: [], durationSec: 3, numbersVerified: true, summary: "ok" };
    const first = await app.inject({ method: "POST", url: "/v1/outcomes", headers: auth, payload });
    const second = await app.inject({ method: "POST", url: "/v1/outcomes", headers: auth, payload });
    expect([first.json().duplicate, second.json().duplicate]).toEqual([false, true]);
    expect((await app.inject({ method: "POST", url: "/v1/outcomes", headers: auth, payload: { briefId: "x" } })).statusCode).toBe(400);
  });

  it("publishes its contract without a key", async () => {
    expect(Object.keys((await app.inject({ url: "/v1/openapi.json" })).json().paths)).toContain("/v1/outcomes");
  });
});
