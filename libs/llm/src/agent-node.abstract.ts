import { Injectable } from '@nestjs/common';
import { generateObject } from 'ai';
import type { ModelMessage, GenerateObjectResult } from 'ai';
import { z } from 'zod';
import { Node } from '@app/core';
import type { TaskContext } from '@app/core';
import { LlmService } from './llm.service';

type GenerateFn = (opts: {
  model: ReturnType<LlmService['getLanguageModel']>;
  schema: z.ZodTypeAny;
  messages: ModelMessage[];
  maxRetries: number;
  experimental_telemetry: { isEnabled: boolean };
}) => Promise<GenerateObjectResult<unknown>>;

const safeGenerateObject = generateObject as unknown as GenerateFn;

@Injectable()
export abstract class AgentNode<TOutput = unknown> extends Node {
  abstract readonly outputSchema: z.ZodTypeAny;

  constructor(protected readonly llmService: LlmService) {
    super();
  }

  abstract buildMessages(ctx: TaskContext): ModelMessage[];

  async process(ctx: TaskContext): Promise<TaskContext> {
    const model = this.llmService.getLanguageModel();

    const result = await safeGenerateObject({
      model,
      schema: this.outputSchema,
      messages: this.buildMessages(ctx),
      maxRetries: 3,
      experimental_telemetry: { isEnabled: false },
    });

    this.saveOutput(ctx, result.object as TOutput);
    return ctx;
  }
}
