import type { RetrievedChunk } from '../retrieval/retriever.interface';
import type { Citation, RagAnswer } from './rag-answer.schema';

export interface GroundedCitation extends Citation {
  documentId: string;
  ordinal: number;
}

export interface GroundedAnswer {
  answer: string;
  citations: GroundedCitation[];
  confidence: number;
  /** True iff the final answer carries at least one citation, all resolving to retrieved chunks. */
  grounded: boolean;
  /** True iff some model citation was ungrounded and had to be dropped or repaired. */
  repaired: boolean;
}

const MAX_QUOTE_CHARS = 240;

/**
 * Enforce the citation-grounding invariant: every returned `chunkId` must exist
 * in the retrieved set. Hallucinated citations are dropped. If that leaves the
 * answer with no citations while retrieved context exists, we repair by
 * anchoring to the top retrieved chunk so the answer is never silently
 * un-cited. Any rejection or repair is surfaced via `repaired`.
 */
export function validateGrounding(answer: RagAnswer, retrieved: RetrievedChunk[]): GroundedAnswer {
  const byId = new Map(retrieved.map((r) => [r.chunkId, r]));

  const grounded: GroundedCitation[] = [];
  for (const c of answer.citations) {
    const chunk = byId.get(c.chunkId);
    if (chunk) {
      grounded.push({
        chunkId: c.chunkId,
        quote: c.quote,
        documentId: chunk.documentId,
        ordinal: chunk.ordinal,
      });
    }
  }

  const hadUngrounded = grounded.length !== answer.citations.length;
  let repaired = hadUngrounded;
  let citations = grounded;

  if (citations.length === 0 && retrieved.length > 0) {
    const top = retrieved[0]!;
    citations = [
      {
        chunkId: top.chunkId,
        quote: top.text.slice(0, MAX_QUOTE_CHARS),
        documentId: top.documentId,
        ordinal: top.ordinal,
      },
    ];
    repaired = true;
  }

  return {
    answer: answer.answer,
    citations,
    confidence: answer.confidence,
    grounded: citations.length > 0 && citations.every((c) => byId.has(c.chunkId)),
    repaired,
  };
}
