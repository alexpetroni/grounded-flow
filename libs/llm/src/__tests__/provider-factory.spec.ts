import { describe, it, expect } from 'vitest';
import {
  createLanguageModel,
  UnknownProviderError,
  MissingProviderKeyError,
} from '../provider-factory';
import { createFakeLanguageModel, createFakeEmbeddingModel } from '../fake-provider';

function getModelProp(model: object, prop: string): unknown {
  return (model as Record<string, unknown>)[prop];
}

describe('createFakeLanguageModel', () => {
  it('returns a LanguageModel with provider=fake', () => {
    const model = createFakeLanguageModel();
    expect(model).toBeDefined();
    expect(getModelProp(model as object, 'provider')).toBe('fake');
    expect(getModelProp(model as object, 'modelId')).toBe('fake-model');
  });
});

describe('createFakeEmbeddingModel', () => {
  it('returns an EmbeddingModel with provider=fake', () => {
    const model = createFakeEmbeddingModel();
    expect(model).toBeDefined();
    expect(getModelProp(model as object, 'provider')).toBe('fake');
  });
});

describe('createLanguageModel', () => {
  it('throws UnknownProviderError for unknown providers', () => {
    expect(() => createLanguageModel({ provider: 'unknown-provider', model: 'x' })).toThrow(
      UnknownProviderError,
    );
  });

  it('throws MissingProviderKeyError when openai key is missing', () => {
    expect(() =>
      createLanguageModel({ provider: 'openai', model: 'gpt-4o-mini', openaiApiKey: '' }),
    ).toThrow(MissingProviderKeyError);
  });

  it('throws MissingProviderKeyError when anthropic key is missing', () => {
    expect(() =>
      createLanguageModel({
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        anthropicApiKey: '',
      }),
    ).toThrow(MissingProviderKeyError);
  });

  it('throws MissingProviderKeyError when google key is missing', () => {
    expect(() =>
      createLanguageModel({ provider: 'google', model: 'gemini-pro', googleApiKey: '' }),
    ).toThrow(MissingProviderKeyError);
  });

  it('throws MissingProviderKeyError when mistral key is missing', () => {
    expect(() =>
      createLanguageModel({ provider: 'mistral', model: 'mistral-small', mistralApiKey: '' }),
    ).toThrow(MissingProviderKeyError);
  });

  it('creates an ollama model without a key (uses openai-compat)', () => {
    const model = createLanguageModel({ provider: 'ollama', model: 'llama3' });
    expect(model).toBeDefined();
  });
});
