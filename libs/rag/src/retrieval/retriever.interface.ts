import type { EmbedResult } from '../embedder/embedder.interface';
import type { SearchResult } from '../vector-store/vector-store.interface';

/** A chunk returned from retrieval; `score` is the fused (or native) relevance. */
export type RetrievedChunk = SearchResult;

export type RetrievalMode = 'hybrid' | 'dense' | 'sparse';

export interface RetrieveOptions {
  /** Final number of chunks to return. Falls back to the configured default. */
  topK?: number;
  /** Qdrant payload filter, e.g. `{ documentId }` or `{ 'metadata.lang': 'en' }`. */
  filter?: Record<string, unknown>;
  /** Which vector spaces to query and fuse. Defaults to `'hybrid'`. */
  mode?: RetrievalMode;
}

export interface Retriever {
  retrieve(embedding: EmbedResult, options?: RetrieveOptions): Promise<RetrievedChunk[]>;
}
