import { describe, it, expect } from 'vitest';
import { FakeEmbedder } from './fake.embedder';
import { computeSparseVector } from './sparse';

describe('FakeEmbedder', () => {
  it('returns one result per input', async () => {
    const embedder = new FakeEmbedder(8);
    const results = await embedder.embed(['hello', 'world', 'foo']);
    expect(results).toHaveLength(3);
  });

  it('returns dense vectors of correct dimension', async () => {
    const embedder = new FakeEmbedder(16);
    const [result] = await embedder.embed(['test text']);
    expect(result?.dense.values).toHaveLength(16);
  });

  it('is deterministic — same text at same position produces same embedding', async () => {
    const embedder = new FakeEmbedder(8);
    const a = await embedder.embed(['hello world']);
    const b = await embedder.embed(['hello world']);
    expect(a[0]?.dense.values).toEqual(b[0]?.dense.values);
  });

  it('produces sparse vectors for non-empty text', async () => {
    const embedder = new FakeEmbedder(4);
    const [result] = await embedder.embed(['the quick brown fox']);
    expect(result?.sparse.indices.length).toBeGreaterThan(0);
    expect(result?.sparse.values.length).toBe(result?.sparse.indices.length);
  });

  it('handles empty batch', async () => {
    const embedder = new FakeEmbedder(4);
    const results = await embedder.embed([]);
    expect(results).toHaveLength(0);
  });

  it('covers batches larger than 1 (simulates batching logic coverage)', async () => {
    const embedder = new FakeEmbedder(4);
    const texts = Array.from({ length: 10 }, (_, i) => `text number ${i}`);
    const results = await embedder.embed(texts);
    expect(results).toHaveLength(10);
    // All dense values should be in range
    for (const r of results) {
      for (const v of r.dense.values) {
        expect(Math.abs(v)).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('computeSparseVector', () => {
  it('returns empty for empty string', () => {
    const v = computeSparseVector('');
    expect(v.indices).toEqual([]);
    expect(v.values).toEqual([]);
  });

  it('is deterministic for the same text', () => {
    const a = computeSparseVector('hello world test');
    const b = computeSparseVector('hello world test');
    expect(a).toEqual(b);
  });

  it('indices are sorted', () => {
    const v = computeSparseVector('foo bar baz qux quux corge grault');
    for (let i = 1; i < v.indices.length; i++) {
      expect(v.indices[i]!).toBeGreaterThan(v.indices[i - 1]!);
    }
  });

  it('values are normalized between 0 and 1', () => {
    const v = computeSparseVector('the the the fox');
    for (const val of v.values) {
      expect(val).toBeGreaterThan(0);
      expect(val).toBeLessThanOrEqual(1);
    }
  });

  it('different texts produce different sparse vectors', () => {
    const a = computeSparseVector('artificial intelligence machine learning');
    const b = computeSparseVector('cooking recipes baking bread');
    // High probability of difference (not guaranteed but astronomically likely)
    const aSet = new Set(a.indices);
    const bSet = new Set(b.indices);
    const intersection = [...aSet].filter((x) => bSet.has(x));
    expect(intersection.length).toBeLessThan(Math.min(aSet.size, bSet.size));
  });
});
