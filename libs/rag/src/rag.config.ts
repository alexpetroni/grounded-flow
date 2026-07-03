import type { ConfigService } from '@nestjs/config';
import type { Env } from '@app/config';

export const RAG_CONFIG_TOKEN = Symbol('RAG_CONFIG');

export interface RagConfig {
  chunkTokens: number;
  overlapTokens: number;
  topK: number;
  topN: number;
}

/** Single read point for RAG tuning env vars — see REFACTOR-PLAN R2. */
export function ragConfigFactory(config: ConfigService<Env, true>): RagConfig {
  return {
    chunkTokens: config.get('RAG_CHUNK_TOKENS', { infer: true }),
    overlapTokens: config.get('RAG_CHUNK_OVERLAP', { infer: true }),
    topK: config.get('RAG_TOP_K', { infer: true }),
    topN: config.get('RAG_RERANK_TOP_N', { infer: true }),
  };
}
