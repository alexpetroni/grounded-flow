import type { SparseVector } from './embedder.interface';

export function computeSparseVector(text: string): SparseVector {
  const tokens = tokenize(text);
  if (tokens.length === 0) return { indices: [], values: [] };

  const tf = new Map<number, number>();
  for (const token of tokens) {
    const idx = termToIndex(token);
    tf.set(idx, (tf.get(idx) ?? 0) + 1);
  }

  const total = tokens.length;
  const indices: number[] = [];
  const values: number[] = [];

  for (const [idx, count] of tf.entries()) {
    indices.push(idx);
    // Normalize TF to [0,1] range
    values.push(count / total);
  }

  // Sort by index for consistent representation
  const pairs = indices.map((idx, i) => ({ idx, val: values[i]! }));
  pairs.sort((a, b) => a.idx - b.idx);

  return {
    indices: pairs.map((p) => p.idx),
    values: pairs.map((p) => p.val),
  };
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function termToIndex(term: string): number {
  // FNV-1a hash mod 65536 to produce a stable sparse index
  let hash = 0x811c9dc5;
  for (let i = 0; i < term.length; i++) {
    hash ^= term.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash % 65536;
}
