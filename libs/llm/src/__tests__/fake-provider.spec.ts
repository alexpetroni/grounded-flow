import { describe, it, expect } from 'vitest';
import { generateObject, generateText } from 'ai';
import type { LanguageModel, ModelMessage } from 'ai';
import { z } from 'zod';
import { createFakeLanguageModel } from '../fake-provider';

// generateObject's generics explode on inline Zod schemas; cast to a flat
// signature (mirrors AgentNode's safeGenerateObject) for the test.
const generateObj = generateObject as unknown as (opts: {
  model: LanguageModel;
  schema: z.ZodTypeAny;
  messages: ModelMessage[];
}) => Promise<{ object: Record<string, unknown> }>;

const ragSchema = z.object({
  answer: z.string(),
  citations: z.array(z.unknown()),
  confidence: z.number(),
});

describe('createFakeLanguageModel', () => {
  it('coerces a plain default response into a valid object in generateObject mode', async () => {
    const { object } = await generateObj({
      model: createFakeLanguageModel(),
      schema: ragSchema,
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(object['answer']).toBe('Hello from fake provider.');
    expect(object['citations']).toEqual([]);
    expect(object['confidence']).toBe(0.5);
  });

  it('passes an explicit JSON response through unchanged', async () => {
    const { object } = await generateObj({
      model: createFakeLanguageModel({ responses: ['{"answer":"explicit"}'] }),
      schema: z.object({ answer: z.string() }),
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(object['answer']).toBe('explicit');
  });

  it('returns raw text in generateText mode', async () => {
    const model = createFakeLanguageModel({ responses: ['plain text'] });
    const { text } = await generateText({ model, messages: [{ role: 'user', content: 'hi' }] });
    expect(text).toBe('plain text');
  });
});
