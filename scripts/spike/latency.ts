// End-to-end timing: audio clip -> STT -> LLM stream -> first sentence TTS.
// Usage: pnpm spike:latency path/to/clip.wav
import { createReadStream } from "node:fs";
import OpenAI from "openai";
import { SarvamAIClient } from "sarvamai";
import { loadSettings } from "../../config/settings.js";

const clip = process.argv[2];
if (!clip) throw new Error("Usage: pnpm spike:latency path/to/clip.wav");

const s = loadSettings();
const sarvam = new SarvamAIClient({ apiSubscriptionKey: s.SARVAM_API_KEY });
const openai = new OpenAI({ apiKey: s.OPENAI_API_KEY });

const start = performance.now();
const stt = await sarvam.speechToText.transcribe({
  file: createReadStream(clip),
  model: s.SARVAM_STT_MODEL as "saaras:v3",
  ...(s.SARVAM_STT_MODEL === "saaras:v3" ? { mode: "codemix" as const } : {}),
});
const sttMs = performance.now() - start;
console.log(`STT ${sttMs.toFixed(0)}ms: ${stt.transcript}`);

const stream = await openai.chat.completions.create({
  model: s.OPENAI_MODEL,
  stream: true,
  messages: [
    { role: "system", content: "You are Paytm's AI assistant. Reply warmly in short spoken Hinglish, 2 sentences." },
    { role: "user", content: stt.transcript },
  ],
});

let buffer = "";
for await (const chunk of stream) {
  buffer += chunk.choices[0]?.delta?.content ?? "";
  if (/[।.?!]/.test(buffer)) break;
}
const sentence = buffer.split(/(?<=[।.?!])/)[0]?.trim() ?? buffer;
const llmMs = performance.now() - start - sttMs;
console.log(`LLM first sentence ${llmMs.toFixed(0)}ms: ${sentence}`);

await sarvam.textToSpeech.convert({
  text: sentence,
  language_code: "hi-IN",
  model: s.SARVAM_TTS_MODEL as "bulbul:v3",
  speaker: s.SARVAM_TTS_VOICE as "priya",
});
const total = performance.now() - start;
console.log(`TTS ${(total - sttMs - llmMs).toFixed(0)}ms`);
console.log(`Total until audio is ready: ${total.toFixed(0)}ms (target 1500-2000ms)`);
