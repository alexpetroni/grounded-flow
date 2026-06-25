import { describe, it, expect } from 'vitest';
import type { RetrievedChunk } from '../retrieval/retriever.interface';
import { validateGrounding } from './grounding';
import type { RagAnswer } from './rag-answer.schema';

function chunk(chunkId: string, text: string): RetrievedChunk {
  return { chunkId, documentId: `doc-${chunkId}`, ordinal: 1, text, metadata: {}, score: 1 };
}

const retrieved: RetrievedChunk[] = [
  chunk('c1', 'first chunk text'),
  chunk('c2', 'second chunk text'),
];

describe('validateGrounding', () => {
  it('passes valid citations through unchanged and reports grounded', () => {
    const answer: RagAnswer = {
      answer: 'Some answer.',
      citations: [{ chunkId: 'c2', quote: 'second' }],
      confidence: 0.8,
    };

    const result = validateGrounding(answer, retrieved);

    expect(result.grounded).toBe(true);
    expect(result.repaired).toBe(false);
    expect(result.citations).toEqual([
      { chunkId: 'c2', quote: 'second', documentId: 'doc-c2', ordinal: 1 },
    ]);
  });

  it('drops a hallucinated chunkId while keeping a valid one, flagging repaired', () => {
    const answer: RagAnswer = {
      answer: 'Mixed.',
      citations: [
        { chunkId: 'c1', quote: 'first' },
        { chunkId: 'ghost', quote: 'made up' },
      ],
      confidence: 0.6,
    };

    const result = validateGrounding(answer, retrieved);

    expect(result.citations.map((c) => c.chunkId)).toEqual(['c1']);
    expect(result.grounded).toBe(true);
    expect(result.repaired).toBe(true);
  });

  it('repairs an answer whose only citation is hallucinated by anchoring to the top chunk', () => {
    const answer: RagAnswer = {
      answer: 'Ungrounded.',
      citations: [{ chunkId: 'ghost', quote: 'nope' }],
      confidence: 0.9,
    };

    const result = validateGrounding(answer, retrieved);

    expect(result.repaired).toBe(true);
    expect(result.grounded).toBe(true);
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]!.chunkId).toBe('c1'); // top retrieved chunk
    expect(result.citations[0]!.quote).toBe('first chunk text');
  });

  it('cannot ground when nothing was retrieved', () => {
    const answer: RagAnswer = {
      answer: 'No context.',
      citations: [{ chunkId: 'ghost', quote: 'x' }],
      confidence: 0.1,
    };

    const result = validateGrounding(answer, []);
    expect(result.citations).toEqual([]);
    expect(result.grounded).toBe(false);
    expect(result.repaired).toBe(true);
  });

  it('truncates an overly long repaired quote', () => {
    const longText = 'x'.repeat(1000);
    const result = validateGrounding({ answer: 'a', citations: [], confidence: 0.5 }, [
      chunk('big', longText),
    ]);
    expect(result.citations[0]!.quote.length).toBe(240);
    expect(result.repaired).toBe(true);
  });
});
