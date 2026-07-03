# REFACTOR-STATUS

Phase-by-phase summary of `docs/REFACTOR-PLAN.md` execution on branch `refactor/architecture`,
plus the R6 full-verification evidence.

## R1 — Single-source the shared contracts

Commit `8765817`. Queue names (`EVENTS_QUEUE`/`INGEST_QUEUE`) and the `Db` type single-sourced in
`libs/core`/`libs/database`; `@app/workflows` path alias added and the four
`../../../../workflows/...` relative imports replaced; `packageManager` pinned
(`pnpm@10.34.4`) and the redundant `version: 10` removed from both CI `pnpm/action-setup` steps.

## R2 — DI & config simplification

Commit `e611041`. `EventsRepository`/`DocumentsRepository`/`ChunksRepository`/`UnitOfWork` moved
to `@Inject(DATABASE_TOKEN)` constructor injection (only `DATABASE_TOKEN` keeps a factory); typed
`rag` config slice (`registerAs('rag', ragConfigFactory)`) replaces the two trailing positional
numbers on `IngestionService` and the deleted `RAG_QUERY_DEFAULTS_TOKEN`; the throwing embedder
factory became a named, unit-tested `UnconfiguredEmbedder`; `WorkflowsModule` registers every
workflow (including composed ones) via `onModuleInit` instead of hand-`new`-ing
`CompositeWorkflow`; one shared enqueue helper backs both `EventsService.create` and
`DocumentsService.create`, and both now return the same `error.flatten()` Zod validation-error
shape (the one sanctioned behavior change).

## R3 — RAG generation as a plain service

Commit `081007d`. Generation got a direct typed entrypoint; `RagQueryService.generate()` calls it
directly. The throwaway `TaskContext` construction, `RAG_INPUT_KEY`, and the `ctx.metadata` cast
in `buildMessages` are gone.

## R4 — Workflow engine: discriminated-union schema

Commit `5d4efc5`. `NodeConfig` is now `LinearNodeConfig | RouterNodeConfig | ConcurrentNodeConfig`
discriminated on `kind`; `dispatch()` is a `switch`; the empty `ConcurrentNode` abstract class is
deleted; the `run`/`runStream` prologue (validate once, memoized) is shared. All regression tests
were migrated to the new schema shape.

- **Deferred (optional) — typed node outputs.** Step 7 suggested keying
  `TaskContext.getOutput`/`setOutput` off the node instance so `ctx.getOutput<T>('Token')` casts
  disappear at call sites. Skipped: `getOutput<T>(token: string)` is called by string token across
  `libs/rag`, `apps/api`, `apps/worker`, and every `workflows/*` node/spec — converting the API
  would ripple far outside `libs/core` and balloon that phase's diff well past "discriminated-union
  schema." Left as a follow-up for a dedicated phase if desired.

## R5 — Build & test infrastructure

Commit `5216c69`. One parameterized `docker/Dockerfile` (`ARG APP`) replaces
`Dockerfile.api`/`Dockerfile.worker`; `HealthService` pings Redis via `ioredis` and the
`redis` (node-redis) dependency is dropped; the dead server-side-fusion
`QdrantVectorStore.search()` path is deleted (client-side `rrfFuse` is the one fusion path); the
duplicated corpus-ingest setup in the eval and e2e specs is now a shared `test/helpers/corpus.ts`
fixture.

## R6 — Full verification, docs, handoff

### Bugs found and fixed during full verification

The full gauntlet (steps below) is the first time this branch's changes were exercised through a
**real, webpack-built NestJS application boot** rather than through unit/integration specs that
construct nodes and workflows by hand (see `apps/api/src/events/composite.integration.spec.ts`,
which builds `CompositeWorkflow` manually rather than booting `WorkflowsModule` via Nest DI). That
gap let two R2/R4-introduced DI-wiring bugs through every earlier phase's gates: the worker
container crash-looped on boot (`docker compose up`, and therefore `scripts/smoke.sh`, both
failed). Both are fix-forward per Global rule 6, are behavior-preserving (they make the R2 design
intent actually work, rather than changing it), and now have a dedicated regression test:

