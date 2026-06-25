import type { RetrievedChunk } from '../retrieval/retriever.interface';
import type { Reranker, RerankedChunk } from './reranker.interface';

/**
 * Identity reranker: preserves the retriever's order and truncates to `topN`.
 *
 * Used as the graceful-degradation default when no rerank provider key is
 * configured — the pipeline still returns sensibly ordered results, just
 * without a dedicated cross-encoder pass.
 */
export class PassthroughReranker implements Reranker {
  async rerank(
    _query: string,
    candidates: RetrievedChunk[],
    topN: number,
  ): Promise<RerankedChunk[]> {
    return candidates.slice(0, topN).map((c) => ({ ...c, rerankScore: c.score }));
  }
}
