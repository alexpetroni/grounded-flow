import type { RetrievedChunk } from '../retrieval/retriever.interface';

export interface RerankedChunk extends RetrievedChunk {
  /** Reranker-assigned relevance for `query`; higher is better. */
  rerankScore: number;
}

export interface Reranker {
  /**
   * Reorder `candidates` by relevance to `query` and return the top `topN`.
   * Implementations must be stable for equal scores so output is deterministic.
   */
  rerank(query: string, candidates: RetrievedChunk[], topN: number): Promise<RerankedChunk[]>;
}
