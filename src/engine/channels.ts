import type { Features } from "../features/buildFeatures.js";
import type { Channel } from "./brief.js";
import type { ReasonCode } from "./reasons.js";

export const VISITS_PER_DAY = 9;

// Device faults go to the app because the Soundbox itself may be failing.
export function channelFor(problem: ReasonCode, f: Features, risk: number, thresholdHeadsUp: boolean): Channel {
  if (thresholdHeadsUp) return "app";
  if (problem === "support_unresolved") return "human_callback";
  if (problem === "rival_offer" || problem === "closing_business") return "salesperson_visit";
  if (problem === "device_fault" || problem === "low_sales_season") return "app";
  if (f.monthlyCollections >= 100_000 && risk >= 0.5 && problem !== "fee_confusion") return "salesperson_visit";
  return "soundbox";
}
