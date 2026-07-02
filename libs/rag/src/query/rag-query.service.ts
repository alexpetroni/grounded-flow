import { Injectable, Logger } from '@nestjs/common';
import { TaskContext } from '@app/core';
import type { Embedder } from '../embedder/embedder.interface';
import type { Retriever, RetrievalMode } from '../retrieval/retriever.interface';
import type { Reranker, RerankedChunk } from '../rerank/reranker.interface';
import {
  RagAnswerNode,
  RAG_INPUT_KEY,
  type RagGenerationInput,
} from '../generation/rag-answer.node';
import { validateGrounding, type GroundedAnswer } from '../generation/grounding';
import type { RagAnswer } from '../generation/rag-answer.schema';

export interface RagQueryInput {
  query: string;
  topK?: number;
  topN?: number;
  filter?: Record<string, unknown>;
  mode?: RetrievalMode;
}

export interface RetrievedRef {
  chunkId: string;
  documentId: string;
  ordinal: number;
  score: number;
  rerankScore: number;
}

export interface RagQueryResult extends GroundedAnswer {
  retrieved: RetrievedRef[];
}

export interface RagQueryDefaults {
  topK: number;
  topN: number;
}

/**
 * End-to-end RAG query: embed → hybrid retrieve → rerank → grounded generation.
 * Citations are always validated/repaired against the retrieved set so the
 * response can never cite a chunk that was not actually retrieved.
 */
@Injectable()
export class RagQueryService {
  private readonly logger = new Logger(RagQueryService.name);

  constructor(
    private readonly embedder: Embedder,
    private readonly retriever: Retriever,
    private readonly reranker: Reranker,
    private readonly answerNode: RagAnswerNode,
    private readonly defaults: RagQueryDefaults,
  ) {}

  async query(input: RagQueryInput): Promise<RagQueryResult> {
    const topK = input.topK ?? this.defaults.topK;
    const topN = input.topN ?? this.defaults.topN;

    const [embedding] = await this.embedder.embed([input.query]);
    const retrieved = await this.retriever.retrieve(embedding!, {
      topK,
      filter: input.filter,
      mode: input.mode,
    });
    // Graceful degradation: a rerank outage falls back to the fused retrieval
    // order instead of failing the whole query.
    let reranked: RerankedChunk[];
    try {
      reranked = await this.reranker.rerank(input.query, retrieved, topN);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Rerank failed — degrading to fused retrieval order: ${message}`);
      reranked = retrieved.slice(0, topN).map((c) => ({ ...c, rerankScore: c.score }));
    }

    if (reranked.length === 0) {
      return {
        answer: 'No relevant context was found to answer this question.',
        citations: [],
        confidence: 0,
        grounded: false,
        repaired: false,
        retrieved: [],
      };
    }

    const raw = await this.generate(input.query, reranked);
    const grounded = validateGrounding(raw, reranked);

    if (grounded.repaired) {
      this.logger.warn(`Grounding repaired ungrounded citations for query: "${input.query}"`);
    }

    return { ...grounded, retrieved: reranked.map(toRef) };
  }

  private async generate(question: string, chunks: RerankedChunk[]): Promise<RagAnswer> {
    const generationInput: RagGenerationInput = { question, chunks };
    const ctx = new TaskContext({ query: question }, undefined, {
      [RAG_INPUT_KEY]: generationInput,
    });
    try {
      await this.answerNode.process(ctx);
      return ctx.getOutput<RagAnswer>(this.answerNode.token);
    } finally {
      await this.answerNode.cleanup();
    }
  }
}

function toRef(c: RerankedChunk): RetrievedRef {
  return {
    chunkId: c.chunkId,
    documentId: c.documentId,
    ordinal: c.ordinal,
    score: c.score,
    rerankScore: c.rerankScore,
  };
}
