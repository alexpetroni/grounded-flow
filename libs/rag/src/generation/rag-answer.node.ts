import { Injectable } from '@nestjs/common';
import type { ModelMessage } from 'ai';
import { AgentNode, LlmService } from '@app/llm';
import type { TaskContext } from '@app/core';
import type { RerankedChunk } from '../rerank/reranker.interface';
import { ragAnswerSchema, type RagAnswer } from './rag-answer.schema';

export const RAG_INPUT_KEY = 'ragInput';

export interface RagGenerationInput {
  question: string;
  chunks: RerankedChunk[];
}

const SYSTEM_PROMPT = [
  'You are a precise question-answering assistant for a retrieval system.',
  'Answer ONLY from the provided context chunks. If the context does not contain',
  'the answer, say so plainly and set a low confidence.',
  'Every citation MUST reference one of the provided chunkId values verbatim and',
  'quote a short span of that chunk that supports the answer. Never invent chunkIds.',
].join(' ');

/**
 * Generation node: turns reranked context chunks into a grounded, cited answer.
 * Reuses {@link AgentNode}'s structured-output machinery with the RAG schema.
 * The retrieved chunks are passed via `ctx.metadata[RAG_INPUT_KEY]`.
 */
@Injectable()
export class RagAnswerNode extends AgentNode<RagAnswer> {
  readonly token = 'RagAnswerNode';
  readonly outputSchema = ragAnswerSchema;

  constructor(llmService: LlmService) {
    super(llmService);
  }

  buildMessages(ctx: TaskContext): ModelMessage[] {
    const input = ctx.metadata[RAG_INPUT_KEY] as RagGenerationInput | undefined;
    if (!input) {
      throw new Error(`RagAnswerNode requires ctx.metadata['${RAG_INPUT_KEY}']`);
    }

    const context = input.chunks
      .map((c, i) => `[#${i + 1}] chunkId=${c.chunkId}\n${c.text}`)
      .join('\n\n');

    return [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Question: ${input.question}\n\nContext chunks:\n${context || '(no context retrieved)'}`,
      },
    ];
  }
}
