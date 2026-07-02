# REFACTOR-PLAN — Architecture & Simplification

Executable plan for the autonomous refactor agent. Derived from the architecture review of
2026-07-02 (three-reviewer pass over libs/core, libs/rag+llm+database, apps+build). Execute
phases **in order**; each phase is one conventional commit on branch `refactor/architecture`.
The runner (`scripts/refactor-driver.sh`) independently re-runs the gates after every phase —
do not claim a DoD you have not verified yourself.

## Global rules (binding for every phase)

1. **Behavior-preserving.** The public HTTP API, workflow semantics, persisted schemas, and
   queue wire formats must not change — with ONE sanctioned exception noted in R2 (unified
   validation-error JSON shape). When in doubt, keep behavior and note the doubt in the commit.
2. **Tests move, they do not die.** Every existing regression test must survive each phase,
   adapted to new shapes/names. Named regression tests from CLAUDE.md §Regression checklist
   are sacred. New abstractions get new tests in the same commit.
3. **Gates per phase** (all must pass before committing):
   `pnpm lint` · `pnpm typecheck` · `pnpm test` (unit + integration). Phases R5–R6 add more
   (see phase Checks). Coverage must stay ≥ 80% lines on libs/core, libs/rag, libs/database.
4. **One conventional commit per phase**, e.g. `refactor(core): ...`. No force-push, no
   history rewrites, no commits to `main`.
5. **Never read, write, or delete `.env.builder`.** The app stack uses `.env`
   (copy from `.env.example` if missing).
6. **Fix forward; stop honestly.** If a phase's DoD cannot be met, stop, write what blocked
   you and what you tried into `docs/REFACTOR-STATUS.md`, commit that, and exit non-zero.
   Never fake green.
7. Out of scope (deliberate — do NOT "improve" these): the hand-rolled sparse embedder,
   chunker, and client-side RRF (determinism constitution); the `rag_default`/testcontainers
   helper `test/helpers/rag-network.ts` (this very refactor runs inside a container that may
   depend on it); migrations living under `docker/`; the four compose files.

## Environment notes (you are inside an isolated container)

- You work in a fresh clone on branch `refactor/architecture`; the host repo is mounted
  read-only elsewhere. Commit locally; the runner exports your branch as a bundle.
- `TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal` is set: integration/e2e tests that
  spawn containers via the host Docker socket work with the standard mapped-port strategy.
- The app stack's published ports bind to the HOST's 127.0.0.1 — unreachable from this
  container. For the smoke test (R6): bring the stack up, then connect this container to the
  stack's network and address the API by service name:
  ```bash
  docker network connect "$(basename "$PWD")_default" "$(hostname)" || true
  API_URL=http://api:8080 SMOKE_NO_UP=1 bash scripts/smoke.sh   # after compose up -d --build
  ```
  (Compose project name = current directory name. Tear down with `docker compose down -v`.)
- Host ports 5433/6380/6333/8080 may be in use by the operator's own stack; if `compose up`
  fails on a port conflict, report it in REFACTOR-STATUS.md rather than killing containers
  you did not start.

---

## R1 — Single-source the shared contracts (low risk, mechanical)

**Steps**
1. Queue names: create `libs/core/src/queues.ts` exporting `EVENTS_QUEUE = 'events'` and
   `INGEST_QUEUE = 'ingest'`; re-export from the `@app/core` barrel. Replace the duplicate
   declarations in `apps/api/src/events/events.service.ts`,
   `apps/worker/src/events/events.constants.ts` (delete file if empty after),
   `apps/api/src/documents/documents.service.ts`, `apps/worker/src/ingest/ingest.processor.ts`,
   and the hardcoded `'ingest'` string in `apps/worker/src/ingest/ingest.integration.spec.ts`.
2. Move `export type Db = NodePgDatabase<typeof schema>` from
   `libs/database/src/repositories/events.repository.ts` to a new
   `libs/database/src/db.types.ts`; update all imports and the barrel.
3. Add an `@app/workflows` path alias (root `tsconfig.json` paths, `vitest.config.ts`
   aliases, and any app tsconfigs that need it) pointing at `workflows/index.ts` (create a
   barrel exporting what apps import today). Replace the three `../../../../workflows/...`
   imports in `apps/api/src/chat/chat.controller.ts`, `apps/api/src/chat/chat.module.ts`,
   `apps/worker/src/events/events.worker.module.ts` (and any spec imports).
4. Pin the toolchain: add `"packageManager": "pnpm@<latest 10.x>"` to package.json (pick the
   newest 10.x; `corepack` will fetch it). Remove the now-redundant `version: 10` from BOTH
   `pnpm/action-setup` blocks in `.github/workflows/ci.yml` (the action reads packageManager).

