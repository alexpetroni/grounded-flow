/**
 * Reciprocal Rank Fusion (RRF).
 *
 * Combines several ranked lists into one. An item's fused score is the sum,
 * over every list it appears in, of `1 / (k + rank)` where `rank` is 1-based.
 * The constant `k` (default 60, the canonical value) damps the influence of
 * top ranks so lower-ranked agreements still matter.
 *
 * Fusion is fully deterministic: ties on score are broken by `chunkId`
 * (lexicographic), so the same inputs always yield the same ordering.
 */
export const DEFAULT_RRF_K = 60;

export interface RrfOptions {
  /** Rank-damping constant. Defaults to {@link DEFAULT_RRF_K}. */
  k?: number;
  /** If set, truncate the fused result to this many items. */
  topK?: number;
}

export interface FusedItem<T> {
  item: T;
  score: number;
}

export function rrfFuse<T extends { chunkId: string }>(
  lists: T[][],
  options: RrfOptions = {},
): FusedItem<T>[] {
  const k = options.k ?? DEFAULT_RRF_K;
  const scoreById = new Map<string, number>();
  const itemById = new Map<string, T>();

  for (const list of lists) {
    list.forEach((item, index) => {
      const rank = index + 1; // 1-based
      const contribution = 1 / (k + rank);
      scoreById.set(item.chunkId, (scoreById.get(item.chunkId) ?? 0) + contribution);
      // Keep the first-seen instance for each id (lists carry identical payloads).
      if (!itemById.has(item.chunkId)) itemById.set(item.chunkId, item);
    });
  }

  const fused: FusedItem<T>[] = [...itemById.values()].map((item) => ({
    item,
    score: scoreById.get(item.chunkId)!,
  }));

  fused.sort((a, b) => b.score - a.score || a.item.chunkId.localeCompare(b.item.chunkId));

  return options.topK !== undefined ? fused.slice(0, options.topK) : fused;
}
