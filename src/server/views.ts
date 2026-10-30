import { PLAYBOOK, approachById } from "../../config/playbook.js";
import { REASON_LABELS, SUGGESTED_MOVES, type ReasonCode } from "../engine/reasons.js";
import { feeFacts, summaryFacts } from "../engine/facts.js";
import { TODAY } from "../sim/types.js";
import type { DB } from "./db.js";
import { loadMerchant } from "./store.js";

type Row = Record<string, any>;
const parse = <T = any>(s: string) => JSON.parse(s) as T;

const COST_PER_MINUTE_INR = 3; // list-price estimate: STT + TTS + LLM

function queue(db: DB) {
  const outcomes = new Map((db.prepare("SELECT merchant_id, json FROM outcomes").all() as Row[]).map((o) => [o.merchant_id, parse(o.json)]));
  const rows = db.prepare("SELECT * FROM briefs ORDER BY sort_key DESC").all() as Row[];
  return rows.map((r) => ({ brief: parse(r.json), meta: parse(r.meta), outcome: outcomes.get(r.merchant_id) ?? null }));
}

function why(db: DB) {
  const events = db.prepare("SELECT * FROM reason_events ORDER BY live DESC, day DESC, id DESC").all() as Row[];
  const recent = events.filter((e) => e.day > TODAY - 28);
  const earlier = events.filter((e) => e.day <= TODAY - 28 && e.day > TODAY - 56);

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

function playbook(db: DB) {
  const rows = db.prepare("SELECT problem, approach_id, kept FROM contact_history WHERE kept IS NOT NULL").all() as Row[];
  const shares = db.prepare("SELECT * FROM playbook_stats ORDER BY week").all() as Row[];
  return (Object.keys(PLAYBOOK) as ReasonCode[]).map((problem) => {
    const keep = (id: string) => {
      const list = rows.filter((r) => r.problem === problem && r.approach_id === id);
      return { n: list.length, keepRate: list.length ? list.reduce((s, r) => s + r.kept, 0) / list.length : null };
    };
    const approaches = PLAYBOOK[problem]!.map((a) => ({
      id: a.id,
      label: a.label,
      ...keep(a.id),
      weekly: shares.filter((s) => s.problem === problem && s.approach_id === a.id).map((s) => s.share as number),
    }));
    return { problem, label: REASON_LABELS[problem], approaches, holdout: keep("holdout") };
  });
}

function done(db: DB) {
  const outcomes = (db.prepare("SELECT json FROM outcomes").all() as Row[]).map((o) => parse(o.json));
  const conversations = db.prepare("SELECT merchant_id, numbers_verified, transcript FROM conversations WHERE ended_at IS NOT NULL").all() as Row[];
  const minutes = outcomes.reduce((s, o) => s + o.durationSec, 0) / 60;
  const resolved = outcomes.filter((o) => ["stayed", "plan_changed", "ticket_raised"].includes(o.outcome)).length;
  return {
    conversations: outcomes.length,
    resolvedWithoutHuman: resolved,
    ticketsRaised: (db.prepare("SELECT COUNT(*) c FROM tickets WHERE live = 1").get() as Row).c,
    plansChanged: outcomes.filter((o) => o.outcome === "plan_changed").length,
    escalations: outcomes.filter((o) => o.outcome === "handed_off").length,
    optOuts: outcomes.filter((o) => o.outcome === "opted_out").length,
    visitsSaved: resolved,
    costPerConversationInr: outcomes.length ? Math.round((minutes * COST_PER_MINUTE_INR * 10) / outcomes.length) / 10 : null,
    costPerMinuteInr: COST_PER_MINUTE_INR,
    verified: conversations.filter((c) => c.numbers_verified).length,
  };
}

function humanWork(db: DB, q: ReturnType<typeof queue>) {
  const handoffs = (db.prepare("SELECT * FROM handoffs ORDER BY id DESC").all() as Row[]).map((h): Row => ({ ...h, name: q.find((x) => x.brief.merchantId === h.merchant_id)?.meta.name ?? h.merchant_id, live: true }));
  const callbacks = q.filter((x) => x.brief.channel === "human_callback" && !handoffs.some((h) => h.merchant_id === x.brief.merchantId)).map((x) => {
    const notes = (db.prepare("SELECT note, opened_day FROM tickets WHERE merchant_id = ? AND (closed_day IS NULL OR closed_day > 179) ORDER BY opened_day").all(x.brief.merchantId) as Row[]);
    const first = notes[0];
    return {
      merchant_id: x.brief.merchantId,
      name: x.meta.name,
      reason: x.meta.why,
      summary: `${notes.length} open tickets, oldest ${first ? TODAY - first.opened_day : 0} days old. Latest note: ${notes.at(-1)?.note ?? "none"}. Rishta held back outreach: a person should call, with these tickets in hand.`,
      live: false,
    };
  });
  const visits = q.filter((x) => x.brief.channel === "salesperson_visit").slice(0, 9).map((x) => ({
    merchantId: x.brief.merchantId,
    name: x.meta.name,
    city: x.meta.city,
    why: x.meta.why,
    say: approachById(x.brief.approachId)?.guidance ?? "",
    tried: "No proactive contact in the last 28 days",
  }));
  return { needsHuman: [...handoffs, ...callbacks], visits };
}

export function consoleView(db: DB) {
  const plan = parse((db.prepare("SELECT json FROM daily_plan").get() as Row).json);
  const q = queue(db);
  return {
    plan,
    queue: q.slice(0, 40),
    queueTotal: q.length,
    leftAlone: (db.prepare("SELECT * FROM left_alone ORDER BY is_demo DESC, kind DESC LIMIT 12").all() as Row[]).map((l) => ({ ...l, reasons: parse(l.reasons) })),
    why: why(db),
    playbook: playbook(db),
    done: done(db),
    ...humanWork(db, q),
  };
}

export function merchantView(db: DB, id: string) {
  const m = loadMerchant(db, id);
  const brief = db.prepare("SELECT json FROM briefs WHERE merchant_id = ?").get(id) as Row | undefined;
  const fee = feeFacts(m, TODAY);
  return {
    id: m.id,
    name: m.name,
    city: m.city,
    plan: { id: m.planId, rent: m.monthlyRent },
    today: m.days[TODAY]!.value,
    ...summaryFacts(m, TODAY),
    fee,
    hasBrief: !!brief,
    channel: brief ? parse(brief.json).channel : null,
    inbox: db.prepare("SELECT text, created_at FROM inbox WHERE merchant_id = ? ORDER BY id DESC").all(id),
    tickets: db.prepare("SELECT id, type, status, note FROM tickets WHERE merchant_id = ? AND live = 1 ORDER BY id DESC").all(id),
  };
}
