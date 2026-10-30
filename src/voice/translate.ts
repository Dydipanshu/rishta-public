import { SarvamAIClient } from "sarvamai";
import type { Settings } from "../../config/settings.js";
import { numbersIn } from "../agent/guard.js";
import { LANGUAGES } from "./languages.js";
import { withTimeout } from "./timeout.js";

const sameNumbers = (a: string, b: string) => {
  const x = new Set(numbersIn(a)), y = new Set(numbersIn(b));
  return x.size === y.size && [...x].every((n) => y.has(n));
};

// Runs after the guard. A line that can't be translated faithfully stays in Hindi.
export function makeTranslate(s: Settings) {
  const sarvam = new SarvamAIClient({ apiSubscriptionKey: s.SARVAM_API_KEY });
  return async (hindi: string, language: string) => {
    try {
      const res = await withTimeout(sarvam.text.translate({
        input: hindi,
        source_language_code: "hi-IN",
        target_language_code: language as "kn-IN",
        model: s.SARVAM_TRANSLATE_MODEL as "mayura:v1",
        mode: "modern-colloquial",
        numerals_format: "international",
        speaker_gender: LANGUAGES[language]!.gender,
      }), 6000, "Translation");
      return sameNumbers(hindi, res.translated_text) ? res.translated_text : hindi;
    } catch {
      return hindi;
    }
  };
}
