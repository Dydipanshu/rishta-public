// Hindi and English only for now. Add a language here (name, script, Sarvam voice) to switch it on.
export const LANGUAGES: Record<string, { name: string; script: string; voice: string }> = {};

export const HINDI = "hi-IN";
const MIN_CONFIDENCE = 0.85;

const inScript = (text: string, script: string) => new RegExp(`\\p{Script=${script}}`, "u").test(text);
const words = (text: string) => text.trim().split(/\s+/).length;

// Typed text has no detector, but its script gives the language away.
export function languageOfText(text: string, current: string) {
  const found = Object.entries(LANGUAGES).find(([, l]) => l.script !== "Devanagari" && inScript(text, l.script));
  if (found) return found[0];
  return inScript(text, "Devanagari") && current !== "mr-IN" ? HINDI : current;
}

// Fixed lines follow the merchant: full English gets English, a stray word doesn't.
const ROMAN_HINDI = /\b(mera|mere|meri|ke|ka|ki|mein|baare|batao|bataiye|kitna|kaise|abhi|hoon|hun|mujhe|paise|paisa|kya|kyu|kyun|hai|hain|nahi|nahin|kaat|kat|rahe|raha|aap|aapka|kar|karo|dukan|dukaan|band|zyada|kam|haan|theek|thik|chahiye|bhai|ji)\b/i;
export const isEnglish = (text: string) => /^[\x00-\x7F₹]+$/.test(text) && words(text) >= 3 && !ROMAN_HINDI.test(text);

// Noisy Hindi can be misread as another language, so a switch needs a confident, full phrase in the right script.
export function trustDetection(text: string, language: string, confidence: number | undefined, current: string) {
  const known = LANGUAGES[language];
  // Anything else is noisy Hindi misheard, so the audio is read again in the current language.
  if (!known) return language === HINDI || language === "en-IN";
  if (!inScript(text, known.script)) return false;
  return language === current || ((confidence ?? 0) >= MIN_CONFIDENCE && words(text) >= 2);
}

// Short English like "settlement" doesn't end a Tamil conversation.
export function nextLanguage(text: string, language: string, current: string) {
  if (LANGUAGES[language]) return language;
  if (language === "en-IN" && LANGUAGES[current] && words(text) < 3) return current;
  return HINDI;
}
