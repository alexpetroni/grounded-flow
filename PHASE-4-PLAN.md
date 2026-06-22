# Phase 4 — RAG Ingestion

**Goal:** A real ingestion pipeline (`libs/rag`) — the thing the reference project never had:
documents in → loaded → chunked → embedded (dense + sparse) → upserted to Qdrant, idempotently,
with status tracking.

Depends on: Phase 3. See `docs/PLAN.md` §RAG Subsystem (1–4), §Data Layer.

## Deliverables

- **Schema (`libs/database`):** `documents` (id, source, mimeType, status, metadata, timestamps)
  and `chunks` (id, documentId fk, ordinal, text, tokenCount, metadata) + repos (no self-commit).
- **Loaders:** pluggable `DocumentLoader` per type — md/txt/html native; PDF via `pdf-parse`.
  Unknown/oversized/invalid uploads rejected with a validation error.
- **Chunker:** token-aware recursive splitter using `js-tiktoken`; configurable
  `RAG_CHUNK_TOKENS` / `RAG_CHUNK_OVERLAP`; structure-aware (respect headings/paragraphs where
  possible). Emits ordered chunks with token counts.
- **Embeddings:** `Embedder` interface; real impl via AI SDK `embedMany` (default
  `text-embedding-3-small`), batched with retry/backoff; **fake impl** with fixed vectors for
  tests. **Sparse** vectors (BM25/SPLADE-style) for hybrid.
- **Vector store:** `VectorStore` interface; Qdrant impl with **named vectors** `dense` (cosine)
  + `sparse`; payload `{documentId, chunkId, ordinal, text, metadata}`; **idempotent upsert keyed
  by chunkId**; `deleteByDocument` for re-ingest; collection bootstrap.
- **API + queue:** `POST /documents` (persist `pending` → enqueue `ingest`), `GET /documents/:id`;
  BullMQ `ingest` processor runs load → chunk → embed → upsert and transitions document status;
  failures mark `failed` with a captured reason.

## Tests

- **Chunker (unit):** size/overlap honored; boundary cases (empty, whitespace, a single huge doc,
  multi-section); token math matches.
- **Loaders (unit):** each type parses; invalid/oversized rejected.
- **Embeddings (unit):** fake embedder deterministic; batching covers remainder batches.
- **Integration (Testcontainers Qdrant):** upsert then query returns the points; **idempotent
  re-ingest produces no duplicates**; `deleteByDocument` removes them.
- **Integration (queue):** `POST /documents` → `ingest` job → document `completed`; chunks present
  in Postgres and points in Qdrant; a forced loader/embedder error → document `failed`.

## Definition of Done

- Sample corpus (`test/fixtures/corpus/`) ingests; chunks in Postgres, points in Qdrant.
- **Re-ingest is idempotent** (named regression test); ingestion errors captured on the document.
- `libs/rag` + `libs/database` coverage ≥ 80%; all gates green; committed.

## Notes / Risks

- Spike Qdrant sparse/hybrid setup first with a small integration test before building on it.
- Confirm `pdf-parse` + `js-tiktoken` build and run in the slim glibc image (Phase 1 base).
