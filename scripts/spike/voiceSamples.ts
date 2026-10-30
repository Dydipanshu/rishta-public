// Writes one sample per candidate voice for the /voices page.
import { mkdirSync, writeFileSync } from "node:fs";
import { SarvamAIClient } from "sarvamai";
import { speakable } from "../../src/voice/speakNumbers.js";

process.loadEnvFile(".env");
const c = new SarvamAIClient({ apiSubscriptionKey: process.env.SARVAM_API_KEY! });
const LINE = speakable("नमस्ते Ramesh जी। आपके ₹14,250 के settlement में ₹44.84 fee और GST कटा है। क्या आप Soundbox रखना चाहेंगे?");
const VOICES = ["aparna_hi_customer", "aarti_hi_customer", "ritu_hi_customer_warm", "simran_enhi_customer", "ishita_enhi_customer", "shalini_enhi_customer"];
mkdirSync("web/public/voice-samples", { recursive: true });
for (const speaker of VOICES) {
  const r = (await c.textToSpeech.convert({ text: LINE, language_code: "hi-IN", model: "bulbul:v4-flash", speaker, enable_preprocessing: true, speech_sample_rate: 24000, output_audio_codec: "mp3" } as never)) as { audios: string[] };
  writeFileSync(`web/public/voice-samples/${speaker}.mp3`, Buffer.from(r.audios[0]!, "base64"));
  console.log(speaker, "written");
}
