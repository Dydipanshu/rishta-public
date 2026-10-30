import { SarvamAIClient } from "sarvamai";
import type { Settings } from "../../config/settings.js";
import { withTimeout } from "./timeout.js";

// Words the model should expect from a shopkeeper talking about Paytm.
const KEYTERMS = ["Paytm", "Soundbox", "settlement", "fee", "GST", "ticket", "plan", "rent", "payment", "battery", "UPI", "QR"];

// Merchants speak Hindi and English here. Anything in another script is noise misheard, never speech.
export const heardClearly = (text: string) => /[\p{Script=Devanagari}\p{Script=Latin}]/u.test(text) && !/[^\p{Script=Devanagari}\p{Script=Latin}\p{N}\p{P}\p{S}\p{Z}\p{M}]/u.test(text);

export function makeStt(s: Settings) {
  const sarvam = new SarvamAIClient({ apiSubscriptionKey: s.SARVAM_API_KEY });
  return async (audio: Buffer, contentType: string) => {
    const res = await withTimeout(sarvam.speechToText.transcribe({
      file: { data: audio, filename: "clip.webm", contentType },
      model: s.SARVAM_STT_MODEL as "saaras:v4",
      mode: "codemix",
      language_code: "hi-IN",
      keyterms: KEYTERMS,
    }), 10_000, "Speech-to-text");
    return res.transcript;
  };
}
