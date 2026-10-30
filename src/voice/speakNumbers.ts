// Turns digits into spoken Hindi after the guard has passed the sentence.
const UNDER_100 = [
  "शून्य","एक","दो","तीन","चार","पाँच","छह","सात","आठ","नौ","दस","ग्यारह","बारह","तेरह","चौदह","पंद्रह","सोलह","सत्रह","अठारह","उन्नीस",
  "बीस","इक्कीस","बाईस","तेईस","चौबीस","पच्चीस","छब्बीस","सत्ताईस","अट्ठाईस","उनतीस","तीस","इकतीस","बत्तीस","तैंतीस","चौंतीस","पैंतीस","छत्तीस","सैंतीस","अड़तीस","उनतालीस",
  "चालीस","इकतालीस","बयालीस","तैंतालीस","चौवालीस","पैंतालीस","छियालीस","सैंतालीस","अड़तालीस","उनचास","पचास","इक्यावन","बावन","तिरपन","चौवन","पचपन","छप्पन","सत्तावन","अट्ठावन","उनसठ",
  "साठ","इकसठ","बासठ","तिरसठ","चौंसठ","पैंसठ","छियासठ","सड़सठ","अड़सठ","उनहत्तर","सत्तर","इकहत्तर","बहत्तर","तिहत्तर","चौहत्तर","पचहत्तर","छिहत्तर","सतहत्तर","अठहत्तर","उनासी",
  "अस्सी","इक्यासी","बयासी","तिरासी","चौरासी","पचासी","छियासी","सत्तासी","अट्ठासी","नवासी","नब्बे","इक्यानवे","बानवे","तिरानवे","चौरानवे","पचानवे","छियानवे","सत्तानवे","अट्ठानवे","निन्यानवे",
];

export function hindiNumber(n: number): string {
  if (n < 100) return UNDER_100[n]!;
  const parts: string[] = [];
  const scales: [number, string][] = [[10_000_000, "करोड़"], [100_000, "लाख"], [1000, "हज़ार"], [100, "सौ"]];
  let rest = n;
  for (const [size, word] of scales) {
    const q = Math.floor(rest / size);
    if (q > 0) {
      parts.push(`${hindiNumber(q)} ${word}`);
      rest %= size;
    }
  }
  if (rest > 0) parts.push(UNDER_100[rest]!);
  return parts.join(" ");
}

function money(raw: string) {
  const [rupees = "0", paise] = raw.replace(/,/g, "").split(".");
  const r = `${hindiNumber(Number(rupees))} रुपये`;
  if (!paise) return r;
  const p = Number(paise.padEnd(2, "0").slice(0, 2));
  return p > 0 ? `${r} ${hindiNumber(p)} पैसे` : r;
}

function plain(raw: string) {
  const [whole = "0", frac] = raw.replace(/,/g, "").split(".");
  const w = hindiNumber(Number(whole));
  return frac ? `${w} दशमलव ${[...frac].map((d) => UNDER_100[Number(d)]).join(" ")}` : w;
}

// English sentences keep their digits: the voice reads those fine.
export function speakable(text: string): string {
  if (!/[ऀ-ॿ]/.test(text)) return text;
  return text
    .replace(/₹\s?(\d[\d,]*(?:\.\d+)?)/g, (_, n: string) => money(n))
    .replace(/(\d[\d,]*(?:\.\d+)?)\s?%/g, (_, n: string) => `${plain(n)} प्रतिशत`)
    .replace(/\d[\d,]*(?:\.\d+)?/g, (n) => plain(n));
}
