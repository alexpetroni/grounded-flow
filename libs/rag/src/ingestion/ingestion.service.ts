import { Injectable, Logger } from '@nestjs/common';
import type { DocumentsRepository } from '@app/database';
import type { ChunksRepository } from '@app/database';
import { Chunker } from '../chunker/chunker';
import { getLoader } from '../loaders/loader-registry';
import type { Embedder } from '../embedder/embedder.interface';
import type { VectorStore } from '../vector-store/vector-store.interface';

export const EMBEDDER_TOKEN = Symbol('EMBEDDER');
export const VECTOR_STORE_TOKEN = Symbol('VECTOR_STORE');

export interface IngestInput {
  documentId: string;
  content: Buffer;
  mimeType: string;
  source: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);
  private readonly chunker: Chunker;

  constructor(
    private readonly documentsRepository: DocumentsRepository,
    private readonly chunksRepository: ChunksRepository,
    private readonly embedder: Embedder,
    private readonly vectorStore: VectorStore,
    chunkTokens: number,
    overlapTokens: number,
  ) {
    this.chunker = new Chunker({ chunkTokens, overlapTokens });
  }

  async ingest(input: IngestInput): Promise<void> {
    const { documentId, content, mimeType, source, metadata = {} } = input;

    this.logger.log(`Ingesting document ${documentId} (${mimeType})`);
    await this.documentsRepository.updateStatus(documentId, 'processing');

    try {
      // Step 1: Load
      const loader = getLoader(mimeType);
      const loaded = await loader.load(content, source, metadata);

      // Step 2: Chunk
      const rawChunks = this.chunker.chunk(loaded.text);
      if (rawChunks.length === 0) {
        throw new Error('Document produced no chunks after loading');
      }

      // Step 3: Embed. All fallible work (load/chunk/embed) must complete
      // before the existing copy is touched: a transient failure here must
      // never leave a previously-healthy document without chunks.
      const embedResults = await this.embedder.embed(rawChunks.map((c) => c.text));

      const { uuidv7 } = await import('uuidv7');
      const chunkRows = rawChunks.map((chunk, i) => {
        const chunkId = uuidv7();
        return {
          id: chunkId,
          documentId,
          ordinal: chunk.ordinal,
          text: chunk.text,
          tokenCount: chunk.tokenCount,
          metadata: loaded.metadata,
          embedding: embedResults[i]!,
        };
      });

      // Step 4: Swap — delete-by-document then write keeps re-ingest
      // idempotent; a failure mid-swap is healed by retrying the ingest.
      await this.vectorStore.ensureCollection(this.embedder.dimensions);
      await this.chunksRepository.deleteByDocumentId(documentId);
      await this.chunksRepository.upsertMany(chunkRows);

      await this.vectorStore.deleteByDocumentId(documentId);

      await this.vectorStore.upsert(
        chunkRows.map((row) => ({
          id: row.id,
          chunkId: row.id,
          documentId: row.documentId,
          ordinal: row.ordinal,
          text: row.text,
          metadata: row.metadata,
          embedding: row.embedding,
        })),
      );

      await this.documentsRepository.complete(documentId);
      this.logger.log(`Document ${documentId} ingested: ${rawChunks.length} chunks`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Ingestion failed for document ${documentId}: ${message}`);
      await this.documentsRepository.fail(documentId, message);
      throw err;
    }
  }
}
