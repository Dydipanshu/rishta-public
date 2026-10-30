// Sends real audio to the running app: speech, then pure noise.
import { SarvamAIClient } from "sarvamai";

process.loadEnvFile(".env");
const c = new SarvamAIClient({ apiSubscriptionKey: process.env.SARVAM_API_KEY! });
const talk = async (data: Buffer) => {
  const form = new FormData();
  form.append("audio", new Blob([new Uint8Array(data)], { type: "audio/wav" }), "c.wav");
  const res = await fetch("http://localhost:3000/api/talk/M001", { method: "POST", body: form });
  return (await res.text()).trim().split("\n").map((l) => JSON.parse(l) as { type: string; text?: string; filler?: boolean }).filter((e) => e.type === "transcript" || (e.type === "say" && !e.filler)).map((e) => `${e.type}: ${e.text}`);
};
const noise = () => {
  const n = 24000;
  const b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.floor((Math.random() - 0.5) * 12000), 44 + i * 2);
  return b;
};
await fetch("http://localhost:3000/api/reset", { method: "POST" });
console.log("noise:", await talk(noise()));
const r = (await c.textToSpeech.convert({ text: "सब ठीक है", language_code: "hi-IN", model: "bulbul:v4-flash", speaker: "aparna_hi_customer", output_audio_codec: "wav" } as never)) as { audios: string[] };
console.log("speech:", await talk(Buffer.from(r.audios[0]!, "base64")));
await fetch("http://localhost:3000/api/reset", { method: "POST" });
