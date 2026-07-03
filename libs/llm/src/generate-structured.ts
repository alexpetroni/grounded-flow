import { generateObject } from 'ai';
import type { ModelMessage, GenerateObjectResult } from 'ai';
import { z } from 'zod';
import { LlmService } from './llm.service';

type GenerateFn = <T>(opts: {
  model: ReturnType<LlmService['getLanguageModel']>;
  schema: z.ZodType<T>;
  messages: ModelMessage[];
  maxRetries: number;
  experimental_telemetry: { isEnabled: boolean; functionId?: string };
}) => Promise<GenerateObjectResult<T>>;

const safeGenerateObject = generateObject as unknown as GenerateFn;

export interface GenerateStructuredOptions<T> {
  llmService: LlmService;
  schema: z.ZodType<T>;
  messages: ModelMessage[];
  telemetry: { isEnabled: boolean; functionId?: string };
}

/**
 * Shared AI SDK `generateObject` call — schema-typed result, no `as` cast at
 * call sites. Used by both {@link AgentNode} (ctx-driven workflow steps) and
 * plain typed generators that never touch a `TaskContext`.
 */
export async function generateStructured<T>(opts: GenerateStructuredOptions<T>): Promise<T> {
  const result = await safeGenerateObject({
    model: opts.llmService.getLanguageModel(),
    schema: opts.schema,
    messages: opts.messages,
    maxRetries: 3,
    experimental_telemetry: opts.telemetry,
  });
  return result.object;
}
