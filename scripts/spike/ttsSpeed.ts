// Times TTS on a short spoken sentence: full response vs streaming first byte.
import { SarvamAIClient } from "sarvamai";
import { loadSettings } from "../../config/settings.js";

const s = loadSettings();
const sarvam = new SarvamAIClient({ apiSubscriptionKey: s.SARVAM_API_KEY });
const text = "नमस्ते जी, मैं Paytm की AI assistant हूँ।";
const voices: [string, string][] = [["bulbul:v3", "priya"], ["bulbul:v4-flash", "simran_en_customer"]];

for (const [model, speaker] of voices) {
  for (let i = 0; i < 3; i++) {
    const a = performance.now();
    await sarvam.textToSpeech.convert({ text, language_code: "hi-IN", model: model as "bulbul:v3", speaker: speaker as "priya", speech_sample_rate: 22050 });
    const full = performance.now() - a;

    const b = performance.now();
    const res = await sarvam.textToSpeech.convertStream({ text, language_code: "hi-IN", model: model as "bulbul:v3", speaker: speaker as "priya", output_audio_codec: "mp3" });
    let firstByte = 0;
    let bytes = 0;
    for await (const chunk of res.stream()!) {
      firstByte ||= performance.now() - b;
      bytes += chunk.length;
    }
    console.log(`${model} ${speaker}: full ${full.toFixed(0)}ms | stream first byte ${firstByte.toFixed(0)}ms, done ${(performance.now() - b).toFixed(0)}ms, ${bytes} bytes`);
  }
}
