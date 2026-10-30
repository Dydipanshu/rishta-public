import { readFileSync } from "node:fs";
import { z } from "zod";
import { approachById } from "../../config/playbook.js";
import { Outcome, type ActionName, type Brief, type OutcomeKind } from "../engine/brief.js";
import { REASON_CODES, ReasonCode } from "../engine/reasons.js";
import { audit, type DB } from "../server/db.js";
import { TODAY, OUTREACH_START_DAY } from "../sim/types.js";
import { checkSentence, collectNumbers, takeChunks } from "./guard.js";
import type { LLMAdapter, LLMItem } from "./llmAdapter.js";
import { runTool, toolsFor, type ToolContext } from "./tools.js";

const TEMPLATE = readFileSync(new URL("./prompts/system.md", import.meta.url), "utf8");
const READ_TOOLS = new Set(["getMerchantSummary", "explainFee", "checkDeviceHealth", "proposePlan"]);
const FALLBACK = "जी, मैं check करके बताती हूँ।";
const CLOSING_LINES: Record<string, string> = {
  scheduleHumanCallback: "जी, Paytm से एक व्यक्ति आपको call करेगा। धन्यवाद।",
  recordOptOut: "जी, अब हम आपसे संपर्क नहीं करेंगे। धन्यवाद।",
  recordOutcome: "धन्यवाद जी।",
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

export class Conversation {
  readonly id: string;
  readonly transcript: Turn[] = [];
  readonly actions: ActionName[] = [];
  readonly guardEvents: string[] = [];
  numbersVerified = true;
  ended = false;
  outcome: OutcomeKind | null = null;
  private summary = "";
  private input: LLMItem[] = [];
  private allowed = new Set<string>();
  private instructions: string;
  private started = Date.now();
  private ctx: ToolContext;

  constructor(private db: DB, readonly brief: Brief, private llm: LLMAdapter, why: string) {
    this.id = `C-${brief.merchantId}-${this.started}`;
    collectNumbers(brief.facts, this.allowed);
    this.instructions = buildInstructions(brief, why);
    this.ctx = {
      db,
      brief,
      lastUserText: () => this.transcript.filter((t) => t.role === "merchant").at(-1)?.text ?? "",
      transcriptText: () => this.transcript.map((t) => `${t.role}: ${t.text}`).join("\n"),
      onOutcome: (outcome, summary) => {
        this.outcome = outcome;
        this.summary = summary;
        this.ended = true;
      },
    };
    db.prepare("INSERT INTO conversations (id, brief_id, merchant_id, started_at) VALUES (?, ?, ?, ?)").run(this.id, brief.briefId, brief.merchantId, new Date().toISOString());
  }

  opening() {
    const text = openingLine(String(this.brief.facts.firstName));
    this.transcript.push({ role: "agent", text });
    this.input.push({ role: "assistant", content: text });
    return text;
  }

  // Yields guarded chunks of speech for one merchant turn.
  async *reply(userText: string): AsyncGenerator<string> {
    this.transcript.push({ role: "merchant", text: userText });
    this.input.push({ role: "user", content: userText });

    let retried = false;
    for (let round = 0; round < 4; round++) {
      let buffer = "";
      let spoke = false;
      let failed = false;
      let done: { items: LLMItem[]; calls: { callId: string; name: string; args: string }[] } | null = null;

      for await (const event of this.llm.turn({ instructions: this.instructions, input: this.input, tools: toolsFor(this.brief) })) {
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
            audit(this.db, this.brief.merchantId, "guard_block", { chunk, reason: check.reason });
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
            audit(this.db, this.brief.merchantId, "guard_block", { chunk, reason: check.reason });
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
          this.input.push({ role: "user", content: `[System note, not from the merchant: your last reply used something not allowed (${this.guardEvents.at(-1)}). Reply again using only figures from the facts, written as digits.]` });
          continue;
        }
        yield* this.fallback();
        return;
      }
      if (!done) return;

      this.input.push(...done.items);
      for (const call of done.calls) {
        const result = runTool(this.ctx, call.name, call.args);
        this.actions.push(call.name as ActionName);
        collectNumbers(result, this.allowed);
        this.input.push({ type: "function_call_output", call_id: call.callId, output: JSON.stringify(result) });
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

  private *fallback() {
    this.numbersVerified = false;
    const type = this.brief.problem === "device_fault" ? "device" : this.brief.problem === "rent_too_high" ? "rent" : "settlement";
    const result = runTool(this.ctx, "raiseTicket", JSON.stringify({ type, note: "Agent could not verify a figure; needs a check." }));
    this.actions.push("raiseTicket");
    collectNumbers(result, this.allowed);
    this.say(FALLBACK);
    yield FALLBACK;
  }

  // Post-call step: reasons, outcome, and the learning loop.
  async finish(): Promise<Outcome> {
    this.ended = true;
    const merchantLines = this.transcript.filter((t) => t.role === "merchant").map((t) => t.text);
    const text = this.transcript.map((t) => `${t.role === "merchant" ? "MERCHANT" : "AGENT"}: ${t.text}`).join("\n");

    let extraction: z.infer<typeof Extraction> = { reasons: [], teamSummary: this.summary, merchantMessage: "" };
    if (merchantLines.length > 0) {
      extraction = await this.llm.extract({ instructions: EXTRACT_INSTRUCTIONS, text, schema: Extraction, name: "conversation_reasons" });
    }
    const reasons = extraction.reasons
      .filter((r) => r.code !== "unknown" && merchantLines.some((l) => l.includes(r.quote.trim())) && r.quote.trim())
      .map((r) => ({ code: ReasonCode.parse(r.code), quote: r.quote.trim() }));

    const kind: OutcomeKind =
      this.outcome ?? (merchantLines.length === 0 ? "no_response" : this.actions.includes("raiseTicket") ? "ticket_raised" : "stayed");

    const outcome = Outcome.parse({
      briefId: this.brief.briefId,
      outcome: kind,
      reasons,
      actionsTaken: this.actions,
      durationSec: Math.round((Date.now() - this.started) / 1000),
      numbersVerified: this.numbersVerified,
      summary: extraction.teamSummary || this.summary,
    });

    const m = this.db.prepare("SELECT city, category, city_tier, category_group FROM merchants WHERE id = ?").get(this.brief.merchantId) as { city: string; category: string; city_tier: number; category_group: string };
    const week = Math.floor((TODAY - OUTREACH_START_DAY) / 7) + 1;
    const save = this.db.transaction(() => {
      this.db.prepare("UPDATE conversations SET ended_at = ?, transcript = ?, numbers_verified = ? WHERE id = ?").run(new Date().toISOString(), JSON.stringify(this.transcript), +this.numbersVerified, this.id);
      this.db.prepare("INSERT INTO outcomes VALUES (?, ?, ?, ?)").run(this.brief.briefId, this.brief.merchantId, JSON.stringify(outcome), new Date().toISOString());
      for (const r of reasons) {
        this.db.prepare("INSERT INTO reason_events (merchant_id, day, week, code, quote, city, category, live) VALUES (?, ?, ?, ?, ?, ?, ?, 1)").run(this.brief.merchantId, TODAY, week, r.code, r.quote, m.city, m.category);
      }
      // Kept stays empty for 30 days; the weekly update will count it then.
      this.db.prepare("INSERT INTO contact_history VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)").run(this.brief.merchantId, TODAY, week, this.brief.problem, this.brief.approachId, "live", `T${m.city_tier}-${m.category_group}`, m.city, m.category);
      const message = extraction.merchantMessage && checkSentence(extraction.merchantMessage, this.allowed).ok ? extraction.merchantMessage : "आपकी बात दर्ज हो गई है। धन्यवाद।";
      this.db.prepare("INSERT INTO inbox (merchant_id, text, created_at) VALUES (?, ?, ?)").run(this.brief.merchantId, message, new Date().toISOString());
      audit(this.db, this.brief.merchantId, "outcome", outcome);
    });
    save();
    return outcome;
  }
}
