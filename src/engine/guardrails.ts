import type { Merchant } from "../sim/types.js";

const QUIET_START_HOUR = 9;
const QUIET_END_HOUR = 19;

export function withinContactHours(now: Date) {
  const hour = Number(new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", hour12: false }).format(now));
  return hour >= QUIET_START_HOUR && hour < QUIET_END_HOUR;
}

// Re-checked at send time: the morning's plan may be out of date by then.
export function outreachBlock(m: Merchant, now: Date, enforceHours: boolean): string | null {
  if (m.optedOut) return "Merchant opted out";
  if (!m.consentMessages) return "Message consent missing";
  if (enforceHours && !withinContactHours(now)) return "Outside contact hours (9am to 7pm IST)";
  return null;
}
