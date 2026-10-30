// Languages Rishta can speak beyond Hindi and English. Malayalam and Odia have no bulbul:v4 voice yet.
export const LANGUAGES: Record<string, { script: string; voice: string; gender: "Male" | "Female" }> = {
  "kn-IN": { script: "Kannada", voice: "chaitra_kn_conversation", gender: "Female" },
  "ta-IN": { script: "Tamil", voice: "aravind_ta_ads", gender: "Male" },
  "te-IN": { script: "Telugu", voice: "pooja_te_conversation", gender: "Female" },
  "bn-IN": { script: "Bengali", voice: "roopa_bn_conversational", gender: "Female" },
  "gu-IN": { script: "Gujarati", voice: "pooja_gu_customer", gender: "Female" },
  "pa-IN": { script: "Gurmukhi", voice: "anand_pa_customer", gender: "Male" },
  "mr-IN": { script: "Devanagari", voice: "ishita_mr_conversational", gender: "Female" },
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
