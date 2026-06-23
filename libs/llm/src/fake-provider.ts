import { MockLanguageModelV3, MockEmbeddingModelV3, simulateReadableStream } from 'ai/test';
import type { LanguageModel, EmbeddingModel } from 'ai';

export interface FakeLanguageModelOptions {
  responses?: string[];
}

const STOP_FINISH_REASON = { unified: 'stop', raw: 'stop' } as const;

const FAKE_USAGE = {
  inputTokens: {
    total: 10 as number | undefined,
    noCache: 10 as number | undefined,
    cacheRead: undefined as number | undefined,
    cacheWrite: undefined as number | undefined,
  },
  outputTokens: {
    total: 5 as number | undefined,
    text: 5 as number | undefined,
    reasoning: undefined as number | undefined,
  },
};

export function createFakeLanguageModel(options: FakeLanguageModelOptions = {}): LanguageModel {
  const responses = options.responses ?? ['Hello from fake provider.'];
  let callCount = 0;

  return new MockLanguageModelV3({
    provider: 'fake',
    modelId: 'fake-model',
    // Cast via unknown to bypass strict LanguageModelV3GenerateResult typing in mock constructor
    doGenerate: (async () => {
      const text = responses[Math.min(callCount++, responses.length - 1)];
      return {
        content: [{ type: 'text' as const, text }],
        finishReason: STOP_FINISH_REASON,
        usage: FAKE_USAGE,
        warnings: [] as never[],
      };
    }) as unknown as MockLanguageModelV3['doGenerate'],
    doStream: (async () => {
      const text = responses[Math.min(callCount++, responses.length - 1)];
      const words = text.split(' ');
      const textId = 'text-0';
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start' as const, id: textId },
            ...words.map((word, i) => ({
              type: 'text-delta' as const,
              id: textId,
              delta: i === 0 ? word : ` ${word}`,
            })),
            { type: 'text-end' as const, id: textId },
            {
              type: 'finish' as const,
              finishReason: STOP_FINISH_REASON,
              usage: FAKE_USAGE,
            },
          ],
          chunkDelayInMs: null,
        }),
      };
    }) as unknown as MockLanguageModelV3['doStream'],
  }) as unknown as LanguageModel;
}

export function createFakeEmbeddingModel(dimensions = 1536): EmbeddingModel {
  return new MockEmbeddingModelV3({
    provider: 'fake',
    modelId: 'fake-embedding',
    maxEmbeddingsPerCall: 100,
    doEmbed: (async ({ values }: { values: string[] }) => ({
      embeddings: values.map(() =>
        Array.from({ length: dimensions }, (_, i) => (i % 2 === 0 ? 0.1 : -0.1)),
      ),
      warnings: [] as never[],
    })) as unknown as MockEmbeddingModelV3['doEmbed'],
  }) as unknown as EmbeddingModel;
}
