import { SarvamAIClient } from "sarvamai";
import type { Settings } from "../../config/settings.js";
import { HINDI, LANGUAGES, nextLanguage, trustDetection } from "./languages.js";
import { withTimeout } from "./timeout.js";

// Words the model should expect from a shopkeeper talking about Paytm.
const KEYTERMS = ["Paytm", "Soundbox", "settlement", "fee", "GST", "ticket", "plan", "rent", "payment", "battery", "UPI", "QR"];

// A lone keyterm is the model hearing its own hint in noise.
// Anything outside the conversation's scripts is noise misheard, never speech.
export const heardClearly = (text: string, language = HINDI) => {
  const own = LANGUAGES[language]?.script;
  const scripts = `\\p{Script=Devanagari}\\p{Script=Latin}${own ? `\\p{Script=${own}}` : ""}`;
  return !KEYTERMS.some((k) => k.toLowerCase() === text.replace(/[\p{P}\s]/gu, "").toLowerCase())
    && new RegExp(`[${scripts}]`, "u").test(text)
    && !new RegExp(`[^${scripts}\\p{N}\\p{P}\\p{S}\\p{Z}\\p{M}]`, "u").test(text);
};

const MIN_CLIP_BYTES = 1500;

export function makeStt(s: Settings) {
  const sarvam = new SarvamAIClient({ apiSubscriptionKey: s.SARVAM_API_KEY });
  const transcribe = (audio: Buffer, contentType: string, language: "unknown" | "hi-IN") => withTimeout(sarvam.speechToText.transcribe({
    file: { data: audio, filename: contentType.includes("mp4") ? "clip.m4a" : "clip.webm", contentType },
    model: s.SARVAM_STT_MODEL as "saaras:v4",
    mode: "codemix",
    language_code: language,
    keyterms: KEYTERMS,
  }), 10_000, "Speech-to-text");

  return async (audio: Buffer, contentType: string, current: string) => {
    // An accidental double tap sends a clip too short to read. That means "didn't hear", not a failed call.
    if (audio.length < MIN_CLIP_BYTES) return { text: "", language: current };
    const res = await transcribe(audio, contentType, "unknown").catch((err: { statusCode?: number }) => {
      if (err.statusCode === 400) return null;
      throw err;
    });
    if (!res) return { text: "", language: current };
    const detected = res.language_code ?? current;
    if (!res.transcript.trim()) return { text: "", language: current };
    if (trustDetection(res.transcript, detected, res.language_probability, current)) {
      return { text: res.transcript, language: nextLanguage(res.transcript, detected, current) };
    }
    const again = await transcribe(audio, contentType, current as "hi-IN");
    return { text: again.transcript, language: current };
  };
}
