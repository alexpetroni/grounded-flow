import type { EmbedResult } from '../embedder/embedder.interface';

export interface ChunkPoint {
  id: string;
  chunkId: string;
  documentId: string;
  ordinal: number;
  text: string;
  metadata: Record<string, unknown>;
  embedding: EmbedResult;
}

export interface VectorStore {
  ensureCollection(dimensions: number): Promise<void>;
  upsert(points: ChunkPoint[]): Promise<void>;
  deleteByDocumentId(documentId: string): Promise<void>;
  search(
    embedding: EmbedResult,
    topK: number,
    filter?: Record<string, unknown>,
  ): Promise<SearchResult[]>;
  /** Dense-only ANN search, returned in descending score order. */
  searchDense(
    dense: number[],
    limit: number,
    filter?: Record<string, unknown>,
  ): Promise<SearchResult[]>;
  /** Sparse-only search, returned in descending score order. */
  searchSparse(
    sparse: { indices: number[]; values: number[] },
    limit: number,
    filter?: Record<string, unknown>,
  ): Promise<SearchResult[]>;
}

export interface SearchResult {
  chunkId: string;
  documentId: string;
  ordinal: number;
  text: string;
  metadata: Record<string, unknown>;
  score: number;
}
