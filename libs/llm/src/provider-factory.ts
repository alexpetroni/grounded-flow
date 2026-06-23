import type { LanguageModel, EmbeddingModel } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createMistral } from '@ai-sdk/mistral';

export type LlmProviderName = 'openai' | 'anthropic' | 'google' | 'mistral' | 'ollama' | 'fake';

export interface ProviderConfig {
  provider: string;
  model: string;
  embeddingProvider?: string;
  embeddingModel?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  googleApiKey?: string;
  mistralApiKey?: string;
  ollamaBaseUrl?: string;
}

export class UnknownProviderError extends Error {
  constructor(provider: string) {
    super(
      `Unknown LLM provider: "${provider}". Supported: openai, anthropic, google, mistral, ollama, fake.`,
    );
    this.name = 'UnknownProviderError';
  }
}

export class MissingProviderKeyError extends Error {
  constructor(provider: string) {
    super(
      `Provider "${provider}" requires an API key that is not configured. ` +
        `Set the corresponding environment variable or use provider=fake for development.`,
    );
    this.name = 'MissingProviderKeyError';
  }
}

export function createLanguageModel(config: ProviderConfig): LanguageModel {
  const { provider, model } = config;

  switch (provider) {
    case 'openai':
      if (!config.openaiApiKey) throw new MissingProviderKeyError('openai');
      return createOpenAI({ apiKey: config.openaiApiKey })(model);
    case 'anthropic':
      if (!config.anthropicApiKey) throw new MissingProviderKeyError('anthropic');
      return createAnthropic({ apiKey: config.anthropicApiKey })(model);
    case 'google':
      if (!config.googleApiKey) throw new MissingProviderKeyError('google');
      return createGoogleGenerativeAI({ apiKey: config.googleApiKey })(model);
    case 'mistral':
      if (!config.mistralApiKey) throw new MissingProviderKeyError('mistral');
      return createMistral({ apiKey: config.mistralApiKey })(model);
    case 'ollama': {
      const baseURL = config.ollamaBaseUrl ?? 'http://localhost:11434/v1';
      return createOpenAI({ baseURL, apiKey: 'ollama' })(model);
    }
    default:
      throw new UnknownProviderError(provider);
  }
}

export function createEmbeddingModel(config: ProviderConfig): EmbeddingModel {
  const provider = config.embeddingProvider ?? config.provider;
  const model = config.embeddingModel ?? 'text-embedding-3-small';

  switch (provider) {
    case 'openai':
      if (!config.openaiApiKey) throw new MissingProviderKeyError('openai');
      return createOpenAI({ apiKey: config.openaiApiKey }).textEmbeddingModel(model);
    case 'ollama': {
      const baseURL = config.ollamaBaseUrl ?? 'http://localhost:11434/v1';
      return createOpenAI({ baseURL, apiKey: 'ollama' }).textEmbeddingModel(model);
    }
    default:
      throw new UnknownProviderError(`${provider} (embedding)`);
  }
}
