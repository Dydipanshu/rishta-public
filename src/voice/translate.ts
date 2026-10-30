import OpenAI from "openai";
import type { Settings } from "../../config/settings.js";
import { numbersIn } from "../agent/guard.js";
import { LANGUAGES } from "./languages.js";
import { withTimeout } from "./timeout.js";

// Every amount must survive, the same number of times, in rupees.
const moneyShape = (text: string) => JSON.stringify([numbersIn(text).sort(), text.split("₹").length]);
export const sameNumbers = (a: string, b: string) => moneyShape(a) === moneyShape(b) && !/[£$€]/.test(b);

// Sarvam's translators turned ₹ into dollars and garbled amounts, so this uses the main model.
// Runs after the guard. A line that can't be translated faithfully stays in Hindi.
export function makeTranslate(s: Settings) {
  const ai = new OpenAI({ apiKey: s.OPENAI_API_KEY, baseURL: s.OPENAI_BASE_URL });
  return async (hindi: string, language: string) => {
    try {
      const res = await withTimeout(ai.responses.create({
        model: s.OPENAI_MODEL,
        reasoning: { effort: "none" },
        instructions: `Translate this Hindi line, spoken to a shopkeeper, into everyday spoken ${LANGUAGES[language]!.name}. Keep business words like settlement, fee, GST, payment in English letters. Copy every number and ₹ sign exactly. Output only the translation.`,
        input: hindi,
      }), 8000, "Translation");
      if (sameNumbers(hindi, res.output_text)) return res.output_text;
      console.warn(JSON.stringify({ translation: "numbers changed", language }));
      return hindi;
    } catch (err) {
      console.warn(JSON.stringify({ translation: "failed", language, error: (err as Error).message }));
      return hindi;
    }
  };
}
