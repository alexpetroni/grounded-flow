# Phase 2 — Core Workflow Engine

**Goal:** The DAG workflow engine (`libs/core`) — the heart of the platform — async-correct,
fully validated, and driven end-to-end through the queue, with the reference engine's bugs fixed
and covered by regression tests.

Depends on: Phase 1. See `docs/PLAN.md` §Core Workflow Engine, §Data Layer, §Background Processing.

## Deliverables

- **`libs/core`:**
  - `Node` (abstract): `process(ctx): Promise<TaskContext>`, `saveOutput`, `getOutput<T>`,
    `cleanup()`. Nodes are NestJS injectable providers.
  - `TaskContext`: typed `event`, `nodes` (typed get/set by node token), `metadata`, `shouldStop`,
    `traceId`.
  - `WorkflowSchema` / `NodeConfig`: `{ start, nodes:[{node, connections, isRouter,
    concurrentNodes}], eventSchema }`.
  - `Workflow` (abstract): `run()` and `runStream()`; node iteration; router handling; **per-node
    `try/finally` that always calls `cleanup()` — on success, on throw, AND in the streaming
    path**; parent node-registry save/restore for composition; Langfuse span hooks (NoOp until
    Phase 6).
  - `BaseRouter` / `RouterNode`: `route(ctx)` → next node token; routers instantiated once.
  - `ConcurrentNode`: `Promise.all` over `concurrentNodes`.
  - `WorkflowValidator`: cycle detection, reachability, "only routers may have >1 connection",
    `concurrentNodes` existence, all referenced nodes registered.
- **`libs/database`:** Drizzle schema for `events` (uuid v7, status enum, data/result jsonb, error,
  traceId, timestamps) + thin repository (no self-commit); drizzle-kit config; `migrate` container
  wired.
- **Queue:** BullMQ `events` queue; `apps/worker` processor loads the event, resolves the workflow,
  runs the engine, writes result + terminal status.
- **API:** `POST /events` (Zod-validated body → persist `pending` → enqueue → 202 + eventId);
  `GET /events/:id` (status + result).
- **Example workflow:** one trivial non-LLM workflow (e.g. a linear + a router branch) registered
  and runnable end-to-end.

## Tests

- **Validator:** cycle rejected; unreachable node rejected; non-router with >1 connection rejected;
  missing/unknown node rejected; `concurrentNodes` existence enforced.
- **Engine:** linear run produces expected context; router selects correct branch; concurrent
  fan-out runs in parallel (assert wall-clock/ordering, not serial); `shouldStop` halts.
- **Regression (named):**
  - `cleanup()` called on success, on thrown error, and in the streaming path.
  - composition restores the parent node registry.
  - `POST /events` rejects malformed body via Zod (no crash).
- **Integration:** `POST /events` → BullMQ (real Redis via Testcontainers) → worker → `GET
  /events/:id` returns `completed`; a failing workflow yields `failed` with captured error
  (never stuck `pending`).

## Definition of Done

- Example event processed end-to-end through Redis to `completed`.
- All engine + validator + regression tests green; **`libs/core` coverage ≥ 80%**.
- `pnpm lint && pnpm typecheck && pnpm test` green; committed.
