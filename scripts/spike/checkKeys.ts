// Confirms both keys work without printing them.
import OpenAI from "openai";
import { SarvamAIClient } from "sarvamai";
import { loadSettings } from "../../config/settings.js";

const s = loadSettings();

const sarvam = new SarvamAIClient({ apiSubscriptionKey: s.SARVAM_API_KEY });
const tts = await sarvam.textToSpeech.convert({
  text: "Namaste ji.",
  language_code: "hi-IN",
  model: s.SARVAM_TTS_MODEL as "bulbul:v3",
  speaker: s.SARVAM_TTS_VOICE as "priya",
});
console.log(`Sarvam ok (${tts.audios.length} audio returned)`);

const openai = new OpenAI({ apiKey: s.OPENAI_API_KEY });
const models = await openai.models.list();
const ids = models.data.map((m) => m.id);
console.log(`OpenAI ok (${ids.length} models). ${s.OPENAI_MODEL} available: ${ids.includes(s.OPENAI_MODEL)}`);
