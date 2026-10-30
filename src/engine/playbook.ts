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

export function addResult(stats: Stats, problem: string, approach: string, segment: string, kept: boolean) {
  for (const k of [key(problem, approach), key(problem, approach, segment)]) {
    const t = stats.get(k) ?? { kept: 0, lost: 0 };
    if (kept) t.kept++;
    else t.lost++;
    stats.set(k, t);
  }
}

// Share of traffic for each approach: how often it wins a Thompson draw, floored at 10%.
export function allocation(stats: Stats, problem: ReasonCode, segment: string, rng: Rng, draws = 300) {
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
    let bestValue = -1;
    params.forEach(([a, b], j) => {
      const v = sampleBeta(a, b, rng);
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

export function chooseApproach(stats: Stats, problem: ReasonCode, segment: string, rng: Rng) {
  const shares = allocation(stats, problem, segment, rng);
  let r = rng();
  for (const s of shares) {
    r -= s.share;
    if (r <= 0) return { ...s, shares };
  }
  return { ...shares[shares.length - 1]!, shares };
}
