# Phase 5 — RAG Retrieval & Generation

**Goal:** Turn ingested vectors into grounded, cited answers: hybrid retrieval + reranking +
structured generation whose citations are validated against the retrieved set.

Depends on: Phase 4. See `docs/PLAN.md` §RAG Subsystem (5–7), §API Surface.

## Deliverables

- **Hybrid retriever:** Qdrant Query API — dense + sparse prefetch fused with **RRF** (seeded,
  deterministic), with **metadata/payload filtering**; configurable `RAG_TOP_K`.
- **Reranker:** `Reranker` interface; default **Cohere Rerank** over fused candidates → final
  `RAG_RERANK_TOP_N`; **fake reranker** with known scores for tests.
- **Generation node:** `AgentNode` (from Phase 3) with Zod output `{ answer, citations:
  [{chunkId, quote}], confidence }`, fed the reranked chunks as context.
- **Grounding validator:** every returned `chunkId` must exist in the retrieved set; ungrounded
  citations are rejected/repaired and flagged in the output.
- **API:** `POST /rag/query` → retrieve → rerank → generate → grounded, cited answer. Optionally
  a RAG workflow registered for the engine path too.

## Tests

- **RRF (unit):** deterministic fusion ordering for known inputs.
- **Filter (unit/integration):** metadata filter excludes non-matching points.
- **Reranker (unit):** fake reranker reorders candidates by known scores; top-n respected.
- **Grounding (unit):** a hallucinated `chunkId` is rejected/repaired; valid citations pass.
- **E2E (mocked LLM):** `POST /rag/query` over the ingested fixture corpus returns an answer whose
  citations all resolve to ingested chunks; a keyword-only (sparse) query and a semantic-only
  (dense) query each retrieve the right chunk.

## Definition of Done

- E2E RAG query returns a grounded, cited answer in Docker with the FakeProvider.
- Sparse-only and dense-only retrieval both succeed; grounding regression test passes.
- `libs/rag` coverage ≥ 80%; all gates green; `pnpm test:e2e` green; committed.
