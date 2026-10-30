// End-to-end timing: audio clip -> STT -> LLM stream -> first TTS audio byte.
// No tool call here: merchant facts are already in the prompt.
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

const stream = await openai.responses.create({
  model: s.OPENAI_MODEL,
  instructions:
    "You are Paytm's AI assistant. Reply warmly in short spoken Hinglish, 2 sentences. " +
    "Facts: 4 payments above ₹2,000 totalling ₹9,500, fee ₹38, GST ₹6.84.",
  input: stt.transcript,
  reasoning: { effort: "none" },
  stream: true,
  store: false,
});

let buffer = "";
for await (const event of stream) {
  if (event.type === "response.output_text.delta") buffer += event.delta;
  if (/[।?!]\s|\.\s/.test(buffer)) break;
}
const sentence = buffer.trim();
const llmMs = performance.now() - start - sttMs;
console.log(`LLM first sentence ${llmMs.toFixed(0)}ms: ${sentence}`);

const res = await sarvam.textToSpeech.convertStream({
  text: sentence,
  language_code: "hi-IN",
  model: s.SARVAM_TTS_MODEL as "bulbul:v3",
  speaker: s.SARVAM_TTS_VOICE as "priya",
  output_audio_codec: "mp3",
});
const reader = res.stream()!.getReader();
await reader.read();
const total = performance.now() - start;
await reader.cancel();
console.log(`TTS first byte ${(total - sttMs - llmMs).toFixed(0)}ms`);
console.log(`Total until agent starts speaking: ${total.toFixed(0)}ms (target 1500-2000ms)`);
