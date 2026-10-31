import { PLAYBOOK } from "../../config/playbook.js";
import type { ReasonCode } from "./reasons.js";
import { sampleBeta, type Rng } from "../sim/rng.js";

export const MIN_EXPLORATION = 0.1;
const SHRINK = 10; // how many problem-level results a segment's prior counts for

export interface Tally {
  kept: number;
  lost: number;
}
export type Stats = Map<string, Tally>;

const key = (problem: string, approach: string, segment = "*") => `${problem}|${approach}|${segment}`;

export function addResult(stats: Stats, problem: string, approach: string, segment: string, kept: boolean, n = 1) {
  for (const k of [key(problem, approach), key(problem, approach, segment)]) {
    const t = stats.get(k) ?? { kept: 0, lost: 0 };
    if (kept) t.kept += n;
    else t.lost += n;
    stats.set(k, t);
  }
}

// Share of traffic for each approach: how often it wins a Thompson draw, floored at 10%.
// With a score, each draw is judged in rupees rather than in shops kept.
export type Score = (approachId: string, keep: number) => number;

export function keepEstimate(stats: Stats, problem: string, approach: string) {
  const t = stats.get(key(problem, approach));
  return t && t.kept + t.lost > 0 ? t.kept / (t.kept + t.lost) : null;
}

export function allocation(stats: Stats, problem: ReasonCode, segment: string, rng: Rng, score?: Score, draws = 300) {
  const approaches = PLAYBOOK[problem] ?? [];
  const wins = new Array<number>(approaches.length).fill(0);
  const params = approaches.map((a) => {
    const all = stats.get(key(problem, a.id)) ?? { kept: 0, lost: 0 };
    const seg = stats.get(key(problem, a.id, segment)) ?? { kept: 0, lost: 0 };
    const p = (all.kept + 1) / (all.kept + all.lost + 2);
    return [1 + SHRINK * p + seg.kept, 1 + SHRINK * (1 - p) + seg.lost] as const;
  });
  for (let i = 0; i < draws; i++) {
    let best = 0;
    let bestValue = -Infinity;
    params.forEach(([a, b], j) => {
      const keep = sampleBeta(a, b, rng);
      const v = score ? score(approaches[j]!.id, keep) : keep;
      if (v > bestValue) {
        bestValue = v;
        best = j;
      }
    });
    wins[best]!++;
  }
  const floor = Math.min(MIN_EXPLORATION, 1 / approaches.length);
  const spare = 1 - floor * approaches.length;
  return approaches.map((a, j) => ({ approachId: a.id, share: floor + (spare * wins[j]!) / draws }));
}

export function chooseApproach(stats: Stats, problem: ReasonCode, segment: string, rng: Rng, score?: Score) {
  const shares = allocation(stats, problem, segment, rng, score);
  let r = rng();
  for (const s of shares) {
    r -= s.share;
    if (r <= 0) return { ...s, shares };
  }
  return { ...shares[shares.length - 1]!, shares };
}
