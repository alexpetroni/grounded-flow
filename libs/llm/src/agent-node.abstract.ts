import { Injectable, Optional } from '@nestjs/common';
import type { ModelMessage } from 'ai';
import { z } from 'zod';
import { Node } from '@app/core';
import type { TaskContext } from '@app/core';
import { TracingService } from '@app/observability';
import { LlmService } from './llm.service';
import { generateStructured } from './generate-structured';

@Injectable()
export abstract class AgentNode<TOutput = unknown> extends Node<TOutput> {
  abstract readonly outputSchema: z.ZodType<TOutput>;

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
    const output = await generateStructured({
      llmService: this.llmService,
      schema: this.outputSchema,
      messages: this.buildMessages(ctx),
      telemetry: this.telemetry(),
    });
    this.saveOutput(ctx, output);
    return ctx;
  }
}
