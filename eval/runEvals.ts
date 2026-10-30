// Runs scripted conversations through the real agent. Usage: pnpm eval [model]
import { existsSync, readFileSync, rmSync } from "node:fs";
import { parse } from "yaml";
import { loadSettings } from "../config/settings.js";
import { Conversation } from "../src/agent/brain.js";
import { checkSentence, collectNumbers, takeChunks } from "../src/agent/guard.js";
import { benchCore } from "../src/adapters/benchCore.js";
import { openAIAdapter } from "../src/agent/llmAdapter.js";
import { Brief } from "../src/engine/brief.js";
import { openSql } from "../src/data/sql.js";
import { resetLive } from "../src/data/reset.js";

interface Scenario {
  name: string;
  merchant: string;
  turns: string[];
  expect: {
    tools?: string[];
    noTools?: string[];
    outcome?: string;
    reason?: string;
    mustContain?: string[];
    mustContainAny?: string[];
    mustNotContain?: string[];
    english?: boolean;
  };
}

const s = loadSettings();
const model = process.argv[2] ?? s.OPENAI_MODEL;
const only = process.argv[3];
const llm = openAIAdapter(s.OPENAI_API_KEY, model, s.OPENAI_REASONING_EFFORT);

const source = await openSql("data/rishta.db");
for (const f of ["data/eval.db", "data/eval.db-wal", "data/eval.db-shm"]) if (existsSync(f)) rmSync(f);
await source.run("VACUUM INTO 'data/eval.db'");
await source.close();
const db = await openSql("data/eval.db");
const deps = { sql: db, core: benchCore(db), llm };

const scenarios = (parse(readFileSync("eval/scripts/scenarios.yaml", "utf8")) as Scenario[]).filter((x) => !only || x.name.includes(only));
let passed = 0;
const started = performance.now();

for (const sc of scenarios) {
  await resetLive(db);
  const row = (await db.get<{ json: string; meta: string }>("SELECT json, meta FROM briefs WHERE merchant_id = ?", [sc.merchant]))!;
  const brief = Brief.parse(JSON.parse(row.json));
  const conv = await Conversation.start(deps, brief, JSON.parse(row.meta).why);
  conv.opening();
  const fails: string[] = [];
  const replies: string[] = [];
  const firstChunk: number[] = [];

  for (const turn of sc.turns) {
    const t = performance.now();
    let got = false;
    let text = "";
    for await (const chunk of conv.reply(turn)) {
      if (!got) firstChunk.push(Math.round(performance.now() - t));
      got = true;
      text += `${chunk} `;
    }
    replies.push(text.trim());
    if (!text.trim()) fails.push("empty reply");
    const sentences = takeChunks(text.replace(/,(?=\s)/g, ";"), true).chunks.length;
    if (sentences > 4) fails.push(`${sentences} sentences`);
    if (conv.ended) break;
  }

  const outcome = (await conv.finish())!;
  const all = replies.join(" ");
  const allowed = new Set<string>();
  collectNumbers(brief.facts, allowed);
  collectNumbers(await db.all("SELECT detail FROM audit_log WHERE kind = 'tool'"), allowed);

  const e = sc.expect;
  for (const t of e.tools ?? []) if (!conv.actions.includes(t as never)) fails.push(`missing tool ${t}`);
  for (const t of e.noTools ?? []) if (conv.actions.includes(t as never)) fails.push(`forbidden tool ${t}`);
  if (e.outcome && outcome.outcome !== e.outcome) fails.push(`outcome ${outcome.outcome}, wanted ${e.outcome}`);
  if (e.reason && !outcome.reasons.some((r) => r.code === e.reason)) fails.push(`reason ${e.reason} missing: ${JSON.stringify(outcome.reasons)}`);
  for (const t of e.mustContain ?? []) if (!all.includes(t)) fails.push(`missing "${t}"`);
  for (const t of e.mustNotContain ?? []) if (all.includes(t)) fails.push(`should not say "${t}"`);
  if (e.mustContainAny && !e.mustContainAny.some((t) => all.includes(t))) fails.push(`none of ${e.mustContainAny.join("/")}`);
  if (e.english && /[ऀ-ॿ]/.test(all)) fails.push("not in English");
  const forbidden = replies.flatMap((r) => takeChunks(r, true).chunks).map((c) => checkSentence(c, new Set(["*"]))).filter((c) => !c.ok && c.kind === "forbidden");
  if (forbidden.length) fails.push("forbidden content reached the merchant");
  if (!outcome.numbersVerified) fails.push("fell back on an unverified number");

  if (fails.length === 0) passed++;
  console.log(`${fails.length ? "FAIL" : "PASS"} ${sc.name} [first ${firstChunk.join("/")}ms] tools=${conv.actions.join(",")} guard=${conv.guardEvents.length}`);
  if (fails.length) console.log(`   ${fails.join(" | ")}`);
  if (fails.length || process.env.VERBOSE) for (const r of replies) console.log(`   > ${r}`);
}

console.log(`\n${model}: ${passed}/${scenarios.length} passed in ${((performance.now() - started) / 1000).toFixed(0)}s`);
