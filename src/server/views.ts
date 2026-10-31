import { PLAYBOOK, approachById } from "../../config/playbook.js";
import type { Sql } from "../data/sql.js";
import { feeFacts, summaryFacts } from "../engine/facts.js";
import { outreachBlock } from "../engine/guardrails.js";
import { REASON_LABELS, SUGGESTED_MOVES, type ReasonCode } from "../engine/reasons.js";
import { COST } from "../../config/value.js";
import { SOLVED } from "../engine/brief.js";
import { timeline } from "../engine/memory.js";
import { keptWorth, moveCost } from "../engine/value.js";
import type { PaytmCore } from "../ports.js";
import { TODAY } from "../sim/types.js";

type Row = Record<string, any>;
const parse = <T = any>(s: string) => JSON.parse(s) as T;

// What a salesperson should open with, by problem.
const VISIT_OPENERS: Partial<Record<ReasonCode, string>> = {
  rival_offer: "Ask what changed for the shop, then compare plans fairly. Don't run down the other company.",
  closing_business: "Ask how the business is doing. If they are closing, explain how to return the device.",
  settlement_delay: "Bring the settlement status and open tickets, and say what has been done so far.",
  rent_too_high: "Show what the shop collected this month and offer the plan that fits.",
  fee_confusion: "Walk through the shop's own settlement line by line.",
  device_fault: "Bring a replacement device and check it takes a test payment.",
  low_sales_season: "Ask how sales are going and show what the shop collected this month.",
};

const COST_PER_MINUTE_INR = 3; // list-price estimate: STT + TTS + LLM
const QUEUE_SIZE = 40;

