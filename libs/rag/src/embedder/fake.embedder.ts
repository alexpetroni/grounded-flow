import type { Embedder, EmbedResult } from './embedder.interface';
import { computeSparseVector } from './sparse';

export class FakeEmbedder implements Embedder {
  readonly dimensions: number;

  constructor(dimensions = 4) {
    this.dimensions = dimensions;
  }

  async embed(texts: string[]): Promise<EmbedResult[]> {
    return texts.map((text, i) => ({
      dense: {
        // Deterministic: cycle through a small fixed pattern, varying by position
        values: Array.from(
          { length: this.dimensions },
          (_, d) => Math.sin((i + 1) * (d + 1)) * 0.5,
        ),
      },
      sparse: computeSparseVector(text),
    }));
  }
}
