import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GenericContainer, Wait } from 'testcontainers';
import type { StartedTestContainer } from 'testcontainers';
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
import { INGEST_QUEUE } from '@app/core';
import { detectRagNetwork, attachOrExpose, endpointOf } from '../../../../test/helpers/rag-network';

const MIGRATIONS_FOLDER = path.resolve(__dirname, '../../../../docker/migrations');
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
  const net = await detectRagNetwork();

  const pgBuilder = attachOrExpose(
    new GenericContainer('postgres:16-bookworm')
      .withEnvironment({ POSTGRES_DB: 'rag_test', POSTGRES_USER: 'rag', POSTGRES_PASSWORD: 'rag' })
      .withWaitStrategy(
        // Postgres inits, RESTARTS, then listens: a psql check via the unix
        // socket passes during the first phase, before TCP is actually up
        // (flaky ECONNREFUSED through the docker gateway). The second "ready"
        // log line marks the real, post-restart listen.
        Wait.forLogMessage(/database system is ready to accept connections/, 2).withStartupTimeout(
          60_000,
        ),
      ),
    net,
    'pg_ingest_test',
    5432,
  );
  const redisBuilder = attachOrExpose(
    new GenericContainer('redis:7-bookworm').withWaitStrategy(
      Wait.forSuccessfulCommand('redis-cli ping'),
    ),
    net,
    'redis_ingest_test',
    6379,
  );
  const qdrantBuilder = attachOrExpose(
    new GenericContainer('qdrant/qdrant:v1.13.6').withWaitStrategy(
      Wait.forLogMessage('Qdrant HTTP listening on 6333', 1).withStartupTimeout(60_000),
    ),
    net,
    'qdrant_ingest_test',
    6333,
  );

  const [pgContainer, redisContainer, qdrantContainer] = await Promise.all([
    pgBuilder.start(),
    redisBuilder.start(),
    qdrantBuilder.start(),
  ]);

  const [pg, redis, qdrant] = await Promise.all([
    endpointOf(pgContainer, net, 5432),
    endpointOf(redisContainer, net, 6379),
    endpointOf(qdrantContainer, net, 6333),
  ]);

  return {
    pgHost: pg.host,
    pgPort: pg.port,
    redisHost: redis.host,
    redisPort: redis.port,
    qdrantHost: qdrant.host,
    qdrantPort: qdrant.port,
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
      { chunkTokens: 50, overlapTokens: 10 },
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
