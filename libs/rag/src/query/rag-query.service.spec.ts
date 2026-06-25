import { describe, it, expect, vi } from 'vitest';
import { LlmService, createFakeLanguageModel } from '@app/llm';
import { FakeEmbedder } from '../embedder/fake.embedder';
import { FakeReranker } from '../rerank/fake.reranker';
import type { Retriever, RetrievedChunk, RetrieveOptions } from '../retrieval/retriever.interface';
import { RagAnswerNode } from '../generation/rag-answer.node';
import { RagQueryService } from './rag-query.service';
import type { EmbedResult } from '../embedder/embedder.interface';

function chunk(chunkId: string, text: string): RetrievedChunk {
  return { chunkId, documentId: `doc-${chunkId}`, ordinal: 1, text, metadata: {}, score: 1 };
}

function makeAnswerNode(json: string): RagAnswerNode {
  const llm = new LlmService();
  llm.getLanguageModel = () => createFakeLanguageModel({ responses: [json] });
  return new RagAnswerNode(llm);
}

class StubRetriever implements Retriever {
  lastOptions?: RetrieveOptions;
  constructor(private readonly chunks: RetrievedChunk[]) {}
  async retrieve(_embedding: EmbedResult, options?: RetrieveOptions): Promise<RetrievedChunk[]> {
    this.lastOptions = options;
    return this.chunks;
  }
}

const DEFAULTS = { topK: 20, topN: 5 };

describe('RagQueryService', () => {
  it('embeds → retrieves → reranks → generates a grounded, cited answer', async () => {
    const chunks = [chunk('c1', 'alpha'), chunk('c2', 'beta')];
    const node = makeAnswerNode(
      JSON.stringify({
        answer: 'Alpha and beta.',
        citations: [{ chunkId: 'c1', quote: 'alpha' }],
        confidence: 0.77,
      }),
    );
    const service = new RagQueryService(
      new FakeEmbedder(4),
      new StubRetriever(chunks),
      new FakeReranker({ c1: 0.9, c2: 0.5 }),
      node,
      DEFAULTS,
    );

    const result = await service.query({ query: 'tell me about alpha' });

    expect(result.answer).toBe('Alpha and beta.');
    expect(result.grounded).toBe(true);
    expect(result.repaired).toBe(false);
    expect(result.citations[0]!.chunkId).toBe('c1');
    expect(result.retrieved.map((r) => r.chunkId)).toEqual(['c1', 'c2']);
    expect(result.retrieved[0]!.rerankScore).toBe(0.9);
  });

  it('repairs a hallucinated citation against the retrieved set', async () => {
    const chunks = [chunk('real-1', 'grounded text')];
    const node = makeAnswerNode(
      JSON.stringify({
        answer: 'Hallucinated cite.',
        citations: [{ chunkId: 'does-not-exist', quote: 'nope' }],
        confidence: 0.9,
      }),
    );
    const service = new RagQueryService(
      new FakeEmbedder(4),
      new StubRetriever(chunks),
      new FakeReranker({ 'real-1': 1 }),
      node,
      DEFAULTS,
    );

    const result = await service.query({ query: 'anything' });

    expect(result.repaired).toBe(true);
    expect(result.grounded).toBe(true);
    expect(result.citations[0]!.chunkId).toBe('real-1');
  });

  it('short-circuits with no LLM call when nothing is retrieved', async () => {
    const node = makeAnswerNode('{}');
    const processSpy = vi.spyOn(node, 'process');
    const service = new RagQueryService(
      new FakeEmbedder(4),
      new StubRetriever([]),
      new FakeReranker({}),
      node,
      DEFAULTS,
    );

    const result = await service.query({ query: 'nothing here' });

    expect(result.grounded).toBe(false);
    expect(result.citations).toEqual([]);
    expect(result.retrieved).toEqual([]);
    expect(processSpy).not.toHaveBeenCalled();
  });

  it('forwards topK / filter / mode to the retriever', async () => {
    const retriever = new StubRetriever([chunk('c1', 'x')]);
    const node = makeAnswerNode(
      JSON.stringify({ answer: 'ok', citations: [{ chunkId: 'c1', quote: 'x' }], confidence: 0.5 }),
    );
    const service = new RagQueryService(
      new FakeEmbedder(4),
      retriever,
      new FakeReranker({ c1: 1 }),
      node,
      DEFAULTS,
    );

    await service.query({ query: 'q', topK: 7, mode: 'dense', filter: { documentId: 'doc-c1' } });

    expect(retriever.lastOptions).toMatchObject({
      topK: 7,
      mode: 'dense',
      filter: { documentId: 'doc-c1' },
    });
  });
});
