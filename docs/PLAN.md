# Plan: NodeJS/TypeScript GenAI Workflow Platform with Production RAG

> This is the authoritative design. `CLAUDE.md` holds the engineering rules; each
> `PHASE-N-PLAN.md` is the executable slice of the relevant sections below.

## Context

The reference project (`datalumina/genai-launchpad`, Python) is a Docker-based GenAI starter kit:
FastAPI + Celery + Postgres/pgvector + Redis with a custom DAG-based workflow engine over
`pydantic-ai`. Its **workflow engine is its standout strength** (declarative DAG, cycle/
reachability validation, multi-provider LLM layer, composition, streaming). But its weak spots
are significant, especially for RAG:

- **Bugs:** `/events` handler crashes (`dict.model_dump()`), `repository.exists()` uses a
  Flask-only idiom, `get_latest()` orders by UUID not time.
- **Async correctness:** "async" nodes make blocking SDK calls that stall the event loop.
- **Resource leaks:** httpx clients never closed; streaming path skips node cleanup.
- **Ops gaps:** no tests/CI, `--reload` baked into the prod entrypoint, no Celery retries,
  no event status column, no results-lookup endpoint, migrations race on multi-replica.
- **RAG is a toy:** *no ingestion pipeline*, `chunking_utils.py` is an empty stub, no reranking,
  no hybrid search, no metadata filtering, no real citations, no eval. Retrieval works only if
  you hand-populate the vector store.

**Goal:** Build a *new, cleaner* equivalent in **NodeJS/TypeScript** that keeps the engine's
strengths, fixes every weak spot, and ships a **production-grade RAG subsystem**. Runs fully
isolated in Docker. Intended as a reusable foundation, so design quality and structure matter.

**Project home:** `/home/alex/work/RAG`. Environment verified: Node 24, pnpm 10, Docker 29, git 2.43.

**Execution model — Docker-first.** Everything runs inside containers so the dev loop happens in
the sandbox (no dangerous host permission prompts) and the end state is a runnable product. The
source of truth for "does it work" is `docker compose up` plus the test/eval containers. Tests and
validation are first-class deliverables, written alongside each layer.

## Locked Decisions

| Area | Choice |
|---|---|
| HTTP framework | **NestJS** (DI + decorators map cleanly to the class-based Node/Workflow pattern) |
| Vector store | **Qdrant** (networked, native hybrid dense+sparse, shared by api+worker) |
| LLM/AI SDK | **Vercel AI SDK** (multi-provider, streaming, Zod-typed structured output) |
| RAG scope | **Full production stack** (ingestion + chunking + hybrid + rerank + citations + eval) |

Sensible defaults: **BullMQ** (queue), **Postgres 16**, **Drizzle ORM + drizzle-kit**, **Zod**,
**NestJS monorepo + pnpm**, **Node 24 LTS**, **Vitest + Supertest**, **Cohere Rerank**.

## Architecture Overview

```
Client → [api] POST /events ──► validate (Zod) ──► persist Event(status=pending)
                                          └─► enqueue BullMQ job ──► 202 + eventId
[worker] BullMQ processor ──► load Event ──► resolve Workflow ──► run engine
                                          └─► persist result + status (completed/failed)
Client → GET /events/:id ──► poll status + result        (NEW: fixes "no results endpoint")
Client → POST /v1/chat/completions ──► streaming workflow ──► SSE (OpenAI-compatible)
RAG:   POST /documents ──► persist Document ──► enqueue ingestion ──► chunk→embed→upsert(Qdrant)
       POST /rag/query  ──► retrieve(hybrid)→rerank→generate(grounded+citations)
```

**Containers (isolated network):** `api`, `worker`, `postgres`, `qdrant`, `redis`, one-shot
`migrate`, optional `langfuse`. Ports bound to `127.0.0.1`, healthchecks on every service, named
volumes for postgres/qdrant/redis.

## Repository Structure (NestJS monorepo)

```
apps/
  api/         HTTP entrypoint (main.ts) — controllers, SSE, OpenAPI
  worker/      BullMQ processor entrypoint (worker.ts) — shares DI container
libs/
  core/        Workflow engine: Node, Workflow, Router, ConcurrentNode, validator, TaskContext
  llm/         Vercel AI SDK provider factory + AgentNode base + structured-output helpers
  rag/         Ingestion, chunking, embeddings, Qdrant store, retrieval, rerank, citations, eval
  database/    Drizzle schema, migrations, repositories
  observability/ Langfuse + OpenTelemetry wiring, NoOp fallback
  config/      @nestjs/config + Zod-validated env schema
workflows/     Concrete workflow definitions + example workflows (RAG, quickstart, streaming)
docker/        Dockerfiles, compose, healthchecks
test/          e2e + eval harness
```

