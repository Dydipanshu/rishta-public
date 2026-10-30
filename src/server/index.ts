import { existsSync } from "node:fs";
import { resolve } from "node:path";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { loadSettings } from "../../config/settings.js";
import { Conversation, openingLine } from "../agent/brain.js";
import { openAIAdapter } from "../agent/llmAdapter.js";
import { Brief } from "../engine/brief.js";
import { makeStt } from "../voice/stt.js";
import { makeTts } from "../voice/tts.js";
import { audit, openDb } from "./db.js";
import { publish, subscribe } from "./events.js";
import { resetLive } from "./reset.js";
import { TalkText } from "./schemas.js";
import { consoleView, merchantView } from "./views.js";

const s = loadSettings();
const db = openDb();
const llm = openAIAdapter(s.OPENAI_API_KEY, s.OPENAI_MODEL, s.OPENAI_REASONING_EFFORT);
const stt = makeStt(s);
const tts = makeTts(s);

const app = Fastify({ logger: false });
await app.register(fastifyMultipart, { limits: { fileSize: 5_000_000 } });

const conversations = new Map<string, Conversation>();

const ANNOUNCEMENT = "Paytm पर पाँच सौ रुपये प्राप्त हुए।";
const FILLERS = ["जी, एक second।", "जी, देखती हूँ।"];
const NUDGES: Record<string, string> = {
  fee_confusion: "आपके settlement में कुछ कम आया है। जानने के लिए Paytm button दबाइए।",
  device_fault: "आपकी मशीन में कुछ दिक्कत दिख रही है। जानने के लिए Paytm button दबाइए।",
  rent_too_high: "आपके plan के बारे में एक ज़रूरी बात है। जानने के लिए Paytm button दबाइए।",
  settlement_delay: "आपके settlement की जानकारी है। जानने के लिए Paytm button दबाइए।",
};
const nudgeFor = (problem: string) => NUDGES[problem] ?? "Paytm की तरफ़ से एक जानकारी है। जानने के लिए Paytm button दबाइए।";

const say = (text: string) => ({ text, audio: tts.prepare(text) });

function briefRow(id: string) {
  const row = db.prepare("SELECT json, meta FROM briefs WHERE merchant_id = ?").get(id) as { json: string; meta: string } | undefined;
  if (!row) return null;
  return { brief: Brief.parse(JSON.parse(row.json)), meta: JSON.parse(row.meta) as { why: string } };
}

function conversationFor(id: string) {
  const existing = conversations.get(id);
  if (existing && !existing.ended) return { conv: existing, isNew: false };
  const row = briefRow(id);
  if (!row) return null;
  const conv = new Conversation(db, row.brief, llm, row.meta.why);
  conversations.set(id, conv);
  return { conv, isNew: true };
}

async function finish(id: string, conv: Conversation) {
  const outcome = await conv.finish();
  conversations.delete(id);
  publish({ type: "changed", merchantId: id });
  console.log(`[${id}] outcome ${outcome.outcome}, reasons ${outcome.reasons.map((r) => r.code).join(",")}`);
}

app.get("/api/events", (_req, reply) => {
  subscribe(reply);
  reply.hijack();
});
app.get("/api/console", () => consoleView(db));
app.get("/api/merchant/:id", (req) => merchantView(db, (req.params as { id: string }).id));

app.get("/api/tts/:hash", async (req, reply) => {
  const { hash } = req.params as { hash: string };
  reply.hijack();
  reply.raw.writeHead(200, { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" });
  try {
    for await (const chunk of tts.stream(hash)) reply.raw.write(chunk);
  } catch (err) {
    console.error("TTS failed", err);
  }
  reply.raw.end();
});

// Rishta's outreach step: the Soundbox plays a payment, then the nudge.
app.post("/api/outreach/:id", (req, reply) => {
  const { id } = req.params as { id: string };
  const row = briefRow(id);
  if (!row) return reply.code(404).send({ error: "No brief" });
  audit(db, id, "outreach", { channel: row.brief.channel, approachId: row.brief.approachId });
  const lines = row.brief.channel === "soundbox" ? [say(ANNOUNCEMENT), say(nudgeFor(row.brief.problem))] : [];
  publish({ type: "nudge", merchantId: id, channel: row.brief.channel, lines, card: nudgeFor(row.brief.problem) });
  return { ok: true };
});

// One merchant turn. Replies as newline-delimited JSON so speech can start early.
app.post("/api/talk/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const started = performance.now();
  const found = conversationFor(id);
  if (!found) return reply.code(404).send({ error: "No brief for this merchant" });
  const { conv, isNew } = found;

  let audio: { data: Buffer; type: string } | null = null;
  let typed = "";
  if (req.isMultipart()) {
    const file = await req.file();
    if (file) audio = { data: await file.toBuffer(), type: file.mimetype };
  } else {
    typed = TalkText.parse(req.body).text;
  }

  reply.hijack();
  reply.raw.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" });
  const send = (o: unknown) => reply.raw.write(`${JSON.stringify(o)}\n`);

  try {
    if (isNew) send({ type: "say", ...say(conv.opening()) });

    const text = audio ? await stt(audio.data, audio.type) : typed;
    const sttMs = performance.now() - started;
    send({ type: "transcript", text });
    if (!text.trim()) {
      send({ type: "say", ...say("जी, मुझे सुनाई नहीं दिया। कृपया फिर से बोलिए।") });
      send({ type: "end" });
      reply.raw.end();
      return;
    }

    let spoke = false;
    let first = 0;
    const filler = isNew ? null : setTimeout(() => { if (!spoke) send({ type: "say", ...say(FILLERS[conv.transcript.length % FILLERS.length]!), filler: true }); }, 500);
    for await (const chunk of conv.reply(text)) {
      spoke = true;
      first ||= performance.now() - started;
      send({ type: "say", ...say(chunk) });
    }
    if (filler) clearTimeout(filler);
    console.log(`[${id}] STT ${sttMs.toFixed(0)}ms, first reply ${first.toFixed(0)}ms, total ${(performance.now() - started).toFixed(0)}ms`);
    send({ type: "end", ended: conv.ended });
    publish({ type: "changed", merchantId: id });
    if (conv.ended) await finish(id, conv);
  } catch (err) {
    console.error("Talk failed", err);
    send({ type: "error", message: (err as Error).message });
  }
  reply.raw.end();
});

// Ends a conversation the merchant simply walked away from.
app.post("/api/end/:id", async (req) => {
  const { id } = req.params as { id: string };
  const conv = conversations.get(id);
  if (conv) await finish(id, conv);
  return { ok: true };
});

app.post("/api/reset", () => {
  conversations.clear();
  resetLive(db);
  publish({ type: "reset" });
  publish({ type: "changed" });
  return { ok: true };
});

const web = resolve("dist/web");
if (existsSync(web)) {
  await app.register(fastifyStatic, { root: web });
  app.setNotFoundHandler((_req, reply) => reply.sendFile("index.html"));
}

await app.listen({ port: s.PORT, host: "0.0.0.0" });
console.log(`Rishta on http://localhost:${s.PORT}  (/demo, /merchant, /console)`);

// Fixed lines play instantly from cache.
const firstNames = (db.prepare("SELECT first_name FROM merchants WHERE is_demo = 1").all() as { first_name: string }[]).map((m) => m.first_name);
tts
  .prewarm([ANNOUNCEMENT, ...FILLERS, ...Object.values(NUDGES), ...firstNames.map(openingLine)])
  .then(() => console.log("Fixed lines cached"))
  .catch((err) => console.error("Could not cache fixed lines", err));
