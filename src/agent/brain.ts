import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { approachById } from "../../config/playbook.js";
import { audit, type Sql } from "../data/sql.js";
import { Brief, Outcome, type ActionName, type OutcomeKind } from "../engine/brief.js";
import { recordOutcome } from "../engine/outcomes.js";
import { REASON_CODES, ReasonCode } from "../engine/reasons.js";
import type { PaytmCore } from "../ports.js";
import { isEnglish } from "../voice/languages.js";
import { hideLongNumbers, LINES, routeTurn, type Route } from "./router.js";
import { NO, YES } from "./tools.js";
import { addNote, memoryForAgent, openPromises, timeline } from "../engine/memory.js";
import { SOLVED } from "../engine/brief.js";
import { shopValue } from "../engine/value.js";
import { TODAY } from "../sim/types.js";
import { checkSentence, collectNumbers, numbersIn, takeChunks, type GuardResult } from "./guard.js";
import type { LLMAdapter, LLMItem } from "./llmAdapter.js";
import { runTool, toolsFor, type ToolContext } from "./tools.js";

const TEMPLATE = readFileSync(new URL("./prompts/system.md", import.meta.url), "utf8");
const READ_TOOLS = new Set(["getMerchantSummary", "getShopProfile", "explainFee", "checkDeviceHealth", "proposePlan", "proposeLoan", "checkLoan"]);
const GOODBYE = /(धन्यवाद|दिन शुभ|thank you|good day|nice day|great day)[^?]*[।.!]?\s*$/i;
const CONFIRMED = new Set(["raiseTicket", "changePlan", "requestDeviceReturn", "setReducedEmi", "acceptLoan"]);
const CARE = /(bimar|hospital|अस्पताल|बीमार|ऑपरेशन|operation|गुज़र|गुजर|निधन|शादी|death|passed away|ill\b|sick)/i;
const STAYING = /\b(samajh gaya|samajh gayi|samajh aa gaya|theek hai|thik hai|achha|accha|dhanyavaad|shukriya|thanks|thank you|ok|okay|understood|got it)\b|समझ|ठीक है|धन्यवाद|शुक्रिया|रखूँगा|रखूंगा|रखूँगी|रखूंगी|रख लेता|रखता हूँ|रखेंगे|नहीं लौटा|वापस नहीं|समझ गया|समझ गई|समझ आ गया|समझ आ गई|ठीक है|ठीक हो गया|सब ठीक|और कुछ नहीं|कुछ नहीं|धन्यवाद|शुक्रिया|thanks?\b|thank you|i'?ll keep|will keep|understood|got it|okay|\bok\b/i;
const LOAN_ASK = ["एक बात और, आपकी दुकान का record अच्छा है। अगर चाहें तो Paytm से एक व्यक्ति business loan के बारे में बता सकता है। बात कराऊँ?", "One more thing: your shop's record is good. If you'd like, a person from Paytm can tell you about a business loan. Shall I arrange that?"] as const;
const LOAN_YES = ["जी, वे आपको call करेंगे। धन्यवाद, आपका दिन शुभ हो।", "They will call you. Thank you, have a good day."] as const;
const LOAN_NO = ["जी, कोई बात नहीं। धन्यवाद, आपका दिन शुभ हो।", "No problem. Thank you, have a good day."] as const;
const FALLBACK = "जी, यह पक्का आँकड़ा अभी मेरे पास नहीं है। और कुछ बताऊँ?";
const NO_SPLITTING = "जी, fee बचाने के तरीकों पर मैं सलाह नहीं दे सकती। कोई और सवाल हो तो बताइए।";
// Nobody ends a sentence with a lone "जी" or "ji". The model does when told to be respectful, so code removes it.
export const tidy = (chunk: string) => chunk.replace(/^\s*(जी|ji)\s*;\s*(?=\S)/i, "").replace(/\s*,\s*(जी|ji)\s*([।.?!])\s*$/i, "$2").replace(/^\s*(जी|ji)\s*[;,।.]?\s*$/i, "").trim();
const NO_PROMISE = "जी, इसकी पक्की तारीख या वादा मैं नहीं दे सकती। Team आपसे खुद संपर्क करेगी।";
const CANNOT_HELP = "जी, इसमें मैं मदद नहीं कर सकती। Paytm से जुड़ा कोई और सवाल हो तो बताइए।";
const FAILOVER = "माफ़ कीजिए, अभी दिक्कत आ रही है। Paytm से एक व्यक्ति आपको call करेगा।";
const SECRET_HI = "जी, OTP या PIN किसी को मत बताइए, मुझे भी नहीं। Paytm कभी नहीं माँगता। आपका कोई और सवाल हो तो बताइए।";
const SECRET_EN = "Please never share your OTP or PIN with anyone, including me. Paytm never asks for it. Is there anything else I can help with?";
const SECRET_WORD = /\b(otp|pin|cvv|password)\b|ओटीपी|ओ टी पी|पिन|पासवर्ड/i;
const CLOSING_LINES: Record<string, [string, string]> = {
  scheduleHumanCallback: ["जी, Paytm से एक व्यक्ति आपको call करेगा। धन्यवाद।", "A person from Paytm will call you. Thank you."],
  recordOptOut: ["जी, अब हम आपसे संपर्क नहीं करेंगे। धन्यवाद।", "We won't contact you again. Thank you."],
  recordOutcome: ["जी, धन्यवाद। आपका दिन शुभ हो।", "Thank you. Have a good day."],
};

