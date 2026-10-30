import { PLAYBOOK, approachById } from "../../config/playbook.js";
import type { Sql } from "../data/sql.js";
import { feeFacts, summaryFacts } from "../engine/facts.js";
import { REASON_LABELS, SUGGESTED_MOVES, type ReasonCode } from "../engine/reasons.js";
import type { PaytmCore } from "../ports.js";
import { TODAY } from "../sim/types.js";

type Row = Record<string, any>;
const parse = <T = any>(s: string) => JSON.parse(s) as T;

const COST_PER_MINUTE_INR = 3; // list-price estimate: STT + TTS + LLM
const QUEUE_SIZE = 40;

async function queue(sql: Sql) {
  const rows = await sql.all(`SELECT * FROM briefs ORDER BY sort_key DESC LIMIT ${QUEUE_SIZE}`);
  const ids = rows.map((r) => r.merchant_id);
  const outcomes = new Map(ids.length ? (await sql.all(`SELECT merchant_id, json FROM outcomes WHERE merchant_id IN (${ids.map(() => "?").join(",")}) ORDER BY created_at`, ids)).map((o) => [o.merchant_id, parse(o.json)]) : []);
  return rows.map((r) => ({ brief: parse(r.json), meta: parse(r.meta), outcome: outcomes.get(r.merchant_id) ?? null }));
}

async function why(sql: Sql) {
  const events = await sql.all("SELECT * FROM reason_events WHERE day > ? ORDER BY live DESC, day DESC, id DESC", [TODAY - 56]);
  const recent = events.filter((e) => e.day > TODAY - 28);
  const earlier = events.filter((e) => e.day <= TODAY - 28);

  const counts = new Map<string, number>();
  for (const e of recent) counts.set(e.code, (counts.get(e.code) ?? 0) + 1);
  const reasons = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([code, count]) => ({
      code,
      label: REASON_LABELS[code as ReasonCode],
      count,
      liveCount: recent.filter((e) => e.code === code && e.live).length,
      quotes: [...new Map(recent.filter((e) => e.code === code).map((e) => [e.quote, e])).values()].slice(0, 2).map((e) => ({ quote: e.quote, city: e.city, live: !!e.live })),
    }));

  const pair = (list: Row[]) => {
    const map = new Map<string, number>();
    for (const e of list) map.set(`${e.code}|${e.city}`, (map.get(`${e.code}|${e.city}`) ?? 0) + 1);
    return map;
  };
  const before = pair(earlier);
  const spikes = [...pair(recent).entries()]
    .map(([key, now]) => {
      const [code, city] = key.split("|") as [ReasonCode, string];
      return { code, city, now, before: before.get(key) ?? 0, label: REASON_LABELS[code], move: SUGGESTED_MOVES[code] ?? "" };
    })
    .filter((s) => s.now >= 5 && s.now >= 2 * Math.max(1, s.before))
    .sort((a, b) => b.now - b.before - (a.now - a.before))
    .slice(0, 3);
  return { reasons, spikes };
}

// Best approach minus the no-contact group, with a 95% margin. Below the margin, it may be luck.
function liftOverHoldout(approaches: { label: string; n: number; keepRate: number | null }[], holdout: { n: number; keepRate: number | null }) {
  const best = approaches.filter((a) => a.keepRate !== null && a.n > 0).sort((a, b) => b.keepRate! - a.keepRate!)[0];
  if (!best || holdout.keepRate === null || holdout.n === 0) return null;
  const [p, q] = [best.keepRate!, holdout.keepRate];
  const margin = 1.96 * Math.sqrt((p * (1 - p)) / best.n + (q * (1 - q)) / holdout.n);
  return { approach: best.label, points: p - q, margin, proven: p - q > margin };
}

async function playbook(sql: Sql) {
  const rows = await sql.all("SELECT problem, approach_id, SUM(kept) AS kept, COUNT(*) AS n FROM contact_history WHERE kept IS NOT NULL GROUP BY problem, approach_id");
  const shares = await sql.all("SELECT * FROM playbook_stats ORDER BY week");
  return (Object.keys(PLAYBOOK) as ReasonCode[]).map((problem) => {
    const keep = (id: string) => {
      const r = rows.find((x) => x.problem === problem && x.approach_id === id);
      return { n: Number(r?.n ?? 0), keepRate: r ? Number(r.kept) / Number(r.n) : null };
    };
    const approaches = PLAYBOOK[problem]!.map((a) => ({
      id: a.id,
      label: a.label,
      ...keep(a.id),
      weekly: shares.filter((s) => s.problem === problem && s.approach_id === a.id).map((s) => s.share as number),
    }));
    const holdout = keep("holdout");
    return { problem, label: REASON_LABELS[problem], approaches, holdout, lift: liftOverHoldout(approaches, holdout) };
  });
}

