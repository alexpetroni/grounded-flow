import { readFileSync } from 'fs';
import path from 'path';
import { uuidv7 } from 'uuidv7';
import { Chunker, getLoader } from '@app/rag';
import type { ChunkPoint, FakeEmbedder, QdrantVectorStore } from '@app/rag';

/**
 * Fixed 3-document corpus + ingest pipeline shared by the RAG e2e spec and
 * the eval harness — both need the same chunked/embedded/upserted fixture
 * data, keyed by source document for gold relevance.
 */
export const CORPUS_DIR = path.resolve(__dirname, '../fixtures/corpus');

export const CORPUS: Array<{ file: string; mime: string }> = [
  { file: 'introduction.md', mime: 'text/markdown' },
  { file: 'rag-overview.txt', mime: 'text/plain' },
  { file: 'vectors.html', mime: 'text/html' },
];

export async function ingestCorpus(
  store: QdrantVectorStore,
  embedder: FakeEmbedder,
  chunkerOptions: { chunkTokens: number; overlapTokens: number } = {
    chunkTokens: 60,
    overlapTokens: 10,
  },
): Promise<void> {
  const chunker = new Chunker(chunkerOptions);
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
        documentId: file, // gold relevance is keyed on the source document
        ordinal: c.ordinal,
        text: c.text,
        metadata: { source: file },
        embedding: embeds[i]!,
      };
    });
    await store.upsert(points);
  }
}
