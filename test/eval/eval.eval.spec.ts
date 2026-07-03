import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GenericContainer, Wait } from 'testcontainers';
import type { StartedTestContainer } from 'testcontainers';
import { QdrantClient } from '@qdrant/js-client-rest';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import {
  QdrantVectorStore,
  FakeEmbedder,
  HybridRetriever,
  aggregate,
  checkRatchet,
  checkThresholds,
} from '@app/rag';
import type { EvalMetrics, RankedRelevance, RetrievalMode } from '@app/rag';
import { detectRagNetwork, attachOrExpose, endpointOf } from '../helpers/rag-network';
import { ingestCorpus } from '../helpers/corpus';

const COLLECTION = 'rag_eval';
const DIMS = 4;
const DATASET = path.resolve(__dirname, 'dataset.jsonl');
const BASELINE = path.resolve(__dirname, 'baseline.json');

// Dense vectors from the FakeEmbedder are positional, not semantic, so the
// deterministic (no-keys) eval scores the lexical/sparse channel. A full hybrid
// eval with real embeddings is opt-in via EVAL_RETRIEVAL_MODE=hybrid + keys.
const RETRIEVAL_MODE = (process.env.EVAL_RETRIEVAL_MODE as RetrievalMode) ?? 'sparse';

// DoD thresholds (faithfulness is gated on a real LLM judge → only checked when measured).
const THRESHOLDS: Partial<EvalMetrics> = { recallAt5: 0.85, mrr: 0.7, faithfulness: 0.9 };

interface DatasetRow {
  query: string;
  goldSource: string;
  goldAnswer: string;
}

let container: StartedTestContainer;
let retriever: HybridRetriever;
const embedder = new FakeEmbedder(DIMS);

async function startQdrant(): Promise<{ host: string; port: number }> {
  const net = await detectRagNetwork();

  const builder = attachOrExpose(
    new GenericContainer('qdrant/qdrant:v1.13.6').withWaitStrategy(
      Wait.forLogMessage('Qdrant HTTP listening on 6333', 1).withStartupTimeout(60_000),
    ),
    net,
    'qdrant_eval',
    6333,
  );

  container = await builder.start();
  return endpointOf(container, net, 6333);
}

function loadDataset(): DatasetRow[] {
  return readFileSync(DATASET, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as DatasetRow);
}

describe('RAG eval harness', () => {
  let metrics: EvalMetrics;
  let dataset: DatasetRow[];

  beforeAll(async () => {
    const { host, port } = await startQdrant();
    const client = new QdrantClient({ url: `http://${host}:${port}`, checkCompatibility: false });
    const store = new QdrantVectorStore(client, COLLECTION);
    await store.ensureCollection(DIMS);
    await ingestCorpus(store, embedder);
    retriever = new HybridRetriever(store, 10);

    dataset = loadDataset();
    const perQuery: RankedRelevance[] = [];
    for (const row of dataset) {
      const [embedding] = await embedder.embed([row.query]);
      const results = await retriever.retrieve(embedding!, { topK: 10, mode: RETRIEVAL_MODE });
      perQuery.push({
        relevant: results.map((r) => r.documentId === row.goldSource),
        totalRelevant: 1,
      });
    }
    metrics = aggregate(perQuery, 5);

    // eslint-disable-next-line no-console
    console.log(`\n[eval] mode=${RETRIEVAL_MODE} metrics=${JSON.stringify(metrics)}\n`);
  }, 120_000);

  afterAll(async () => {
    await container?.stop();
  });

  it('meets the recorded baseline (ratchet)', () => {
    if (!existsSync(BASELINE) || process.env.EVAL_UPDATE_BASELINE === '1') {
      writeFileSync(BASELINE, JSON.stringify(metrics, null, 2) + '\n');
      // eslint-disable-next-line no-console
      console.log(`[eval] baseline written to ${BASELINE}`);
      return;
    }
    const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as Partial<EvalMetrics>;
    const result = checkRatchet(metrics, baseline);
    expect(result.failures).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('meets absolute quality thresholds (recall@5 ≥ 0.85, MRR ≥ 0.7)', () => {
    const result = checkThresholds(metrics, THRESHOLDS);
    expect(result.failures).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('produces a metric for every dataset query', () => {
    expect(dataset.length).toBeGreaterThanOrEqual(6);
    expect(metrics.recallAt5).toBeGreaterThanOrEqual(0);
    expect(metrics.mrr).toBeGreaterThanOrEqual(0);
  });
});