// Said by code, not the model, so a fix is always confirmed with the real ticket or plan.
function confirmation(call: string, result: Record<string, unknown>, english: boolean, device: boolean) {
  if (call === "raiseTicket") {
    const next = device ? ["Device team replacement के लिए आपसे संपर्क करेगी।", "The device team will contact you about a replacement."] : ["Support team इसे देखेगी।", "The support team will review it."];
    if (result.existing) return english ? `Your ticket ${result.ticketId} is already open, so I added this to it. ${next[1]} Anything else?` : `जी, आपका ticket ${result.ticketId} पहले से चल रहा है, मैंने यह बात उसमें जोड़ दी। ${next[0]} और कुछ बताऊँ?`;
    return english ? `Your ticket ${result.ticketId} is raised. ${next[1]} Anything else?` : `जी, आपका ticket ${result.ticketId} बन गया है। ${next[0]} और कुछ बताऊँ?`;
  }
  if (call === "requestDeviceReturn") {
    return english ? `Your return request ${result.ticketId} is booked. The pickup team will contact you. You can come back any time. Anything else?` : `जी, आपकी वापसी का request ${result.ticketId} बन गया है। Pickup team आपसे संपर्क करेगी। आप कभी भी वापस आ सकते हैं। और कुछ बताऊँ?`;
  }
  if (call === "setReducedEmi") return english ? `Done. Your EMI is ₹${Number(result.reducedEmiInr).toLocaleString("en-IN")} for ${result.reliefMonths} months. The details are in your app. Anything else?` : `जी, हो गया। ${result.reliefMonths} महीने के लिए आपकी EMI ₹${Number(result.reducedEmiInr).toLocaleString("en-IN")} है। पूरी जानकारी आपके app में है। और कुछ बताऊँ?`;
  if (call === "acceptLoan") return english ? `Sent to your Paytm app for approval: ₹${Number(result.dailyInr)} a day. The lender makes the final decision. Please never share an OTP. Anything else?` : `जी, यह आपके Paytm app में approval के लिए भेज दिया: रोज़ ₹${Number(result.dailyInr)}। अंतिम फ़ैसला lender करेगा। OTP किसी को मत बताइएगा। और कुछ बताऊँ?`;
  if (call === "changePlan") {
    return english ? `Your plan is now ${result.newPlan}. Your rent will be ₹${result.newRentInr} a month. Anything else?` : `जी, आपका plan ${result.newPlan} हो गया है। अब rent ₹${result.newRentInr} महीना लगेगा। और कुछ बताऊँ?`;
  }
  return null;
}

const greet = (name: string, tail: string) => (/^(ji|जी)?$/i.test(name.trim()) ? "" : `${name} ${tail}`);

// Only when Rishta reached out does it say who is speaking, once. When the shop speaks first the agent just answers.
export const openingLine = (firstName: string, english = false) =>
  english ? `Namaste ${greet(firstName, "ji, ")}this is Paytm's AI assistant.` : `नमस्ते ${greet(firstName, "जी, ")}Paytm की AI assistant बोल रही हूँ।`;
export const helloLine = (firstName: string) => `नमस्ते ${greet(firstName, "जी, ")}बताइए, क्या मदद करूँ?`;