## Core Workflow Engine (libs/core) — port + fixes

- **`Node` (abstract):** `process(ctx): Promise<TaskContext>`, `saveOutput`, `getOutput`,
  `cleanup()`. Nodes are **NestJS injectable providers** (DI gives them services/clients instead
  of constructing clients inline → fixes leaks + testability).
- **`TaskContext`:** typed class — `event`, `nodes: Map<string, unknown>` (typed accessors),
  `metadata`, `shouldStop`, `traceId`. Zod-validated `event`.
- **`WorkflowSchema` / `NodeConfig`:** `{ start, nodes:[{node, connections, isRouter,
  concurrentNodes}], eventSchema (Zod) }`.
- **`Workflow` (abstract):** `run()` / `runStream()`; iterates nodes, handles routers, per-node
  try/finally **always calls `cleanup()` (including the streaming path** — fixes the reference
  bug), Langfuse span per node with NoOp fallback, parent node-registry save/restore for
  **workflow composition**.
- **`BaseRouter` / `RouterNode`:** `route(ctx)` returns next node token; routers instantiated once.
- **`ConcurrentNode`:** `Promise.all` over `concurrentNodes` (true non-blocking).
- **`WorkflowValidator`:** DAG cycle detection + reachability + "only routers may have >1
  connection" + `concurrentNodes` existence + every referenced node registered.

## LLM Layer (libs/llm)

- **Provider factory** over Vercel AI SDK: OpenAI, Anthropic, Google, Bedrock, Mistral, Ollama,
  Azure — selected by env/config — plus a **FakeProvider** for tests.
- **`AgentNode` base:** wraps `generateObject`/`generateText` with a **Zod output schema** (typed
  structured output), retries, and `experimental_telemetry` → Langfuse.
- **`AgentStreamingNode`:** `streamText`/`streamObject` → async-iterable SSE chunks (OpenAI
  `chat.completion.chunk` shape for the compatible endpoint).

## RAG Subsystem (libs/rag) — the core deliverable

1. **Ingestion API & pipeline.** `POST /documents` (text/md/html/pdf + metadata) → persist
   `Document` (status `pending`) → enqueue BullMQ `ingest`. `GET /documents/:id` for status.
   Pluggable `DocumentLoader` per type (md/txt/html native; `pdf-parse` for PDF).
2. **Chunking (replaces the empty stub).** Token-aware recursive splitter using `js-tiktoken`;
   configurable `chunkSize`/`overlap`; structure-aware. Persist canonical chunk text + tokenCount
   + ordinal in Postgres (`chunks`).
3. **Embeddings.** Vercel AI SDK `embedMany` (default OpenAI `text-embedding-3-small`), batched
   with retry/backoff. **Sparse vectors** (BM25/SPLADE-style) for hybrid.
4. **Vector store (Qdrant).** Collection with **named vectors**: `dense` (cosine) + `sparse`.
   Payload `{documentId, chunkId, ordinal, text, metadata}`. Idempotent upsert keyed by chunkId;
   delete-by-document. `VectorStore` interface so the store stays swappable.
5. **Retrieval (hybrid).** Qdrant Query API: dense + sparse prefetch fused with **RRF**, with
   **metadata/payload filtering**. Configurable top-k.
6. **Reranking.** `Reranker` interface; default Cohere Rerank over fused candidates → final top-n.
7. **Generation with grounded citations.** `generateObject` with Zod schema `{answer, citations:
   [{chunkId, quote}], confidence}`. **Citations tracked from retrieved chunk payloads** — every
   returned `chunkId` must exist in the retrieved set; flag/repair ungrounded answers.
8. **Evaluation harness (test/eval).** Q/(gold answer, gold chunks) set. Metrics: retrieval
   **recall@k / MRR**, **context precision**, **faithfulness** via LLM-judge. `pnpm eval`;
   optional Langfuse datasets. Establishes a baseline + guards regressions.

## Data Layer (libs/database, Drizzle)

- `events`: `id` (**uuid v7**), `workflowType`, `data` jsonb, `result` jsonb, **`status` enum**
  (pending/processing/completed/failed), `error`, `traceId`, timestamps. Order by `createdAt`.
