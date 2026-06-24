import { embedMany } from 'ai';
import type { EmbeddingModel } from 'ai';
import type { Embedder, EmbedResult } from './embedder.interface';
import { computeSparseVector } from './sparse';

const BATCH_SIZE = 512;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

export class AiSdkEmbedder implements Embedder {
  readonly dimensions: number;

  constructor(
    private readonly model: EmbeddingModel,
    dimensions: number,
  ) {
    this.dimensions = dimensions;
  }

  async embed(texts: string[]): Promise<EmbedResult[]> {
    const results: EmbedResult[] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const embeddings = await this.embedBatchWithRetry(batch);
      for (let j = 0; j < batch.length; j++) {
        results.push({
          dense: { values: embeddings[j]! },
          sparse: computeSparseVector(batch[j]!),
        });
      }
    }

    return results;
  }

  private async embedBatchWithRetry(texts: string[]): Promise<number[][]> {
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const { embeddings } = await embedMany({ model: this.model, values: texts });
        return embeddings;
      } catch (err) {
        lastError = err;
        if (attempt < MAX_RETRIES - 1) {
          await new Promise((res) => setTimeout(res, RETRY_DELAY_MS * 2 ** attempt));
        }
      }
    }
    throw lastError;
  }
}
