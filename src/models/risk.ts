import { MODEL_FEATURES, type Features } from "../features/buildFeatures.js";

export interface RiskModel {
  keys: string[];
  mean: number[];
  std: number[];
  weights: number[];
  bias: number;
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const toRow = (f: Features) => MODEL_FEATURES.map((m) => m.get(f));

export function trainRisk(rows: { f: Features; y: number }[], epochs = 500, lr = 0.5, l2 = 1e-3): RiskModel {
  const X = rows.map((r) => toRow(r.f));
  const n = X.length;
  const k = MODEL_FEATURES.length;
  const mean = Array.from({ length: k }, (_, j) => X.reduce((s, x) => s + x[j]!, 0) / n);
  const std = Array.from({ length: k }, (_, j) => Math.sqrt(X.reduce((s, x) => s + (x[j]! - mean[j]!) ** 2, 0) / n) || 1);
  const Z = X.map((x) => x.map((v, j) => (v - mean[j]!) / std[j]!));
  const weights = new Array<number>(k).fill(0);
  let bias = 0;
  for (let e = 0; e < epochs; e++) {
    const grad = new Array<number>(k).fill(0);
    let gradBias = 0;
    for (let i = 0; i < n; i++) {
      const z = Z[i]!;
      let dot = bias;
      for (let j = 0; j < k; j++) dot += weights[j]! * z[j]!;
      const err = sigmoid(dot) - rows[i]!.y;
      gradBias += err;
      for (let j = 0; j < k; j++) grad[j]! += err * z[j]!;
    }
    bias -= (lr * gradBias) / n;
    for (let j = 0; j < k; j++) weights[j]! -= lr * (grad[j]! / n + l2 * weights[j]!);
  }
  return { keys: MODEL_FEATURES.map((m) => m.key), mean, std, weights, bias };
}

export function scoreRisk(model: RiskModel, f: Features) {
  const row = toRow(f);
  const contributions = row.map((v, j) => model.weights[j]! * ((v - model.mean[j]!) / model.std[j]!));
  const score = sigmoid(model.bias + contributions.reduce((a, b) => a + b, 0));
  const reasons = contributions
    .map((c, j) => ({ c, text: MODEL_FEATURES[j]!.say(f) }))
    .filter((r) => r.c > 0.2)
    .sort((a, b) => b.c - a.c)
    .slice(0, 3)
    .map((r) => r.text);
  return { score, reasons };
}

// Precision-recall area and lift in the top 10%.
export function evaluate(scored: { s: number; y: number }[]) {
  const sorted = [...scored].sort((a, b) => b.s - a.s);
  const positives = sorted.reduce((a, r) => a + r.y, 0);
  let tp = 0;
  let prAuc = 0;
  sorted.forEach((r, i) => {
    if (r.y) {
      tp++;
      prAuc += tp / (i + 1) / positives;
    }
  });
  const top = sorted.slice(0, Math.ceil(sorted.length * 0.1));
  const lift = top.reduce((a, r) => a + r.y, 0) / top.length / (positives / sorted.length);
  return { prAuc, lift, baseRate: positives / sorted.length };
}
