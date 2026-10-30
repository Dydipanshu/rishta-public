export const LEARNED_MIN_N = 15;
export const LEARNED_MIN_GAP = 0.15;
export const LOW_VALUE_MONTHLY_INR = 3000;
export const RECENT_CONTACT_DAYS = 7;

export interface HistoryRow {
  segment: string;
  arm: "contacted" | "holdout";
  kept: number;
  n?: number;
}

export interface SegmentCheck {
  segment: string;
  contactedKeep: number;
  holdoutKeep: number;
  contactedN: number;
  holdoutN: number;
  z: number;
  skip: boolean;
}

// A segment is skipped only with enough holdout data and a clear harm from contact.
export function learnedSkips(rows: HistoryRow[]): SegmentCheck[] {
  const bySegment = new Map<string, { cK: number; cN: number; hK: number; hN: number }>();
  for (const r of rows) {
    const s = bySegment.get(r.segment) ?? { cK: 0, cN: 0, hK: 0, hN: 0 };
    const n = r.n ?? 1;
    if (r.arm === "contacted") {
      s.cK += r.kept * n;
      s.cN += n;
    } else {
      s.hK += r.kept * n;
      s.hN += n;
    }
    bySegment.set(r.segment, s);
  }
  return [...bySegment.entries()].map(([segment, s]) => {
    const pc = s.cK / Math.max(1, s.cN);
    const ph = s.hK / Math.max(1, s.hN);
    const pool = (s.cK + s.hK) / Math.max(1, s.cN + s.hN);
    const se = Math.sqrt(pool * (1 - pool) * (1 / Math.max(1, s.cN) + 1 / Math.max(1, s.hN))) || 1;
    const z = (pc - ph) / se;
    const skip = s.cN >= LEARNED_MIN_N && s.hN >= LEARNED_MIN_N && ph - pc >= LEARNED_MIN_GAP && z <= -2.5;
    return { segment, contactedKeep: pc, holdoutKeep: ph, contactedN: s.cN, holdoutN: s.hN, z, skip };
  });
}

export interface RuleInput {
  optedOut: boolean;
  consentMessages: boolean;
  consentProfiling: boolean;
  lastContactDay: number | null;
  monthlyCollections: number;
}

export function ruleSkips(m: RuleInput, today: number): string[] {
  const out: string[] = [];
  if (m.optedOut) out.push("Opted out of outreach");
  if (!m.consentMessages || !m.consentProfiling) out.push("Consent missing");
  if (m.lastContactDay !== null && today - m.lastContactDay < RECENT_CONTACT_DAYS) {
    out.push(`Contacted ${today - m.lastContactDay} days ago`);
  }
  if (m.monthlyCollections < LOW_VALUE_MONTHLY_INR) out.push("Very low value this month");
  return out;
}
