// Checks tool calling + streaming on OPENAI_MODEL and prints timings.
// Usage: pnpm spike:openai [model]
import OpenAI from "openai";
import { loadSettings } from "../../config/settings.js";

const s = loadSettings();
const model = process.argv[2] ?? s.OPENAI_MODEL;
const openai = new OpenAI({ apiKey: s.OPENAI_API_KEY });

const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "explainFee",
      description: "Get this merchant's fee details for a period.",
      parameters: {
        type: "object",
        properties: { period: { type: "string" } },
        required: ["period"],
        additionalProperties: false,
      },
    },
  },
];

const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
  { role: "system", content: "You are Paytm's AI assistant. Reply in short Hinglish. Always use tools for numbers." },
  { role: "user", content: "Mere settlement mein paise kam kyun aaye?" },
];

async function run() {
  const start = performance.now();
  let first: number | undefined;
  let text = "";
  const calls = new Map<number, { id: string; name: string; args: string }>();

  const stream = await openai.chat.completions.create({ model, messages, tools, stream: true });
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;
    if (first === undefined && (delta.content || delta.tool_calls)) first = performance.now() - start;
    if (delta.content) text += delta.content;
    for (const c of delta.tool_calls ?? []) {
      const cur = calls.get(c.index) ?? { id: "", name: "", args: "" };
      cur.id ||= c.id ?? "";
      cur.name ||= c.function?.name ?? "";
      cur.args += c.function?.arguments ?? "";
      calls.set(c.index, cur);
    }
  }
  return { text, calls: [...calls.values()], firstMs: first ?? 0, totalMs: performance.now() - start };
}

const one = await run();
console.log(`[${model}] turn 1: first token ${one.firstMs.toFixed(0)}ms, total ${one.totalMs.toFixed(0)}ms`);
console.log("tool calls:", one.calls.map((c) => `${c.name}(${c.args})`));
if (one.calls.length === 0) throw new Error("Model did not call the tool");

messages.push({
  role: "assistant",
  tool_calls: one.calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args } })),
});
for (const c of one.calls) {
  messages.push({
    role: "tool",
    tool_call_id: c.id,
    content: JSON.stringify({ paymentsAbove2000: 4, total: 9500, fee: 38, gst: 6.84 }),
  });
}

const two = await run();
console.log(`[${model}] turn 2: first token ${two.firstMs.toFixed(0)}ms, total ${two.totalMs.toFixed(0)}ms`);
console.log("reply:", two.text);
