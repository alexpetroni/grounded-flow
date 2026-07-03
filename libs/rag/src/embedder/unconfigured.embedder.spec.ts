import { describe, it, expect } from 'vitest';
import { UnconfiguredEmbedder } from './unconfigured.embedder';

describe('UnconfiguredEmbedder', () => {
  it('reports the configured dimensions without crashing boot', () => {
    const embedder = new UnconfiguredEmbedder(1536, 'openai');
    expect(embedder.dimensions).toBe(1536);
  });

  it('rejects with a message naming the unconfigured provider', async () => {
    const embedder = new UnconfiguredEmbedder(1536, 'openai');
    await expect(embedder.embed()).rejects.toThrow(
      'Embedding provider "openai" is not configured (missing API key)',
    );
  });
});
