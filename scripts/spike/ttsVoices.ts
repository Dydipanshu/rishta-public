// Writes the same lines in several voices to out/tts for listening.
// Compares Romanised Hinglish vs Devanagari, and how "₹38" is read.
import { mkdirSync, writeFileSync } from "node:fs";
import { SarvamAIClient } from "sarvamai";
import { loadSettings } from "../../config/settings.js";

const s = loadSettings();
const sarvam = new SarvamAIClient({ apiSubscriptionKey: s.SARVAM_API_KEY });

const voices: [model: string, speaker: string][] = [
  ["bulbul:v3", "priya"],
  ["bulbul:v3", "neha"],
  ["bulbul:v3", "kavya"],
  ["bulbul:v3", "shreya"],
  ["bulbul:v4-flash", "shubh_enhi_ads"],
  ["bulbul:v4-flash", "simran_en_customer"],
];

const lines = {
  roman: "Namaste ji, main Paytm ki AI assistant hoon. Is hafte aapka fee ₹38 aur GST ₹6.84 kata hai.",
  devanagari: "नमस्ते जी, मैं Paytm की AI assistant हूँ। इस हफ्ते आपका fee ₹38 और GST ₹6.84 कटा है।",
  spelled: "नमस्ते जी, मैं Paytm की AI assistant हूँ। इस हफ्ते आपका fee अड़तीस रुपये और GST छह रुपये चौरासी पैसे कटा है।",
};

mkdirSync("out/tts", { recursive: true });
for (const [model, speaker] of voices) {
  for (const [style, text] of Object.entries(lines)) {
    const name = `${model.replace(":", "-")}_${speaker}_${style}`;
    try {
      const start = performance.now();
      const res = await sarvam.textToSpeech.convert({
        text,
        language_code: "hi-IN",
        model: model as "bulbul:v3",
        speaker: speaker as "priya",
      });
      writeFileSync(`out/tts/${name}.wav`, Buffer.from(res.audios[0] ?? "", "base64"));
      console.log(`${name}: ${(performance.now() - start).toFixed(0)}ms`);
    } catch (err) {
      console.log(`${name}: FAILED ${(err as Error).message}`);
    }
  }
}
