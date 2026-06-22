# CLAUDE.md — Engineering Constitution

This file governs how the project is built. Read it fully before writing any code, and re-read
the relevant phase file before starting each phase. The authoritative design is `docs/PLAN.md`;
each `PHASE-N-PLAN.md` is the executable slice. **Do not skip ahead** — phases build on each other.

## Mission

Build a NodeJS/TypeScript GenAI workflow platform with production-grade RAG, runnable fully in
Docker, that fixes every weak spot of the reference Python `genai-launchpad` (see `docs/PLAN.md`
§Context). Quality, tests, and verifiability are the point — not speed.

## Operating rules

1. **Phase by phase.** Execute `PHASE-0` → `PHASE-6` in order. Start a phase only when the
   previous phase's Definition of Done (DoD) fully holds.
2. **Docker-first verification.** "It works" means it works in containers. Use the host Docker
   socket to run `docker compose up` and the test stack. Never claim a DoD met without running it.
3. **Tests are written with the code, not after.** Every deliverable lands with its tests in the
   same commit. A phase is not Done if its tests are missing or red.
4. **Determinism for AI code.** No test may call a live LLM/embedding/rerank API. Use the
   `FakeProvider` + Vercel AI SDK mock models (`MockLanguageModelV2`, `MockEmbeddingModelV2`,
   `simulateReadableStream`). Live providers are used only by the opt-in `pnpm eval`.
5. **No `any`.** TypeScript strict mode; ESLint `@typescript-eslint/no-explicit-any` is an error.
   Validate all external input with Zod.
6. **Fix-forward the reference bugs.** Each known weak spot must have a named regression test
   (see §Regression checklist). Do not reintroduce them.
7. **Conventional commits, one per phase minimum.** `feat(core): …`, `test(rag): …`,
   `chore(ci): …`. Commit only when the working tree's checks pass. Never commit secrets.
   **Never read, write, or delete `.env.builder`** — it holds the build agent's own
   credentials and is owned by the human operator, not you. The app stack uses `.env`
   (you may copy it from `.env.example`); leave `.env.builder` untouched.
8. **Stop and report on a blocked DoD.** If a phase cannot meet its DoD (e.g. a dependency is
   broken), stop, summarize the blocker and what was tried, and do not fake green.

## Definition of Done — every phase

A phase is Done when ALL hold (in addition to that phase's specific DoD):

- `pnpm lint` and `pnpm typecheck` pass with zero errors.
- `pnpm test` (unit + integration) passes; coverage gates met (see below).
- `docker build` succeeds for any images the phase touches.
- New behavior has tests; changed behavior has updated tests.
- The phase's deliverables are committed with a conventional-commit message.

## Quality gates (merge-blocking, enforced in CI)

- `pnpm typecheck` — zero errors; `any` banned.
- `pnpm lint` — zero errors (ESLint + Prettier).
- `pnpm test` — all pass; **coverage ≥ 80% lines** on `libs/core`, `libs/rag`, `libs/database`.
- `docker build` (api, worker) — succeeds.
- `pnpm test:e2e` — full-stack happy path (mocked providers) passes.
- Eval is a **separate, non-blocking** job (needs keys); it must not regress below the recorded
  baseline (ratchet).

CI pipeline order: `install (pnpm cache)` → `lint` → `typecheck` → `test (Testcontainers)` →
`docker build` → `test:e2e (compose)`. Eval runs on manual dispatch + nightly.

## Architecture invariants (do not violate)

- **Nodes are async-native and side-effect-clean.** No blocking I/O in `process()`. Clients/
  services come via NestJS DI, never constructed inline. `cleanup()` runs in a `finally` on every
  path — **including the streaming path**.
- **Only routers may have >1 connection.** The validator enforces DAG (no cycles), reachability,
  router-connection rules, and that every referenced node (incl. `concurrentNodes`) is registered.
- **Repositories don't self-commit.** Unit-of-work owns the transaction boundary.
- **Migrations run only in the one-shot `migrate` container.** Never in the API entrypoint.
- **Citations are grounded.** Every returned `chunkId` must exist in the retrieved set; ungrounded
  citations are rejected/flagged.
- **Idempotent ingestion.** Re-ingesting a document produces no duplicate chunks/points
  (chunkId-keyed upsert + delete-by-document).
- **Graceful degradation.** Missing provider keys disable that capability with a warning; they
  never crash boot. Tracing is NoOp when unconfigured.
- **uuid v7** for ids; order "latest" by `createdAt`, never by id.

## Regression checklist (each needs a named test)

- `POST /events` rejects malformed bodies via Zod (no crash) — reference `dict.model_dump()` bug.
- Node `cleanup()` called on success, on thrown error, and in the streaming path.
- `GET /events/:id` returns status + result (results endpoint exists).
- Worker retry: kill mid-job → retries → terminal status (never stuck `pending`); DLQ on terminal fail.
- Idempotent re-ingest (no duplicate chunks/points).
- Grounded citations (hallucinated chunkId rejected/repaired).

## Repository layout (target)

```
apps/api  apps/worker
libs/core  libs/llm  libs/rag  libs/database  libs/observability  libs/config
workflows/        example + concrete workflows
docker/           Dockerfiles + compose + healthchecks
test/             e2e + fixtures + eval
scripts/          smoke.sh, migrate, seed
```

## Commands (define these in package.json during Phase 1)

`pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm test:e2e` · `pnpm eval` ·
`pnpm build` · `docker compose up --build` · `bash scripts/smoke.sh`

## Definition of Done — the whole product

See `README.md` §Verification and `docs/PLAN.md` §Global Definition of Done. In short:
all services healthy in compose, CI green, `scripts/smoke.sh` exits 0, eval meets thresholds,
every regression test passes, README + `.env.example` complete.
