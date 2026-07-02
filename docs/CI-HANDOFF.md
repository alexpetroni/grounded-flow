# CI Failure — RESOLVED (2026-07-02)

Historical handoff doc. The failure described below was diagnosed and fixed; kept as a record.

## Root cause (confirmed by clean-room reproduction, not the log)

`pnpm test` exited 1 in any checkout without a `.env` file — and CI never has one (`.env` is
git-ignored). Mechanism:

1. `apps/worker/src/dead-letter.service.ts` imports `parseRedisUrl` from `@app/config`.
2. The barrel `libs/config/src/index.ts` re-exports `config.module.ts`.
3. `config.module.ts` called `NestConfigModule.forRoot({ validate })` **inside the `@Module`
   decorator**, i.e. at import time — the moment any spec transitively touched `@app/config`.
4. With no `.env`, Zod validation threw `DATABASE_URL / REDIS_URL / QDRANT_URL: Required` as an
   **unhandled rejection**; vitest exits 1 on unhandled errors **even when every test passes**.

Locally it was green only because the dev machine's git-ignored `.env` satisfied the schema.
Reproduced with: clean `git clone` (no `.env`) → `pnpm install` → `CI=true pnpm test` → exit 1
with all tests passing. With the fix applied, same clean clone → exit 0.

## The fix

- `libs/config/src/config.module.ts`: `AppConfigModule` is now a **dynamic module** — env
  validation runs in `AppConfigModule.forRoot()` at Nest bootstrap, never at import.
- `apps/api/src/app.module.ts`, `apps/worker/src/worker.module.ts`: import
  `AppConfigModule.forRoot()`.
- Named regression test: `libs/config/src/config.module.spec.ts` (asserts the static module
  metadata is empty, i.e. no eager `forRoot()` at import).
- Bootstrap behavior preserved: running the built image with no env still fails fast with
  `Invalid environment configuration` (verified against `rag-api:ci`).

## Corrections to the previous session's assumptions

- **Docker Hub rate-limiting was NOT the cause.** In run #5 (`ea97af2`) the `Log in to Docker Hub`
  step succeeded and the Test step still failed — after only 20s, far too fast for image pulls to
  be the problem. The login step is harmless and kept.
- **CI logs ARE partially readable without credentials.** The repo is public: run/job/step status
  and annotations come from the unauthenticated GitHub API
  (`/repos/alexpetroni/grounded-flow/actions/runs`, `.../jobs`, `/check-runs/<id>/annotations`).
  Only the raw log download requires a token. The failing step (Test, exit 1) was identified this
  way; the root cause was then pinned by clean-room reproduction.
