// Checks tool calling + streaming through the Responses API and prints timings.
// Usage: pnpm spike:openai [model] [effort]
import OpenAI from "openai";
import { loadSettings } from "../../config/settings.js";

const s = loadSettings();
const model = process.argv[2] ?? s.OPENAI_MODEL;
const effort = (process.argv[3] ?? "low") as "none" | "low" | "medium";
const openai = new OpenAI({ apiKey: s.OPENAI_API_KEY });

const tools: OpenAI.Responses.Tool[] = [
  {
    type: "function",
    name: "explainFee",
    description: "Get this merchant's fee details for a period.",
    strict: true,
    parameters: {
      type: "object",
      properties: { period: { type: "string" } },
      required: ["period"],
      additionalProperties: false,
    },
  },
];

const instructions = "You are Paytm's AI assistant. Reply in short Hinglish. Always use tools for numbers.";
const input: OpenAI.Responses.ResponseInputItem[] = [
  { role: "user", content: "Mere settlement mein paise kam kyun aaye?" },
];

async function run() {
  const start = performance.now();
  let first: number | undefined;
  let text = "";
  let output: OpenAI.Responses.ResponseOutputItem[] = [];

  const stream = await openai.responses.create({
    model,
    instructions,
    input,
    tools,
    reasoning: { effort },
    stream: true,
    store: false,
  });
  for await (const event of stream) {
    if (event.type === "response.output_text.delta") {
      first ??= performance.now() - start;
      text += event.delta;
    }
    if (event.type === "response.completed") output = event.response.output;
  }
  return { text, output, firstMs: first, totalMs: performance.now() - start };
}

const one = await run();
const calls = one.output.filter((o) => o.type === "function_call");
console.log(`[${model} ${effort}] turn 1 (tool call): total ${one.totalMs.toFixed(0)}ms`);
console.log("tool calls:", calls.map((c) => `${c.name}(${c.arguments})`));
if (calls.length === 0) throw new Error(`Model did not call the tool. It said: ${one.text}`);

input.push(...(one.output as OpenAI.Responses.ResponseInputItem[]));
for (const c of calls) {
  input.push({
    type: "function_call_output",
    call_id: c.call_id,
    output: JSON.stringify({ paymentsAbove2000: 4, total: 9500, fee: 38, gst: 6.84 }),
  });
}

const two = await run();
console.log(`[${model} ${effort}] turn 2 (reply): first token ${two.firstMs?.toFixed(0)}ms, total ${two.totalMs.toFixed(0)}ms`);
console.log("reply:", two.text);
