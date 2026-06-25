import type { EmbedResult } from '../embedder/embedder.interface';
import type { VectorStore } from '../vector-store/vector-store.interface';
import type { Retriever, RetrieveOptions, RetrievedChunk } from './retriever.interface';
import { rrfFuse } from './rrf';

/**
 * Hybrid retriever over a {@link VectorStore}.
 *
 * For `mode: 'hybrid'` it issues independent dense and sparse queries and fuses
 * the two ranked lists client-side with deterministic RRF — keeping fusion
 * testable and seed-stable rather than relying on the store's server-side
 * fusion. `mode: 'dense'` / `'sparse'` return that single space's native order.
 */
export class HybridRetriever implements Retriever {
  constructor(
    private readonly store: VectorStore,
    private readonly defaultTopK: number,
  ) {}

  async retrieve(embedding: EmbedResult, options: RetrieveOptions = {}): Promise<RetrievedChunk[]> {
    const topK = options.topK ?? this.defaultTopK;
    const mode = options.mode ?? 'hybrid';
    // Over-fetch each space so fusion has candidates beyond a single list's head.
    const perSpaceLimit = topK * 2;

    if (mode === 'dense') {
      const dense = await this.store.searchDense(embedding.dense.values, topK, options.filter);
      return dense.slice(0, topK);
    }

    if (mode === 'sparse') {
      const sparse = await this.store.searchSparse(embedding.sparse, topK, options.filter);
      return sparse.slice(0, topK);
    }

    const [dense, sparse] = await Promise.all([
      this.store.searchDense(embedding.dense.values, perSpaceLimit, options.filter),
      this.store.searchSparse(embedding.sparse, perSpaceLimit, options.filter),
    ]);

    const fused = rrfFuse<RetrievedChunk>([dense, sparse], { topK });
    return fused.map(({ item, score }) => ({ ...item, score }));
  }
}
