import type { Embedder, EmbedResult } from './embedder.interface';

/**
 * Graceful degradation: boot never crashes on a missing embedding provider
 * key — this stands in for the real embedder and fails loudly only when a
 * caller actually tries to embed something.
 */
export class UnconfiguredEmbedder implements Embedder {
  constructor(
    readonly dimensions: number,
    private readonly provider: string,
  ) {}

  embed(): Promise<EmbedResult[]> {
    return Promise.reject(
      new Error(`Embedding provider "${this.provider}" is not configured (missing API key)`),
    );
  }
}