1. **`WorkflowsModule` re-exported a provider it didn't own.** `exports: [WorkflowRegistry]`
   — but `WorkflowRegistry` is provided (and exported) by the imported `CoreModule`, not declared
   locally. Nest only allows exporting a token a module either declares itself or that is itself
   one of its `imports` (a module, re-exported whole) — cherry-picking a single provider that
   merely arrived via an import throws `UnknownExportException` at module-scan time. Fixed by
   exporting `CoreModule` instead of `WorkflowRegistry` (`workflows/workflows.module.ts`).
2. **`SubWorkflowNode`'s DI constructor param used `import type`.** `import type { WorkflowRegistry }`
   erases the class at runtime, so `emitDecoratorMetadata` recorded `Object` instead of
   `WorkflowRegistry` for the constructor's `design:paramtypes` — Nest then saw an undefined
   dependency (`UnknownDependenciesException`) when instantiating `EchoSubWorkflowNode`. Fixed by
   making it a value import (`libs/core/src/sub-workflow-node.ts`).

Neither bug was type-checking-visible (both are pure runtime DI metadata/graph issues) or caught
by `pnpm test`/`pnpm test:e2e` (neither boots `WorkflowsModule` through real Nest DI). Added
`workflows/workflows.module.spec.ts`, which boots `WorkflowsModule` (and a synthetic consumer
module that only imports it, mirroring `EventsWorkerModule`) through `Test.createTestingModule(...).compile()`
+ `.init()` — the same lifecycle real bootstrap uses. Verified both fixes are load-bearing by
reverting each independently and confirming the new spec reproduces the exact same
`UnknownExportException` / `UnknownDependenciesException` seen from the real docker boot. Added
`workflows/**/*.spec.ts` to the `unit` Vitest project's `include` (previously only
`libs/**` and `apps/**` were scanned, so this new spec — and any future `workflows/` spec — would
otherwise never run under `pnpm test`).

### Full gauntlet — verification evidence

All commands run from a clean state on this branch; all exited 0.

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | OK (lockfile already up to date) |
| `pnpm lint` | 0 errors |
| `pnpm typecheck` | 0 errors (root + api + worker tsconfigs) |
| `pnpm test:cov` | **33 test files / 202 tests passed**; coverage `libs/core` 100%, `libs/database` 90.19%, `libs/rag` 65.08% overall-with-100%-on-business-logic (the low overall number is unexercised DI-wiring/module-factory code — `rag.module.ts`, `rag.config.ts` — not covered source; every engine/business-logic file is ≥84% and the enforced Vitest `lines: 80` **global** threshold over `include: [libs/core/src/**, libs/rag/src/**, libs/database/src/**]` passed, exit 0) |
| `pnpm test:e2e` | **3 files / 10 tests passed** (health, chat SSE, RAG grounding + repair + dense-only) |
| `docker build -f docker/Dockerfile --build-arg APP=api` | OK |
| `docker build -f docker/Dockerfile --build-arg APP=worker` | OK |
| `pnpm eval` | **3 tests passed**; `recallAt5=1, mrr=1, contextPrecision=0.70` (meets/exceeds the recorded ratchet baseline) |
| `scripts/smoke.sh` (in-container recipe: `docker compose -f docker-compose.yml -f docker-compose.smoke.yml up -d --build`, network-connect, `API_URL=http://api:8080 SMOKE_NO_UP=1 bash scripts/smoke.sh`) | **SMOKE PASSED** — health → event submit/poll/completed → document ingest/poll/completed → grounded RAG query (1 citation) → SSE chat stream terminated by `[DONE]` |

`docker compose down -v` run afterward to tear down the stack this run started.

### Docs updated

- `docs/GUIDE.md`: §1 library table (dropped `ConcurrentNode`, deleted in R4); §3 `WorkflowSchema`
  rewritten for the discriminated union (`LinearNodeConfig`/`RouterNodeConfig`/
  `ConcurrentNodeConfig`); §4.2/4.3/4.4 examples updated to `kind`/`next`/`children`; §4.7 rewritten
  to describe the actual DI-managed `onModuleInit` registration (was documenting a manual
  `new WorkflowRegistry()` + hand-registration pattern R2 replaced) and the `exports: [CoreModule]`
  re-export rule the R6 bugfix above depends on.
- `CLAUDE.md` §Repository layout: `docker/` line updated from "Dockerfiles" (plural) to the R5
  single parameterized `Dockerfile`.
- `README.md`: no changes needed — it references only the public build/verify commands and API
  surface, none of which the refactor changed.

### Branch contents

One commit per phase (R1–R6), nothing else, on `refactor/architecture`.
