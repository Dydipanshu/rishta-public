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
const HINDI_NUMBERS = "तीन चार पाँच पांच छह सात आठ नौ दस ग्यारह बारह तेरह चौदह पंद्रह सोलह सत्रह अठारह उन्नीस बीस इक्कीस बाईस तेईस चौबीस पच्चीस छब्बीस सत्ताईस अट्ठाईस उनतीस तीस इकतीस बत्तीस तैंतीस चौंतीस पैंतीस छत्तीस सैंतीस अड़तीस उनतालीस चालीस इकतालीस बयालीस तैंतालीस चौवालीस चवालीस पैंतालीस छियालीस सैंतालीस अड़तालीस उनचास पचास साठ सत्तर अस्सी नब्बे निन्यानवे सौ हज़ार हजार लाख करोड़ डेढ़ ढाई";
const ROMAN_NUMBERS = "teen chaar char paanch panch saat aath das bees tees chalis pachas sau hazaar hazar lakh crore";
const ENGLISH_NUMBERS = "two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand lakh crore";
const NUMBER_WORDS = new RegExp(`(?:^|[\\s,])(${[HINDI_NUMBERS, ROMAN_NUMBERS, ENGLISH_NUMBERS].join(" ").split(" ").join("|")})(?=[\\s,।.?!-]|$)`, "i");

const SECRET = /\b(otp|pin|password|cvv)\b|ओटीपी|पिन|पासवर्ड|bank details|बैंक डिटेल|account number|खाता नंबर|card number|कार्ड नंबर/i;
const NEGATED = /nahi|nahin|नहीं|never|kabhi|कभी|mat|मत|don'?t|do not/i;
const LINK = /https?:|www\.|\.com\b|\.in\b|bit\.ly/i;
const SPLITTING = /(split|बाँट|बांट|baant|tod\s*kar|तोड़\s*कर|अलग[- ]अलग\s*payment|chhote\s*payment|छोटे\s*payment|दूसरे\s*account|doosre\s*account)/i;
const SURCHARGE = /(customer|grahak|ग्राहक).{0,30}(extra|zyada charge|ज़्यादा charge|अतिरिक्त|surcharge)|surcharge/i;
const FISHING = /(kaunsi|kaun si|कौन सी|कौन-सी|which).{0,20}(company|कंपनी|rival|competitor)|competitor/i;

// The model may not commit Paytm to anything. Only code confirms real actions.
const PROMISE = /(refund|रिफंड|पैसे वापस).{0,30}(मिल जाएगा|मिलेगा|आ जाएगा|आएगा|हो जाएगा|कर दूँगी|कर देती|कर दिया|will|done)|(fee|शुल्क).{0,20}(माफ़|माफ|waive)|(माफ़|waive).{0,20}(fee|शुल्क)|fee\s*(नहीं|बंद).{0,12}(लगेगी|कटेगी|होगी)|पक्का|गारंटी|guarantee|कल तक|आज ही/i;
const REFUSED = /(refund|रिफंड|माफ़|waive).{0,30}(नहीं|cannot|can't|not)/i;

const MONEY = "₹\\s?(\\d[\\d,]*(?:\\.\\d+)?)";
// "fee ₹2,000 से ऊपर" names the limit, not the amount.
const LIMIT = "(?![\\d,.]|\\s*(?:से|तक|के\\s*ऊपर|above|up\\s*to|or\\s*less))";
const FEE_CLAIM = new RegExp(`\\bfee\\s*(?:है|थी|थे|:|of|is|was)?\\s*${MONEY}${LIMIT}|${MONEY}\\s*(?:का|की|के)?\\s*fee\\b`, "gi");
const GST_CLAIM = new RegExp(`\\bGST\\s*(?:है|थी|:|of|is|was)?\\s*${MONEY}|${MONEY}\\s*(?:का|की|के)?\\s*GST\\b`, "gi");
const CUT_CLAIM = new RegExp(`${MONEY}\\s*(?:रुपये\\s*)?(?:कटे|कट गए|कटा|कटी|deducted|were cut|was cut)`, "gi");

const key = (raw: string | undefined) => numberKey((raw ?? "").replace(/,$/, ""));

// A real number in the wrong place is still wrong: the fee must be the fee.
export function wrongLabel(sentence: string, facts: Record<string, unknown>): string | null {
  const known = (...keys: string[]) => keys.filter((k) => facts[k] !== undefined).map((k) => String(facts[k]));
  const test = (re: RegExp, keys: string[], label: string) => {
    const ok = known(...keys);
    if (ok.length === 0) return null;
    for (const m of normaliseDigits(sentence).matchAll(re)) {
      const n = key(m[1] ?? m[2]);
      if (!ok.includes(n)) return `${n} is not the ${label}`;
    }
    return null;
  };
  return test(FEE_CLAIM, ["feeInr", "feePlusGstInr"], "fee") ?? test(GST_CLAIM, ["gstInr"], "GST") ?? test(CUT_CLAIM, ["feePlusGstInr", "feeInr", "gstInr", "monthlyRentInr"], "amount deducted");
}

export type GuardResult = { ok: true } | { ok: false; kind: "number" | "forbidden"; reason: string };

export function checkSentence(sentence: string, allowed: Set<string>, facts: Record<string, unknown> = {}): GuardResult {
  if (LINK.test(sentence)) return { ok: false, kind: "forbidden", reason: "link" };
  if (SPLITTING.test(sentence)) return { ok: false, kind: "forbidden", reason: "splitting advice" };
  if (SURCHARGE.test(sentence) && !NEGATED.test(sentence)) return { ok: false, kind: "forbidden", reason: "surcharge" };
  if (FISHING.test(sentence)) return { ok: false, kind: "forbidden", reason: "asked about a competitor" };
  if (SECRET.test(sentence) && !NEGATED.test(sentence)) return { ok: false, kind: "forbidden", reason: "asked for a secret" };
  if (PROMISE.test(sentence) && !REFUSED.test(sentence)) return { ok: false, kind: "forbidden", reason: "made a promise" };
  const word = sentence.match(NUMBER_WORDS);
  if (word) return { ok: false, kind: "number", reason: `number word "${word[1]}"` };
  for (const n of numbersIn(sentence)) {
    if (!allowed.has(n)) return { ok: false, kind: "number", reason: `unverified number ${n}` };
  }
  const label = wrongLabel(sentence, facts);
  if (label) return { ok: false, kind: "number", reason: label };
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
