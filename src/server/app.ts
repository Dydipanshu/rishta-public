import { existsSync } from "node:fs";
import { resolve } from "node:path";
import fastifyMultipart from "@fastify/multipart";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import type { Settings } from "../../config/settings.js";
import { Conversation, helloLine, openingLine, type AgentDeps } from "../agent/brain.js";
import { TOPICS } from "../contracts/events.js";
import { resetLive } from "../data/reset.js";
import { audit } from "../data/sql.js";
import { KEEP_WINDOW_DAYS, TODAY } from "../sim/types.js";
import { Brief, Outcome } from "../engine/brief.js";
import { followUpBrief, inboundBrief, pendingFollowUp } from "../engine/inbound.js";
import { sendOutreach } from "../engine/outreach.js";
import { heardClearly } from "../voice/stt.js";
import { settleOutcomes } from "../engine/settle.js";
import { recordOutcome } from "../engine/outcomes.js";
import type { ChannelGateway, EventBus } from "../ports.js";
import { LANGUAGES, isEnglish, languageOfText } from "../voice/languages.js";
import type { makeStt } from "../voice/stt.js";
import type { makeTranslate } from "../voice/translate.js";
import type { makeTts } from "../voice/tts.js";
import { bearer, issueMerchantToken, merchantFromToken, validKey } from "./auth.js";
import { metrics, registry } from "./metrics.js";
import { openapi } from "./openapi.js";
import { consoleView, decisionsView, merchantView, shopView, shopsView } from "./views.js";

export interface AppDeps extends AgentDeps {
  s: Settings;
  bus: EventBus;
  gateway: ChannelGateway;
  stt: ReturnType<typeof makeStt>;
  translate: ReturnType<typeof makeTranslate>;
  tts: ReturnType<typeof makeTts>;
  kickRelay: () => void;
}

const ANNOUNCEMENT = "Paytm पर पाँच सौ रुपये प्राप्त हुए।";
const FILLERS = ["जी, एक second।", "जी, देखती हूँ।"];
// Spoken aloud in a shop, maybe in front of customers: it claims nothing and reveals nothing.
const NUDGE = "Paytm से आपके लिए एक जानकारी है। सुनना चाहें तो बटन दबाइए।";

const HELLO = /^(नमस्ते|नमस्कार|प्रणाम|हेलो|हैलो|हाय|namaste|namaskar|hello|hi|hey)( जी| ji| ji\.)?[\s.!।?]*$/i;

const IDLE_MS = 5 * 60_000;
const TalkText = z.object({ text: z.string().trim().min(1) });
const SessionRequest = z.object({ merchantId: z.string(), ttlSec: z.number().int().max(3600).default(900) });

