// Runs eval/stt-clips/clips.yaml through Sarvam STT and reports word accuracy.
// Usage: pnpm spike:stt [model] [mode]
import { createReadStream, readFileSync } from "node:fs";
import { SarvamAIClient } from "sarvamai";
import { parse } from "yaml";
import { loadSettings } from "../../config/settings.js";

const s = loadSettings();
const model = process.argv[2] ?? s.SARVAM_STT_MODEL;
const mode = process.argv[3] ?? (model === "saaras:v3" ? "codemix" : undefined);
const sarvam = new SarvamAIClient({ apiSubscriptionKey: s.SARVAM_API_KEY });

const clips = parse(readFileSync("eval/stt-clips/clips.yaml", "utf8")) as { file: string; text: string }[];

const words = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").split(/\s+/).filter(Boolean);

function editDistance(a: string[], b: string[]): number {
  let prev = b.map((_, i) => i + 1);
  prev.unshift(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    prev = cur;
  }
  return prev[b.length]!;
}

let errors = 0;
let total = 0;
for (const clip of clips) {
  const start = performance.now();
  const res = await sarvam.speechToText.transcribe({
    file: createReadStream(`eval/stt-clips/${clip.file}`),
    model: model as "saaras:v3",
    ...(mode ? { mode: mode as "codemix" } : {}),
  });
  const ms = performance.now() - start;
  const expected = words(clip.text);
  const dist = editDistance(expected, words(res.transcript));
  errors += dist;
  total += expected.length;
  console.log(`${clip.file} (${ms.toFixed(0)}ms) errors ${dist}/${expected.length}\n  want: ${clip.text}\n  got:  ${res.transcript}`);
}
console.log(`\n${model}${mode ? ` ${mode}` : ""}: word accuracy ${((1 - errors / total) * 100).toFixed(1)}% over ${clips.length} clips`);
