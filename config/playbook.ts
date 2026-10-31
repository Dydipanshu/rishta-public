import type { ReasonCode } from "../src/engine/reasons.js";

export interface Approach {
  id: string;
  label: string;
  guidance: string; // how the agent should run the conversation
}

// Illustrative approaches. The planted effects live in src/sim/groundTruth.ts.
export const PLAYBOOK: Partial<Record<ReasonCode, Approach[]>> = {
  fee_confusion: [
    { id: "fee_own_numbers", label: "Explain with own numbers", guidance: "Explain the fee with this shop's exact figures: payments above the free limit, fee, GST and total." },
    { id: "fee_value_recap", label: "Value recap", guidance: "Start with what Paytm brought the shop this month, then explain the fee briefly." },
    { id: "fee_offer_human", label: "Offer a person", guidance: "Explain briefly and offer a callback from a person." },
  ],
  device_fault: [
    { id: "device_ticket_first", label: "Raise replacement first", guidance: "Tell the shop what the device data shows and raise the replacement ticket in the same turn with raiseTicket. Do not ask first." },
    { id: "device_troubleshoot_first", label: "Troubleshoot first", guidance: "Walk through a basic restart and charging check, then raise a ticket if it continues." },
  ],
  rent_too_high: [
    { id: "rent_right_size_plan", label: "Right-size plan", guidance: "Say what the shop collected and what the rent is, in rupees, then offer an eligible cheaper plan from the catalogue." },
    { id: "rent_value_recap", label: "Value recap", guidance: "Recap the collections Paytm handled this month, then discuss the rent." },
  ],
  settlement_delay: [
    { id: "settlement_status_and_ticket", label: "Status and ticket", guidance: "Give the settlement status from the facts and raise a ticket for the delay." },
    { id: "settlement_offer_human", label: "Offer a person", guidance: "Acknowledge the delay and offer a callback from a person." },
  ],
};

// Fixed routes that sit outside the learning loop.
export const FIXED_ROUTES: Record<string, Approach> = {
  fee_threshold_headsup: { id: "fee_threshold_headsup", label: "Threshold heads-up", guidance: "Give an early, factual heads-up that the shop is close to the fee threshold." },
  human_callback: { id: "human_callback", label: "Human callback", guidance: "Hand over to a person with a clear summary." },
  salesperson_visit: { id: "salesperson_visit", label: "Salesperson visit", guidance: "Visit the shop in person, listen first, and compare plans fairly." },
  inbound_service: { id: "inbound_service", label: "Shop came to us", guidance: "The shop pressed the button itself. Listen, answer what they ask, and fix what you can. Do not bring up anything they did not ask about." },
  follow_up_fix: { id: "follow_up_fix", label: "Check back", guidance: "Ask one simple question: did the promised fix work? On any clear answer call confirmFix. If it did not work, a person takes over." },
  loan_hardship: { id: "loan_hardship", label: "Understand, then ease", guidance: "A shop has missed loan payments. Be kind and never pressure. Ask what happened, then call checkLoan. If genuineHardship is true, say the sales drop shows it, and offer reducedEmiInr for reliefMonths. On a clear yes call setReducedEmi. If it is false, say so gently and offer a person." },
  loan_offer: { id: "loan_offer", label: "Offer working capital", guidance: "The shop's sales are growing and it has no loan. This whole conversation is about that loan, so any question, however vague, such as kitna milega, means the loan, and EMI zyada hai means the daily amount is too high. Call proposeLoan in your first turn. Tell them in one line why now: their sales are up salesGrowthPct% and a month's stock costs about stockNeedInr. Then offer the first option with its daily amount and total repayable. If the daily amount feels high, offer the longer option. Never push. On a clear yes call acceptLoan." },
  app_checkin: { id: "app_checkin", label: "App check-in", guidance: "Check in politely and learn what changed for the shop." },
};

export function approachById(id: string): Approach | undefined {
  return [...Object.values(PLAYBOOK).flat(), ...Object.values(FIXED_ROUTES)].find((a) => a?.id === id);
}