export async function buildApp(d: AppDeps) {
  const { s, sql, core, bus, tts, stt, translate } = d;
  const production = s.APP_ENV === "production";
  const app = Fastify({ logger: { level: s.LOG_LEVEL, redact: ["req.headers.authorization"] }, forceCloseConnections: "idle" });
  await app.register(fastifyMultipart, { limits: { fileSize: 5_000_000 } });
  if (production) await app.register(fastifyRateLimit, { global: false });

  const say = (text: string) => ({ text, audio: tts.prepare(text) });
  const ui = (event: Record<string, unknown>) => bus.publish(TOPICS.ui, String(event.merchantId ?? "all"), JSON.stringify(event));

  // Live screens: any server can publish, every server forwards to its own browsers.
  const screens = new Set<FastifyReply>();
  await bus.subscribe({
    topics: [TOPICS.ui],
    handler: async (_topic, value) => {
      for (const c of screens) c.raw.write(`data: ${value}\n\n`);
    },
  });

  async function briefRow(id: string) {
    const row = await sql.get<{ json: string; meta: string }>("SELECT json, meta FROM briefs WHERE merchant_id = ? AND sort_key >= 0", [id]);
    return row ? { brief: Brief.parse(JSON.parse(row.json)), meta: JSON.parse(row.meta) as { why: string } } : null;
  }

  // Exactly one server picks up each outreach event.
  await bus.subscribe({
    topics: [TOPICS.outreach],
    group: "rishta-outreach",
    handler: async (_topic, value) => {
      const event = JSON.parse(value) as { merchantId: string };
      const row = await briefRow(event.merchantId);
      if (!row) return;
      const lines = row.brief.channel === "soundbox" ? [say(ANNOUNCEMENT), say(NUDGE)] : [];
      await d.gateway.deliver({ brief: row.brief, lines, card: NUDGE });
    },
  });

  async function finish(conv: Conversation) {
    const outcome = await conv.finish();
    if (!outcome) return;
    metrics.outcomes.inc({ outcome: outcome.outcome });
    d.kickRelay();
    await ui({ type: "changed", merchantId: conv.brief.merchantId });
    app.log.info({ merchantId: conv.brief.merchantId, outcome: outcome.outcome }, "conversation finished");
  }

  const serviceAuth = async (req: FastifyRequest, reply: FastifyReply) => {
    if (production && !validKey(bearer(req.headers.authorization), s.RISHTA_API_KEY)) return reply.code(401).send({ error: "Unauthorised" });
  };
  const merchantAuth = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!production) return;
    const id = (req.params as { id: string }).id;
    if (merchantFromToken(s.SESSION_SECRET, bearer(req.headers.authorization)) !== id) return reply.code(401).send({ error: "Unauthorised" });
  };

  app.get("/healthz", () => ({ ok: true }));
  app.get("/readyz", async (_req, reply) => {
    try {
      await sql.get("SELECT 1 AS ok");
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });
  app.get("/metrics", { preHandler: serviceAuth }, async (_req, reply) => reply.type(registry.contentType).send(await registry.metrics()));

  app.get("/api/events", { preHandler: serviceAuth }, (_req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    reply.raw.write(": connected\n\n");
    screens.add(reply);
    reply.raw.on("close", () => screens.delete(reply));
  });
  app.get("/api/console", { preHandler: serviceAuth }, () => consoleView(sql, core));
  app.get("/api/decisions", { preHandler: serviceAuth }, () => decisionsView(sql));
  app.get<{ Querystring: { q?: string } }>("/api/shops", { preHandler: serviceAuth }, (req) => shopsView(sql, req.query.q ?? ""));
  app.get<{ Params: { id: string } }>("/api/shop/:id", { preHandler: serviceAuth }, async (req, reply) => (await shopView(sql, core, req.params.id)) ?? reply.code(404).send({ error: "No such shop" }));
  app.get<{ Params: { id: string } }>("/api/merchant/:id", { preHandler: merchantAuth }, async (req, reply) => {
    if (!(await sql.get("SELECT 1 AS ok FROM merchants WHERE id = ?", [req.params.id]))) return reply.code(404).send({ error: "No such shop" });
    return merchantView(sql, core, req.params.id);
  });

  app.get<{ Querystring: { t?: string; s?: string } }>("/api/tts/:hash", async (req, reply) => {
    const spoken = tts.verify(req.query.t ?? "", req.query.s ?? "");
    if (!spoken) return reply.code(403).send({ error: "Bad audio link" });
    reply.hijack();
    reply.raw.writeHead(200, { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=86400" });
    try {
      for await (const chunk of tts.stream(spoken)) reply.raw.write(chunk);
    } catch (err) {
      app.log.error(err, "TTS failed");
    }
    reply.raw.end();
  });

  // The Soundbox plays a payment, then the nudge. Goes through the outbox, so it survives a crash.
  const outreach = async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    if (!s.OUTREACH_ENABLED) {
      metrics.outreach.inc({ result: "paused" });
      return reply.code(503).send({ error: "Outreach is paused" });
    }
    const row = await briefRow(id);
    if (!row) return reply.code(404).send({ error: "No brief" });
    const result = await sendOutreach(sql, core, row.brief, new Date(), production);
    if (result.blocked) {
      metrics.outreach.inc({ result: "blocked" });
      return reply.code(409).send({ error: result.blocked });
    }
    metrics.outreach.inc({ result: result.sent ? "sent" : "duplicate" });
    d.kickRelay();
    return { ok: true, duplicate: !result.sent };
  };
  app.post("/api/outreach/:id", { preHandler: serviceAuth }, outreach);
  app.post("/v1/outreach/:id", { preHandler: serviceAuth }, outreach);

  // One merchant turn. Replies as newline-delimited JSON so speech can start early.
  app.post<{ Params: { id: string } }>("/api/talk/:id", { preHandler: merchantAuth, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { id } = req.params;
    const started = performance.now();
    let conv = await Conversation.resume(d, id);
    const isNew = !conv;
    if (!conv) {
      // Any shop can press the button, any time. One brief still gives one conversation,
      // so a late press becomes a new service conversation and can't overwrite a result.
      if (!(await sql.get("SELECT 1 AS ok FROM merchants WHERE id = ?", [id]))) return reply.code(404).send({ error: "No such shop" });
      const row = await briefRow(id);
      const open = row && (row.brief.channel === "human_callback" || !(await sql.get("SELECT 1 AS ok FROM outcomes WHERE brief_id = ?", [row.brief.briefId])));
      // Rishta only brings up its own topic if it actually reached out. Otherwise the shop speaks first and the agent answers that.
      const reachedOut = row && (row.brief.channel === "human_callback" || !!(await sql.get("SELECT 1 AS ok FROM outreach WHERE brief_id = ?", [row.brief.briefId])));
      const planned = open && reachedOut && row.brief.channel !== "salesperson_visit";
      const brief = (await pendingFollowUp(sql, id)) ?? (planned ? row.brief : await inboundBrief(sql, core, id));
      conv = await Conversation.start(d, brief, planned ? row.meta.why : "The shop pressed the button itself");
    }

    let audio: { data: Buffer; type: string } | null = null;
    let typed = "";
    if (req.isMultipart()) {
      const file = await req.file();
      if (file) audio = { data: await file.toBuffer(), type: file.mimetype };
    } else {
      const body = TalkText.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "Say something first" });
      typed = body.data.text.slice(0, 500);
    }

    reply.hijack();
    reply.raw.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" });
    const send = (o: unknown) => reply.raw.write(`${JSON.stringify(o)}\n`);
    let filler: NodeJS.Timeout | undefined;

    try {
      const heard = audio ? await stt(audio.data, audio.type, conv.language) : { text: typed, language: languageOfText(typed, conv.language) };
      const { text, language } = heard;
      const sttMs = performance.now() - started;
      conv.language = language;
      const local = !!LANGUAGES[language];
      // Everything is checked in Hindi first, then translated, so the guard covers every language.
      const speak = async (line: string) => (local ? { text: await translate(line, language), audio: "" } : say(line));
      const voiced = async (line: string) => {
        const out = await speak(line);
        return local ? { text: out.text, audio: tts.prepare(out.text, language) } : out;
      };
      const clear = heardClearly(text, language);
      if (clear) send({ type: "transcript", text });
      const hello = isNew ? conv.opening(isEnglish(text)) : "";
      if (hello) send({ type: "say", ...(await voiced(hello)) });
      if (!clear) {
        await conv.save();
        send({ type: "say", ...(await voiced("जी, मुझे सुनाई नहीं दिया। कृपया फिर से बोलिए।")) });
        send({ type: "end" });
        reply.raw.end();
        return;
      }

      if (isNew && conv.brief.channel === "inbound" && HELLO.test(text.trim())) {
        send({ type: "say", ...(await voiced(conv.askHowToHelp(text))) });
        await conv.save();
        await ui({ type: "changed", merchantId: id });
        send({ type: "end" });
        reply.raw.end();
        return;
      }

      let spoke = false;
      let first = 0;
      const current = conv;
      if (!isNew && !local) filler = setTimeout(() => { if (!spoke) send({ type: "say", ...say(FILLERS[current.transcript.length % FILLERS.length]!), filler: true }); }, 500);
      // Translations run side by side but are sent in order.
      let queue = Promise.resolve();
      for await (const chunk of conv.reply(text)) {
        spoke = true;
        const line = voiced(chunk);
        queue = queue.then(async () => {
          const out = await line;
          first ||= performance.now() - started;
          send({ type: "say", ...out });
        });
      }
      await queue;
      clearTimeout(filler);
      if (!spoke && !conv.ended) send({ type: "say", ...(await voiced(conv.askHowToHelp())) });
      metrics.firstReply.observe(first);
      metrics.turns.inc({ result: "ok" });
      app.log.info({ merchantId: id, sttMs: Math.round(sttMs), firstMs: Math.round(first), totalMs: Math.round(performance.now() - started) }, "turn");
      if (!(await conv.save())) app.log.warn({ merchantId: id }, "turn lost a race with another server");
      send({ type: "end", ended: conv.ended });
      await ui({ type: "changed", merchantId: id });
      if (conv.ended) await finish(conv);
    } catch (err) {
      clearTimeout(filler);
      metrics.turns.inc({ result: "failed" });
      app.log.error(err, "turn failed");
      try {
        // The merchant is never left hanging: a person takes over.
        send({ type: "say", ...say(await conv.failover((err as Error).message)) });
        send({ type: "end", ended: true });
        await finish(conv);
      } catch (inner) {
        app.log.error(inner, "failover failed");
        send({ type: "error", message: "Something went wrong" });
      }
    }
    reply.raw.end();
  });

  // Ends a conversation the merchant simply walked away from.
  app.post<{ Params: { id: string } }>("/api/end/:id", { preHandler: merchantAuth }, async (req) => {
    const conv = await Conversation.resume(d, req.params.id);
    if (conv) await finish(conv);
    return { ok: true };
  });

  // The contract for any other agent or channel.
  app.get("/v1/openapi.json", () => openapi());
  app.get<{ Querystring: { channel?: string; after?: string; limit?: string } }>("/v1/briefs", { preHandler: serviceAuth }, async (req) => {
    const limit = Math.min(Number(req.query.limit ?? 100) || 100, 500);
    const rows = await sql.all<{ brief_id: string; json: string }>(`SELECT brief_id, json FROM briefs WHERE brief_id > ?${req.query.channel ? " AND channel = ?" : ""} ORDER BY brief_id LIMIT ?`, [req.query.after ?? "", ...(req.query.channel ? [req.query.channel] : []), limit]);
    return { briefs: rows.map((r) => JSON.parse(r.json) as unknown), next: rows.length === limit ? rows.at(-1)!.brief_id : null };
  });
  app.get<{ Params: { id: string } }>("/v1/briefs/:id", { preHandler: serviceAuth }, async (req, reply) => {
    const row = await briefRow(req.params.id);
    return row ? row.brief : reply.code(404).send({ error: "Nothing planned today" });
  });
  app.post("/v1/outcomes", { preHandler: serviceAuth }, async (req, reply) => {
    const parsed = Outcome.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: z.prettifyError(parsed.error) });
    const outcome = parsed.data;
    const row = await sql.get<{ json: string }>("SELECT json FROM briefs WHERE brief_id = ?", [outcome.briefId]);
    if (!row) return reply.code(404).send({ error: "Unknown brief" });
    const brief = Brief.parse(JSON.parse(row.json));
    const m = await core.merchant(brief.merchantId);
    const added = await sql.tx((tx) => recordOutcome(tx, `ext-${outcome.briefId}`, brief, outcome, m));
    d.kickRelay();
    await ui({ type: "changed", merchantId: brief.merchantId });
    return { ok: true, duplicate: !added };
  });
  app.post("/v1/settle", { preHandler: serviceAuth }, async () => {
    const settled = await settleOutcomes(sql, core, s.DEMO_SEED, TODAY);
    await ui({ type: "changed" });
    return { settled };
  });
  app.post("/v1/sessions", { preHandler: serviceAuth }, async (req, reply) => {
    const parsed = SessionRequest.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Bad request" });
    return { token: issueMerchantToken(s.SESSION_SECRET, parsed.data.merchantId, parsed.data.ttlSec), expiresInSec: parsed.data.ttlSec };
  });

  // Rishta goes back to a shop about a promise it made. The daily worker calls the same step.
  app.post<{ Params: { id: string } }>("/api/check-back/:id", { preHandler: serviceAuth }, async (req, reply) => {
    const brief = await followUpBrief(sql, core, req.params.id);
    if (!brief) return reply.code(404).send({ error: "Nothing to check on" });
    const card = "आपकी शिकायत के बारे में पूछना था: क्या दिक्कत ठीक हो गई? बताने के लिए नीचे का बटन दबाइए।";
    await d.gateway.deliver({ brief, lines: [say(card)], card });
    await ui({ type: "changed", merchantId: req.params.id });
    return { ok: true };
  });

  if (!production) {
    // Bench only: pretends 30 days have passed so the learning step runs live.
    app.post("/api/demo/fast-forward", async () => {
      const settled = await settleOutcomes(sql, core, s.DEMO_SEED, TODAY + KEEP_WINDOW_DAYS);
      await ui({ type: "changed" });
      return { settled };
    });
    app.post("/api/reset", async () => {
      await resetLive(sql);
      await ui({ type: "reset" });
      await ui({ type: "changed" });
      return { ok: true };
    });
  }

  const web = resolve("dist/web");
  if (existsSync(web)) {
    await app.register(fastifyStatic, { root: web });
    app.setNotFoundHandler((req, reply) => (req.method === "GET" && !/^\/(api|v1)\//.test(req.url) ? reply.sendFile("index.html") : reply.code(404).send({ error: "Not found" })));
  }

  async function prewarm() {
    const firstNames = await sql.all<{ first_name: string }>("SELECT first_name FROM merchants WHERE is_demo = 1");
    await tts.prewarm([ANNOUNCEMENT, ...FILLERS, NUDGE, ...firstNames.flatMap((m) => [openingLine(m.first_name), helloLine(m.first_name)])]);
  }

  // Any server can close abandoned conversations; finish() runs only once.
  async function sweep() {
    for (const conv of await Conversation.stale(d, IDLE_MS)) await finish(conv);
  }

  const closeScreens = () => {
    for (const c of screens) c.raw.end();
  };

  return { app, prewarm, sweep, closeScreens };
}
