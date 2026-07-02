import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LanguageModel, EmbeddingModel } from 'ai';
import type { Env } from '@app/config';
import {
  createLanguageModel,
  createEmbeddingModel,
  UnknownProviderError,
} from './provider-factory';
import { createFakeLanguageModel, createFakeEmbeddingModel } from './fake-provider';

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  constructor(@Optional() private readonly config?: ConfigService<Env, true>) {}

  getLanguageModel(): LanguageModel {
    const provider = this.config?.get('LLM_PROVIDER', { infer: true }) ?? 'fake';
    const model = this.config?.get('LLM_MODEL', { infer: true }) ?? 'fake-model';

    if (provider === 'fake') {
      return createFakeLanguageModel();
    }

    return this.create('language', provider, () =>
      createLanguageModel({
        provider,
        model,
        openaiApiKey: this.config?.get('OPENAI_API_KEY', { infer: true }),
        anthropicApiKey: this.config?.get('ANTHROPIC_API_KEY_APP', { infer: true }),
        googleApiKey: this.config?.get('GOOGLE_API_KEY', { infer: true }),
        mistralApiKey: this.config?.get('MISTRAL_API_KEY', { infer: true }),
        ollamaBaseUrl: this.config?.get('OLLAMA_BASE_URL', { infer: true }),
      }),
    );
  }

  getEmbeddingModel(): EmbeddingModel {
    const provider = this.config?.get('EMBEDDING_PROVIDER', { infer: true }) ?? 'fake';
    const model = this.config?.get('EMBEDDING_MODEL', { infer: true }) ?? 'fake-embedding';

    if (provider === 'fake') {
      return createFakeEmbeddingModel();
    }

    return this.create('embedding', provider, () =>
      createEmbeddingModel({
        provider,
        model,
        embeddingProvider: provider,
        embeddingModel: model,
        openaiApiKey: this.config?.get('OPENAI_API_KEY', { infer: true }),
        ollamaBaseUrl: this.config?.get('OLLAMA_BASE_URL', { infer: true }),
      }),
    );
  }

  private create<T>(kind: 'language' | 'embedding', provider: string, factory: () => T): T {
    try {
      return factory();
    } catch (err) {
      if (!(err instanceof UnknownProviderError)) {
        this.logger.warn(
          `Failed to create ${kind} model for provider "${provider}": ${String(err)}`,
        );
      }
      throw err;
    }
  }
}
