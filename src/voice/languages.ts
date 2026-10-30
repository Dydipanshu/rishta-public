// Languages Rishta can speak beyond Hindi and English. Malayalam and Odia have no bulbul:v4 voice yet.
export const LANGUAGES: Record<string, { name: string; script: string; voice: string }> = {
  "kn-IN": { name: "Kannada", script: "Kannada", voice: "chaitra_kn_conversation" },
  "ta-IN": { name: "Tamil", script: "Tamil", voice: "aravind_ta_ads" },
  "te-IN": { name: "Telugu", script: "Telugu", voice: "pooja_te_conversation" },
  "bn-IN": { name: "Bengali", script: "Bengali", voice: "roopa_bn_conversational" },
  "gu-IN": { name: "Gujarati", script: "Gujarati", voice: "pooja_gu_customer" },
  "pa-IN": { name: "Punjabi", script: "Gurmukhi", voice: "anand_pa_customer" },
  "mr-IN": { name: "Marathi", script: "Devanagari", voice: "ishita_mr_conversational" },
};

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
export const isEnglish = (text: string) => /^[\x00-\x7F₹]+$/.test(text) && words(text) >= 3;

// Noisy Hindi can be misread as another language, so a switch needs a confident, full phrase in the right script.
export function trustDetection(text: string, language: string, confidence: number | undefined, current: string) {
  const known = LANGUAGES[language];
  if (!known) return true;
  if (!inScript(text, known.script)) return false;
  return language === current || ((confidence ?? 0) >= MIN_CONFIDENCE && words(text) >= 2);
}

// Short English like "settlement" doesn't end a Tamil conversation.
export function nextLanguage(text: string, language: string, current: string) {
  if (LANGUAGES[language]) return language;
  if (language === "en-IN" && LANGUAGES[current] && words(text) < 3) return current;
  return HINDI;
}
