# RAG Platform

A NodeJS/TypeScript GenAI workflow platform with a **production-grade RAG subsystem**, built to
run fully isolated in Docker. It is a cleaner reimagining of the Python `genai-launchpad` starter:
the same declarative DAG workflow engine, but async-correct, fully tested, and with real
retrieval (ingestion → chunking → hybrid search → reranking → grounded citations → eval).

**Status: complete — Phases 0–6 built.** All phases are implemented, tested, and committed: the
workflow engine, LLM layer, RAG ingestion, hybrid retrieval + reranking + grounded citations, an
eval harness, observability, worker/API hardening, and the end-to-end smoke. See
**[Verification](#verification-the-workable-product-gate)** to run it.

## How this repo is built

The whole project is constructed by a **containerized Claude Code agent** that reads this README,
then `CLAUDE.md` (the engineering constitution), then each `PHASE-N-PLAN.md` in order — building,
testing, and committing one phase at a time. Running the agent inside Docker means it can use
`--dangerously-skip-permissions` safely (it is sandboxed) and verify everything docker-first.

```bash
# from /home/alex/work/RAG, authenticated with ONE of (OAuth token wins):
#   export CLAUDE_CODE_OAUTH_TOKEN=...   # Pro/Max subscription, via `claude setup-token`
#   export ANTHROPIC_API_KEY=sk-ant-...  # API billing
docker compose -f docker-compose.builder.yml run --rm builder
```

See **[Build process](#build-process)** below for what that command does and how to drive it.

## Phases

Each phase is self-contained and ends with a green CI run + a commit. A phase is **Done** only
when every bullet in its Definition of Done holds.

| Phase | File | Outcome |
|---|---|---|
| 0 | [`PHASE-0-PLAN.md`](./PHASE-0-PLAN.md) | Repo init, governance docs committed |
| 1 | [`PHASE-1-PLAN.md`](./PHASE-1-PLAN.md) | Scaffold + Docker stack + CI harness (all services healthy) |
| 2 | [`PHASE-2-PLAN.md`](./PHASE-2-PLAN.md) | Core workflow engine (Node/Workflow/Router/Concurrent/Validator) |
| 3 | [`PHASE-3-PLAN.md`](./PHASE-3-PLAN.md) | LLM layer (provider factory, AgentNode, streaming, OpenAI endpoint) |
| 4 | [`PHASE-4-PLAN.md`](./PHASE-4-PLAN.md) | RAG ingestion (documents API, chunking, embeddings, Qdrant) |
| 5 | [`PHASE-5-PLAN.md`](./PHASE-5-PLAN.md) | RAG retrieval & generation (hybrid + rerank + grounded citations) |
| 6 | [`PHASE-6-PLAN.md`](./PHASE-6-PLAN.md) | Eval harness, observability, hardening, demo smoke |

A hands-on **[Platform Guide](./docs/GUIDE.md)** walks through agent orchestration (chaining,
routing, concurrent fan-out, workflow composition, streaming) and RAG (uploading documents and
interrogating them with grounded, cited answers), with runnable examples.

Full design rationale, architecture, and the reference-project critique live in
**[`docs/PLAN.md`](./docs/PLAN.md)**. Engineering rules and the phase workflow live in
**[`CLAUDE.md`](./CLAUDE.md)**.

## Target stack (built over the phases)

- **NestJS** (monorepo: `apps/api`, `apps/worker`, `libs/*`), **Node 24 LTS**, **pnpm**
- **Qdrant** (hybrid dense+sparse vectors), **Postgres 16** + **Drizzle**, **Redis** + **BullMQ**
- **Vercel AI SDK** (multi-provider LLM + embeddings, streaming, Zod structured output)
- **Cohere Rerank** (provider-abstracted), **Langfuse + OpenTelemetry** (NoOp fallback)
- **Vitest + Supertest + Testcontainers**, **Zod** validation everywhere

## Target services & ports (after Phase 1)

| Service | Port (host) | Notes |
|---|---|---|
| api (NestJS) | 127.0.0.1:8080 | HTTP + SSE; OpenAPI |
| worker | — | BullMQ processors (`events`, `ingest`) |
| postgres | 127.0.0.1:5432 | relational: events, documents, chunks |
| qdrant | 127.0.0.1:6333 | vectors (named: dense + sparse) |
| redis | 127.0.0.1:6379 | BullMQ broker |
| migrate | — | one-shot drizzle-kit job |
| langfuse | optional | self-host or cloud |

## Build process

`docker-compose.builder.yml` runs a `builder` service (Node 24 + git + Docker CLI + Claude Code)
that mounts this repo **at the same host path** (so Docker-Compose bind mounts resolve correctly
when the agent runs the app stack via the host Docker socket). On start it invokes:

```
claude --dangerously-skip-permissions -p "<bootstrap prompt: read README → CLAUDE.md → build PHASE-0..6 in order>"
```

The agent then, per phase: implements the deliverables, writes tests, runs the phase's
Definition-of-Done checks (lint, typecheck, unit/integration tests, `docker compose up`, e2e),
and commits. Progress is visible via `git log` and the agent's output.

### Verification (the "workable product" gate)

After the phases complete, the product is Done when:

```bash
cp .env.example .env            # fill provider keys for eval; app boots without them (graceful degradation)
docker compose up -d --build    # all services healthy
pnpm test                       # unit + integration (Testcontainers)
pnpm test:e2e                   # full-stack happy path, providers mocked
bash scripts/smoke.sh           # end-to-end: health → event → ingest → grounded RAG query → stream (exit 0)
pnpm eval                       # RAG quality vs baseline (needs API keys)
```

## API surface

| Method & path | Purpose |
|---|---|
| `GET /health` | Liveness + dependency status (postgres/redis/qdrant) |
| `POST /events` · `GET /events/:id` | Submit a workflow event (async) and poll its status + result |
| `POST /documents` · `GET /documents/:id` | Ingest a document (base64) and poll ingestion status |
| `POST /rag/query` | Hybrid retrieve → rerank → grounded, cited answer |
| `POST /v1/chat/completions` | OpenAI-compatible streaming chat (SSE) |

All bodies are Zod-validated. A payload-size limit (`API_BODY_LIMIT`), an optional in-memory
rate limiter (`RATE_LIMIT_MAX`, off by default), and an optional API-key guard (`API_KEY`, off by
default) are wired as global guards. Missing provider keys degrade the relevant capability with a
warning rather than crashing boot.

## Observability & eval

- **Tracing** (`libs/observability`): a dependency-free tracing facade that is a **NoOp until both
  `LANGFUSE_*` keys are set**, at which point spans (workflow/per-node) are exported through a
  pluggable `SpanExporter` — the seam where a Langfuse/OpenTelemetry exporter attaches.
- **Eval** (`pnpm eval`): runs the dataset in `test/eval/dataset.jsonl` against an ephemeral
  Qdrant, computing **recall@5 / MRR / context precision** (faithfulness via LLM-judge is opt-in
  with keys). It records `test/eval/baseline.json` and **ratchets** against it; thresholds
  (recall@5 ≥ 0.85, MRR ≥ 0.7) are enforced. It is separate from blocking CI.

## Prerequisites

- Docker + Docker Compose
- An `ANTHROPIC_API_KEY` (for the builder agent)
- Provider keys (OpenAI/Anthropic/Cohere/…) only needed to run `pnpm eval` against live models
