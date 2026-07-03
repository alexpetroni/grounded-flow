import { Injectable } from '@nestjs/common';
import type { ModelMessage } from 'ai';
import { LlmService, generateStructured } from '@app/llm';
import type { TracingService } from '@app/observability';
import type { RerankedChunk } from '../rerank/reranker.interface';
import { ragAnswerSchema, type RagAnswer } from './rag-answer.schema';

interface RagGenerationInput {
  question: string;
  chunks: RerankedChunk[];
}

const FUNCTION_ID = 'RagAnswerNode';

const SYSTEM_PROMPT = [
  'You are a precise question-answering assistant for a retrieval system.',
  'Answer ONLY from the provided context chunks. If the context does not contain',
  'the answer, say so plainly and set a low confidence.',
  'Every citation MUST reference one of the provided chunkId values verbatim and',
  'quote a short span of that chunk that supports the answer. Never invent chunkIds.',
].join(' ');

/**
 * Generation step: turns reranked context chunks into a grounded, cited
 * answer. A plain typed call — no workflow/TaskContext machinery involved.
 */
@Injectable()
export class RagAnswerNode {
  constructor(
    private readonly llmService: LlmService,
    private readonly tracing?: TracingService,
  ) {}

  async answer(input: RagGenerationInput): Promise<RagAnswer> {
    return generateStructured({
      llmService: this.llmService,
      schema: ragAnswerSchema,
      messages: this.buildMessages(input),
      telemetry: this.tracing?.aiTelemetry(FUNCTION_ID) ?? { isEnabled: false },
    });
  }

  private buildMessages(input: RagGenerationInput): ModelMessage[] {
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
