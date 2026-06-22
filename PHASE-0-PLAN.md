# Phase 0 — Repo Init & Governance

**Goal:** A clean git repository whose governance docs are committed, so every later phase has a
stable base and the build agent has its instructions.

## Deliverables

- `git init` in `/home/alex/work/RAG` (default branch `main`).
- Governance docs committed: `README.md`, `CLAUDE.md`, `docs/PLAN.md`, `PHASE-0..6-PLAN.md`.
- `.gitignore`, `.env.example`.
- Builder: `docker/builder/{Dockerfile,bootstrap.sh,PROMPT.md}`, `docker-compose.builder.yml`.
- `.nvmrc` pinning Node 24.
- Initial commit.

## Tests

- None (no application code yet). Sanity only: `git status` is clean after the initial commit.

## Definition of Done

- Repo exists with a clean initial commit on `main`; `git status` clean.
- All governance + builder files present and committed.
- `docker compose -f docker-compose.builder.yml build` succeeds (builder image builds).

> Most of Phase 0 is already in place when the agent first runs (these files were authored during
> planning). The agent's job here is to verify completeness, add `.nvmrc` if missing, and ensure
> the initial commit exists.
