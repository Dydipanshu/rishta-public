// Makes a test clip from TTS so timing can run before real recordings exist.
import { mkdirSync, writeFileSync } from "node:fs";
import { SarvamAIClient } from "sarvamai";
import { loadSettings } from "../../config/settings.js";

const s = loadSettings();
const sarvam = new SarvamAIClient({ apiSubscriptionKey: s.SARVAM_API_KEY });
const res = await sarvam.textToSpeech.convert({
  text: "मेरे settlement में पैसे कम क्यों आए?",
  language_code: "hi-IN",
  model: "bulbul:v3",
  speaker: "rahul",
  speech_sample_rate: 16000,
});
mkdirSync("out", { recursive: true });
writeFileSync("out/test-clip.wav", Buffer.from(res.audios[0] ?? "", "base64"));
