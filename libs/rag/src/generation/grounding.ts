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
  /**
   * True iff at least one of the MODEL'S OWN citations resolved to a retrieved
   * chunk. A repair-fabricated anchor citation never counts as grounded — a
   * consumer keying on this flag must be able to distinguish a genuinely cited
   * answer from a papered-over ungrounded one.
   */
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
    // Only the model's surviving citations count: after a fabricated-anchor
    // repair the check `citations.every(byId.has)` would be trivially true.
    grounded: grounded.length > 0,
    repaired,
  };
}
