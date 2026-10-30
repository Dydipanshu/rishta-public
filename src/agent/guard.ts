// Checks every sentence before it can reach the merchant.

const DIGIT_MAP: Record<string, string> = { "०": "0", "१": "1", "२": "2", "३": "3", "४": "4", "५": "5", "६": "6", "७": "7", "८": "8", "९": "9" };

export const normaliseDigits = (s: string) => s.replace(/[०-९]/g, (d) => DIGIT_MAP[d]!);

const numberKey = (raw: string) => String(Number(raw.replace(/,/g, "")));

export function numbersIn(text: string): string[] {
  return [...normaliseDigits(text).matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => numberKey(m[0].replace(/,$/, "")));
}

// Collects every number from facts and tool results.
export function collectNumbers(value: unknown, into: Set<string>) {
  if (typeof value === "number") into.add(String(value));
  else if (typeof value === "string") for (const n of numbersIn(value)) into.add(n);
  else if (Array.isArray(value)) value.forEach((v) => collectNumbers(v, into));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => collectNumbers(v, into));
}

// Number words the model must write as digits. "ek" and "do" are left out: they are common non-numeric words.
const NUMBER_WORDS = /(?:^|[\s,])(तीन|चार|पाँच|पांच|छह|सात|आठ|नौ|दस|बीस|तीस|चालीस|पचास|सौ|हज़ार|हजार|लाख|करोड़|teen|chaar|char|paanch|panch|saat|aath|hazaar|hazar|lakh|crore)(?=[\s,।.?!]|$)/i;

const SECRET = /\b(otp|pin|password|cvv)\b|ओटीपी|पिन|पासवर्ड|bank details|बैंक डिटेल|account number|खाता नंबर|card number|कार्ड नंबर/i;
const NEGATED = /nahi|nahin|नहीं|never|kabhi|कभी|mat|मत|don'?t|do not/i;
const LINK = /https?:|www\.|\.com\b|\.in\b|bit\.ly/i;
const SPLITTING = /(split|बाँट|बांट|baant|tod\s*kar|तोड़\s*कर|अलग[- ]अलग\s*payment|chhote\s*payment|छोटे\s*payment|दूसरे\s*account|doosre\s*account)/i;
const SURCHARGE = /(customer|grahak|ग्राहक).{0,30}(extra|zyada charge|ज़्यादा charge|अतिरिक्त|surcharge)|surcharge/i;
const FISHING = /(kaunsi|kaun si|कौन सी|कौन-सी|which).{0,20}(company|कंपनी|rival|competitor)|competitor/i;

export type GuardResult = { ok: true } | { ok: false; kind: "number" | "forbidden"; reason: string };

export function checkSentence(sentence: string, allowed: Set<string>): GuardResult {
  if (LINK.test(sentence)) return { ok: false, kind: "forbidden", reason: "link" };
  if (SPLITTING.test(sentence)) return { ok: false, kind: "forbidden", reason: "splitting advice" };
  if (SURCHARGE.test(sentence) && !NEGATED.test(sentence)) return { ok: false, kind: "forbidden", reason: "surcharge" };
  if (FISHING.test(sentence)) return { ok: false, kind: "forbidden", reason: "asked about a competitor" };
  if (SECRET.test(sentence) && !NEGATED.test(sentence)) return { ok: false, kind: "forbidden", reason: "asked for a secret" };
  const word = sentence.match(NUMBER_WORDS);
  if (word) return { ok: false, kind: "number", reason: `number word "${word[1]}"` };
  for (const n of numbersIn(sentence)) {
    if (!allowed.has(n)) return { ok: false, kind: "number", reason: `unverified number ${n}` };
  }
  return { ok: true };
}

const LONG_CHUNK = 45;

// Pulls finished chunks off the buffer. Never cuts inside "₹6.84" or "₹9,500".
export function takeChunks(buffer: string, flush = false): { chunks: string[]; rest: string } {
  const chunks: string[] = [];
  let rest = buffer;
  for (;;) {
    const hard = rest.match(/^[\s\S]*?(?:[।?!](?=\s|$)|\.(?=\s))/);
    if (hard && (flush || hard[0].length < rest.length)) {
      chunks.push(hard[0].trim());
      rest = rest.slice(hard[0].length);
      continue;
    }
    const soft = rest.match(/^[\s\S]*?,(?=\s)/);
    if (soft && soft[0].length >= LONG_CHUNK && !/[.,]\d*$/.test(soft[0].slice(0, -1))) {
      chunks.push(soft[0].trim());
      rest = rest.slice(soft[0].length);
      continue;
    }
    break;
  }
  if (flush && rest.trim()) {
    chunks.push(rest.trim());
    rest = "";
  }
  return { chunks: chunks.filter(Boolean), rest };
}
