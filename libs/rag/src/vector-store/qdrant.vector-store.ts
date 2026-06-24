import { QdrantClient } from '@qdrant/js-client-rest';
import type { VectorStore, ChunkPoint, SearchResult } from './vector-store.interface';

const DENSE_VECTOR = 'dense';
const SPARSE_VECTOR = 'sparse';

export class QdrantVectorStore implements VectorStore {
  constructor(
    private readonly client: QdrantClient,
    private readonly collectionName: string,
  ) {}

  async ensureCollection(dimensions: number): Promise<void> {
    const collections = await this.client.getCollections();
    const exists = collections.collections.some((c) => c.name === this.collectionName);
    if (exists) return;

    await this.client.createCollection(this.collectionName, {
      vectors: {
        [DENSE_VECTOR]: {
          size: dimensions,
          distance: 'Cosine',
        },
      },
      sparse_vectors: {
        [SPARSE_VECTOR]: {},
      },
    });

    // Create payload index for documentId filtering
    await this.client.createPayloadIndex(this.collectionName, {
      field_name: 'documentId',
      field_schema: 'keyword',
    });
  }

  async upsert(points: ChunkPoint[]): Promise<void> {
    if (points.length === 0) return;

    const qdrantPoints = points.map((p) => ({
      id: chunkIdToUint(p.chunkId),
      vector: {
        [DENSE_VECTOR]: p.embedding.dense.values,
        [SPARSE_VECTOR]: {
          indices: p.embedding.sparse.indices,
          values: p.embedding.sparse.values,
        },
      },
      payload: {
        chunkId: p.chunkId,
        documentId: p.documentId,
        ordinal: p.ordinal,
        text: p.text,
        metadata: p.metadata,
      },
    }));

    await this.client.upsert(this.collectionName, {
      wait: true,
      points: qdrantPoints,
    });
  }

  async deleteByDocumentId(documentId: string): Promise<void> {
    await this.client.delete(this.collectionName, {
      wait: true,
      filter: {
        must: [{ key: 'documentId', match: { value: documentId } }],
      },
    });
  }

  async search(
    embedding: { dense: { values: number[] }; sparse: { indices: number[]; values: number[] } },
    topK: number,
    filter?: Record<string, unknown>,
  ): Promise<SearchResult[]> {
    const qdrantFilter = filter ? buildFilter(filter) : undefined;

    const results = await this.client.query(this.collectionName, {
      prefetch: [
        {
          query: embedding.dense.values,
          using: DENSE_VECTOR,
          limit: topK * 2,
          ...(qdrantFilter ? { filter: qdrantFilter } : {}),
        },
        {
          query: { indices: embedding.sparse.indices, values: embedding.sparse.values },
          using: SPARSE_VECTOR,
          limit: topK * 2,
          ...(qdrantFilter ? { filter: qdrantFilter } : {}),
        },
      ],
      query: { fusion: 'rrf' },
      limit: topK,
      with_payload: true,
      ...(qdrantFilter ? { filter: qdrantFilter } : {}),
    });

    return results.points.map((p) => {
      const payload = p.payload as Record<string, unknown>;
      return {
        chunkId: payload['chunkId'] as string,
        documentId: payload['documentId'] as string,
        ordinal: payload['ordinal'] as number,
        text: payload['text'] as string,
        metadata: (payload['metadata'] as Record<string, unknown>) ?? {},
        score: p.score,
      };
    });
  }
}

function chunkIdToUint(chunkId: string): string {
  // Qdrant accepts UUID strings directly as point IDs
  return chunkId;
}

function buildFilter(filter: Record<string, unknown>): {
  must: Array<{ key: string; match: { value: unknown } }>;
} {
  return {
    must: Object.entries(filter).map(([key, value]) => ({
      key,
      match: { value },
    })),
  };
}
