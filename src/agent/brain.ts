import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { approachById } from "../../config/playbook.js";
import { audit, type Sql } from "../data/sql.js";
import { Brief, Outcome, type ActionName, type OutcomeKind } from "../engine/brief.js";
import { recordOutcome } from "../engine/outcomes.js";
import { REASON_CODES, ReasonCode } from "../engine/reasons.js";
import type { PaytmCore } from "../ports.js";
import { checkSentence, collectNumbers, takeChunks } from "./guard.js";
import type { LLMAdapter, LLMItem } from "./llmAdapter.js";
import { runTool, toolsFor, type ToolContext } from "./tools.js";

const TEMPLATE = readFileSync(new URL("./prompts/system.md", import.meta.url), "utf8");
const READ_TOOLS = new Set(["getMerchantSummary", "explainFee", "checkDeviceHealth", "proposePlan"]);
const FALLBACK = "जी, मैं check करके बताती हूँ।";
const NO_SPLITTING = "जी, fee बचाने के तरीकों पर मैं सलाह नहीं दे सकती। कोई और सवाल हो तो बताइए।";
const FAILOVER = "माफ़ कीजिए, अभी दिक्कत आ रही है। Paytm से एक व्यक्ति आपको call करेगा।";
const CLOSING_LINES: Record<string, string> = {
  scheduleHumanCallback: "जी, Paytm से एक व्यक्ति आपको call करेगा। धन्यवाद।",
  recordOptOut: "जी, अब हम आपसे संपर्क नहीं करेंगे। धन्यवाद।",
  recordOutcome: "बहुत अच्छा जी, धन्यवाद। आपका दिन शुभ हो।",
};

export const openingLine = (firstName: string) => `नमस्ते ${firstName} जी, मैं Paytm की AI assistant हूँ। Paytm कभी OTP या PIN नहीं माँगता।`;

function buildInstructions(brief: Brief, why: string) {
  const { firstName, ...facts } = brief.facts;
  const fill: Record<string, string> = {
    goal: brief.goal,
    displayName: brief.displayName,
    firstName: String(firstName),
    why,
    guidance: approachById(brief.approachId)?.guidance ?? "",
    successCriteria: brief.successCriteria,
    facts: Object.entries(facts).map(([k, v]) => `- ${k}: ${v}`).join("\n"),
  };
  return TEMPLATE.replace(/\{\{(\w+)\}\}/g, (_, k: string) => fill[k] ?? "");
}

const Extraction = z.object({
  reasons: z.array(z.object({ code: z.enum(REASON_CODES), quote: z.string() })),
  teamSummary: z.string(),
  merchantMessage: z.string(),
});

const EXTRACT_INSTRUCTIONS = `You read a conversation between a Paytm AI assistant and a shopkeeper and fill in a form.
reasons: why the shop might leave or is unhappy, from this fixed list only: ${REASON_CODES.join(", ")}.
Each reason needs "quote": the merchant's exact words, copied character for character from a MERCHANT line.
Use "unknown" if the merchant gave no reason. Only include what the merchant said. Never infer.
teamSummary: two plain English sentences for the merchant team: what happened and what was done.
merchantMessage: one short Hindi sentence in Devanagari for the merchant's inbox saying what was done. No numbers.`;

export interface Turn {
  role: "merchant" | "agent";
  text: string;
}

export interface AgentDeps {
  sql: Sql;
  core: PaytmCore;
  llm: LLMAdapter;
}

// Everything a conversation needs to resume on any server.
interface ConversationState {
  id: string;
  transcript: Turn[];
  actions: ActionName[];
  guardEvents: string[];
  numbersVerified: boolean;
  ended: boolean;
  outcome: OutcomeKind | null;
  summary: string;
  input: LLMItem[];
  allowed: string[];
  started: number;
}

export class Conversation {
  private allowed: Set<string>;
  private instructions: string;
  private ctx: ToolContext;
  private version = 0;

  private constructor(private deps: AgentDeps, readonly brief: Brief, private why: string, private state: ConversationState) {
    this.allowed = new Set(state.allowed);
    this.instructions = buildInstructions(brief, why);
    this.ctx = {
      sql: deps.sql,
      core: deps.core,
      brief,
      lastUserText: () => this.transcript.filter((t) => t.role === "merchant").at(-1)?.text ?? "",
      transcriptText: () => this.transcript.map((t) => `${t.role}: ${t.text}`).join("\n"),
      onOutcome: (outcome, summary) => {
        this.state.outcome = outcome;
        this.state.summary = summary;
        this.state.ended = true;
      },
    };
  }

