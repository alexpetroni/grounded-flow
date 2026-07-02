import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { GenericContainer, Wait } from 'testcontainers';
import type { StartedTestContainer } from 'testcontainers';
import { QdrantClient } from '@qdrant/js-client-rest';
import { uuidv7 } from 'uuidv7';
import { readFileSync } from 'fs';
import path from 'path';
import {
  QdrantVectorStore,
  FakeEmbedder,
  Chunker,
  getLoader,
  HybridRetriever,
  PassthroughReranker,
  RagAnswerNode,
  RagQueryService,
} from '@app/rag';
import type { ChunkPoint } from '@app/rag';
import { LlmService, createFakeLanguageModel } from '@app/llm';
import { RagController } from '../apps/api/src/rag/rag.controller';
import { detectRagNetwork, attachOrExpose, endpointOf } from './helpers/rag-network';

const COLLECTION = 'rag_query_e2e';
const DIMS = 4;
const CORPUS_DIR = path.resolve(__dirname, 'fixtures/corpus');

const CORPUS: Array<{ file: string; mime: string }> = [
  { file: 'introduction.md', mime: 'text/markdown' },
  { file: 'rag-overview.txt', mime: 'text/plain' },
  { file: 'vectors.html', mime: 'text/html' },
];

// The fake LLM cites a chunkId that is NOT in the corpus, forcing the grounding
// validator to reject + repair it — proving the regression end-to-end.
const HALLUCINATED_ID = '00000000-0000-0000-0000-000000000000';
let currentResponses: string[] | undefined;

const FAKE_ANSWER = JSON.stringify({
  answer: 'Retrieval-Augmented Generation grounds generated answers in retrieved source chunks.',
  citations: [{ chunkId: HALLUCINATED_ID, quote: 'retrieval augmented generation' }],
  confidence: 0.85,
});

let container: StartedTestContainer;
let app: INestApplication;

async function startQdrant(): Promise<{ host: string; port: number }> {
  const net = await detectRagNetwork();

  const builder = attachOrExpose(
    new GenericContainer('qdrant/qdrant:v1.13.6').withWaitStrategy(
      Wait.forLogMessage('Qdrant HTTP listening on 6333', 1).withStartupTimeout(60_000),
    ),
    net,
    'qdrant_rag_e2e',
    6333,
  );

  container = await builder.start();
  return endpointOf(container, net, 6333);
}

async function ingestCorpus(store: QdrantVectorStore, embedder: FakeEmbedder): Promise<void> {
  const chunker = new Chunker({ chunkTokens: 60, overlapTokens: 10 });
  for (const { file, mime } of CORPUS) {
    const buf = readFileSync(path.join(CORPUS_DIR, file));
    const loaded = await getLoader(mime).load(buf, file, {});
    const raw = chunker.chunk(loaded.text);
    const embeds = await embedder.embed(raw.map((c) => c.text));
    const points: ChunkPoint[] = raw.map((c, i) => {
      const id = uuidv7();
      return {
        id,
        chunkId: id,
        documentId: file,
        ordinal: c.ordinal,
        text: c.text,
        metadata: { source: file },
        embedding: embeds[i]!,
      };
    });
    await store.upsert(points);
  }
}

beforeAll(async () => {
  const { host, port } = await startQdrant();
  const client = new QdrantClient({ url: `http://${host}:${port}`, checkCompatibility: false });
  const embedder = new FakeEmbedder(DIMS);
  const store = new QdrantVectorStore(client, COLLECTION);
  await store.ensureCollection(DIMS);
  await ingestCorpus(store, embedder);

  const llm = new LlmService();
  // Mutable per-test response: undefined → the default fake, which cites the
  // first chunkId it sees in the prompt (genuine grounding); FAKE_ANSWER →
  // a hallucinated citation to exercise the repair path.
  llm.getLanguageModel = () =>
    createFakeLanguageModel(currentResponses ? { responses: currentResponses } : {});
  const answerNode = new RagAnswerNode(llm);

  const ragQueryService = new RagQueryService(
    embedder,
    new HybridRetriever(store, 20),
    new PassthroughReranker(),
    answerNode,
    { topK: 20, topN: 5 },
  );

  const moduleRef = await Test.createTestingModule({
    controllers: [RagController],
    providers: [{ provide: RagQueryService, useValue: ragQueryService }],
  }).compile();

  app = moduleRef.createNestApplication();
  await app.init();
}, 120_000);

afterAll(async () => {
  await app?.close();
  await container?.stop();
});

describe('POST /rag/query (e2e)', () => {
  it('returns a grounded, cited answer over the ingested corpus', async () => {
    currentResponses = undefined; // default fake cites genuinely from the prompt
    const res = await request(app.getHttpServer())
      .post('/rag/query')
      .send({ query: 'What is retrieval augmented generation?' })
      .expect(201);

    expect(typeof res.body.answer).toBe('string');
    expect(res.body.answer.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body.citations)).toBe(true);
    expect(res.body.citations.length).toBeGreaterThan(0);
    expect(res.body.retrieved.length).toBeGreaterThan(0);

    // Every citation resolves to an actually-retrieved chunk (grounding invariant).
    const retrievedIds = new Set<string>(
      res.body.retrieved.map((r: { chunkId: string }) => r.chunkId),
    );
    for (const c of res.body.citations) {
      expect(retrievedIds.has(c.chunkId)).toBe(true);
    }
    expect(res.body.grounded).toBe(true);
    expect(res.body.repaired).toBe(false);
  });

  it('repairs the hallucinated citation rather than echoing it back', async () => {
    currentResponses = [FAKE_ANSWER];
    const res = await request(app.getHttpServer())
      .post('/rag/query')
      .send({ query: 'Explain hybrid retrieval.' })
      .expect(201);

    // The model cited a chunk that does not exist; it must not survive.
    expect(
      res.body.citations.every((c: { chunkId: string }) => c.chunkId !== HALLUCINATED_ID),
    ).toBe(true);
    expect(res.body.repaired).toBe(true);
    // Regression: a repaired answer must not claim to be grounded.
    expect(res.body.grounded).toBe(false);
  });

  it('dense-only retrieval returns chunks', async () => {
    const res = await request(app.getHttpServer())
      .post('/rag/query')
      .send({ query: 'vectors and embeddings', mode: 'dense' })
      .expect(201);
    expect(res.body.retrieved.length).toBeGreaterThan(0);
  });

  it('rejects an empty query with 400', async () => {
    await request(app.getHttpServer()).post('/rag/query').send({ query: '' }).expect(400);
  });

  it('rejects a malformed body with 400', async () => {
    await request(app.getHttpServer()).post('/rag/query').send({ topK: 5 }).expect(400);
  });
});
