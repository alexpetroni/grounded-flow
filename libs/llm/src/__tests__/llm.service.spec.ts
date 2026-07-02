import { describe, it, expect } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '@app/config';
import { LlmService } from '../llm.service';
import { MissingProviderKeyError } from '../provider-factory';

// Real tests of LlmService's config-reading and provider-selection paths —
// the previous suites stubbed getLanguageModel itself, leaving these untested.
function makeConfig(values: Partial<Record<keyof Env, unknown>>): ConfigService<Env, true> {
  return {
    get: (key: keyof Env) => values[key],
  } as unknown as ConfigService<Env, true>;
}

describe('LlmService', () => {
  it('defaults to the fake language model when no config is provided', () => {
    const service = new LlmService();
    const model = service.getLanguageModel();
    expect((model as { modelId?: string }).modelId).toBe('fake-model');
  });

  it('defaults to the fake embedding model when no config is provided', () => {
    const service = new LlmService();
    const model = service.getEmbeddingModel();
    expect((model as { modelId?: string }).modelId).toBe('fake-embedding');
  });

  it('returns the fake model when LLM_PROVIDER=fake regardless of other config', () => {
    const service = new LlmService(
      makeConfig({ LLM_PROVIDER: 'fake', LLM_MODEL: 'ignored', OPENAI_API_KEY: 'sk-set' }),
    );
    expect((service.getLanguageModel() as { modelId?: string }).modelId).toBe('fake-model');
  });

  it('throws MissingProviderKeyError for a real provider without its key', () => {
    const service = new LlmService(
      makeConfig({ LLM_PROVIDER: 'openai', LLM_MODEL: 'gpt-4o-mini', OPENAI_API_KEY: '' }),
    );
    expect(() => service.getLanguageModel()).toThrow(MissingProviderKeyError);
  });

  it('creates a real provider model when the key is present', () => {
    const service = new LlmService(
      makeConfig({ LLM_PROVIDER: 'openai', LLM_MODEL: 'gpt-4o-mini', OPENAI_API_KEY: 'sk-test' }),
    );
    const model = service.getLanguageModel();
    expect((model as { modelId?: string }).modelId).toBe('gpt-4o-mini');
  });

  it('throws MissingProviderKeyError for embedding provider without its key', () => {
    const service = new LlmService(
      makeConfig({
        EMBEDDING_PROVIDER: 'openai',
        EMBEDDING_MODEL: 'text-embedding-3-small',
        OPENAI_API_KEY: '',
      }),
    );
    expect(() => service.getEmbeddingModel()).toThrow(MissingProviderKeyError);
  });
});
