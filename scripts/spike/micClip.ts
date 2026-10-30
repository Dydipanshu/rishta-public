// Writes a spoken Hindi clip for feeding a browser's fake microphone.
import { writeFileSync } from "node:fs";
import { SarvamAIClient } from "sarvamai";

process.loadEnvFile(".env");
const c = new SarvamAIClient({ apiSubscriptionKey: process.env.SARVAM_API_KEY! });
const r = (await c.textToSpeech.convert({ text: "सब ठीक है", language_code: "hi-IN", model: "bulbul:v4-flash", speaker: "aarti_hi_customer", speech_sample_rate: 48000, output_audio_codec: "wav" } as never)) as { audios: string[] };
writeFileSync(process.argv[2]!, Buffer.from(r.audios[0]!, "base64"));
