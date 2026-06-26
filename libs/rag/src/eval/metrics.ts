/**
 * Retrieval-quality metrics over per-query relevance judgments.
 *
 * Each query contributes a `relevant: boolean[]` ordered by retrieval rank
 * (index 0 = top hit) plus `totalRelevant`, the number of gold items that
 * exist for that query (the recall denominator).
 */
export interface RankedRelevance {
  relevant: boolean[];
  totalRelevant: number;
}

export function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

/** Fraction of gold items found within the top-k (capped at 1 per query). */
export function recallAtK(r: RankedRelevance, k: number): number {
  if (r.totalRelevant <= 0) return 0;
  const hits = r.relevant.slice(0, k).filter(Boolean).length;
  return Math.min(hits, r.totalRelevant) / r.totalRelevant;
}

/** Reciprocal of the rank (1-based) of the first relevant item; 0 if none. */
export function reciprocalRank(relevant: boolean[]): number {
  const idx = relevant.findIndex(Boolean);
  return idx === -1 ? 0 : 1 / (idx + 1);
}

export function meanReciprocalRank(perQuery: boolean[][]): number {
  return mean(perQuery.map(reciprocalRank));
}

/** Precision within the top-k: relevant fraction of the retrieved window. */
export function contextPrecisionAtK(relevant: boolean[], k: number): number {
  const window = relevant.slice(0, k);
  return window.length === 0 ? 0 : window.filter(Boolean).length / window.length;
}

export interface EvalMetrics {
  recallAt5: number;
  mrr: number;
  contextPrecision: number;
  faithfulness?: number;
}

/** Aggregate per-query judgments into the headline metrics. */
export function aggregate(perQuery: RankedRelevance[], k = 5): EvalMetrics {
  return {
    recallAt5: mean(perQuery.map((q) => recallAtK(q, k))),
    mrr: meanReciprocalRank(perQuery.map((q) => q.relevant)),
    contextPrecision: mean(perQuery.map((q) => contextPrecisionAtK(q.relevant, k))),
  };
}
