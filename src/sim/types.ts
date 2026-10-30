import type { ReasonCode } from "../engine/reasons.js";

export interface Ticket {
  id: string;
  type: "settlement" | "rent" | "device" | "fee";
  openedDay: number;
  closedDay: number | null;
  note: string;
}

export interface DayRow {
  count: number;
  value: number;
  countAbove: number;
  valueAbove: number;
  failed: number;
  uniquePayers: number;
  repeatShare: number;
  offlineHours: number;
  batteryAlerts: number;
  errors: number;
  delayHours: number;
  fee: number;
  gst: number;
}

export interface Merchant {
  id: string;
  name: string;
  firstName: string;
  city: string;
  cityTier: 1 | 2 | 3;
  category: string;
  categoryGroup: string;
  language: string;
  deviceType: string;
  planId: string;
  monthlyRent: number;
  onboardDay: number;
  feeCategory: "P2PM" | "P2M";
  consentProfiling: boolean;
  consentMessages: boolean;
  optedOut: boolean;
  holdout: boolean;
  isDemo: boolean;
  days: DayRow[];
  tickets: Ticket[];
  lastContactDay: number | null;
  // Ground truth, kept for evaluation only.
  trueCause: ReasonCode | "none";
  causeOnset: number;
  churnDay: number | null;
}

export const segmentOf = (m: Pick<Merchant, "cityTier" | "categoryGroup">) => `T${m.cityTier}-${m.categoryGroup}`;

export const SIM_DAYS = 180;
export const TODAY = SIM_DAYS - 1;
export const FEE_START_DAY = 40;
export const OUTREACH_START_DAY = 70;
export const KEEP_WINDOW_DAYS = 30;
