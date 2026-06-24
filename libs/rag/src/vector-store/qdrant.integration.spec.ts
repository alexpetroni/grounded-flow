import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GenericContainer, Wait } from 'testcontainers';
import type { StartedTestContainer } from 'testcontainers';
import Dockerode from 'dockerode';
import { QdrantClient } from '@qdrant/js-client-rest';
import { QdrantVectorStore } from './qdrant.vector-store';
import { FakeEmbedder } from '../embedder/fake.embedder';
import { uuidv7 } from 'uuidv7';

const COLLECTION = 'test_chunks';
const DIMS = 4;

let container: StartedTestContainer;
let store: QdrantVectorStore;
let embedder: FakeEmbedder;

async function startQdrant(): Promise<{ host: string; port: number }> {
  const docker = new Dockerode();

  let ragNetworkId: string | null = null;
  try {
    const nets = await docker.listNetworks({ filters: JSON.stringify({ name: ['rag_default'] }) });
    if (nets.length > 0) ragNetworkId = nets[0]?.Id ?? null;
  } catch {
    // not in Docker or no socket — use standard strategy
  }

  const fakeNetwork = ragNetworkId
    ? ({ getId: () => ragNetworkId, getName: () => 'rag_default' } as unknown as Parameters<
        typeof GenericContainer.prototype.withNetwork
      >[0])
    : null;

  let builder = new GenericContainer('qdrant/qdrant:v1.13.6').withWaitStrategy(
    Wait.forLogMessage('Qdrant HTTP listening on 6333', 1).withStartupTimeout(60_000),
  );

  if (fakeNetwork) {
    builder = builder.withNetwork(fakeNetwork).withNetworkAliases('qdrant_tc_test');
  } else {
    builder = builder.withExposedPorts(6333);
  }

  container = await builder.start();

  if (ragNetworkId) {
    const info = await docker.getContainer(container.getId()).inspect();
    const ip = info.NetworkSettings.Networks['rag_default']?.IPAddress ?? container.getHost();
    return { host: ip, port: 6333 };
  }

  return { host: container.getHost(), port: container.getMappedPort(6333) };
}

beforeAll(async () => {
  const { host, port } = await startQdrant();
  const client = new QdrantClient({ url: `http://${host}:${port}`, checkCompatibility: false });
  store = new QdrantVectorStore(client, COLLECTION);
  embedder = new FakeEmbedder(DIMS);
  await store.ensureCollection(DIMS);
}, 90_000);

afterAll(async () => {
  await container?.stop();
});

function makePoint(documentId: string, ordinal: number) {
  return {
    id: uuidv7(),
    chunkId: uuidv7(),
    documentId,
    ordinal,
    text: `chunk ordinal ${ordinal} for document ${documentId}`,
    metadata: { source: 'test' },
    embedding: {
      dense: { values: Array.from({ length: DIMS }, (_, i) => (ordinal + i) * 0.1) },
      sparse: { indices: [ordinal, ordinal + 1], values: [0.5, 0.3] },
    },
  };
}

describe('QdrantVectorStore', () => {
  it('upserts points and retrieves them via search', async () => {
    const docId = uuidv7();
    const points = [makePoint(docId, 0), makePoint(docId, 1)];
    await store.upsert(points);

    const [embedResult] = await embedder.embed(['machine learning']);
    const results = await store.search(embedResult!, 5);
    expect(results.length).toBeGreaterThan(0);
  });

  it('is idempotent — re-upserting the same chunkIds produces no duplicates', async () => {
    const docId = uuidv7();
    const chunkId = uuidv7();
    const point = {
      id: uuidv7(),
      chunkId,
      documentId: docId,
      ordinal: 0,
      text: 'idempotency test chunk',
      metadata: {},
      embedding: {
        dense: { values: Array.from({ length: DIMS }, () => 0.1) },
        sparse: { indices: [100], values: [0.5] },
      },
    };

    await store.upsert([point]);
    await store.upsert([point]); // re-upsert same point

    const [embedResult] = await embedder.embed(['idempotency test chunk']);
    const results = await store.search(embedResult!, 20);
    const matching = results.filter((r) => r.chunkId === chunkId);
    expect(matching).toHaveLength(1);
  });

  it('deleteByDocumentId removes all chunks for that document', async () => {
    const docId = uuidv7();
    const points = [makePoint(docId, 0), makePoint(docId, 1)];
    await store.upsert(points);

    await store.deleteByDocumentId(docId);

    const [embedResult] = await embedder.embed(['chunk ordinal']);
    const results = await store.search(embedResult!, 50);
    const remaining = results.filter((r) => r.documentId === docId);
    expect(remaining).toHaveLength(0);
  });

  it('ensureCollection is idempotent — calling twice does not throw', async () => {
    await expect(store.ensureCollection(DIMS)).resolves.not.toThrow();
  });

  it('handles empty upsert gracefully', async () => {
    await expect(store.upsert([])).resolves.not.toThrow();
  });
});
