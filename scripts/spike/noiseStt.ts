// What does recognition return for pure noise and silence?
import { SarvamAIClient } from "sarvamai";

process.loadEnvFile(".env");
const c = new SarvamAIClient({ apiSubscriptionKey: process.env.SARVAM_API_KEY! });
const wav = (amp: number) => {
  const n = 32000, b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.floor((Math.random() - 0.5) * amp), 44 + i * 2);
  return b;
};
for (const amp of [12000, 12000, 12000, 12000, 12000, 12000, 3000, 3000, 300, 0]) {
  const r = await c.speechToText.transcribe({ file: { data: wav(amp), filename: "c.wav", contentType: "audio/wav" }, model: "saaras:v4", mode: "codemix", language_code: "hi-IN" } as never);
  console.log(amp, JSON.stringify(r.transcript), (r as { language_probability?: number }).language_probability);
}
