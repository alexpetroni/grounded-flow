import { describe, it, expect, vi } from 'vitest';
import type { RetrievedChunk } from '../retrieval/retriever.interface';
import { FakeReranker } from './fake.reranker';
import { PassthroughReranker } from './passthrough.reranker';
import { CohereReranker, type FetchFn } from './cohere.reranker';

function chunk(chunkId: string, score: number, text = `text-${chunkId}`): RetrievedChunk {
  return { chunkId, documentId: 'doc', ordinal: 0, text, metadata: {}, score };
}

const candidates: RetrievedChunk[] = [chunk('a', 0.9), chunk('b', 0.8), chunk('c', 0.7)];

describe('FakeReranker', () => {
  it('reorders candidates by known scores and respects top-n', async () => {
    const reranker = new FakeReranker({ a: 0.1, b: 0.9, c: 0.5 });
    const result = await reranker.rerank('q', candidates, 2);

    expect(result.map((r) => r.chunkId)).toEqual(['b', 'c']);
    expect(result[0]!.rerankScore).toBe(0.9);
  });

  it('scores unknown chunks as 0 and breaks ties by chunkId', async () => {
    const reranker = new FakeReranker({});
    const result = await reranker.rerank('q', candidates, 3);
    expect(result.map((r) => r.chunkId)).toEqual(['a', 'b', 'c']);
    expect(result.every((r) => r.rerankScore === 0)).toBe(true);
  });
});

describe('PassthroughReranker', () => {
  it('preserves retrieval order and truncates to top-n', async () => {
    const reranker = new PassthroughReranker();
    const result = await reranker.rerank('q', candidates, 2);
    expect(result.map((r) => r.chunkId)).toEqual(['a', 'b']);
    expect(result[0]!.rerankScore).toBe(0.9);
  });
});

describe('CohereReranker', () => {
  it('sends documents and maps relevance scores back onto candidates', async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          { index: 2, relevance_score: 0.99 },
          { index: 0, relevance_score: 0.42 },
        ],
      }),
      text: async () => '',
    });

    const reranker = new CohereReranker({ apiKey: 'k', fetchFn });
    const result = await reranker.rerank('what is c?', candidates, 2);

    expect(result.map((r) => r.chunkId)).toEqual(['c', 'a']);
    expect(result[0]!.rerankScore).toBe(0.99);

    const [, init] = fetchFn.mock.calls[0]!;
    const body = JSON.parse(init.body) as { documents: string[]; top_n: number };
    expect(body.documents).toEqual(['text-a', 'text-b', 'text-c']);
    expect(body.top_n).toBe(2);
    expect(init.headers.Authorization).toBe('Bearer k');
  });

  it('returns empty without calling the API when there are no candidates', async () => {
    const fetchFn = vi.fn<FetchFn>();
    const reranker = new CohereReranker({ apiKey: 'k', fetchFn });
    expect(await reranker.rerank('q', [], 5)).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('throws a descriptive error on a non-ok response', async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({}),
      text: async () => 'rate limited',
    });
    const reranker = new CohereReranker({ apiKey: 'k', fetchFn });
    await expect(reranker.rerank('q', candidates, 2)).rejects.toThrow(/429.*rate limited/);
  });
});