**Checks**
- `grep -rn '\.\./\.\./\.\./\.\./workflows' apps libs` → no hits.
- `grep -rn "EVENTS_QUEUE\s*=" apps libs | wc -l` → exactly 1 declaration (in libs/core).
- `pnpm install --frozen-lockfile` still passes under the pinned pnpm.
- Gates green; **plus** `docker build -f docker/Dockerfile.api -t rag-api:r1 .` succeeds
  (webpack must resolve the new alias inside the image build).

**DoD:** checks green, one commit `refactor(contracts): single-source queue names, Db type, workflows alias; pin packageManager`.

## R2 — DI & config simplification

**Steps**
1. `libs/database/src/database.module.ts`: give `EventsRepository`, `DocumentsRepository`,
   `ChunksRepository`, `UnitOfWork` constructors `@Inject(DATABASE_TOKEN)`; replace their four
   `useFactory` blocks with a bare `providers` list. Only `DATABASE_TOKEN` keeps a factory.
2. Typed config slice: `registerAs('rag', ...)` (or equivalent) exposing
   `{ chunkTokens, overlapTokens, topK, topN }` once; `IngestionService` takes an options
   object instead of two trailing positional numbers; delete `RAG_QUERY_DEFAULTS_TOKEN` and
   `query/rag-query.tokens.ts` if empty; `RAG_TOP_K` is read in exactly one place.
3. Extract the anonymous throwing embedder in `rag.module.ts`'s `EMBEDDER_TOKEN` factory into
   a named, unit-tested `UnconfiguredEmbedder` class beside `FakeEmbedder`.
4. Workflows registry without hand-`new`: make `WorkflowRegistry` a plain provider; register
   `CompositeWorkflow`/children from a module lifecycle hook (`onModuleInit`) so every
   workflow is DI-managed (`workflows/workflows.module.ts` no longer constructs
   `new CompositeWorkflow(new EchoSubWorkflowNode(...), ...)` manually).
5. Unify the queue-submit path: one shared enqueue helper (attempts/backoff/removeOn* read
   from config once) used by both `EventsService.create` and `DocumentsService.create`, and
   ONE Zod validation-error contract for both endpoints (use `error.flatten()`); update the
   specs that assert the old `err.errors` shape. **This is the sanctioned behavior change.**

**Checks**
- `grep -c useFactory libs/database/src/database.module.ts` → 1.
- `grep -rn "RAG_QUERY_DEFAULTS_TOKEN" libs apps` → no hits.
- `grep -rn "new CompositeWorkflow" workflows` → no hits.
- Gates green (incl. the events/documents controller specs on the new error shape).

**DoD:** checks green, one commit `refactor(di): constructor injection, typed rag config slice, DI-managed workflows, unified enqueue`.

## R3 — RAG generation as a plain service (kill the fake-TaskContext ABI)

**Steps**
1. Give the generation logic a direct typed entrypoint — e.g. `RagAnswerNode.answer(input:
   { question, chunks }): Promise<RagAnswer>` or a standalone `AnswerGenerator` service —
   that builds messages from its argument and calls the AI SDK with the existing
   `outputSchema` + `telemetry()` wiring (functionId preserved).
2. `RagQueryService.generate()` calls it directly. Delete: the throwaway `TaskContext`
   construction, `RAG_INPUT_KEY`, the `ctx.metadata` cast + guard in `buildMessages`, and the
   `getOutput`-by-token round-trip. If nothing else uses `RagGenerationInput` externally,
   un-export it.
3. `AgentNode`: make the output type flow from the schema (`outputSchema: z.ZodType<TOutput>`
   so `result.object` is typed without the cast) or drop the unused `TOutput` parameter —
   whichever leaves less ceremony. Keep `buildMessages(ctx)`/`process(ctx)` for genuine
   workflow usage.

**Checks**
- `grep -rn "RAG_INPUT_KEY" libs apps` → no hits.
- `grep -rn "new TaskContext" libs/rag` → no hits.
- Gates green; `pnpm test:e2e` green (grounding + repair paths unchanged).

**DoD:** checks green, one commit `refactor(rag): generation is a plain typed call, not a fake workflow step`.

## R4 — Workflow engine: discriminated-union schema (highest leverage, biggest blast radius)

**Steps**
1. Replace the flat `NodeConfig` in `libs/core/src/workflow-schema.ts` with a discriminated
   union — shape it as fits, but it must: hold `BaseRouter` in the router variant (no
   `as BaseRouter` cast anywhere), give linear nodes a single `next?: string` (two targets
   become unrepresentable), and model concurrent fan-out as its own variant
   (`children: string[]` + `next?: string`).