async function queue(sql: Sql) {
  const rows = await sql.all(`SELECT * FROM briefs WHERE sort_key >= 0 ORDER BY sort_key DESC LIMIT ${QUEUE_SIZE}`);
  const ids = rows.map((r) => r.merchant_id);
  const outcomes = new Map(ids.length ? (await sql.all(`SELECT o.merchant_id, o.json FROM outcomes o JOIN briefs b ON b.brief_id = o.brief_id AND b.sort_key >= 0 WHERE o.merchant_id IN (${ids.map(() => "?").join(",")}) ORDER BY o.created_at`, ids)).map((o) => [o.merchant_id, parse(o.json)]) : []);
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
    .slice(0, 3)
    .map((s) => ({ ...s, quote: recent.find((e) => e.code === s.code && e.city === s.city)?.quote ?? null }));
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

const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0;

// Rupees per 100 shops contacted, from the measured gap against the no-contact group.
async function ledger(sql: Sql, panels: Awaited<ReturnType<typeof playbook>>) {
  const briefs = await sql.all<{ meta: string; json: string }>("SELECT meta, json FROM briefs WHERE sort_key >= 0");
  return panels.filter((p) => p.lift).map((p) => {
    const lift = p.lift!;
    const best = p.approaches.find((a) => a.label === lift.approach)!;
    const metas = briefs.filter((b) => (parse(b.json) as { problem: string }).problem === p.problem).map((b) => parse(b.meta)).filter((m) => m.valueYear);
    const rent = median(metas.map((m) => m.valueYear.rentYear / 12)) || 149;
    const worth = keptWorth(best.id, median(metas.map((m) => m.valueYear.total)), rent);
    const cost = moveCost(best.id) * 100;
    const net = (points: number) => Math.round(points * 100 * worth - cost);
    return { problem: p.problem, label: p.label, approach: lift.approach, shopWorthYear: Math.round(worth), extraKeptPer100: Math.round(lift.points * 100), low: net(lift.points - lift.margin), best: net(lift.points), high: net(lift.points + lift.margin), costPer100: Math.round(cost), visitsCostPer100: COST.salespersonVisit * 100, proven: lift.proven };
  });
}

async function atStake(sql: Sql) {
  const rows = await sql.all<{ meta: string }>("SELECT meta FROM briefs WHERE sort_key >= 0");
  return rows.reduce((sum, r) => sum + (parse(r.meta).valueYear?.total ?? 0), 0);
}

async function activity(sql: Sql) {
  const rows = await sql.all<{ merchant_id: string; json: string; name: string }>("SELECT o.merchant_id, o.json, m.name FROM outcomes o JOIN merchants m ON m.id = o.merchant_id ORDER BY o.created_at DESC LIMIT 5");
  return rows.map((r) => { const o = parse(r.json); return { merchantId: r.merchant_id, name: r.name, outcome: o.outcome, summary: o.summary }; });
}

async function done(sql: Sql) {
  const outcomes = (await sql.all("SELECT json FROM outcomes")).map((o) => parse(o.json));
  const minutes = outcomes.reduce((s, o) => s + o.durationSec, 0) / 60;
  const byAi = outcomes.filter((o) => o.handledBy !== "human");
  const resolved = byAi.filter((o) => SOLVED.includes(o.outcome)).length;
  const shopSaved = await sql.get("SELECT COALESCE(SUM(CASE WHEN p.from_plan = 'SB_149' THEN 149 WHEN p.from_plan = 'SB_129' THEN 129 ELSE 99 END - m.monthly_rent), 0) * 12 AS saved FROM plan_changes p JOIN merchants m ON m.id = p.merchant_id");
  const inProgress = byAi.filter((o) => o.outcome === "ticket_raised").length;
  const promises = await sql.get("SELECT SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS waiting, SUM(CASE WHEN status = 'kept' THEN 1 ELSE 0 END) AS kept, SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed FROM promises");
  const tickets = await sql.get("SELECT COUNT(*) AS c FROM tickets WHERE live = 1");
  const history = await sql.get("SELECT SUM(CASE WHEN approach_id <> 'holdout' THEN 1 ELSE 0 END) AS contacted, AVG(CASE WHEN approach_id <> 'holdout' THEN kept END) AS keep, AVG(CASE WHEN approach_id = 'holdout' THEN kept END) AS control, SUM(CASE WHEN approach_id = 'holdout' THEN 1 ELSE 0 END) AS controlN FROM contact_history WHERE kept IS NOT NULL AND true_cause <> 'live'");
  return {
    simulated: { contacted: Number(history?.contacted ?? 0), keepRate: Number(history?.keep ?? 0), controlRate: Number(history?.control ?? 0), controlN: Number(history?.controlN ?? 0) },
    conversations: byAi.length,
    humanClosed: outcomes.length - byAi.length,
    resolvedWithoutHuman: resolved,
    inProgress,
    shopSavedYearInr: Number(shopSaved?.saved ?? 0),
    promises: { waiting: Number(promises?.waiting ?? 0), kept: Number(promises?.kept ?? 0), failed: Number(promises?.failed ?? 0) },
    ticketsRaised: Number(tickets?.c ?? 0),
    plansChanged: outcomes.filter((o) => o.outcome === "plan_changed").length,
    escalations: outcomes.filter((o) => o.outcome === "handed_off").length,
    optOuts: outcomes.filter((o) => o.outcome === "opted_out").length,
    costPerConversationInr: byAi.length ? Math.round((minutes * COST_PER_MINUTE_INR * 10) / byAi.length) / 10 : null,
    costPerMinuteInr: COST_PER_MINUTE_INR,
    verified: byAi.filter((o) => o.numbersVerified).length,
  };
}

async function humanWork(sql: Sql, core: PaytmCore) {
  const handoffs = await sql.all("SELECT h.*, m.name FROM handoffs h JOIN merchants m ON m.id = h.merchant_id ORDER BY (h.reason LIKE 'URGENT%') DESC, h.id DESC LIMIT 20");
  // One shop, one card, however many reasons came in: urgent first, then newest.
  const unique = [...new Map([...handoffs].reverse().map((h) => [h.merchant_id, h])).values()].reverse();
  const live = await Promise.all(unique.map(async (h) => ({ merchant_id: h.merchant_id, reason: h.reason, summary: (await timeline(sql, h.merchant_id)).find((e) => e.when === "Conversation")?.text ?? h.reason, name: h.name, urgent: String(h.reason).startsWith("URGENT"), history: await timeline(sql, h.merchant_id), live: true })));
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
        history: await timeline(sql, c.merchant_id),
        reason: meta.why,
        summary: `${notes.length} open tickets, oldest ${notes[0] ? TODAY - notes[0].openedDay : 0} days old. Latest note: ${notes.at(-1)?.note ?? "none"}. Rishta held back outreach: a person should call, with these tickets in hand.`,
        live: false,
      };
    }),
  );
  const visitRows = await sql.all("SELECT json, meta FROM briefs WHERE channel = 'salesperson_visit' ORDER BY value DESC LIMIT 20");
  const visits = await Promise.all(visitRows.map(async (v) => {
    const brief = parse(v.json);
    const meta = parse(v.meta);
    const history = await timeline(sql, brief.merchantId);
    return { merchantId: brief.merchantId, briefId: brief.briefId, problem: brief.problem, closed: closed.has(brief.merchantId), name: meta.name, city: meta.city, why: meta.why, say: VISIT_OPENERS[brief.problem as ReasonCode] ?? approachById(brief.approachId)?.guidance ?? "", history };
  }));
  const leads = await sql.all("SELECT l.*, m.name, m.city FROM leads l JOIN merchants m ON m.id = l.merchant_id ORDER BY l.created_at DESC");
  const leadCards = await Promise.all(leads.map(async (l) => ({ merchantId: l.merchant_id, name: l.name, city: l.city, why: l.why, valueInr: l.value_inr, history: await timeline(sql, l.merchant_id) })));
  return { needsHuman: [...live, ...waiting], visits, leads: leadCards };
}

