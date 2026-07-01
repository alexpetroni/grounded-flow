# Platform Guide — Agent Orchestration & RAG

A hands-on guide to the RAG Platform: how the workflow engine orchestrates agents, and
how to ingest documents and interrogate them with grounded, cited answers.

This guide is **task-oriented**. For the design rationale see [`PLAN.md`](./PLAN.md); for the
engineering rules see [`../CLAUDE.md`](../CLAUDE.md); for setup/verification see
[`../README.md`](../README.md).

- [1. The big picture](#1-the-big-picture)
- [2. Quick start](#2-quick-start)
- [3. Core concepts](#3-core-concepts)
- [4. Agent orchestration](#4-agent-orchestration)
  - [4.1 A single structured-output agent](#41-a-single-structured-output-agent)
  - [4.2 Chaining nodes](#42-chaining-nodes-into-a-pipeline)
  - [4.3 Routing (conditional branching)](#43-routing--conditional-branching)
  - [4.4 Concurrent fan-out](#44-concurrent-fan-out)
  - [4.5 Workflow composition (sub-workflows)](#45-workflow-composition-sub-workflows)
  - [4.6 Streaming agents](#46-streaming-agents)
  - [4.7 Registering & running a workflow](#47-registering--running-a-workflow)
- [5. RAG: uploading documents](#5-rag-uploading-documents)
- [6. RAG: interrogating documents](#6-rag-interrogating-documents)
- [7. OpenAI-compatible chat endpoint](#7-openai-compatible-chat-endpoint)
- [8. Configuration reference](#8-configuration-reference)
- [9. API reference](#9-api-reference)

---

## 1. The big picture

The platform is a **NestJS monorepo** with two runnable apps sharing one DI container's worth
of libraries:

- **`apps/api`** — HTTP + SSE entrypoint. Accepts events, documents, and RAG queries; validates
  every body with Zod; enqueues async work.
- **`apps/worker`** — BullMQ processors that actually *run* workflows and *ingest* documents.

The libraries:

| Lib | Responsibility |
|---|---|
| `libs/core` | Workflow engine: `Node`, `Workflow`, `BaseRouter`, `ConcurrentNode`, `SubWorkflowNode`, `TaskContext`, validator, registry |
| `libs/llm` | Vercel AI SDK provider factory, `AgentNode` (structured output) + `AgentStreamingNode` (SSE), `FakeProvider` |
| `libs/rag` | Loaders → chunker → embedder → Qdrant store → hybrid retrieval → rerank → grounded generation → eval |
| `libs/database` | Drizzle schema + repositories (`events`, `documents`, `chunks`) |
| `libs/observability` | Tracing facade (NoOp until Langfuse keys set) |
| `libs/config` | Zod-validated env schema |

Two flows dominate. **Workflow events** (generic agent orchestration):

```
POST /events → validate → persist Event(status=pending) → enqueue → 202 {eventId}
worker: load Event → resolve Workflow from registry → run engine → persist result + status
GET /events/:id → poll status + result
```

**RAG** (retrieval-augmented generation):

```
POST /documents → persist Document(status=pending) → enqueue ingest → 202 {id}
worker: load → chunk → embed → upsert to Qdrant → Document(status=completed)
POST /rag/query → embed query → hybrid retrieve → rerank → grounded, cited answer
```

Everything runs in Docker: `api`, `worker`, `postgres`, `qdrant`, `redis`, a one-shot `migrate`
job, and optional `langfuse`.

---

## 2. Quick start

```bash
cp .env.example .env            # app boots even with no provider keys (graceful degradation)
docker compose up -d --build    # api, worker, postgres, qdrant, redis, migrate
curl -s http://127.0.0.1:8080/health | jq
```

`GET /health` returns liveness plus the status of each dependency (postgres / redis / qdrant).

> **No API keys?** The stack still boots and the smoke test still passes. With `LLM_PROVIDER=fake`
> and `EMBEDDING_PROVIDER=fake` the engine uses deterministic mock models — great for development
> and CI, useless for real answers. Set real provider keys in `.env` (see [§8](#8-configuration-reference))
> to get real embeddings and generations.

End-to-end smoke (health → event → ingest → RAG query → stream), all with fake providers:

```bash
bash scripts/smoke.sh     # exits 0 on success
```

---

## 3. Core concepts

A **workflow** is a directed acyclic graph of **nodes**. The engine walks it from a `start` token,
following each node's `connections`. State flows through a shared **`TaskContext`**.

### Node

Every unit of work extends `Node` (from `@app/core`). It is a NestJS injectable — services and
clients arrive by DI, never constructed inline.

```ts
import { Injectable } from '@nestjs/common';
import { Node, TaskContext } from '@app/core';

@Injectable()
export class MyNode extends Node {
  readonly token = 'MyNode';                 // unique id used in connections

  async process(ctx: TaskContext): Promise<TaskContext> {
    // read inputs, do async work, write output
    this.saveOutput(ctx, { done: true });    // stored under this.token
    return ctx;
  }

  async cleanup(): Promise<void> {
    // ALWAYS runs in a finally — success, error, AND the streaming path.
    // Release clients/handles here.
  }
}
```

Key invariants (enforced across the engine):

- `process()` is **async-native and side-effect-clean** — no blocking I/O.
- `cleanup()` is called in a `finally` on *every* path, including streaming. (This fixes a leak in
  the reference project.)

### TaskContext

The typed state bag passed to every node:

- `ctx.event` — the (Zod-validated) input event.
- `ctx.setOutput(token, value)` / `ctx.getOutput<T>(token)` — per-node outputs. `saveOutput`/
  `getOutput` on `Node` wrap these using the node's own token.
- `ctx.nodes` — read-only map of all outputs so far (this is what becomes an event's `result`).
- `ctx.metadata` — free-form side channel (RAG uses it to pass retrieved chunks into the answer node).
- `ctx.traceId` — uuid v7, shared across composed sub-workflows for trace continuity.
- `ctx.shouldStop` — set `true` to halt the walk early.

### WorkflowSchema

A workflow declares its graph by returning a `WorkflowSchema`:

```ts
interface NodeConfig {
  node: Node;
  connections: string[];      // next node token(s). >1 allowed ONLY for routers.
  isRouter?: boolean;         // node is a BaseRouter; route() picks the next token
  concurrentNodes?: string[]; // fan-out: run these node tokens in parallel
}

interface WorkflowSchema {
  start: string;              // token of the first node
  nodes: NodeConfig[];
  eventSchema?: ZodSchema;    // validates ctx.event at run() time
}
```

The `WorkflowValidator` runs on every `run()`/`runStream()` and rejects: cycles, unreachable nodes,
non-routers with >1 connection, missing `concurrentNodes`, and references to unregistered nodes.

---

## 4. Agent orchestration

"Agents" here are LLM-backed nodes. `libs/llm` gives you two base classes:

- **`AgentNode<TOutput>`** — one `generateObject` call with a **Zod output schema** → typed,
  structured output (with retries). Use for extraction, classification, reasoning steps.
- **`AgentStreamingNode`** — `streamText` → OpenAI `chat.completion.chunk` SSE frames. Use for chat.

Both get their model from `LlmService`, which selects a provider from env
(`LLM_PROVIDER` / `LLM_MODEL`) and falls back to the deterministic `FakeProvider` when set to `fake`.

### 4.1 A single structured-output agent

Subclass `AgentNode`, declare an `outputSchema`, and build the messages. The parsed object is saved
under the node's token.

```ts
import { Injectable } from '@nestjs/common';
import type { ModelMessage } from 'ai';
import { z } from 'zod';
import { AgentNode, LlmService } from '@app/llm';
import type { TaskContext } from '@app/core';

const sentimentSchema = z.object({
  sentiment: z.enum(['positive', 'neutral', 'negative']),
  score: z.number().min(0).max(1),
  rationale: z.string(),
});

@Injectable()
export class SentimentNode extends AgentNode<z.infer<typeof sentimentSchema>> {
  readonly token = 'SentimentNode';
  readonly outputSchema = sentimentSchema;

  constructor(llm: LlmService) {
    super(llm);
  }

  buildMessages(ctx: TaskContext): ModelMessage[] {
    const { text } = ctx.event as { text: string };
    return [
      { role: 'system', content: 'Classify the sentiment of the user text. Return structured JSON.' },
      { role: 'user', content: text },
    ];
  }
}
```

Downstream nodes read the typed result with `ctx.getOutput<...>('SentimentNode')`.

### 4.2 Chaining nodes into a pipeline

Connect nodes head-to-tail; each reads its predecessor's output. This is the actual `echo` example
workflow (`workflows/echo/`) — two nodes, the second consuming the first:

```ts
// echo.nodes.ts
export const echoEventSchema = z.object({ message: z.string() });

@Injectable()
export class EchoNode extends Node {
  readonly token = 'EchoNode';
  async process(ctx: TaskContext): Promise<TaskContext> {
    const event = echoEventSchema.parse(ctx.event);
    this.saveOutput(ctx, { echo: event.message });
    return ctx;
  }
}

@Injectable()
export class UpperCaseNode extends Node {
  readonly token = 'UpperCaseNode';
  async process(ctx: TaskContext): Promise<TaskContext> {
    const { echo } = ctx.getOutput<{ echo: string }>('EchoNode');
    this.saveOutput(ctx, { result: echo.toUpperCase() });
    return ctx;
  }
}
```

```ts
// echo.workflow.ts
@Injectable()
export class EchoWorkflow extends Workflow {
  static readonly TYPE = 'echo';

  constructor(
    private readonly echoNode: EchoNode,
    private readonly upperCaseNode: UpperCaseNode,
  ) {
    super();
  }

  getSchema(): WorkflowSchema {
    return {
      start: this.echoNode.token,
      eventSchema: echoEventSchema,
      nodes: [
        { node: this.echoNode, connections: [this.upperCaseNode.token] },
        { node: this.upperCaseNode, connections: [] },   // [] = terminal
      ],
    };
  }
}
```

Swap `EchoNode`/`UpperCaseNode` for `AgentNode`s and you have a multi-step LLM pipeline
(e.g. *extract entities → summarize → draft reply*), each step's structured output feeding the next.

### 4.3 Routing — conditional branching

A router is the **only** node type allowed more than one connection. Extend `BaseRouter` and
implement `route(ctx)` to return the next node's token based on state:

```ts
import { Injectable } from '@nestjs/common';
import { BaseRouter, TaskContext } from '@app/core';

@Injectable()
export class SentimentRouter extends BaseRouter {
  readonly token = 'SentimentRouter';

  route(ctx: TaskContext): string {
    const { sentiment } = ctx.getOutput<{ sentiment: string }>('SentimentNode');
    return sentiment === 'negative' ? 'EscalateNode' : 'AutoReplyNode';
  }
}
```

```ts
getSchema(): WorkflowSchema {
  return {
    start: this.sentimentNode.token,
    nodes: [
      { node: this.sentimentNode, connections: [this.sentimentRouter.token] },
      {
        node: this.sentimentRouter,
        isRouter: true,
        connections: ['EscalateNode', 'AutoReplyNode'],  // declared branches
      },
      { node: this.escalateNode, connections: [] },
      { node: this.autoReplyNode, connections: [] },
    ],
  };
}
```

The engine runs the router's `process()` (a no-op by default), then follows `route()`'s return.
Every branch listed in `connections` must be a registered node, and the graph must stay acyclic.

### 4.4 Concurrent fan-out

To run several agents in parallel (e.g. summarize, extract keywords, and detect language at once),
set `concurrentNodes` on a coordinator node. The engine `Promise.all`s them, then continues to the
coordinator's single `connections[0]`:

```ts
getSchema(): WorkflowSchema {
  return {
    start: this.fanOut.token,
    nodes: [
      {
        node: this.fanOut,                                   // a ConcurrentNode coordinator
        concurrentNodes: ['SummaryNode', 'KeywordsNode', 'LanguageNode'],
        connections: [this.mergeNode.token],                 // runs after all three finish
      },
      { node: this.summaryNode,  connections: [] },
      { node: this.keywordsNode, connections: [] },
      { node: this.languageNode, connections: [] },
      { node: this.mergeNode,    connections: [] },          // reads all three outputs
    ],
  };
}
```

`MergeNode` reads each parallel result via `ctx.getOutput('SummaryNode')`, etc. Because nodes are
async-native, this is true non-blocking concurrency.

### 4.5 Workflow composition (sub-workflows)

Run an entire registered workflow as one step of a parent — the composition primitive the reference
engine lacked. Extend `SubWorkflowNode`, name the child workflow, and map parent state to the
child's input event. The child runs in its **own isolated `TaskContext`** (sharing only `traceId`);
its outputs are merged back namespaced under the sub-node's token. This is `workflows/composite/`:

```ts
@Injectable()
export class EchoSubWorkflowNode extends SubWorkflowNode {
  readonly token = 'EchoSubWorkflow';
  readonly childWorkflowType = 'echo';               // must be registered

  protected buildChildEvent(ctx: TaskContext): unknown {
    const { text } = compositeEventSchema.parse(ctx.event);
    return { message: text };                         // shape the child expects
  }
}

@Injectable()
export class SummarizeNode extends Node {
  readonly token = 'SummarizeNode';
  async process(ctx: TaskContext): Promise<TaskContext> {
    const child = ctx.getOutput<SubWorkflowResult>('EchoSubWorkflow');
    const upper = child?.nodes['UpperCaseNode'] as { result: string } | undefined;
    this.saveOutput(ctx, { summary: `echo returned: ${upper?.result ?? '(none)'}` });
    return ctx;
  }
}
```

A composing workflow overrides `getRegistry()` so the validator can confirm the child is registered
at run time. Sibling nodes read child outputs either via the raw `SubWorkflowResult.nodes` map (as
above) or the typed helper `subNode.getChildOutput<T>(ctx, 'UpperCaseNode')`.

### 4.6 Streaming agents

For token-by-token chat, extend `AgentStreamingNode` and implement `buildMessages`. Streaming
nodes are auto-detected by the engine's `runStream()`; each emitted value is an OpenAI
`chat.completion.chunk`. This is `workflows/streaming/`:

```ts
export const streamingEventSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string(),
  })),
  model: z.string().optional(),
  stream: z.boolean().default(true),
});

@Injectable()
export class StreamingChatNode extends AgentStreamingNode {
  readonly token = 'StreamingChatNode';
  buildMessages(ctx: TaskContext): ModelMessage[] {
    const event = streamingEventSchema.parse(ctx.event);
    return event.messages.map((m) => ({ role: m.role, content: m.content })) as ModelMessage[];
  }
}
```

`runStream()` yields a `role` opener frame, then `content` deltas, then a `finish_reason: 'stop'`
frame — and calls `cleanup()` in a `finally` even mid-stream. The `/v1/chat/completions` controller
pipes these straight to SSE (see [§7](#7-openai-compatible-chat-endpoint)).

### 4.7 Registering & running a workflow

A workflow is reachable by clients once it's in the `WorkflowRegistry` under a string type. Register
it in `workflows/workflows.module.ts`:

```ts
const registry = new WorkflowRegistry();
registry.register(EchoWorkflow.TYPE, echoWorkflow);            // 'echo'
registry.register(StreamingWorkflow.TYPE, streamingWorkflow);  // 'streaming-chat'
registry.register(CompositeWorkflow.TYPE, composite);          // 'composite'
```

> Composing workflows share a single registry *instance*, so build the composite node graph
> manually (as the module does) rather than via DI — otherwise you create a construction cycle
> (registry ← workflow ← sub-node ← registry).

Now clients submit work by `workflowType`. Submit an event (returns `202` immediately):

```bash
curl -s -X POST http://127.0.0.1:8080/events \
  -H 'content-type: application/json' \
  -d '{"workflowType":"echo","data":{"message":"hello world"}}'
# → {"eventId":"0190...","status":"pending"}
```

The worker resolves the workflow, runs it under a trace span, and persists the result. Poll it:

```bash
curl -s http://127.0.0.1:8080/events/0190... | jq
# {
#   "eventId": "0190...",
#   "status": "completed",
#   "result": {
#     "EchoNode":      { "echo": "hello world" },
#     "UpperCaseNode": { "result": "HELLO WORLD" }
#   },
#   "error": null, "createdAt": "...", "updatedAt": "..."
# }
```

`result` is exactly `ctx.nodes` — every node's output, keyed by token. Status transitions
`pending → processing → completed | failed`; on retryable failure BullMQ retries with exponential
backoff, and terminal failures are dead-lettered (never stuck `pending`).

---

## 5. RAG: uploading documents

Ingestion is asynchronous: `POST /documents` persists the doc and enqueues a BullMQ `ingest` job;
the worker loads → chunks → embeds → upserts to Qdrant.

**Request body** (Zod-validated, `apps/api/src/documents/documents.dto.ts`):

| Field | Type | Notes |
|---|---|---|
| `source` | string (required) | display name / origin, e.g. `guide.md` |
| `mimeType` | enum (required) | one of the supported types below |
| `content` | string (required) | **base64-encoded** file bytes |
| `metadata` | object (optional) | arbitrary; stored on the doc & each chunk, filterable at query time |

**Supported MIME types** (`SUPPORTED_MIME_TYPES`):
`text/plain`, `text/markdown`, `text/x-markdown`, `application/markdown`, `text/html`,
`application/pdf`. HTML is stripped to text; PDF is parsed with `pdf-parse`.

Upload a plain-text document:

```bash
content_b64=$(printf 'Retrieval-Augmented Generation grounds LLM answers in retrieved source
documents. Hybrid search fuses dense and sparse vectors for better recall.' | base64 | tr -d '\n')

curl -s -X POST http://127.0.0.1:8080/documents \
  -H 'content-type: application/json' \
  -d "{\"source\":\"rag-intro.txt\",\"mimeType\":\"text/plain\",
       \"content\":\"$content_b64\",\"metadata\":{\"lang\":\"en\",\"topic\":\"rag\"}}"
# → {"id":"0190...","status":"pending"}
```

Upload a local file (PDF/HTML/Markdown) by base64-encoding it:

```bash
b64=$(base64 -w0 ./whitepaper.pdf)
curl -s -X POST http://127.0.0.1:8080/documents \
  -H 'content-type: application/json' \
  -d "{\"source\":\"whitepaper.pdf\",\"mimeType\":\"application/pdf\",\"content\":\"$b64\"}"
```

Poll ingestion status:

```bash
curl -s http://127.0.0.1:8080/documents/0190... | jq '.status'
# "pending" → "processing" → "completed"   (or "failed" with an error message)
```

**What the worker does** (`libs/rag/src/ingestion/ingestion.service.ts`):

1. **Load** — pick a `DocumentLoader` by MIME type → extract text + metadata.
2. **Idempotency** — ensure the Qdrant collection exists, then delete this document's existing
   chunks (DB) and points (Qdrant). Re-ingesting the same `documentId` never duplicates.
3. **Chunk** — token-aware recursive splitter (`js-tiktoken`), `RAG_CHUNK_TOKENS` size with
   `RAG_CHUNK_OVERLAP` overlap.
4. **Embed** — `embedMany` (default OpenAI `text-embedding-3-small`, 1536-dim), batched with retry.
5. **Persist & upsert** — canonical chunk text/tokenCount/ordinal to Postgres; dense (+ sparse)
   vectors to Qdrant, keyed by `chunkId`, with payload `{documentId, chunkId, ordinal, text, metadata}`.

If any step throws, the document is marked `failed` with the error, the job retries with backoff,
and a permanently-failed job is dead-lettered.

> **Idempotent re-ingest** is a guaranteed invariant with a regression test: re-`POST` the same
> content and you get the same chunk set, not duplicates.

---

## 6. RAG: interrogating documents

Once a document is `completed`, ask questions with `POST /rag/query`. One synchronous call runs the
full pipeline: **embed query → hybrid retrieve → rerank → grounded, cited generation**.

**Request body** (`apps/api/src/rag/rag-query.dto.ts`):

| Field | Type | Default | Notes |
|---|---|---|---|
| `query` | string (required) | — | the question |
| `topK` | int 1–100 (optional) | `RAG_TOP_K` (20) | candidates to retrieve before rerank |
| `topN` | int 1–100 (optional) | `RAG_RERANK_TOP_N` (5) | chunks kept after rerank, fed to the LLM |
| `filter` | object (optional) | — | Qdrant payload filter, e.g. `{"documentId":"..."}` or `{"metadata.lang":"en"}` |
| `mode` | `hybrid`\|`dense`\|`sparse` (optional) | `hybrid` | which vector spaces to query and fuse (RRF) |

Basic query:

```bash
curl -s -X POST http://127.0.0.1:8080/rag/query \
  -H 'content-type: application/json' \
  -d '{"query":"What does retrieval-augmented generation do?"}' | jq
```

**Response** (`RagQueryResult`):

```jsonc
{
  "answer": "Retrieval-Augmented Generation grounds LLM answers in retrieved source documents...",
  "citations": [
    {
      "chunkId": "0190...",          // always exists in the retrieved set — never hallucinated
      "quote": "grounds LLM answers in retrieved source documents",
      "documentId": "0190...",
      "ordinal": 0
    }
  ],
  "confidence": 0.86,                // model self-reported, 0..1
  "grounded": true,                  // true iff ≥1 citation, all resolving to retrieved chunks
  "repaired": false,                 // true iff an ungrounded citation was dropped/repaired
  "retrieved": [                     // the reranked context that was actually used
    { "chunkId": "0190...", "documentId": "0190...", "ordinal": 0,
      "score": 0.71, "rerankScore": 0.93 }
  ]
}
```

**Grounded citations are enforced, not hoped for.** After the LLM answers,
`validateGrounding` (`libs/rag/src/generation/grounding.ts`) checks every returned `chunkId`
against the retrieved set:

- Citations pointing at chunks that weren't retrieved are **dropped**.
- If that leaves the answer with zero citations while context exists, it's **repaired** by anchoring
  to the top retrieved chunk (so answers are never silently un-cited).
- Either action flips `repaired: true`, and `grounded` reflects the final, verified state.

If retrieval + rerank yields nothing, you get a graceful empty answer
(`"No relevant context was found..."`, `grounded: false`, empty `citations`) rather than a fabricated one.

**Scope a query to one document** (or any metadata) with `filter`:

```bash
curl -s -X POST http://127.0.0.1:8080/rag/query \
  -H 'content-type: application/json' \
  -d '{"query":"summarize the methodology","filter":{"documentId":"0190..."},"topN":8}' | jq
```

**Tuning knobs:** raise `topK` for recall (more candidates), raise `topN` for richer context (more
chunks to the LLM, higher token cost). Use `mode:"dense"` for semantic-only, `"sparse"` for
keyword-only, `"hybrid"` (default) to fuse both with Reciprocal Rank Fusion.

> **Reranking:** with a `COHERE_API_KEY` set, candidates are reranked by Cohere Rerank; without one
> the platform degrades gracefully to a passthrough reranker (retrieval order preserved) and logs a
> warning — it never crashes.

---

## 7. OpenAI-compatible chat endpoint

`POST /v1/chat/completions` streams a chat completion as Server-Sent Events in the OpenAI
`chat.completion.chunk` shape — so existing OpenAI SDK clients can point at it. It runs the
registered `streaming-chat` workflow via `runStream()`.

```bash
curl -N -s -X POST http://127.0.0.1:8080/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"Explain hybrid search in one sentence."}]}'
```

```
data: {"id":"chatcmpl-...","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}
data: {"id":"chatcmpl-...","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hybrid"},"finish_reason":null}]}
data: {"id":"chatcmpl-...","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":" search"},"finish_reason":null}]}
...
data: {"id":"chatcmpl-...","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}
data: [DONE]
```

The request body accepts `model` (optional), `messages` (≥1, required), and `stream` (default true).
Bodies are Zod-validated; malformed input returns `400`.

---

## 8. Configuration reference

All config is a Zod-validated env schema (`libs/config/src/env.schema.ts`), validated at boot;
copy `.env.example` → `.env`. Highlights:

| Var | Default | Purpose |
|---|---|---|
| `API_PORT` | `8080` | API HTTP port |
| `DATABASE_URL` | — (required) | Postgres connection |
| `REDIS_URL` | — (required) | BullMQ broker |
| `QDRANT_URL` | — (required) | Vector store |
| `QDRANT_COLLECTION` | `rag_chunks` | Qdrant collection name |
| `LLM_PROVIDER` / `LLM_MODEL` | `openai` / `gpt-4o-mini` | Generation model; `fake` for deterministic dev |
| `EMBEDDING_PROVIDER` / `EMBEDDING_MODEL` | `openai` / `text-embedding-3-small` | Embeddings; `fake` for dev |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY_APP`, `GOOGLE_API_KEY`, `MISTRAL_API_KEY`, `OLLAMA_BASE_URL` | `''` | Provider keys (missing → that capability degrades) |
| `RERANK_PROVIDER` / `COHERE_API_KEY` | `cohere` / `''` | Reranker; no key → passthrough |
| `RAG_CHUNK_TOKENS` / `RAG_CHUNK_OVERLAP` | `512` / `64` | Chunker sizing |
| `RAG_TOP_K` / `RAG_RERANK_TOP_N` | `20` / `5` | Retrieval / rerank defaults |
| `WORKER_CONCURRENCY` | `5` | Parallel jobs per worker |
| `BULLMQ_ATTEMPTS` / `BULLMQ_BACKOFF_MS` | `3` / `1000` | Retry policy |
| `API_BODY_LIMIT` | `5mb` | Max request body |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | `0` / `60000` | In-memory rate limit (`0` = off) |
| `API_KEY` | `''` | Optional API-key guard (`''` = off) |
| `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` / `LANGFUSE_BASE_URL` | `''` / `''` / cloud | Tracing; NoOp until both keys set |

**Provider selection** is per-capability. Supported LLM providers: `openai`, `anthropic`, `google`,
`mistral`, `ollama`, `fake`. Embeddings: `openai`, `ollama`, `fake` (both default to 1536 dims so
collections stay compatible across dev and prod). Set `LLM_PROVIDER=fake` and
`EMBEDDING_PROVIDER=fake` to run the whole platform with zero keys and fully deterministic output.

**Graceful degradation** is a design invariant: a missing key disables that one capability with a
logged warning; it never crashes boot. Tracing is a NoOp until both Langfuse keys are present.

---

## 9. API reference

| Method & path | Body | Returns |
|---|---|---|
| `GET /health` | — | `{status, dependencies:{postgres,redis,qdrant}}` |
| `POST /events` | `{workflowType, data}` | `202 {eventId, status:"pending"}` |
| `GET /events/:id` | — | `{eventId, status, result, error, createdAt, updatedAt}` |
| `POST /documents` | `{source, mimeType, content(base64), metadata?}` | `202 {id, status}` |
| `GET /documents/:id` | — | the `Document` row (incl. `status`) |
| `POST /rag/query` | `{query, topK?, topN?, filter?, mode?}` | `RagQueryResult` (answer + grounded citations) |
| `POST /v1/chat/completions` | `{messages, model?, stream?}` | SSE stream of `chat.completion.chunk` + `[DONE]` |

Every body is Zod-validated → malformed input yields `400` (never a crash). Global guards: payload
size limit (`API_BODY_LIMIT`), optional in-memory rate limiter (`RATE_LIMIT_MAX`), optional API-key
guard (`API_KEY`) — the last two off by default.

---

### See also

- **[`README.md`](../README.md)** — setup, build process, verification gate.
- **[`PLAN.md`](./PLAN.md)** — full architecture & the reference-project critique this fixes.
- **[`../CLAUDE.md`](../CLAUDE.md)** — engineering constitution & regression checklist.
- Example workflows live in **`workflows/`** (`echo`, `streaming`, `composite`).
- The end-to-end smoke script — **`scripts/smoke.sh`** — is a runnable tour of every flow above.
</content>
</invoke>
