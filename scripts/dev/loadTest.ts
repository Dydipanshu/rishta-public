// Measures Rishta's own cost per turn on Postgres: the model is faked with a fixed delay.
// Usage: DATABASE_URL=... pnpm exec tsx scripts/dev/loadTest.ts [rounds]
import { loadSettings } from "../../config/settings.js";
import { benchCore } from "../../src/adapters/benchCore.js";
import { benchGateway } from "../../src/adapters/benchGateway.js";
import { memoryBus } from "../../src/adapters/memoryBus.js";
import type { LLMAdapter } from "../../src/agent/llmAdapter.js";
import { resetLive } from "../../src/data/reset.js";
import { openSql } from "../../src/data/sql.js";
import { buildApp } from "../../src/server/app.js";

const MODEL_DELAY_MS = 1000;
const rounds = Number(process.argv[2] ?? 3);
const s = { ...loadSettings(), LOG_LEVEL: "error" };
const sql = await openSql(s.DATABASE_URL, 50);
const llm: LLMAdapter = {
  async *turn() {
    await new Promise((r) => setTimeout(r, MODEL_DELAY_MS));
    yield { type: "text", delta: "जी, समझ गई।" };
    yield { type: "done", items: [{ role: "assistant", content: "जी, समझ गई।" }], calls: [] };
  },
  extract: async () => ({ reasons: [], teamSummary: "ok", merchantMessage: "" }) as never,
};
const tts = { prepare: () => "/x", verify: () => null, prewarm: async () => {}, stream: async function* () {} };
const bus = memoryBus();
const { app } = await buildApp({ translate: async (t: string) => t, s, sql, core: benchCore(sql), llm, bus, gateway: benchGateway(bus), stt: (async () => "") as never, tts: tts as never, kickRelay: () => {} });
await app.listen({ port: 3009 });
await resetLive(sql);

const ids = (await sql.all<{ merchant_id: string }>("SELECT merchant_id FROM briefs")).map((r) => r.merchant_id);
const times: number[] = [];
const turn = async (id: string) => {
  const t = performance.now();
  const res = await fetch(`http://localhost:3009/api/talk/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "ठीक है" }) });
  await res.text();
  times.push(performance.now() - t);
};
const started = performance.now();
for (let r = 0; r < rounds; r++) await Promise.all(ids.map(turn));
const seconds = (performance.now() - started) / 1000;
await Promise.all(ids.map((id) => fetch(`http://localhost:3009/api/end/${id}`, { method: "POST" })));
times.sort((a, b) => a - b);
const pct = (p: number) => Math.round(times[Math.floor(times.length * p)]! - MODEL_DELAY_MS);
console.log(`${ids.length} live conversations, ${times.length} turns, ${(times.length / seconds).toFixed(0)} turns/s on one server`);
console.log(`Added by Rishta on top of the model: p50 ${pct(0.5)}ms, p95 ${pct(0.95)}ms, p99 ${pct(0.99)}ms`);
console.log("Outcomes written:", (await sql.get("SELECT COUNT(*) AS c FROM outcomes"))?.c);
await resetLive(sql);
await app.close();
await sql.close();
process.exit(0);
