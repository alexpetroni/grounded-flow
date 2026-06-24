import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IngestionService } from './ingestion.service';
import { FakeEmbedder } from '../embedder/fake.embedder';
import type { VectorStore } from '../vector-store/vector-store.interface';
import type { DocumentsRepository, ChunksRepository } from '@app/database';

function makeDocumentsRepository(): DocumentsRepository {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    complete: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
  } as unknown as DocumentsRepository;
}

function makeChunksRepository(): ChunksRepository {
  return {
    upsertMany: vi.fn().mockResolvedValue(undefined),
    findByDocumentId: vi.fn().mockResolvedValue([]),
    deleteByDocumentId: vi.fn().mockResolvedValue(undefined),
    countByDocumentId: vi.fn().mockResolvedValue(0),
  } as unknown as ChunksRepository;
}

function makeVectorStore(): VectorStore {
  return {
    ensureCollection: vi.fn().mockResolvedValue(undefined),
    upsert: vi.fn().mockResolvedValue(undefined),
    deleteByDocumentId: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue([]),
  };
}

describe('IngestionService', () => {
  let docsRepo: ReturnType<typeof makeDocumentsRepository>;
  let chunksRepo: ReturnType<typeof makeChunksRepository>;
  let vectorStore: ReturnType<typeof makeVectorStore>;
  let embedder: FakeEmbedder;
  let service: IngestionService;

  beforeEach(() => {
    docsRepo = makeDocumentsRepository();
    chunksRepo = makeChunksRepository();
    vectorStore = makeVectorStore();
    embedder = new FakeEmbedder(4);
    service = new IngestionService(
      docsRepo,
      chunksRepo,
      embedder,
      vectorStore,
      50, // chunkTokens
      10, // overlapTokens
    );
  });

  it('processes a plain text document end-to-end', async () => {
    const docId = 'doc-001';
    const content = Buffer.from('The quick brown fox jumps over the lazy dog. '.repeat(10));
    await service.ingest({
      documentId: docId,
      content,
      mimeType: 'text/plain',
      source: 'test.txt',
    });

    expect(docsRepo.updateStatus).toHaveBeenCalledWith(docId, 'processing');
    expect(chunksRepo.deleteByDocumentId).toHaveBeenCalledWith(docId);
    expect(vectorStore.deleteByDocumentId).toHaveBeenCalledWith(docId);
    expect(chunksRepo.upsertMany).toHaveBeenCalled();
    expect(vectorStore.upsert).toHaveBeenCalled();
    expect(docsRepo.complete).toHaveBeenCalledWith(docId);
    expect(docsRepo.fail).not.toHaveBeenCalled();
  });

  it('marks document as failed on loader error', async () => {
    const docId = 'doc-fail';
    await expect(
      service.ingest({
        documentId: docId,
        content: Buffer.from('  '), // empty → TextLoader throws
        mimeType: 'text/plain',
        source: 'empty.txt',
      }),
    ).rejects.toThrow();

    expect(docsRepo.fail).toHaveBeenCalledWith(docId, expect.any(String));
    expect(docsRepo.complete).not.toHaveBeenCalled();
  });

  it('marks document as failed on unsupported MIME type', async () => {
    const docId = 'doc-bad-mime';
    await expect(
      service.ingest({
        documentId: docId,
        content: Buffer.from('binary content'),
        mimeType: 'application/octet-stream',
        source: 'file.bin',
      }),
    ).rejects.toThrow();

    expect(docsRepo.fail).toHaveBeenCalledWith(docId, expect.stringContaining('Unsupported'));
  });

  it('processes HTML documents', async () => {
    const docId = 'doc-html';
    const html =
      '<html><body><p>Hello from HTML document with enough text to chunk.</p></body></html>';
    await service.ingest({
      documentId: docId,
      content: Buffer.from(html),
      mimeType: 'text/html',
      source: 'test.html',
    });

    expect(docsRepo.complete).toHaveBeenCalledWith(docId);
  });

  it('calls ensureCollection with embedder dimensions', async () => {
    await service.ingest({
      documentId: 'doc-dims',
      content: Buffer.from('Sample text for dimension check.'),
      mimeType: 'text/plain',
      source: 'sample.txt',
    });

    expect(vectorStore.ensureCollection).toHaveBeenCalledWith(4); // FakeEmbedder dimensions
  });

  it('calls ensureCollection then deleteByDocumentId before upsert (idempotent re-ingest)', async () => {
    const docId = 'doc-idem';
    const content = Buffer.from('Idempotency test content here');

    await service.ingest({ documentId: docId, content, mimeType: 'text/plain', source: 'f.txt' });

    const ensureCall = vi.mocked(vectorStore.ensureCollection).mock.invocationCallOrder[0];
    const deleteCall = vi.mocked(vectorStore.deleteByDocumentId).mock.invocationCallOrder[0];
    const upsertCall = vi.mocked(vectorStore.upsert).mock.invocationCallOrder[0];
    expect(ensureCall!).toBeLessThan(deleteCall!);
    expect(deleteCall!).toBeLessThan(upsertCall!);
  });
});
