import { Module, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QdrantClient } from '@qdrant/js-client-rest';
import type { EmbeddingModel } from 'ai';
import { DatabaseModule } from '@app/database';
import { DocumentsRepository, UnitOfWork } from '@app/database';
import { createEmbeddingModel, LlmModule, LlmService } from '@app/llm';
import { TracingService } from '@app/observability';
import type { Env } from '@app/config';
import { AiSdkEmbedder } from './embedder/ai-sdk.embedder';
import { FakeEmbedder } from './embedder/fake.embedder';
import { QdrantVectorStore } from './vector-store/qdrant.vector-store';
import {
  IngestionService,
  EMBEDDER_TOKEN,
  VECTOR_STORE_TOKEN,
} from './ingestion/ingestion.service';
import { HybridRetriever } from './retrieval/hybrid-retriever';
import type { Embedder } from './embedder/embedder.interface';
import type { VectorStore } from './vector-store/vector-store.interface';
import type { Retriever } from './retrieval/retriever.interface';
import type { Reranker } from './rerank/reranker.interface';
import { PassthroughReranker } from './rerank/passthrough.reranker';
import { CohereReranker } from './rerank/cohere.reranker';
import { RagAnswerNode } from './generation/rag-answer.node';
import { RagQueryService, type RagQueryDefaults } from './query/rag-query.service';
import {
  RETRIEVER_TOKEN,
  RERANKER_TOKEN,
  RAG_QUERY_DEFAULTS_TOKEN,
} from './query/rag-query.tokens';

export const QDRANT_CLIENT_TOKEN = Symbol('QDRANT_CLIENT');

@Module({
  imports: [DatabaseModule, LlmModule],
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
        // Deterministic fake embedder for keyless / test / smoke runs.
        // Use the standard 1536 dims so collections stay dimension-compatible.
        if (provider === 'fake') {
          return new FakeEmbedder(1536);
        }
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
        unitOfWork: UnitOfWork,
        embedder: AiSdkEmbedder,
        vectorStore: QdrantVectorStore,
        config: ConfigService<Env, true>,
      ) => {
        const chunkTokens = config.get('RAG_CHUNK_TOKENS', { infer: true });
        const overlapTokens = config.get('RAG_CHUNK_OVERLAP', { infer: true });
        return new IngestionService(
          docsRepo,
          unitOfWork,
          embedder,
          vectorStore,
          chunkTokens,
          overlapTokens,
        );
      },
      inject: [DocumentsRepository, UnitOfWork, EMBEDDER_TOKEN, VECTOR_STORE_TOKEN, ConfigService],
    },
    {
      provide: RETRIEVER_TOKEN,
      useFactory: (vectorStore: VectorStore, config: ConfigService<Env, true>): Retriever => {
        const topK = config.get('RAG_TOP_K', { infer: true });
        return new HybridRetriever(vectorStore, topK);
      },
      inject: [VECTOR_STORE_TOKEN, ConfigService],
    },
    {
      provide: RERANKER_TOKEN,
      useFactory: (config: ConfigService<Env, true>): Reranker => {
        const provider = config.get('RERANK_PROVIDER', { infer: true });
        const apiKey = config.get('COHERE_API_KEY', { infer: true });
        if (provider === 'cohere' && apiKey) {
          return new CohereReranker({ apiKey });
        }
        // Graceful degradation: no rerank key → keep retrieval order.
        new Logger(RagModule.name).warn(
          `Reranker "${provider}" unavailable (missing key); using passthrough order`,
        );
        return new PassthroughReranker();
      },
      inject: [ConfigService],
    },
    {
      provide: RAG_QUERY_DEFAULTS_TOKEN,
      useFactory: (config: ConfigService<Env, true>): RagQueryDefaults => ({
        topK: config.get('RAG_TOP_K', { infer: true }),
        topN: config.get('RAG_RERANK_TOP_N', { infer: true }),
      }),
      inject: [ConfigService],
    },
    {
      provide: RagAnswerNode,
      useFactory: (llmService: LlmService, tracing?: TracingService) =>
        new RagAnswerNode(llmService, tracing),
      inject: [LlmService, { token: TracingService, optional: true }],
    },
    {
      provide: RagQueryService,
      useFactory: (
        embedder: Embedder,
        retriever: Retriever,
        reranker: Reranker,
        answerNode: RagAnswerNode,
        defaults: RagQueryDefaults,
      ) => new RagQueryService(embedder, retriever, reranker, answerNode, defaults),
      inject: [
        EMBEDDER_TOKEN,
        RETRIEVER_TOKEN,
        RERANKER_TOKEN,
        RagAnswerNode,
        RAG_QUERY_DEFAULTS_TOKEN,
      ],
    },
  ],
  exports: [
    IngestionService,
    EMBEDDER_TOKEN,
    VECTOR_STORE_TOKEN,
    QDRANT_CLIENT_TOKEN,
    RETRIEVER_TOKEN,
    RERANKER_TOKEN,
    RagQueryService,
  ],
})
export class RagModule {}