export async function consoleView(sql: Sql, core: PaytmCore) {
  const plan = await sql.get("SELECT json FROM daily_plan");
  const report = await sql.get("SELECT value FROM kv WHERE key = 'report_card'");
  const total = await sql.get("SELECT COUNT(*) AS c FROM briefs WHERE sort_key >= 0");
  const [q, whyPanel, playbookPanel, donePanel, human, leftAlone] = await Promise.all([
    queue(sql), why(sql), playbook(sql), done(sql), humanWork(sql, core),
    sql.all("SELECT * FROM left_alone ORDER BY is_demo DESC, kind DESC, merchant_id LIMIT 12"),
  ]);
  return {
    ledger: await ledger(sql, playbookPanel),
    atStake: await atStake(sql),
    activity: await activity(sql),
    assumptions: { cost: COST },
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

// Every decision of the night, light enough to list in full.
export async function decisionsView(sql: Sql) {
  const briefs = await sql.all("SELECT merchant_id, channel, meta FROM briefs WHERE sort_key >= 0 ORDER BY sort_key DESC");
  const left = await sql.all("SELECT merchant_id, name, city, kind, reasons FROM left_alone ORDER BY is_demo DESC, merchant_id");
  return {
    decided: briefs.map((b) => {
      const m = parse(b.meta);
      return { id: b.merchant_id, name: m.name, city: m.city, reason: m.reasonLabel, why: m.why, approach: m.approachLabel, channel: b.channel, risk: m.risk };
    }),
    left: left.map((l) => ({ id: l.merchant_id, name: l.name, city: l.city, kind: l.kind, reasons: parse(l.reasons) })),
  };
}

async function latestConversation(sql: Sql, id: string) {
  const row = await sql.get<{ state: string; finished: number }>("SELECT state, finished FROM conversations WHERE merchant_id = ? ORDER BY started_at DESC LIMIT 1", [id]);
  if (!row) return null;
  const s = parse(row.state);
  return { transcript: s.transcript as { role: string; text: string }[], actions: s.actions as string[], numbersChecked: (s.numbersChecked ?? 0) as number, guardEvents: s.guardEvents as string[], ended: !!row.finished || !!s.ended };
}

// One shop, whatever Rishta decided about it. Null means no such shop.
export async function shopView(sql: Sql, core: PaytmCore, id: string) {
  const merchant = await sql.get<{ name: string; city: string }>("SELECT name, city FROM merchants WHERE id = ?", [id]);
  if (!merchant) return null;
  const row = await sql.get("SELECT json, meta FROM briefs WHERE merchant_id = ? AND sort_key >= 0", [id]);
  const left = await sql.get("SELECT kind, reasons FROM left_alone WHERE merchant_id = ?", [id]);
  const out = await sql.get("SELECT json FROM outcomes WHERE merchant_id = ? ORDER BY created_at DESC LIMIT 1", [id]);
  const m = await core.merchant(id);
  return {
    id, ...merchant,
    brief: row ? parse(row.json) : null,
    meta: row ? parse(row.meta) : null,
    left: left ? { kind: left.kind, reasons: parse(left.reasons) } : null,
    outcome: out ? parse(out.json) : null,
    blocked: outreachBlock(m, new Date(), false),
    live: await latestConversation(sql, id),
    history: await timeline(sql, id),
    openPromises: await sql.all("SELECT text, due_day FROM promises WHERE merchant_id = ? AND status = 'open'", [id]),
  };
}

export async function merchantView(sql: Sql, core: PaytmCore, id: string) {
  const m = await core.merchant(id);
  const brief = await sql.get("SELECT json FROM briefs WHERE merchant_id = ? AND sort_key >= 0", [id]);
  return {
    id: m.id,
    name: m.name,
    city: m.city,
    plan: { id: m.planId, rent: m.monthlyRent },
    // The latest settlement already holds today's batch, so the live counter starts from the last full day.
    today: m.days[TODAY - 1]!.value,
    ...summaryFacts(m, TODAY),
    fee: feeFacts(m, TODAY),
    hasBrief: !!brief,
    channel: brief ? parse(brief.json).channel : null,
    conversation: await latestConversation(sql, id),
    inbox: await sql.all("SELECT text, created_at FROM inbox WHERE merchant_id = ? ORDER BY id DESC", [id]),
    tickets: await sql.all("SELECT t.id, t.type, t.status, t.note, p.status AS promise FROM tickets t LEFT JOIN promises p ON p.ticket_id = t.id WHERE t.merchant_id = ? AND t.live = 1 ORDER BY t.id DESC", [id]),
    savedYearInr: Number((await sql.get("SELECT COALESCE(SUM(CASE WHEN p.from_plan = 'SB_149' THEN 149 WHEN p.from_plan = 'SB_129' THEN 129 ELSE 99 END - m.monthly_rent), 0) * 12 AS saved FROM plan_changes p JOIN merchants m ON m.id = p.merchant_id WHERE p.merchant_id = ?", [id]))?.saved ?? 0),
  };
}