  static async start(deps: AgentDeps, brief: Brief, why: string) {
    const started = Date.now();
    const allowed = new Set<string>();
    collectNumbers(brief.facts, allowed);
    const conv = new Conversation(deps, brief, why, {
      id: `C-${brief.merchantId}-${randomUUID()}`, transcript: [], actions: [], guardEvents: [], numbersVerified: true, ended: false,
      outcome: null, summary: "", input: [], allowed: [...allowed], started,
    });
    const at = new Date(started).toISOString();
    await deps.sql.run("INSERT INTO conversations (id, brief_id, merchant_id, started_at, updated_at, state) VALUES (?, ?, ?, ?, ?, ?)", [conv.id, brief.briefId, brief.merchantId, at, at, conv.snapshot()]);
    return conv;
  }

  // Picks up the merchant's open conversation, whichever server started it.
  static async resume(deps: AgentDeps, merchantId: string) {
    const row = await deps.sql.get<{ state: string; version: number; brief_id: string }>("SELECT state, version, brief_id FROM conversations WHERE merchant_id = ? AND finished = 0 ORDER BY started_at DESC LIMIT 1", [merchantId]);
    return row ? Conversation.fromRow(deps, row) : null;
  }

  // Conversations the merchant walked away from.
  static async stale(deps: AgentDeps, idleMs: number, limit = 50) {
    const cutoff = new Date(Date.now() - idleMs).toISOString();
    const rows = await deps.sql.all<{ state: string; version: number; brief_id: string }>("SELECT state, version, brief_id FROM conversations WHERE finished = 0 AND updated_at < ? LIMIT ?", [cutoff, limit]);
    return Promise.all(rows.map((r) => Conversation.fromRow(deps, r)));
  }

  private static async fromRow(deps: AgentDeps, row: { state: string; version: number; brief_id: string }) {
    const b = await deps.sql.get<{ json: string; meta: string }>("SELECT json, meta FROM briefs WHERE brief_id = ?", [row.brief_id]);
    if (!b) throw new Error(`Brief ${row.brief_id} is gone`);
    const conv = new Conversation(deps, Brief.parse(JSON.parse(b.json)), JSON.parse(b.meta).why as string, JSON.parse(row.state) as ConversationState);
    conv.version = row.version;
    return conv;
  }

  get id() { return this.state.id; }
  get transcript() { return this.state.transcript; }
  get actions() { return this.state.actions; }
  get guardEvents() { return this.state.guardEvents; }
  get ended() { return this.state.ended; }
  get numbersVerified() { return this.state.numbersVerified; }

  private snapshot() {
    return JSON.stringify({ ...this.state, allowed: [...this.allowed] });
  }

  // Saved after every turn. A false return means another server moved on first.
  async save() {
    const changed = await this.deps.sql.run("UPDATE conversations SET state = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ? AND finished = 0", [this.snapshot(), new Date().toISOString(), this.id, this.version]);
    if (changed === 1) this.version++;
    return changed === 1;
  }

  opening() {
    const text = openingLine(String(this.brief.facts.firstName));
    this.transcript.push({ role: "agent", text });
    this.state.input.push({ role: "assistant", content: text });
    return text;
  }

  // Yields guarded chunks of speech for one merchant turn.
  async *reply(userText: string): AsyncGenerator<string> {
    this.transcript.push({ role: "merchant", text: userText });
    this.state.input.push({ role: "user", content: userText });

    let retried = false;
    for (let round = 0; round < 4; round++) {
      let buffer = "";
      let spoke = false;
      let failed = false;
      let done: { items: LLMItem[]; calls: { callId: string; name: string; args: string }[] } | null = null;

      for await (const event of this.deps.llm.turn({ instructions: this.instructions, input: this.state.input, tools: toolsFor(this.brief) })) {
        if (event.type === "done") {
          done = event;
          break;
        }
        buffer += event.delta;
        const { chunks, rest } = takeChunks(buffer);
        buffer = rest;
        for (const chunk of chunks) {
          const check = checkSentence(chunk, this.allowed);
          if (!check.ok) {
            this.guardEvents.push(check.reason);
            await audit(this.deps.sql, this.brief.merchantId, "guard_block", { chunk, reason: check.reason });
            failed = true;
            break;
          }
          spoke = true;
          this.say(chunk);
          yield chunk;
        }
        if (failed) break;
      }

      if (!failed && buffer.trim()) {
        for (const chunk of takeChunks(buffer, true).chunks) {
          const check = checkSentence(chunk, this.allowed);
          if (!check.ok) {
            this.guardEvents.push(check.reason);
            await audit(this.deps.sql, this.brief.merchantId, "guard_block", { chunk, reason: check.reason });
            failed = true;
            break;
          }
          spoke = true;
          this.say(chunk);
          yield chunk;
        }
      }

      if (failed) {
        if (!retried) {
          retried = true;
          this.state.input.push({ role: "user", content: `[System note, not from the merchant: your last reply used something not allowed (${this.guardEvents.at(-1)}). Reply again using only figures from the facts, written as digits.]` });
          continue;
        }
        // The guard also stops refusals that name splitting, so refuse with a fixed line. Nothing needs checking.
        if (String(this.guardEvents.at(-1)).includes("splitting")) {
          this.say(NO_SPLITTING);
          yield NO_SPLITTING;
          return;
        }
        yield* this.fallback();
        return;
      }
      if (!done) return;

      this.state.input.push(...done.items);
      for (const call of done.calls) {
        const result = await runTool(this.ctx, call.name, call.args);
        this.actions.push(call.name as ActionName);
        collectNumbers(result, this.allowed);
        this.state.input.push({ type: "function_call_output", call_id: call.callId, output: JSON.stringify(result) });
      }
      // Closing lines are fixed, so no second model call is needed.
      const closing = done.calls.map((c) => CLOSING_LINES[c.name]).find(Boolean);
      if (!spoke && closing) {
        this.say(closing);
        yield closing;
        return;
      }
      const needsAnswer = done.calls.some((c) => READ_TOOLS.has(c.name));
      if (done.calls.length === 0 || (spoke && !needsAnswer)) return;
    }
  }

