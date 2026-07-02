import { Injectable, Optional } from '@nestjs/common';
import { generateText, streamText } from 'ai';
import type { ModelMessage, LanguageModel } from 'ai';
import { Node } from '@app/core';
import type { TaskContext, StreamingNode } from '@app/core';
import { TracingService } from '@app/observability';
import { LlmService } from './llm.service';
import { uuidv7 } from 'uuidv7';

export interface OpenAIChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: { role?: string; content?: string };
    finish_reason: string | null;
  }>;
}

function getModelId(model: LanguageModel): string {
  if (model && typeof model === 'object' && 'modelId' in model) {
    return String((model as { modelId: unknown }).modelId);
  }
  return 'unknown';
}

@Injectable()
export abstract class AgentStreamingNode extends Node implements StreamingNode {
  constructor(
    protected readonly llmService: LlmService,
    @Optional() protected readonly tracing?: TracingService,
  ) {
    super();
  }

  abstract buildMessages(ctx: TaskContext): ModelMessage[];

  /** AI SDK telemetry settings — NoOp-disabled when tracing is unconfigured. */
  protected telemetry(): { isEnabled: boolean; functionId?: string } {
    return this.tracing?.aiTelemetry(this.token) ?? { isEnabled: false };
  }

  async process(ctx: TaskContext): Promise<TaskContext> {
    const model = this.llmService.getLanguageModel();
    const result = await generateText({
      model,
      messages: this.buildMessages(ctx),
      experimental_telemetry: this.telemetry(),
    });
    this.saveOutput(ctx, { text: result.text });
    return ctx;
  }

  async *processStream(ctx: TaskContext): AsyncGenerator<unknown, void, undefined> {
    const model = this.llmService.getLanguageModel();
    const completionId = `chatcmpl-${uuidv7()}`;
    const created = Math.floor(Date.now() / 1000);
    const modelId = getModelId(model);

    yield {
      id: completionId,
      object: 'chat.completion.chunk',
      created,
      model: modelId,
      choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
    } satisfies OpenAIChunk;

    const result = streamText({
      model,
      messages: this.buildMessages(ctx),
      experimental_telemetry: this.telemetry(),
    });

    // The finally flushes whatever text was accumulated even when the consumer
    // stops iterating early or the stream throws mid-way; early exit from the
    // for-await also cancels the underlying stream via the iterator protocol.
    let fullText = '';
    try {
      for await (const chunk of result.textStream) {
        fullText += chunk;
        yield {
          id: completionId,
          object: 'chat.completion.chunk',
          created,
          model: modelId,
          choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }],
        } satisfies OpenAIChunk;
      }

      yield {
        id: completionId,
        object: 'chat.completion.chunk',
        created,
        model: modelId,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      } satisfies OpenAIChunk;
    } finally {
      this.saveOutput(ctx, { text: fullText });
    }
  }
}