function buildInstructions(brief: Brief, why: string, memory: string) {
  const { firstName, ...facts } = brief.facts;
  const fill: Record<string, string> = {
    goal: brief.goal,
    displayName: brief.displayName,
    firstName: String(firstName),
    why,
    guidance: approachById(brief.approachId)?.guidance ?? "Listen first and answer what they ask. Use only what the facts show.",
    memory,
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
When a merchant line shows why they are unhappy or thinking of leaving, quote that line rather than a plain question.
teamSummary: two plain English sentences for the merchant team: what happened and what was done. The WHAT THE SYSTEM DID section is the truth about actions; never contradict it.
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
  numbersChecked?: number;
  language?: string;
  ended: boolean;
  outcome: OutcomeKind | null;
  summary: string;
  quiet?: boolean;
  loan?: "asked" | "yes" | "no";
  memory?: string;
  promise?: string;
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
    this.instructions = buildInstructions(brief, why, state.memory ?? "- Nothing yet.");
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
      memory: memoryForAgent(await timeline(deps.sql, brief.merchantId)),
      promise: brief.approachId === "follow_up_fix" ? ({ device: "machine", settlement: "settlement", rent: "plan", fee: "fee" } as Record<string, string>)[(await openPromises(deps.sql, brief.merchantId))[0]?.kind ?? ""] ?? "पिछली" : undefined,
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
  get language() { return this.state.language ?? "hi-IN"; }
  set language(value: string) { this.state.language = value; }
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

  // A check-back says what it remembers, because that is the point of it.
  opening(english = false) {
    if (this.brief.channel === "inbound" || this.brief.channel === "human_callback") return "";
    const name = String(this.brief.facts.firstName);
    const waiting = this.state.promise;
    const text = waiting
      ? (english ? `Namaste ${greet(name, "ji, ")}has your ${waiting} problem been sorted?` : `नमस्ते ${greet(name, "जी, ")}आपकी ${waiting} वाली दिक्कत ठीक हुई?`)
      : openingLine(name, english);
    this.transcript.push({ role: "agent", text });
    this.state.input.push({ role: "assistant", content: text });
    return text;
  }

  // A shop that only said hello hasn't asked anything yet, so nothing goes to the model.
  askHowToHelp(said = "") {
    const text = said ? helloLine(String(this.brief.facts.firstName)) : "जी, बताइए, क्या मदद करूँ?";
    if (said) {
      this.transcript.push({ role: "merchant", text: said });
      this.state.input.push({ role: "user", content: said });
    }
    this.transcript.push({ role: "agent", text });
    this.state.input.push({ role: "assistant", content: text });
    return text;
  }

  // Why the model may not end the conversation yet, if so.
  private closeBlocked(call: { name: string; args: string }, said: string[], batch: { name: string }[]) {
    if (call.name === "raiseTicket" && this.actions.includes("raiseTicket")) return "A ticket is already raised in this conversation. Do not raise or mention it again. Just answer what they asked.";
    if (call.name !== "recordOutcome") return null;
    if (said.at(-1)?.trim().endsWith("?")) return "You just asked the merchant a question. Wait for the answer. Do not end yet.";
    const kind = (JSON.parse(call.args || "{}") as { outcome?: string }).outcome;
    const firstTurn = this.transcript.filter((t) => t.role === "merchant").length === 1;
    if (firstTurn && said.length === 0 && kind !== "no_response" && !batch.some((c) => CONFIRMED.has(c.name))) return "Answer the merchant first, then end.";
    return null;
  }

  // Runs one sentence through the guard. A pass is spoken and kept.
  private async pass(chunk: string, said: string[]): Promise<GuardResult> {
    const check = this.state.quiet && numbersIn(chunk).length ? { ok: false as const, kind: "number" as const, reason: "no amounts aloud; the shop asked for privacy" } : checkSentence(chunk, this.allowed, this.brief.facts);
    if (check.ok) {
      said.push(chunk);
      this.say(chunk);
    } else {
      this.guardEvents.push(check.reason);
      await audit(this.deps.sql, this.brief.merchantId, "guard_block", { chunk, reason: check.reason });
    }
    return check;
  }

  // Yields guarded chunks of speech for one merchant turn.
  // A shopkeeper is never met with silence, even if the model returns nothing.
  async *reply(spoken: string): AsyncGenerator<string> {
    let spoke = false;
    for await (const chunk of this.turn(spoken)) {
      spoke = true;
      yield chunk;
    }
    if (!spoke) yield this.fixed(LINES.again, isEnglish(spoken));
  }

  private async *turn(spoken: string): AsyncGenerator<string> {
    const userText = hideLongNumbers(spoken);
    this.transcript.push({ role: "merchant", text: userText });
    this.state.input.push({ role: "user", content: userText });
    const english = isEnglish(userText);

    // A person already holds this case, so the AI only passes the message on.
    if (this.brief.channel === "human_callback") {
      yield this.fixed(LINES.hold, english);
      await this.deps.core.scheduleCallback(this.brief.merchantId, "Shop pressed the button while waiting for a person", userText);
      this.ctx.onOutcome("handed_off", "Shop is waiting for a person; message passed on, no AI conversation.");
      return;
    }

    if (this.state.loan === "asked") {
      const yes = YES.test(userText) && !NO.test(userText);
      this.state.loan = yes ? "yes" : "no";
      if (yes) await this.lead();
      // Asked mid-conversation, the shop's own problem may still be open.
      if (SOLVED.includes(this.state.outcome as OutcomeKind)) {
        yield this.fixed(yes ? LOAN_YES : LOAN_NO, english);
        this.state.ended = true;
      } else yield this.fixed(yes ? LINES.loanNoted : LINES.loanSkipped, english);
      return;
    }

    const route = routeTurn(userText);
    if (route) {
      yield* this.routed(route, userText, english);
      return;
    }
    if (CARE.test(userText)) await addNote(this.deps.sql, this.brief.merchantId, "care", "The shopkeeper mentioned a hard time at home. No proactive contact for 30 days.");

    // The safety line is fixed: instant, and the same every time. A shopkeeper's digits never reach the model.
    if (SECRET_WORD.test(userText)) {
      const line = english ? SECRET_EN : SECRET_HI;
      this.state.input.pop();
      this.state.input.push({ role: "user", content: "[The merchant mentioned an OTP or PIN. Their words were removed.]" }, { role: "assistant", content: line });
      this.say(line);
      yield line;
      return;
    }

    const said: string[] = [];
    let retried = false;
    for (let round = 0; round < 5; round++) {
      let buffer = "";
      let failure: Exclude<GuardResult, { ok: true }> | null = null;
      let done: { items: LLMItem[]; calls: { callId: string; name: string; args: string }[] } | null = null;

      for await (const event of this.deps.llm.turn({ instructions: this.instructions, input: this.state.input, tools: toolsFor(this.brief) })) {
        if (event.type === "done") {
          done = event;
          break;
        }
        buffer += event.delta;
        const { chunks, rest } = takeChunks(buffer);
        buffer = rest;
        for (const raw of chunks) {
          const chunk = tidy(raw);
          if (!chunk) continue;
          const check = await this.pass(chunk, said);
          if (!check.ok) {
            failure = check;
            break;
          }
          yield chunk;
        }
        if (failure) break;
      }

      if (!failure && buffer.trim()) {
        for (const raw of takeChunks(buffer, true).chunks) {
          const chunk = tidy(raw);
          if (!chunk) continue;
          const check = await this.pass(chunk, said);
          if (!check.ok) {
            failure = check;
            break;
          }
          yield chunk;
        }
      }

      if (failure) {
        if (!retried) {
          retried = true;
          // Keep what was already spoken, so the retry continues instead of repeating it.
          if (said.length) this.state.input.push({ role: "assistant", content: said.join(" ") });
          this.state.input.push({ role: "user", content: `[System note, not from the merchant: your last sentence was blocked (${failure.reason}). ${said.length ? "Continue from what you already said, without repeating it." : "Reply again."} Use only figures from the facts, written as digits.]` });
          continue;
        }
        // The merchant already has an answer, so the blocked sentence is simply dropped.
        if (said.length) return;
        if (failure.kind === "forbidden") {
          const line = failure.reason.includes("splitting") ? NO_SPLITTING : failure.reason.includes("promise") ? NO_PROMISE : CANNOT_HELP;
          this.say(line);
          yield line;
          return;
        }
        yield* this.fallback();
        return;
      }
      if (!done) return;

      this.state.input.push(...done.items);
      const confirmations: string[] = [];
      for (const call of done.calls) {
        const blocked = this.closeBlocked(call, said, done.calls);
        const result = (blocked ? { error: blocked } : await runTool(this.ctx, call.name, call.args)) as Record<string, unknown>;
        if (!result.error) this.actions.push(call.name as ActionName);
        collectNumbers(result, this.allowed);
        this.state.input.push({ type: "function_call_output", call_id: call.callId, output: JSON.stringify(result) });
        const line = result.error ? null : confirmation(call.name, result, english, this.brief.problem === "device_fault");
        if (line) confirmations.push(line);
      }

      // A fix always ends with the merchant hearing exactly what was done.
      if (confirmations.length) {
        // A silent model still owes the merchant the reason, taken from the brief.
        const { batteryAlerts7Days: alerts, feePlusGstInr: total, feeInr: fee, gstInr: gst } = this.brief.facts;
        const told = this.transcript.some((t) => t.role === "agent" && t.text.includes(String(total)));
        const figures = total && !told ? (english ? `Our record shows ₹${total} deducted: fee ₹${fee} and GST ₹${gst}. ` : `जी, हमारे record में ₹${total} कटे हैं: fee ₹${fee} और GST ₹${gst}। `) : "";
        const reason = figures || (said.length === 0 && alerts ? (english ? `I can see ${alerts} battery alerts in the last 7 days. ` : `जी, पिछले 7 दिन में ${alerts} battery alerts आए हैं। `) : "");
        const line = reason + (reason ? confirmations.join(" ").replace(/^जी, /, "") : confirmations.join(" "));
        this.state.input.push({ role: "assistant", content: line });
        this.say(line);
        yield line;
        return;
      }
      const offer = await this.loanAsk(english);
      if (offer) {
        yield offer;
        return;
      }
      const closing = done.calls.filter((c) => this.actions.includes(c.name as ActionName)).map((c) => CLOSING_LINES[c.name]).find(Boolean);
      if (said.length === 0 && closing) {
        const line = closing[english ? 1 : 0];
        this.say(line);
        yield line;
        return;
      }
      const needsAnswer = done.calls.some((c) => READ_TOOLS.has(c.name));
      if (done.calls.length === 0 || (said.length > 0 && !needsAnswer)) {
        // A spoken goodbye ends the conversation, even if the model forgot to record it.
        if (GOODBYE.test(said.at(-1) ?? "")) this.state.ended = true;
        return;
      }
    }
  }

  private fixed(line: readonly [string, string], english: boolean) {
    const text = line[english ? 1 : 0];
    this.state.input.push({ role: "assistant", content: text });
    this.say(text);
    return text;
  }

  // Safety and respect are decided by code, before the model is asked anything.
  private async *routed(route: Exclude<Route, null>, userText: string, english: boolean) {
    const { core, sql } = this.deps;
    const id = this.brief.merchantId;
    if (route === "fraud") {
      // The shop's words are kept for the team only as a description; digits are stripped so no OTP is stored.
      await core.scheduleCallback(id, "URGENT: possible fraud", `Merchant reported possible fraud: ${userText.replace(/\d/g, "#")}`);
      await audit(sql, id, "fraud_report", { conversation: this.id });
      this.transcript.at(-1)!.text = userText.replace(/\d/g, "#");
      this.state.input.pop();
      this.ctx.onOutcome("handed_off", "Possible fraud reported. Urgent handoff; shop told to change PIN and call 1930.");
      yield this.fixed(LINES.fraud, english);
    } else if (route === "trust" || route === "account" || route === "identity") {
      this.state.input.pop();
      yield this.fixed(LINES[route], english);
    } else if (route === "human") {
      await core.scheduleCallback(id, "Merchant asked for a person", this.ctx.transcriptText());
      this.ctx.onOutcome("handed_off", "Merchant asked for a person.");
      yield this.fixed(LINES.human, english);
    } else if (route === "optout") {
      await core.optOut(id);
      this.ctx.onOutcome("opted_out", "Merchant asked to stop outreach.");
      yield this.fixed(LINES.optout, english);
    } else if (route === "later") {
      this.ctx.onOutcome("later", "Merchant was busy; nothing was said about the shop.");
      yield this.fixed(LINES.later, english);
    } else {
      this.state.quiet = true;
      const { firstName: _name, ...facts } = this.brief.facts;
      await core.notify(id, Object.entries(facts).filter(([k]) => k === "feeInr" || k === "gstInr" || k === "feePlusGstInr").map(([k, v]) => `${k === "feeInr" ? "Fee" : k === "gstInr" ? "GST" : "कुल"}: ₹${v}`).join(", ") || "आपका पूरा हिसाब Paytm for Business app में है।");
      yield this.fixed(LINES.quiet, english);
    }
  }

  private async lead(why = "Shop agreed to hear about a business loan after its problem was solved") {
    const m = await this.deps.core.merchant(this.brief.merchantId);
    const monthly = Number(this.brief.facts.collections30DaysInr ?? 0);
    const value = shopValue(m, monthly, TODAY - m.onboardDay, 0);
    await this.deps.sql.run("INSERT INTO leads (merchant_id, kind, why, value_inr, status, created_at) VALUES (?, 'business_loan', ?, ?, 'new', ?) ON CONFLICT (merchant_id) DO NOTHING", [m.id, why, value.loanYear, new Date().toISOString()]);
  }

  // Only a shop whose problem is solved, and whose record supports it, is asked. Asked once, and a person does the selling.
  private async loanAsk(english: boolean) {
    const last = this.transcript.filter((t) => t.role === "merchant").at(-1)?.text ?? "";
    if (this.actions.some((a) => a === "checkLoan" || a === "setReducedEmi" || a === "proposeLoan") || this.brief.problem.startsWith("loan_") || this.actions.includes("acceptLoan") || this.state.loan || !SOLVED.includes(this.state.outcome as OutcomeKind) || !STAYING.test(last) || this.brief.problem === "unknown") return null;
    const m = await this.deps.core.merchant(this.brief.merchantId);
    const monthly = Number(this.brief.facts.collections30DaysInr ?? 0);
    if (!shopValue(m, monthly, TODAY - m.onboardDay, 0).loanReady) return null;
    this.state.loan = "asked";
    this.state.ended = false;
    return this.fixed(LOAN_ASK, english);
  }

  private say(text: string) {
    this.transcript.push({ role: "agent", text });
    this.state.numbersChecked = (this.state.numbersChecked ?? 0) + numbersIn(text).length;
  }

  private async *fallback() {
    this.state.numbersVerified = false;
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

  // What actually happened outranks what the model claimed.
  private finalOutcome(merchantSpoke: boolean): OutcomeKind {
    const claimed = this.state.outcome;
    if (this.state.loan && claimed && SOLVED.includes(claimed)) return claimed;
    if (claimed === "opted_out" || claimed === "handed_off" || claimed === "left" || claimed === "return_requested" || claimed === "later" || claimed === "fix_confirmed") return claimed;
    if (this.actions.includes("acceptLoan")) return "loan_accepted";
    if (this.actions.includes("setReducedEmi")) return "emi_reset";
    if (this.actions.includes("changePlan")) return "plan_changed";
    if (this.actions.includes("raiseTicket")) return "ticket_raised";
    if (!merchantSpoke || claimed === "no_response") return "no_response";
    // "Stayed" must come from the shop's own last words. Walking away mid-talk is not a win.
    const last = this.transcript.filter((t) => t.role === "merchant").at(-1)?.text ?? "";
    return STAYING.test(last) ? "stayed" : "undecided";
  }

  // Post-call step: reasons, outcome, and the learning loop. Runs once per conversation.
  async finish(): Promise<Outcome | null> {
    this.state.ended = true;
    const merchantLines = this.transcript.filter((t) => t.role === "merchant").map((t) => t.text);
    const kind = this.finalOutcome(merchantLines.length > 0);
    const text = `${this.transcript.map((t) => `${t.role === "merchant" ? "MERCHANT" : "AGENT"}: ${t.text}`).join("\n")}\n\nWHAT THE SYSTEM DID: outcome ${kind}; actions ${this.actions.map((a) => (a === "confirmFix" ? `shop said the fix ${kind === "fix_confirmed" ? "worked" : "did NOT work"}` : a)).join(", ") || "none"}.`;

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

    const outcome = Outcome.parse({
      briefId: this.brief.briefId,
      outcome: kind,
      reasons,
      actionsTaken: this.actions,
      durationSec: Math.round((Date.now() - this.state.started) / 1000),
      numbersVerified: this.numbersVerified,
      numbersChecked: this.state.numbersChecked ?? 0,
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
