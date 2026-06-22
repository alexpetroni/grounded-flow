# Phase 3 — LLM Layer

**Goal:** A multi-provider LLM layer (`libs/llm`) with typed structured output and streaming,
fully testable offline via a `FakeProvider`, plus the OpenAI-compatible streaming endpoint.

Depends on: Phase 2. See `docs/PLAN.md` §LLM Layer, §API Surface.

## Deliverables

- **Provider factory** over Vercel AI SDK: OpenAI, Anthropic, Google, Bedrock, Mistral, Ollama,
  Azure — selected by config — plus **`FakeProvider`** built on `MockLanguageModelV2` /
  `MockEmbeddingModelV2` / `simulateReadableStream`.
- **`AgentNode`** (extends core `Node`): wraps `generateObject`/`generateText` with a **Zod output
  schema**, retries on schema-invalid output, and a telemetry hook (`experimental_telemetry`,
  NoOp until Phase 6).
- **`AgentStreamingNode`**: `streamText`/`streamObject` → async-iterable chunks in OpenAI
  `chat.completion.chunk` shape.
- **API:** `POST /v1/chat/completions` (SSE) backed by an example streaming workflow; emits chunks
  then `[DONE]`.
- **Graceful degradation:** selecting a provider whose key is absent yields a clear, non-crashing
  error surfaced to the caller (and the FakeProvider is always available for tests/dev).

## Tests (all via FakeProvider — no network)

- `AgentNode` returns a validated typed object; retries then succeeds on first-invalid-then-valid
  output; surfaces a clear error when output never validates.
- Provider factory selects the correct provider per config; unknown provider rejected.
- Streaming: chunks arrive in order and terminate with `[DONE]`; shape matches the OpenAI schema.
- **E2E:** a workflow containing an `AgentNode` runs deterministically through the worker with the
  FakeProvider (zero network); the SSE endpoint streams.

## Definition of Done

- Agent + streaming workflows run deterministically in CI with no network and no keys.
- Streaming e2e passes; coverage maintained (`libs/llm` covered by FakeProvider tests).
- `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e` green; committed.
