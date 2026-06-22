You are building this project autonomously inside a sandboxed Docker container. You may use
--dangerously-skip-permissions freely; you are isolated and have the host Docker socket for
docker-first verification.

START HERE:
1. Read README.md, then CLAUDE.md (the engineering constitution), then docs/PLAN.md in full.
2. Determine the current phase from `git log` and the repo state. The next phase is the lowest
   PHASE-N-PLAN.md whose Definition of Done does not yet hold.
3. Build phases strictly in order, 0 → 6. Do NOT skip ahead.

FOR EACH PHASE:
- Re-read its PHASE-N-PLAN.md.
- Implement every deliverable. Write tests in the SAME commits as the code.
- Honor every rule and invariant in CLAUDE.md (no `any`, async-native nodes, grounded citations,
  idempotent ingestion, graceful degradation, regression tests for the reference bugs, etc.).
- Verify the phase's Definition of Done by actually running the checks:
    pnpm lint && pnpm typecheck && pnpm test
    docker build (for images the phase touches)
    docker compose up -d --build   # confirm services are healthy where relevant
    pnpm test:e2e                  # once the API exists
- Only when the DoD fully holds, commit with a conventional-commit message, then proceed.

RULES:
- Tests must never call live LLM/embedding/rerank APIs — use FakeProvider + AI SDK mock models.
- Never fake a green result. If a DoD cannot be met, STOP and write a clear blocker report
  (what failed, what you tried, what is needed) instead of proceeding.
- Keep commits scoped per phase (at least one commit per phase).
- The final goal is the "workable product" gate in README.md §Verification, culminating in
  `bash scripts/smoke.sh` exiting 0.

When all phases are Done, run the full verification suite one last time and summarize the result.
