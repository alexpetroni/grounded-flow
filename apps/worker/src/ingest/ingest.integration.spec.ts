import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GenericContainer, Wait } from 'testcontainers';
import type { StartedTestContainer } from 'testcontainers';
import Dockerode from 'dockerode';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { Queue, Worker } from 'bullmq';
import { QdrantClient } from '@qdrant/js-client-rest';
import path from 'path';
import * as schema from '@app/database';
import type { Db } from '@app/database';
import { DocumentsRepository, ChunksRepository, UnitOfWork } from '@app/database';
import { QdrantVectorStore, FakeEmbedder, IngestionService } from '@app/rag';

const MIGRATIONS_FOLDER = path.resolve(__dirname, '../../../../docker/migrations');
const INGEST_QUEUE = 'ingest';
const COLLECTION = 'rag_chunks_ingest_test';

interface IngestJobData {
  documentId: string;
  contentBase64: string;
  mimeType: string;
  source: string;
  metadata: Record<string, unknown>;
}

async function startContainers(): Promise<{
  pgHost: string;
  pgPort: number;
  redisHost: string;
  redisPort: number;
  qdrantHost: string;
  qdrantPort: number;
  pgContainer: StartedTestContainer;
  redisContainer: StartedTestContainer;
  qdrantContainer: StartedTestContainer;
}> {
  const docker = new Dockerode();

  let ragNetworkId: string | null = null;
  try {
    const nets = await docker.listNetworks({ filters: JSON.stringify({ name: ['rag_default'] }) });
    if (nets.length > 0) ragNetworkId = nets[0]?.Id ?? null;
  } catch {
    // not in Docker
  }

  const fakeNetwork = ragNetworkId
    ? ({ getId: () => ragNetworkId, getName: () => 'rag_default' } as unknown as Parameters<
        typeof GenericContainer.prototype.withNetwork
      >[0])
    : null;

  let pgBuilder = new GenericContainer('postgres:16-bookworm')
    .withEnvironment({ POSTGRES_DB: 'rag_test', POSTGRES_USER: 'rag', POSTGRES_PASSWORD: 'rag' })
    .withWaitStrategy(Wait.forSuccessfulCommand('psql -U rag -d rag_test -c "SELECT 1"'));
  let redisBuilder = new GenericContainer('redis:7-bookworm').withWaitStrategy(
    Wait.forSuccessfulCommand('redis-cli ping'),
  );
  let qdrantBuilder = new GenericContainer('qdrant/qdrant:v1.13.6').withWaitStrategy(
    Wait.forLogMessage('Qdrant HTTP listening on 6333', 1).withStartupTimeout(60_000),
  );

  if (fakeNetwork) {
    pgBuilder = pgBuilder.withNetwork(fakeNetwork).withNetworkAliases('pg_ingest_test');
    redisBuilder = redisBuilder.withNetwork(fakeNetwork).withNetworkAliases('redis_ingest_test');
    qdrantBuilder = qdrantBuilder.withNetwork(fakeNetwork).withNetworkAliases('qdrant_ingest_test');
  } else {
    pgBuilder = pgBuilder.withExposedPorts(5432);
    redisBuilder = redisBuilder.withExposedPorts(6379);
    qdrantBuilder = qdrantBuilder.withExposedPorts(6333);
  }

  const [pgContainer, redisContainer, qdrantContainer] = await Promise.all([
    pgBuilder.start(),
    redisBuilder.start(),
    qdrantBuilder.start(),
  ]);

  if (ragNetworkId) {
    const [pgInfo, redisInfo, qdrantInfo] = await Promise.all([
      docker.getContainer(pgContainer.getId()).inspect(),
      docker.getContainer(redisContainer.getId()).inspect(),
      docker.getContainer(qdrantContainer.getId()).inspect(),
    ]);
    return {
      pgHost: pgInfo.NetworkSettings.Networks['rag_default']?.IPAddress ?? pgContainer.getHost(),
      pgPort: 5432,
      redisHost:
        redisInfo.NetworkSettings.Networks['rag_default']?.IPAddress ?? redisContainer.getHost(),
      redisPort: 6379,
      qdrantHost:
        qdrantInfo.NetworkSettings.Networks['rag_default']?.IPAddress ?? qdrantContainer.getHost(),
      qdrantPort: 6333,
      pgContainer,
      redisContainer,
      qdrantContainer,
    };
  }

  return {
    pgHost: pgContainer.getHost(),
    pgPort: pgContainer.getMappedPort(5432),
    redisHost: redisContainer.getHost(),
    redisPort: redisContainer.getMappedPort(6379),
    qdrantHost: qdrantContainer.getHost(),
    qdrantPort: qdrantContainer.getMappedPort(6333),
    pgContainer,
    redisContainer,
    qdrantContainer,
  };
}

