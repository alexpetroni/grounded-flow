# Phase 1 — Scaffold & Harness

**Goal:** A NestJS monorepo that boots in Docker with all backing services healthy, a `/health`
endpoint, and a working test + CI harness — so every later phase lands on green infrastructure.

Depends on: Phase 0. See `docs/PLAN.md` §Repository Structure, §Observability/Config/Quality.

## Deliverables

- **Monorepo:** NestJS monorepo mode + pnpm workspace. `apps/api`, `apps/worker`, and empty
  `libs/{core,llm,rag,database,observability,config}` wired into `nest-cli.json` + `tsconfig`.
- **TS config:** strict mode, path aliases for libs, `tsconfig.build.json`.
- **Lint/format:** ESLint (`@typescript-eslint`, **`no-explicit-any` = error**) + Prettier.
- **Test harness:** Vitest config (unit + integration projects), coverage thresholds wired
  (≥ 80% on core/rag/database once they exist), Supertest available for e2e.
- **Config lib:** `@nestjs/config` + a **Zod env schema** (`libs/config`) validated at boot;
  boot fails fast with a readable error on bad/missing required env. Optional provider keys are
  allowed empty (graceful degradation).
- **Docker:**
  - `docker/Dockerfile.api`, `docker/Dockerfile.worker` — multi-stage (build → slim runtime),
    **glibc base** (`node:24-bookworm-slim`), non-root user, no `--reload`.
  - `docker-compose.yml` — services `postgres` (16), `redis`, `qdrant`, `api`, `worker`,
    one-shot `migrate`; healthchecks on each; `depends_on: condition: service_healthy`; ports
    bound to `127.0.0.1`; named volumes.
  - `docker-compose.dev.yml` — watch/hot-reload overlay for development.
- **Health:** `GET /health` returns 200 with a small status payload (checks DB + Redis + Qdrant
  reachability).
- **CI:** GitHub Actions — `install (pnpm cache) → lint → typecheck → test → docker build`.
- **package.json scripts:** `lint`, `typecheck`, `test`, `test:e2e`, `build`, `eval` (stub ok).

## Tests

- **Unit:** config/env validation — valid env parses; missing required var throws a clear error;
  empty optional provider keys are accepted.
- **E2E:** `GET /health` returns 200 (Supertest).
- **Harness self-check:** a deliberately failing test toggled to passing to prove the gates run
  (or an equivalent assertion that CI fails on red).

## Definition of Done

- `docker compose up -d --build` brings **all** services to healthy; `GET /health` → 200.
- `pnpm lint && pnpm typecheck && pnpm test` green locally and in CI.
- `docker build` succeeds for `api` and `worker`.
- Committed with a conventional-commit message.

## Notes / Risks

- Validate the glibc base early — native deps land in Phase 4, but the image choice is locked here.
- Keep `apps/worker` minimal (boots, connects to Redis, no processors yet) — processors arrive in
  Phase 2 (events) and Phase 4 (ingest).
