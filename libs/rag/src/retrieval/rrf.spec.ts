import { describe, it, expect } from 'vitest';
import { rrfFuse, DEFAULT_RRF_K } from './rrf';

interface Item {
  chunkId: string;
}

function ids(items: Array<{ item: Item }>): string[] {
  return items.map((f) => f.item.chunkId);
}

describe('rrfFuse', () => {
  it('fuses two ranked lists deterministically for known inputs', () => {
    const listA: Item[] = [{ chunkId: 'a' }, { chunkId: 'b' }, { chunkId: 'c' }];
    const listB: Item[] = [{ chunkId: 'b' }, { chunkId: 'a' }, { chunkId: 'd' }];

    const fused = rrfFuse([listA, listB]);

    // a (ranks 1,2) and b (ranks 2,1) accumulate identical scores; tie breaks by id.
    // c and d each appear once at rank 3 → tie, id order.
    expect(ids(fused)).toEqual(['a', 'b', 'c', 'd']);
    expect(fused[0]!.score).toBeCloseTo(fused[1]!.score, 12);
    expect(fused[2]!.score).toBeCloseTo(fused[3]!.score, 12);
    expect(fused[0]!.score).toBeGreaterThan(fused[2]!.score);
  });

  it('rewards agreement: an item in both lists outranks better single-list items', () => {
    const listA: Item[] = [{ chunkId: 'x' }, { chunkId: 'shared' }];
    const listB: Item[] = [{ chunkId: 'y' }, { chunkId: 'shared' }];

    const fused = rrfFuse([listA, listB]);
    expect(fused[0]!.item.chunkId).toBe('shared');
  });

  it('honors topK truncation', () => {
    const list: Item[] = [{ chunkId: 'a' }, { chunkId: 'b' }, { chunkId: 'c' }];
    const fused = rrfFuse([list], { topK: 2 });
    expect(fused).toHaveLength(2);
  });

  it('uses the canonical k=60 contribution for a single rank-1 hit', () => {
    const fused = rrfFuse([[{ chunkId: 'only' }]]);
    expect(fused[0]!.score).toBeCloseTo(1 / (DEFAULT_RRF_K + 1), 12);
  });

  it('produces identical output across repeated runs (seed-stable)', () => {
    const lists: Item[][] = [
      [{ chunkId: 'b' }, { chunkId: 'a' }],
      [{ chunkId: 'a' }, { chunkId: 'b' }],
    ];
    expect(ids(rrfFuse(lists))).toEqual(ids(rrfFuse(lists)));
  });
});
