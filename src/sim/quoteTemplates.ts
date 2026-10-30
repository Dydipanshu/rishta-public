import type { ReasonCode } from "../engine/reasons.js";

// Seeded past quotes for history, so no LLM cost. All are simulated.
export const QUOTES: Partial<Record<ReasonCode, string[]>> = {
  fee_confusion: [
    "settlement mein paise kam kyun aaye samajh nahi aaya",
    "yeh naya charge kya hai bhaiya",
    "pehle to poora paisa aata tha",
    "fee kab se lagne laga",
  ],
  settlement_delay: [
    "kal ka paisa abhi tak nahi aaya",
    "settlement roz late ho raha hai",
    "supplier ko paisa dena hai aur settlement atka hua hai",
  ],
  device_fault: [
    "machine baar baar band ho jaati hai",
    "awaaz nahi aati payment ki",
    "charge hi nahi hota yeh box",
  ],
  rent_too_high: [
    "itni kam sale mein rent zyada lagta hai",
    "mahine ka rent bhaari pad raha hai",
    "dukaan chhoti hai, rent kam karo",
  ],
  rival_offer: [
    "doosri company wala sasta box de raha hai",
    "pados mein sabne naya box le liya, rent aadha hai",
    "unka aadmi aaya tha, kam rent bol raha tha",
  ],
  low_sales_season: ["aajkal grahak hi kam hain", "season thanda chal raha hai"],
  support_unresolved: ["teen baar complaint ki, koi jawab nahi", "ticket khula hi pada hai"],
};
