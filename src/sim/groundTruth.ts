import type { ReasonCode } from "../engine/reasons.js";

// The "known answers" of the test bench. The engine never reads this file.
export const FIX_PROBABILITY: Record<string, Partial<Record<ReasonCode, number>>> = {
  fee_own_numbers: { fee_confusion: 0.7 },
  fee_value_recap: { fee_confusion: 0.2 },
  fee_offer_human: { fee_confusion: 0.35 },
  device_ticket_first: { device_fault: 0.7 },
  device_troubleshoot_first: { device_fault: 0.35 },
  rent_right_size_plan: { rent_too_high: 0.7 },
  rent_value_recap: { rent_too_high: 0.2 },
  settlement_status_and_ticket: { settlement_delay: 0.65 },
  settlement_offer_human: { settlement_delay: 0.3 },
};

export const BACKFIRE_SEGMENT = "T2-fresh";
