// Time to first reply text per model. Usage: pnpm exec tsx scripts/spike/llmSpeed.ts model:effort ...
import OpenAI from "openai";
import { loadSettings } from "../../config/settings.js";

const s = loadSettings();
const openai = new OpenAI({ apiKey: s.OPENAI_API_KEY });

for (const spec of process.argv.slice(2)) {
  const [model = "", effort = "low"] = spec.split(":");
  const times: number[] = [];
  let sample = "";
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    let first = 0;
    sample = "";
    const stream = await openai.responses.create({
      model,
      instructions:
        "You are Paytm's AI assistant. Reply warmly in short spoken Hinglish, 2 sentences. " +
        "Facts: 4 payments above ₹2,000 totalling ₹9,500, fee ₹38, GST ₹6.84.",
      input: "मेरे settlement में पैसे कम क्यों आए",
      reasoning: { effort: effort as "low" },
      stream: true,
      store: false,
    });
    for await (const event of stream) {
      if (event.type === "response.output_text.delta") {
        first ||= performance.now() - start;
        sample += event.delta;
      }
    }
    times.push(Math.round(first));
  }
  const sorted = [...times].sort((a, b) => a - b);
  console.log(`${spec}: median ${sorted[2]}ms, worst ${sorted[4]}ms [${times.join(", ")}]\n  ${sample}`);
}