describe('Ingest pipeline integration (Postgres + Redis + Qdrant)', () => {
  let pgContainer: StartedTestContainer;
  let redisContainer: StartedTestContainer;
  let qdrantContainer: StartedTestContainer;
  let pool: Pool;
  let queue: Queue<IngestJobData>;
  let bullWorker: Worker;
  let docsRepo: DocumentsRepository;
  let chunksRepo: ChunksRepository;

  beforeAll(async () => {
    const { pgHost, pgPort, redisHost, redisPort, qdrantHost, qdrantPort, ...containers } =
      await startContainers();
    pgContainer = containers.pgContainer;
    redisContainer = containers.redisContainer;
    qdrantContainer = containers.qdrantContainer;

    const dbUrl = `postgresql://rag:rag@${pgHost}:${pgPort}/rag_test`;
    pool = new Pool({ connectionString: dbUrl });
    const db = drizzle(pool, { schema }) as Db;
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });

    docsRepo = new DocumentsRepository(db);
    chunksRepo = new ChunksRepository(db);

    const redisOpts = { host: redisHost, port: redisPort };
    queue = new Queue<IngestJobData>(INGEST_QUEUE, { connection: redisOpts });

    const qdrantClient = new QdrantClient({
      url: `http://${qdrantHost}:${qdrantPort}`,
      checkCompatibility: false,
    });
    const embedder = new FakeEmbedder(4);
    const vectorStore = new QdrantVectorStore(qdrantClient, COLLECTION);
    const ingestionService = new IngestionService(
      docsRepo,
      new UnitOfWork(db),
      embedder,
      vectorStore,
      50,
      10,
    );

    bullWorker = new Worker<IngestJobData>(
      INGEST_QUEUE,
      async (job) => {
        const content = Buffer.from(job.data.contentBase64, 'base64');
        await ingestionService.ingest({
          documentId: job.data.documentId,
          content,
          mimeType: job.data.mimeType,
          source: job.data.source,
          metadata: job.data.metadata,
        });
      },
      { connection: redisOpts, autorun: true },
    );
  }, 120_000);

  afterAll(async () => {
    await bullWorker?.close();
    await queue?.close();
    await pool?.end();
    await pgContainer?.stop();
    await redisContainer?.stop();
    await qdrantContainer?.stop();
  });

  async function waitForDocumentStatus(
    docId: string,
    expectedStatus: string,
    timeoutMs = 15_000,
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const doc = await docsRepo.findById(docId);
      if (doc?.status === expectedStatus) return;
      await new Promise((r) => setTimeout(r, 200));
    }
    const doc = await docsRepo.findById(docId);
    throw new Error(
      `Timed out waiting for document ${docId} to be ${expectedStatus}. Got: ${doc?.status}`,
    );
  }

  it('queued ingest → document completed with chunks in Postgres', async () => {
    const doc = await docsRepo.create({
      source: 'introduction.md',
      mimeType: 'text/markdown',
      metadata: {},
    });

    const content =
      '# Introduction\n\nMachine learning is a subset of artificial intelligence. ' +
      'It focuses on building systems that can learn from data. '.repeat(5);
    const contentBase64 = Buffer.from(content).toString('base64');

    await queue.add('ingest', {
      documentId: doc.id,
      contentBase64,
      mimeType: 'text/markdown',
      source: 'introduction.md',
      metadata: {},
    });

    await waitForDocumentStatus(doc.id, 'completed');

    const updatedDoc = await docsRepo.findById(doc.id);
    expect(updatedDoc?.status).toBe('completed');

    const chunkCount = await chunksRepo.countByDocumentId(doc.id);
    expect(chunkCount).toBeGreaterThan(0);
  });

  it('idempotent re-ingest: re-ingesting same document produces no duplicate chunks', async () => {
    const doc = await docsRepo.create({
      source: 'rag-overview.txt',
      mimeType: 'text/plain',
      metadata: {},
    });

    const content = 'Retrieval-Augmented Generation combines retrieval and generation. '.repeat(20);
    const contentBase64 = Buffer.from(content).toString('base64');

    const jobData: IngestJobData = {
      documentId: doc.id,
      contentBase64,
      mimeType: 'text/plain',
      source: 'rag-overview.txt',
      metadata: {},
    };

    await queue.add('ingest', jobData);
    await waitForDocumentStatus(doc.id, 'completed');
    const firstCount = await chunksRepo.countByDocumentId(doc.id);

    // Re-ingest — reset to pending then run again
    await docsRepo.updateStatus(doc.id, 'pending');
    await queue.add('ingest', jobData);
    await waitForDocumentStatus(doc.id, 'completed');

    const secondCount = await chunksRepo.countByDocumentId(doc.id);
    expect(secondCount).toBe(firstCount);
  });

  it('ingestion failure captures error on document', async () => {
    const doc = await docsRepo.create({
      source: 'bad.bin',
      mimeType: 'application/octet-stream',
      metadata: {},
    });

    await queue.add('ingest', {
      documentId: doc.id,
      contentBase64: Buffer.from('binary data').toString('base64'),
      mimeType: 'application/octet-stream',
      source: 'bad.bin',
      metadata: {},
    });

    await waitForDocumentStatus(doc.id, 'failed');
    const failed = await docsRepo.findById(doc.id);
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toBeTruthy();
  });
}, 120_000);
