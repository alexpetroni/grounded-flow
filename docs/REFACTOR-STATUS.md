# REFACTOR-STATUS

Running log of deferred/follow-up items noted during individual phases. A full phase-by-phase
summary and verification evidence is written in R6.

## R4 — Workflow engine: discriminated-union schema

- **Deferred (optional) — typed node outputs.** Step 7 of R4 suggested keying
  `TaskContext.getOutput`/`setOutput` off the node instance so `ctx.getOutput<T>('Token')` casts
  disappear at call sites. Skipped: `getOutput<T>(token: string)` is called by string token across
  `libs/rag`, `apps/api`, `apps/worker`, and every `workflows/*` node/spec — converting the API
  would ripple far outside `libs/core` and balloon this phase's diff well past "discriminated-union
  schema." Left as a follow-up for a dedicated phase if desired.
