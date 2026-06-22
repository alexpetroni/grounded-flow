# Phase 6 — Eval, Observability & Hardening

**Goal:** Prove RAG quality with an eval harness, make the system observable, harden the worker,
and ship the single end-to-end smoke that defines the "workable product."

Depends on: Phase 5. See `docs/PLAN.md` §RAG Subsystem (8), §Observability/Config/Quality,
§Global Definition of Done.

## Deliverables

- **Eval harness (`test/eval`, `pnpm eval`):** runs over `test/eval/dataset.jsonl`
  (query → gold answer, gold chunk ids). Metrics: retrieval **recall@k**, **MRR**, **context
  precision**, and **faithfulness** via LLM-judge. Writes a baseline file; supports a **ratchet**
  (fail if below recorded baseline). Uses real providers (opt-in; not in blocking CI). Optional
  Langfuse dataset logging.
- **Observability:** Langfuse JS SDK via OpenTelemetry + AI SDK telemetry; **NoOp when keys
  absent**. Workflow + per-node + agent spans become visible when configured.
- **Worker hardening:** BullMQ retries with exponential backoff, configurable concurrency,
  **dead-letter** handling; status transitions guaranteed terminal.
- **API hardening:** payload-size limits, basic rate-limit, optional API-key guard scaffold
  (off by default).
- **Smoke + docs:** `scripts/smoke.sh` (the Global DoD gate) and a final README pass
  (setup/run/test/eval/architecture), `.env.example` complete, CI `test:e2e` wired.

## Tests

- Eval harness runs on the fixture set and emits all metrics; ratchet logic unit-tested with
  synthetic scores.
- Observability NoOp path works with no keys (no crash, no spans); spans emitted when configured
  (asserted against a fake exporter).
- **Worker resilience (integration):** kill a job mid-flight → retry → terminal status (never
  stuck `pending`); terminally failed job lands in the DLQ.
- `scripts/smoke.sh` passes against the running stack.

## Definition of Done

- **`bash scripts/smoke.sh` exits 0**: health → submit event & poll to `completed` → ingest
  sample corpus → `POST /rag/query` returns a grounded, cited answer → stream a chat completion.
- Eval baseline recorded and meets initial thresholds: **recall@5 ≥ 0.85, MRR ≥ 0.7,
  faithfulness ≥ 0.9** on the fixture set.
- Worker kill-resilience + DLQ tests pass; tracing visible when configured.
- Every reference-project regression test (see `CLAUDE.md` §Regression checklist) passes.
- Full CI green; README + `.env.example` complete; committed.

## The product is Done

When this phase's DoD holds, the Global Definition of Done in `docs/PLAN.md` is satisfied and the
repository is a runnable, tested, production-shaped RAG platform.