- `documents`: id, source, mimeType, status, metadata, timestamps.
- `chunks`: id, documentId (fk), ordinal, text, tokenCount, metadata.
- Repositories are thin and **do not self-commit**. Migrations via drizzle-kit run by the one-shot
  `migrate` container (no migrations in the API entrypoint).

## API Surface (apps/api)

`POST /events`, `GET /events/:id`, `POST /documents`, `GET /documents/:id`, `POST /rag/query`,
`POST /v1/chat/completions` (SSE), `GET /health`. Global Zod validation pipe. Optional API-key
guard scaffold (off by default).

## Background Processing (apps/worker)

BullMQ queues `events`, `ingest`. **Retries with exponential backoff**, configurable concurrency,
**dead-letter handling**, status transitions on success/failure.

## Observability, Config, Quality

- **Observability:** Langfuse JS SDK via OpenTelemetry + AI SDK telemetry; **NoOp when
  unconfigured** (first run never crashes).
- **Config:** `@nestjs/config` + **Zod env schema** validated at boot; consistent `.env.example`.
- **Docker:** multi-stage builds, **no `--reload` in prod** (dev compose with watch), glibc base,
  non-root user, healthchecks + `depends_on: condition: service_healthy`.
- **Tests/CI:** Vitest unit + integration (Testcontainers), Supertest e2e, eval harness, GitHub
  Actions (lint + typecheck + test + docker build + e2e).

## Test & Validation Strategy

LLM/embedding/rerank calls are nondeterministic and cost money, so CI must not depend on live
providers.

- **Pyramid:** *Unit* (no network) → *Integration* (Testcontainers: Redis/Qdrant/Postgres) →
  *E2E* (full compose, providers mocked) → *Eval* (opt-in, real providers, non-blocking).
- **Determinism for AI code:** Vercel AI SDK `MockLanguageModelV2`, `MockEmbeddingModelV2`,
  `simulateReadableStream` behind a `FakeProvider`; reranker/embedder behind interfaces with fakes.
- **Fixtures:** committed sample corpus (`test/fixtures/corpus/`) + labelled eval set
  (`test/eval/dataset.jsonl`).
- **Determinism knobs:** fixed fake embeddings, seeded RRF, temperature 0 for eval, idempotency
  asserted by re-running ingest.

## Quality Gates (merge-blocking)

`pnpm typecheck` (zero errors, `any` banned) · `pnpm lint` · `pnpm test` (coverage ≥ 80% on
core/rag/database) · `docker build` (api, worker) · `pnpm test:e2e`. Eval separate + non-blocking
with a ratchet. CI: install → lint → typecheck → test → docker build → e2e.

## Global Definition of Done (the "workable product")

1. `docker compose up` → all services healthy; API reachable.
2. CI green: lint, typecheck, unit+integration (coverage met), docker build, e2e.
3. `scripts/smoke.sh` proves end-to-end: health → event → ingest → grounded RAG query → stream
   (exit 0).
4. Eval baseline exists and meets thresholds: **recall@5 ≥ 0.85, MRR ≥ 0.7, faithfulness ≥ 0.9**.
5. Every reference weak spot has a passing regression test.
6. README documents setup/run/test/eval/architecture; `.env.example` complete.

## Risk Register

| Risk | Mitigation |
|---|---|
| LLM nondeterminism breaks CI | FakeProvider + AI SDK mock models; real providers only in opt-in eval |
| Native deps (pdf-parse, tiktoken) fail in slim image | glibc base; verify via `docker build` gate in Phase 1 |
| Qdrant sparse/hybrid setup is fiddly | spike in Phase 4 with an integration test before wiring generation |
| Docker startup ordering / flaky healthchecks | `depends_on: condition: service_healthy` + retries; Testcontainers |
| Ingestion duplicates on re-run | chunkId-keyed upsert + delete-by-document; idempotency test |
| Hallucinated citations | grounding validator + regression test; flagged in output |
| Eval flakiness/cost | temperature 0, fixed fixtures, nightly/manual only, ratchet not absolute |

## Open Items / Assumptions

- Defaults (BullMQ, Postgres, Drizzle, Cohere rerank, pnpm/Nest-monorepo) — swap if preferred.
- Document types at launch (PDF/HTML/MD/code?) and single- vs multi-tenant.
- Langfuse self-host in-compose vs cloud.
