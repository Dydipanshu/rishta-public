import { describe, expect, it } from "vitest";
import { hindiNumber, speakable } from "../src/voice/speakNumbers.js";
import { checkSentence, collectNumbers, numbersIn, takeChunks } from "../src/agent/guard.js";

const allowed = new Set<string>();
collectNumbers({ fee: 38, gst: 6.84, total: 44.84, above: 9500, free: 2000 }, allowed);

describe("number guard", () => {
  it("reads money forms", () => expect(numbersIn("₹9,500 और ₹6.84, फिर ३८")).toEqual(["9500", "6.84", "38"]));
  it("allows grounded figures", () => expect(checkSentence("आपका fee ₹38 और GST ₹6.84 है।", allowed).ok).toBe(true));
  it("blocks invented figures", () => expect(checkSentence("आपका fee ₹40 है।", allowed).ok).toBe(false));
  it("blocks number words", () => expect(checkSentence("आपके चार payments थे।", allowed).ok).toBe(false));
  it("does not trip on the word do", () => expect(checkSentence("kripya do minute dijiye", allowed).ok).toBe(true));
});

describe("forbidden content", () => {
  it("allows the safety line", () => expect(checkSentence("Paytm कभी OTP या PIN नहीं माँगता।", allowed).ok).toBe(true));
  it("blocks asking for OTP", () => expect(checkSentence("कृपया अपना OTP बताइए।", allowed).ok).toBe(false));
  it("blocks links", () => expect(checkSentence("यहाँ देखिए https://paytm.com", allowed).ok).toBe(false));
  it("blocks surcharging", () => expect(checkSentence("आप customer से extra ले लीजिए।", allowed).ok).toBe(false));
});

describe("sentence cutter", () => {
  it("never cuts inside a decimal", () => {
    expect(takeChunks("fee ₹38 और GST ₹6.").chunks).toEqual([]);
    expect(takeChunks("GST ₹6.84 है। अब", false)).toEqual({ chunks: ["GST ₹6.84 है।"], rest: " अब" });
  });
  it("never cuts inside a grouped number", () => {
    const text = "आपके settlement में चार payments जिनका कुल ₹9,500 था और fee भी लगी, इसलिए अब";
    expect(takeChunks(text).chunks[0]).toContain("₹9,500");
  });
  it("flushes the tail", () => expect(takeChunks("धन्यवाद जी", true).chunks).toEqual(["धन्यवाद जी"]));
});

describe("speaking numbers", () => {
  it("reads money the Hindi way", () => {
    expect(speakable("कुल ₹44.84 कटे।")).toBe("कुल चौवालीस रुपये चौरासी पैसे कटे।");
    expect(speakable("₹9,500 और ₹38")).toBe("नौ हज़ार पाँच सौ रुपये और अड़तीस रुपये");
    expect(speakable("4 payments")).toBe("चार payments");
  });
  it("reads lakhs", () => expect(hindiNumber(140000)).toBe("एक लाख चालीस हज़ार"));
  it("keeps English as it is", () => expect(speakable("Your fee was ₹38.")).toBe("Your fee was ₹38."));
});
