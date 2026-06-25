import type { RetrievedChunk } from '../retrieval/retriever.interface';
import type { Reranker, RerankedChunk } from './reranker.interface';

/**
 * Deterministic test reranker driven by a fixed `chunkId -> score` map.
 * Unknown chunks score 0. Ties break by `chunkId` for stable ordering.
 */
export class FakeReranker implements Reranker {
  constructor(private readonly scores: Record<string, number> = {}) {}

  async rerank(
    _query: string,
    candidates: RetrievedChunk[],
    topN: number,
  ): Promise<RerankedChunk[]> {
    return candidates
      .map((c) => ({ ...c, rerankScore: this.scores[c.chunkId] ?? 0 }))
      .sort((a, b) => b.rerankScore - a.rerankScore || a.chunkId.localeCompare(b.chunkId))
      .slice(0, topN);
  }
}
