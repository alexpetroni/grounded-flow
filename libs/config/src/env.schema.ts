import { z } from 'zod';

const coercePort = z
  .string()
  .or(z.number())
  .transform((v) => Number(v))
  .refine((v) => v > 0 && v < 65536, 'must be a valid port');

const coerceInt = z
  .string()
  .or(z.number())
  .transform((v) => Number(v))
  .refine((v) => Number.isInteger(v) && v >= 0, 'must be a non-negative integer');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_PORT: coercePort.default('8080'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Postgres (required for app to work)
  DATABASE_URL: z.string().url(),

  // Redis / BullMQ (required)
  REDIS_URL: z.string().url(),

  // Qdrant (required)
  QDRANT_URL: z.string().url(),
  QDRANT_API_KEY: z.string().default(''),
  QDRANT_COLLECTION: z.string().default('rag_chunks'),

  // LLM / embeddings — optional; capabilities degrade gracefully when unset.
  // Providers are enums so a typo fails loudly at boot validation instead of
  // booting fine and hard-throwing on the first query.
  LLM_PROVIDER: z
    .enum(['openai', 'anthropic', 'google', 'mistral', 'ollama', 'fake'])
    .default('openai'),
  LLM_MODEL: z.string().default('gpt-4o-mini'),
  EMBEDDING_PROVIDER: z.enum(['openai', 'ollama', 'fake']).default('openai'),
  EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  OPENAI_API_KEY: z.string().default(''),
  ANTHROPIC_API_KEY_APP: z.string().default(''),
  GOOGLE_API_KEY: z.string().default(''),
  MISTRAL_API_KEY: z.string().default(''),
  OLLAMA_BASE_URL: z.string().default('http://localhost:11434/v1'),

  // Reranker
  RERANK_PROVIDER: z.string().default('cohere'),
  COHERE_API_KEY: z.string().default(''),

  // RAG tuning
  RAG_CHUNK_TOKENS: coercePort.default('512'),
  RAG_CHUNK_OVERLAP: coercePort.default('64'),
  RAG_TOP_K: coercePort.default('20'),
  RAG_RERANK_TOP_N: coercePort.default('5'),

  // Worker / queue hardening
  WORKER_CONCURRENCY: coerceInt.default('5'),
  BULLMQ_ATTEMPTS: coerceInt.default('3'),
  BULLMQ_BACKOFF_MS: coerceInt.default('1000'),

  // API hardening
  API_BODY_LIMIT: z.string().default('5mb'),
  RATE_LIMIT_MAX: coerceInt.default('0'), // 0 = disabled
  RATE_LIMIT_WINDOW_MS: coerceInt.default('60000'),
  API_KEY: z.string().default(''), // empty = guard disabled

  // Observability — all optional, NoOp when unset
  LANGFUSE_PUBLIC_KEY: z.string().default(''),
  LANGFUSE_SECRET_KEY: z.string().default(''),
  LANGFUSE_BASE_URL: z.string().default('https://cloud.langfuse.com'),
});

export type Env = z.infer<typeof envSchema>;
