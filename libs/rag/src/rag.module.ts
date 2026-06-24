import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QdrantClient } from '@qdrant/js-client-rest';
import type { EmbeddingModel } from 'ai';
import { DatabaseModule } from '@app/database';
import { DocumentsRepository, ChunksRepository } from '@app/database';
import { createEmbeddingModel } from '@app/llm';
import type { Env } from '@app/config';
import { AiSdkEmbedder } from './embedder/ai-sdk.embedder';
import { QdrantVectorStore } from './vector-store/qdrant.vector-store';
import {
  IngestionService,
  EMBEDDER_TOKEN,
  VECTOR_STORE_TOKEN,
} from './ingestion/ingestion.service';

export const QDRANT_CLIENT_TOKEN = Symbol('QDRANT_CLIENT');

@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: QDRANT_CLIENT_TOKEN,
      useFactory: (config: ConfigService<Env, true>) => {
        const url = config.get('QDRANT_URL', { infer: true });
        const apiKey = config.get('QDRANT_API_KEY', { infer: true });
        return new QdrantClient({ url, ...(apiKey ? { apiKey } : {}) });
      },
      inject: [ConfigService],
    },
    {
      provide: EMBEDDER_TOKEN,
      useFactory: (config: ConfigService<Env, true>) => {
        const provider = config.get('EMBEDDING_PROVIDER', { infer: true });
        const modelId = config.get('EMBEDDING_MODEL', { infer: true });
        try {
          const model = createEmbeddingModel({
            provider,
            model: modelId,
            embeddingProvider: provider,
            embeddingModel: modelId,
          }) as EmbeddingModel;
          return new AiSdkEmbedder(model, 1536);
        } catch {
          // Graceful degradation: if provider key is missing, return a no-op embedder
          // that will cause ingestion to fail with a clear message rather than crashing boot
          return {
            dimensions: 1536,
            embed: async () => {
              throw new Error(
                `Embedding provider "${provider}" is not configured (missing API key)`,
              );
            },
          };
        }
      },
      inject: [ConfigService],
    },
    {
      provide: VECTOR_STORE_TOKEN,
      useFactory: (client: QdrantClient, config: ConfigService<Env, true>) => {
        const collection = config.get('QDRANT_COLLECTION', { infer: true });
        return new QdrantVectorStore(client, collection);
      },
      inject: [QDRANT_CLIENT_TOKEN, ConfigService],
    },
    {
      provide: IngestionService,
      useFactory: (
        docsRepo: DocumentsRepository,
        chunksRepo: ChunksRepository,
        embedder: AiSdkEmbedder,
        vectorStore: QdrantVectorStore,
        config: ConfigService<Env, true>,
      ) => {
        const chunkTokens = config.get('RAG_CHUNK_TOKENS', { infer: true });
        const overlapTokens = config.get('RAG_CHUNK_OVERLAP', { infer: true });
        return new IngestionService(
          docsRepo,
          chunksRepo,
          embedder,
          vectorStore,
          chunkTokens,
          overlapTokens,
        );
      },
      inject: [
        DocumentsRepository,
        ChunksRepository,
        EMBEDDER_TOKEN,
        VECTOR_STORE_TOKEN,
        ConfigService,
      ],
    },
  ],
  exports: [IngestionService, EMBEDDER_TOKEN, VECTOR_STORE_TOKEN, QDRANT_CLIENT_TOKEN],
})
export class RagModule {}
