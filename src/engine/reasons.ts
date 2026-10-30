import { z } from "zod";

export const REASON_CODES = [
  "fee_confusion",
  "settlement_delay",
  "device_fault",
  "rent_too_high",
  "rival_offer",
  "low_sales_season",
  "support_unresolved",
  "closing_business",
  "other",
  "unknown",
] as const;

export const ReasonCode = z.enum(REASON_CODES);
export type ReasonCode = z.infer<typeof ReasonCode>;

export const REASON_LABELS: Record<ReasonCode, string> = {
  fee_confusion: "Fee confusion",
  settlement_delay: "Settlement delay",
  device_fault: "Device fault",
  rent_too_high: "Rent too high",
  rival_offer: "Rival offer",
  low_sales_season: "Low sales season",
  support_unresolved: "Support unresolved",
  closing_business: "Closing business",
  other: "Other",
  unknown: "Unknown",
};

export const SUGGESTED_MOVES: Partial<Record<ReasonCode, string>> = {
  fee_confusion: "Add a fee line to the settlement SMS for shops newly paying the fee.",
  settlement_delay: "Check the settlement batch for this city with operations.",
  device_fault: "Move replacement stock to this city before the next wave of faults.",
  rent_too_high: "Offer local salespeople the right-size plan first.",
  rival_offer: "Arm local salespeople with a plan comparison this week.",
  support_unresolved: "Clear the oldest open tickets in this city first.",
};