  private say(text: string) {
    this.transcript.push({ role: "agent", text });
  }

  private async *fallback() {
    this.state.numbersVerified = false;
    const type = this.brief.problem === "device_fault" ? "device" : this.brief.problem === "rent_too_high" ? "rent" : "settlement";
    const result = await runTool(this.ctx, "raiseTicket", JSON.stringify({ type, note: "Agent could not verify a figure; needs a check." }));
    this.actions.push("raiseTicket");
    collectNumbers(result, this.allowed);
    this.say(FALLBACK);
    yield FALLBACK;
  }

  // If the model or a Paytm service fails mid-call, a person takes over.
  async failover(reason: string) {
    await this.deps.core.scheduleCallback(this.brief.merchantId, reason, this.ctx.transcriptText());
    this.ctx.onOutcome("handed_off", reason);
    this.say(FAILOVER);
    return FAILOVER;
  }

  // Post-call step: reasons, outcome, and the learning loop. Runs once per conversation.
  async finish(): Promise<Outcome | null> {
    this.state.ended = true;
    const merchantLines = this.transcript.filter((t) => t.role === "merchant").map((t) => t.text);
    const text = this.transcript.map((t) => `${t.role === "merchant" ? "MERCHANT" : "AGENT"}: ${t.text}`).join("\n");

    let extraction: z.infer<typeof Extraction> = { reasons: [], teamSummary: this.state.summary, merchantMessage: "" };
    if (merchantLines.length > 0) {
      try {
        extraction = await this.deps.llm.extract({ instructions: EXTRACT_INSTRUCTIONS, text, schema: Extraction, name: "conversation_reasons" });
      } catch (err) {
        await audit(this.deps.sql, this.brief.merchantId, "extract_failed", { message: (err as Error).message });
      }
    }
    const reasons = extraction.reasons
      .filter((r) => r.code !== "unknown" && merchantLines.some((l) => l.includes(r.quote.trim())) && r.quote.trim())
      .map((r) => ({ code: ReasonCode.parse(r.code), quote: r.quote.trim() }));

    const kind: OutcomeKind =
      this.state.outcome ?? (merchantLines.length === 0 ? "no_response" : this.actions.includes("raiseTicket") ? "ticket_raised" : "stayed");

    const outcome = Outcome.parse({
      briefId: this.brief.briefId,
      outcome: kind,
      reasons,
      actionsTaken: this.actions,
      durationSec: Math.round((Date.now() - this.state.started) / 1000),
      numbersVerified: this.numbersVerified,
      summary: extraction.teamSummary || this.state.summary,
    });

    const m = await this.deps.core.merchant(this.brief.merchantId);
    const message = extraction.merchantMessage && checkSentence(extraction.merchantMessage, this.allowed).ok ? extraction.merchantMessage : "आपकी बात दर्ज हो गई है। धन्यवाद।";
    const first = await this.deps.sql.tx(async (tx) => {
      const claimed = await tx.run("UPDATE conversations SET finished = 1, ended_at = ?, transcript = ?, numbers_verified = ?, state = ? WHERE id = ? AND finished = 0", [new Date().toISOString(), JSON.stringify(this.transcript), +this.numbersVerified, this.snapshot(), this.id]);
      if (claimed === 0) return false;
      return recordOutcome(tx, this.id, this.brief, outcome, m);
    });
    if (!first) return null;
    await this.deps.core.notify(this.brief.merchantId, message);
    return outcome;
  }
}