2. `dispatch()` becomes a `switch` on the discriminant. The runtime check that a router's
   `route()` return is a declared connection STAYS (route returns a string at runtime).
3. Validator: delete rules the types now make impossible (`validateRouterConnectionRule`);
   keep/adapt cycle, reachability, existence, and the concurrent-child-with-next rule.
4. Delete the empty `ConcurrentNode` abstract class and its export.
5. Extract the duplicated `run`/`runStream` prologue (validate → parse → context → node map)
   into one private helper; memoize schema validation per workflow instance.
6. Migrate everything that builds schemas: `workflows/*`, `libs/core` specs, sub-workflow
   machinery, any app spec constructing workflows. Every regression test (coordinator
   process+cleanup, all-siblings-awaited, router-invalid-route, streaming cleanup, shouldStop,
   validator suite) must be adapted and stay green — where the union makes an old runtime
   validator test unrepresentable, convert it into a `@ts-expect-error` compile-time
   assertion instead of deleting it.
7. Optional, only if it does not balloon the diff: typed node outputs (reader keyed off the
   node instance so `ctx.getOutput<T>('Token')` casts disappear at call sites). If skipped,
   record it in REFACTOR-STATUS.md as follow-up.

**Checks**
- `grep -rn "as BaseRouter" libs` → no hits. `grep -rn "isRouter" libs apps workflows` → no hits.
- `grep -rn "class ConcurrentNode" libs` → no hits.
- Gates green; `pnpm test:cov` meets the 80% threshold; `pnpm test:e2e` green.

**DoD:** checks green, one commit `refactor(core)!: discriminated-union workflow schema` (note the `!` — internal API change, document the migration in the commit body).

## R5 — Build & test infrastructure

**Steps**
1. One parameterized `docker/Dockerfile` (`ARG APP=api`; `nest build ${APP}`; api-specific
   `EXPOSE`/migrations COPY kept unconditionally — harmless in the worker image). Update
   `docker-compose.yml` (api, worker, migrate), `docker-compose.smoke.yml` if needed, and the
   two `docker/build-push-action` steps in CI (`build-args: APP=...`). Delete
   `Dockerfile.api`/`Dockerfile.worker`. Keep the prod-deps stage exactly as is.
2. Drop the `redis` (node-redis) dependency: `health.service.ts` pings via `ioredis`
   (already a transitive-direct dep) or a plain socket probe; update its spec; remove the dep
   from package.json (lockfile update allowed — this is the one permitted lockfile change).
3. Delete the dead server-side-fusion `QdrantVectorStore.search()` + its interface method;
   adapt any spec that exercised it (client-side `rrfFuse` is the one fusion path).
4. Extract the duplicated corpus-ingest setup shared by `test/eval/eval.eval.spec.ts` and
   `test/rag.e2e.spec.ts` into a `test/helpers/corpus.ts` fixture.

**Checks**
- `docker build -f docker/Dockerfile --build-arg APP=api -t rag-api:r5 .` and same for
  `APP=worker` → both succeed; `ls docker/Dockerfile.api docker/Dockerfile.worker` → gone.
- `grep -rn "'redis'" package.json` → no hits; `grep -rn "from 'redis'" apps libs` → no hits.
- Gates green; `pnpm test:e2e` green; `pnpm eval` still meets the recorded baseline.

**DoD:** checks green, one commit `refactor(build): one parameterized Dockerfile; drop node-redis; remove dead fusion path; shared corpus fixture`.

## R6 — Full verification, docs, handoff

**Steps**
1. Full gauntlet from a clean state: `pnpm install --frozen-lockfile`, `pnpm lint`,
   `pnpm typecheck`, `pnpm test:cov` (≥80%), `pnpm test:e2e`, both docker builds via the new
   Dockerfile, `pnpm eval`, and `scripts/smoke.sh` using the in-container recipe from
   §Environment notes (`compose up -d --build` → network connect → `API_URL=http://api:8080
   SMOKE_NO_UP=1`; `docker compose down -v` afterwards).
2. Update docs that the refactor invalidated: README (commands/paths), Platform Guide
   (imports, module wiring), CLAUDE.md §Repository layout if it changed.
3. Write `docs/REFACTOR-STATUS.md`: phase-by-phase summary, anything skipped/deferred, and
   the verification evidence (test counts, smoke PASSED line).

**Checks:** every command in step 1 exits 0.

**DoD:** one commit `docs: refactor summary and updated guides`; branch contains exactly one
commit per phase (R1–R6) plus nothing else; exit 0.
