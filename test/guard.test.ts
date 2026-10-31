import { languageOfText, nextLanguage, trustDetection } from "../src/voice/languages.js";
import { heardClearly } from "../src/voice/stt.js";
import { sameNumbers } from "../src/voice/translate.js";
import { hideLongNumbers, routeTurn } from "../src/agent/router.js";
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
    expect(speakable("आपके 4 payments")).toBe("आपके चार payments");
  });
  it("reads lakhs", () => expect(hindiNumber(140000)).toBe("एक लाख चालीस हज़ार"));
  it("keeps English as it is", () => expect(speakable("Your fee was ₹38.")).toBe("Your fee was ₹38."));
});

describe("languages", () => {
  it("treats any other language as misheard Hindi", () => {
    expect(trustDetection("ನನ್ನ settlement", "kn-IN", 1, "hi-IN")).toBe(false);
    expect(trustDetection("सब ठीक है", "hi-IN", 1, "hi-IN")).toBe(true);
    expect(trustDetection("my settlement", "en-IN", 1, "hi-IN")).toBe(true);
  });
});

describe("router", () => {
  it("tells a question about trust from a fraud report", () => {
    expect(routeTurn("Is this a scam? How do I know you are really Paytm?")).toBe("trust");
    expect(routeTurn("मैंने OTP बता दिया और पैसे कट गए")).toBe("fraud");
    expect(routeTurn("किसी ने मेरे साथ fraud किया")).toBe("fraud");
  });
  it("sends abuse to a person, not to an opt-out", () => expect(routeTurn("तुम बेवकूफ हो, बकवास बंद करो")).toBe("human"));
  it("hears a request for a loan, and a no", () => {
    expect(routeTurn("mera loan kab milega")).toBe("loan");
    expect(routeTurn("loan नहीं चाहिए")).toBeNull();
  });
  it("removes account numbers before anyone sees them", () => {
    const text = hideLongNumbers("मेरा account 1234 5678 9012 है");
    expect(text).not.toMatch(/\d/);
    expect(routeTurn(text)).toBe("account");
    expect(hideLongNumbers("₹9,500 और 4 payments")).toBe("₹9,500 और 4 payments");
  });
});

describe("translated numbers", () => {
  it("catches lost, repeated and re-priced amounts", () => {
    expect(sameNumbers("₹38 fee", "₹38 ಶುಲ್ಕ")).toBe(true);
    expect(sameNumbers("₹38 और ₹44", "₹38")).toBe(false);
    expect(sameNumbers("₹14,250 और ₹14,205.16", "₹14,205.16 ₹14,205.16")).toBe(false);
    expect(sameNumbers("₹2,000", "£2,000")).toBe(false);
  });
});

describe("speech that was misheard", () => {
  it("accepts Hindi and Hinglish", () => {
    expect(heardClearly("सब ठीक है")).toBe(true);
    expect(heardClearly("मेरे settlement में ₹44 कम आए?")).toBe(true);
  });
  it("rejects other scripts, symbols and silence", () => {
    expect(heardClearly("ಠಾ೦")).toBe(false);
    expect(heardClearly("...")).toBe(false);
    expect(heardClearly("")).toBe(false);
    expect(heardClearly("Soundbox.")).toBe(false);
  });
});

describe("guard: what the audit found", () => {
  const facts = { feeInr: 38, gstInr: 6.84, feePlusGstInr: 44.84 };
  const allowed = new Set(["38", "6.84", "44.84", "500"]);
  it.each(["आपकी fee चौवालीस रुपये है।", "Your fee is forty four rupees.", "बस ninety rupees लगे।", "पैंतालीस रुपये कटे।"])("blocks a number written as words: %s", (line) => {
    expect(checkSentence(line, allowed, facts).ok).toBe(false);
  });
  it("blocks a real number used under the wrong label", () => {
    expect(checkSentence("आपकी fee ₹6.84 है।", allowed, facts).ok).toBe(false);
    expect(checkSentence("GST ₹38 है।", allowed, facts).ok).toBe(false);
    expect(checkSentence("₹500 कटे हैं।", allowed, facts).ok).toBe(false);
  });
  it("lets the right label through", () => {
    expect(checkSentence("जी, ₹44.84 कटे हैं: fee ₹38 और GST ₹6.84।", allowed, facts).ok).toBe(true);
  });
  it.each(["आपका refund कल तक आ जाएगा।", "आपकी fee माफ़ हो जाएगी।", "यह पक्का ठीक हो जाएगा।", "I guarantee it."])("blocks a promise: %s", (line) => {
    expect(checkSentence(line, allowed, facts).ok).toBe(false);
  });
  it("still allows saying no to a refund", () => {
    expect(checkSentence("जी, fee का refund नहीं हो सकता।", allowed, facts).ok).toBe(true);
  });
});

