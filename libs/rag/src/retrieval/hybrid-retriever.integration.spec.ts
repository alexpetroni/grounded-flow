import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GenericContainer, Wait } from 'testcontainers';
import type { StartedTestContainer } from 'testcontainers';
import { QdrantClient } from '@qdrant/js-client-rest';
import { uuidv7 } from 'uuidv7';
import { QdrantVectorStore } from '../vector-store/qdrant.vector-store';
import type { ChunkPoint } from '../vector-store/vector-store.interface';
import type { EmbedResult } from '../embedder/embedder.interface';
import { HybridRetriever } from './hybrid-retriever';
import { detectRagNetwork, attachOrExpose, endpointOf } from '../../../../test/helpers/rag-network';

const COLLECTION = 'retriever_test';
const DIMS = 4;

let container: StartedTestContainer;
let store: QdrantVectorStore;
let retriever: HybridRetriever;

// Stable ids so assertions can reference specific chunks.
const DENSE_ID = uuidv7();
const SPARSE_ID = uuidv7();
const DOC_A = uuidv7();
const DOC_B = uuidv7();

async function startQdrant(): Promise<{ host: string; port: number }> {
  const net = await detectRagNetwork();

  const builder = attachOrExpose(
    new GenericContainer('qdrant/qdrant:v1.13.6').withWaitStrategy(
      Wait.forLogMessage('Qdrant HTTP listening on 6333', 1).withStartupTimeout(60_000),
    ),
    net,
    'qdrant_retriever_test',
    6333,
  );

  container = await builder.start();
  return endpointOf(container, net, 6333);
}

function point(
  id: string,
  documentId: string,
  dense: number[],
  sparse: { indices: number[]; values: number[] },
  text: string,
): ChunkPoint {
  return {
    id,
    chunkId: id,
    documentId,
    ordinal: 0,
    text,
    metadata: {},
    embedding: { dense: { values: dense }, sparse },
  };
}

beforeAll(async () => {
  const { host, port } = await startQdrant();
  const client = new QdrantClient({ url: `http://${host}:${port}`, checkCompatibility: false });
  store = new QdrantVectorStore(client, COLLECTION);
  retriever = new HybridRetriever(store, 10);
  await store.ensureCollection(DIMS);

  await store.upsert([
    // Strong dense match on axis 0, sparse token 10.
    point(DENSE_ID, DOC_A, [0.9, 0.1, 0, 0], { indices: [10], values: [1] }, 'dense target alpha'),
    // Strong dense match on axis 3, unique sparse token 20.
    point(
      SPARSE_ID,
      DOC_A,
      [0, 0, 0.1, 0.9],
      { indices: [20], values: [1] },
      'sparse target zebra',
    ),
    // Filler in a different document.
    point(
      uuidv7(),
      DOC_B,
      [0.3, 0.3, 0.3, 0.3],
      { indices: [30], values: [1] },
      'other doc filler',
    ),
  ]);
}, 90_000);

afterAll(async () => {
  await container?.stop();
});

describe('HybridRetriever', () => {
  it('dense-only retrieval finds the dense-nearest chunk', async () => {
    const embedding: EmbedResult = {
      dense: { values: [1, 0, 0, 0] },
      sparse: { indices: [999], values: [1] },
    };
    const results = await retriever.retrieve(embedding, { mode: 'dense' });
    expect(results[0]!.chunkId).toBe(DENSE_ID);
  });

  it('sparse-only retrieval finds the keyword-matching chunk and excludes non-matches', async () => {
    const embedding: EmbedResult = {
      dense: { values: [0, 0, 0, 0.0001] },
      sparse: { indices: [20], values: [1] },
    };
    const results = await retriever.retrieve(embedding, { mode: 'sparse' });
    expect(results.map((r) => r.chunkId)).toContain(SPARSE_ID);
    expect(results.map((r) => r.chunkId)).not.toContain(DENSE_ID);
  });

  it('hybrid retrieval fuses both vector spaces and surfaces both targets', async () => {
    const embedding: EmbedResult = {
      dense: { values: [0.9, 0.1, 0, 0] },
      sparse: { indices: [20], values: [1] },
    };
    const results = await retriever.retrieve(embedding, { mode: 'hybrid', topK: 5 });
    const ids = results.map((r) => r.chunkId);
    expect(ids).toContain(DENSE_ID);
    expect(ids).toContain(SPARSE_ID);
  });

  it('payload filter excludes non-matching points', async () => {
    const embedding: EmbedResult = {
      dense: { values: [0.3, 0.3, 0.3, 0.3] },
      sparse: { indices: [10, 20, 30], values: [1, 1, 1] },
    };
    const results = await retriever.retrieve(embedding, {
      mode: 'hybrid',
      topK: 10,
      filter: { documentId: DOC_A },
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.documentId === DOC_A)).toBe(true);
  });
});