async function done(sql: Sql) {
  const outcomes = (await sql.all("SELECT json FROM outcomes")).map((o) => parse(o.json));
  const minutes = outcomes.reduce((s, o) => s + o.durationSec, 0) / 60;
  const byAi = outcomes.filter((o) => o.handledBy !== "human");
  const resolved = byAi.filter((o) => ["stayed", "plan_changed", "ticket_raised"].includes(o.outcome)).length;
  const tickets = await sql.get("SELECT COUNT(*) AS c FROM tickets WHERE live = 1");
  return {
    conversations: byAi.length,
    humanClosed: outcomes.length - byAi.length,
    resolvedWithoutHuman: resolved,
    ticketsRaised: Number(tickets?.c ?? 0),
    plansChanged: outcomes.filter((o) => o.outcome === "plan_changed").length,
    escalations: outcomes.filter((o) => o.outcome === "handed_off").length,
    optOuts: outcomes.filter((o) => o.outcome === "opted_out").length,
    visitsSaved: resolved,
    costPerConversationInr: byAi.length ? Math.round((minutes * COST_PER_MINUTE_INR * 10) / byAi.length) / 10 : null,
    costPerMinuteInr: COST_PER_MINUTE_INR,
    verified: byAi.filter((o) => o.numbersVerified).length,
  };
}

async function humanWork(sql: Sql, core: PaytmCore) {
  const handoffs = await sql.all("SELECT h.*, b.meta FROM handoffs h LEFT JOIN briefs b ON b.merchant_id = h.merchant_id ORDER BY h.id DESC LIMIT 20");
  const live = handoffs.map((h) => ({ merchant_id: h.merchant_id, reason: h.reason, summary: h.summary, name: h.meta ? parse(h.meta).name : h.merchant_id, live: true }));
  const closed = new Set((await sql.all("SELECT merchant_id FROM outcomes")).map((o) => o.merchant_id));
  const callbacks = await sql.all("SELECT merchant_id, brief_id, json, meta FROM briefs WHERE channel = 'human_callback' ORDER BY sort_key DESC LIMIT 20");
  const waiting = await Promise.all(
    callbacks.filter((c) => !live.some((h) => h.merchant_id === c.merchant_id)).map(async (c) => {
      const meta = parse(c.meta);
      const notes = await core.openTickets(c.merchant_id);
      return {
        merchant_id: c.merchant_id,
        briefId: c.brief_id,
        problem: parse(c.json).problem,
        closed: closed.has(c.merchant_id),
        name: meta.name,
        reason: meta.why,
        summary: `${notes.length} open tickets, oldest ${notes[0] ? TODAY - notes[0].openedDay : 0} days old. Latest note: ${notes.at(-1)?.note ?? "none"}. Rishta held back outreach: a person should call, with these tickets in hand.`,
        live: false,
      };
    }),
  );
  const visitRows = await sql.all("SELECT json, meta FROM briefs WHERE channel = 'salesperson_visit' ORDER BY value DESC LIMIT 20");
  const visits = visitRows.map((v) => {
    const brief = parse(v.json);
    const meta = parse(v.meta);
    return { merchantId: brief.merchantId, briefId: brief.briefId, problem: brief.problem, closed: closed.has(brief.merchantId), name: meta.name, city: meta.city, why: meta.why, say: approachById(brief.approachId)?.guidance ?? "", tried: "No proactive contact in the last 28 days" };
  });
  return { needsHuman: [...live, ...waiting], visits };
}

export async function consoleView(sql: Sql, core: PaytmCore) {
  const plan = await sql.get("SELECT json FROM daily_plan");
  const report = await sql.get("SELECT value FROM kv WHERE key = 'report_card'");
  const total = await sql.get("SELECT COUNT(*) AS c FROM briefs");
  const [q, whyPanel, playbookPanel, donePanel, human, leftAlone] = await Promise.all([
    queue(sql), why(sql), playbook(sql), done(sql), humanWork(sql, core),
    sql.all("SELECT * FROM left_alone ORDER BY is_demo DESC, kind DESC, merchant_id LIMIT 12"),
  ]);
  return {
    plan: parse(plan!.json),
    report: report ? parse(report.value) : null,
    queue: q,
    queueTotal: Number(total?.c ?? 0),
    leftAlone: leftAlone.map((l) => ({ ...l, reasons: parse(l.reasons) })),
    why: whyPanel,
    playbook: playbookPanel,
    done: donePanel,
    ...human,
  };
}

export async function merchantView(sql: Sql, core: PaytmCore, id: string) {
  const m = await core.merchant(id);
  const brief = await sql.get("SELECT json FROM briefs WHERE merchant_id = ?", [id]);
  return {
    id: m.id,
    name: m.name,
    city: m.city,
    plan: { id: m.planId, rent: m.monthlyRent },
    today: m.days[TODAY]!.value,
    ...summaryFacts(m, TODAY),
    fee: feeFacts(m, TODAY),
    hasBrief: !!brief,
    channel: brief ? parse(brief.json).channel : null,
    inbox: await sql.all("SELECT text, created_at FROM inbox WHERE merchant_id = ? ORDER BY id DESC", [id]),
    tickets: await sql.all("SELECT id, type, status, note FROM tickets WHERE merchant_id = ? AND live = 1 ORDER BY id DESC", [id]),
  };
}
