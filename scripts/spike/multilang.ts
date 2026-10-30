// Detection confidence, translation speed, and what noise looks like under auto-detect.
import { SarvamAIClient } from "sarvamai";

process.loadEnvFile(".env");
const c = new SarvamAIClient({ apiSubscriptionKey: process.env.SARVAM_API_KEY! });
const tts = async (text: string, language_code: string, speaker: string) => Buffer.from(((await c.textToSpeech.convert({ text, language_code, model: "bulbul:v4-flash", speaker, speech_sample_rate: 24000, output_audio_codec: "wav" } as never)) as { audios: string[] }).audios[0]!, "base64");
const stt = async (data: Buffer) => { const r = await c.speechToText.transcribe({ file: { data, filename: "c.wav", contentType: "audio/wav" }, model: "saaras:v4", mode: "codemix", language_code: "unknown" } as never) as { transcript: string; language_code?: string; language_probability?: number }; return { t: r.transcript, l: r.language_code, p: r.language_probability }; };
for (const [t, l, v] of [["सब ठीक है", "hi-IN", "ishita_enhi_customer"], ["नहीं", "hi-IN", "ishita_enhi_customer"], ["हाँ", "hi-IN", "ishita_enhi_customer"], ["ನನ್ನ settlement ಯಾಕೆ ಕಡಿಮೆ ಬಂತು", "kn-IN", process.argv[2]!], ["என் settlement ஏன் குறைவாக வந்தது", "ta-IN", process.argv[3]!]] as const) {
  console.log(t, JSON.stringify(await stt(await tts(t, l, v))));
}
const wav = (amp: number) => { const n = 32000, b = Buffer.alloc(44 + n * 2); b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) b.writeInt16LE(Math.floor((Math.random() - 0.5) * amp), 44 + i * 2); return b; };
for (const a of [12000, 12000, 3000, 3000, 800, 800, 0]) console.log("noise", a, JSON.stringify(await stt(wav(a))));
for (const target of ["kn-IN", "ta-IN"]) {
  const s = performance.now();
  const r = await c.text.translate({ input: "इन पर ₹38 fee और ₹6.84 GST, कुल ₹44.84 लगा।", source_language_code: "hi-IN", target_language_code: target, model: "mayura:v1", mode: "modern-colloquial", numerals_format: "international" } as never);
  console.log(target, Math.round(performance.now() - s) + "ms", r.translated_text);
}
