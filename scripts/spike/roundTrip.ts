// Speech out, speech back in: a check on voice settings that needs no ears.
import { SarvamAIClient } from "sarvamai";

process.loadEnvFile(".env");
const c = new SarvamAIClient({ apiSubscriptionKey: process.env.SARVAM_API_KEY! });
const keyterms = ["Paytm", "Soundbox", "settlement", "fee", "GST", "ticket", "plan", "rent"];
const hear = async (data: Buffer, opts: object) => (await c.speechToText.transcribe({ file: { data, filename: "c.wav", contentType: "audio/wav" }, ...opts } as never)).transcript;
const speak = async (text: string, speaker: string) => Buffer.from((await c.textToSpeech.convert({ text, language_code: "hi-IN", model: "bulbul:v4-flash", speaker, enable_preprocessing: true, speech_sample_rate: 24000, output_audio_codec: "wav" } as never) as { audios: string[] }).audios[0]!, "base64");

for (const text of ["सब ठीक है", "हाँ ठीक है", "नहीं", "मेरे settlement में पैसे कम क्यों आए", "Soundbox वापस करना है"]) {
  const audio = await speak(text, "aparna_hi_customer");
  console.log(JSON.stringify({ text, old: await hear(audio, { model: "saaras:v3", mode: "codemix" }), new: await hear(audio, { model: "saaras:v4", mode: "codemix", language_code: "hi-IN", keyterms }) }));
}
for (const text of ["इन पर fee ₹38 और GST ₹6.84 है, कुल ₹44.84।", "₹14,250 का settlement ₹14,205.16 रहा।"]) {
  const audio = await speak(text, "aparna_hi_customer");
  console.log(JSON.stringify({ text, heard: await hear(audio, { model: "saaras:v4", mode: "codemix", language_code: "hi-IN", keyterms }) }));
}
