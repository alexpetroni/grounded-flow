import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import type { StreamingWorkflow, StreamingChatNode } from '@app/workflows';
import { ChatController } from './chat.controller';

const MESSAGES = [{ role: 'user', content: 'Hello' }];

interface FakeRes {
  destroyed: boolean;
  writableEnded: boolean;
  headers: Record<string, string>;
  jsonBody: unknown;
  writes: string[];
  onWrite?: (count: number) => void;
  emitClose: () => void;
  setHeader: (name: string, value: string) => void;
  flushHeaders: () => void;
  write: (chunk: string) => boolean;
  end: () => void;
  json: (body: unknown) => void;
  on: (event: string, fn: () => void) => FakeRes;
}

function makeRes(opts: { destroyed?: boolean } = {}): FakeRes {
  const emitter = new EventEmitter();
  const res: FakeRes = {
    destroyed: opts.destroyed ?? false,
    writableEnded: false,
    headers: {},
    jsonBody: undefined,
    writes: [],
    emitClose: () => emitter.emit('close'),
    setHeader(name, value) {
      res.headers[name] = value;
    },
    flushHeaders() {},
    write(chunk) {
      res.writes.push(chunk);
      res.onWrite?.(res.writes.length);
      return true;
    },
    end() {
      res.writableEnded = true;
    },
    json(body) {
      res.jsonBody = body;
    },
    on(event, fn) {
      emitter.on(event, fn);
      return res;
    },
  };
  return res;
}

function makeController(chunkCount: number) {
  const state = { yielded: 0, finalized: false };
  const workflow = {
    run: () => Promise.resolve({ traceId: 'trace-1' }),
    runStream: async function* (): AsyncGenerator<unknown, void, undefined> {
      try {
        for (let i = 0; i < chunkCount; i++) {
          state.yielded += 1;
          yield {
            id: 'chatcmpl-x',
            object: 'chat.completion.chunk',
            created: 0,
            model: 'fake-model',
            choices: [{ index: 0, delta: { content: `t${i}` }, finish_reason: null }],
          };
        }
      } finally {
        // Runs on natural exhaustion AND on early break (iterator.return()) —
        // the workflow cleanup path the controller must always trigger.
        state.finalized = true;
      }
    },
  };
  const node = { readOutput: () => ({ text: 'hello from node' }) };
  const controller = new ChatController(
    workflow as unknown as StreamingWorkflow,
    node as unknown as StreamingChatNode,
  );
  return { controller, state };
}

describe('ChatController', () => {
  // Regression: OpenAI's default is non-streaming; an omitted `stream` must
  // produce one JSON completion, not SSE.
  it('responds with a single JSON completion when stream is omitted', async () => {
    const { controller, state } = makeController(3);
    const res = makeRes();

    await controller.chatCompletions({ messages: MESSAGES }, res as unknown as Response);

    const body = res.jsonBody as {
      object: string;
      choices: Array<{ message: { content: string } }>;
    };
    expect(body.object).toBe('chat.completion');
    expect(body.choices[0].message.content).toBe('hello from node');
    expect(res.headers['Content-Type']).toBeUndefined();
    expect(state.yielded).toBe(0);
  });

  it('responds with a single JSON completion for explicit stream:false', async () => {
    const { controller } = makeController(3);
    const res = makeRes();

    await controller.chatCompletions(
      { messages: MESSAGES, stream: false },
      res as unknown as Response,
    );

    expect((res.jsonBody as { object: string }).object).toBe('chat.completion');
  });

  it('streams SSE chunks and terminates with [DONE] for stream:true', async () => {
    const { controller, state } = makeController(3);
    const res = makeRes();

    await controller.chatCompletions(
      { messages: MESSAGES, stream: true },
      res as unknown as Response,
    );

    expect(res.headers['Content-Type']).toBe('text/event-stream');
    expect(res.writes).toHaveLength(4); // 3 chunks + [DONE]
    expect(res.writes[3]).toBe('data: [DONE]\n\n');
    expect(res.writableEnded).toBe(true);
    expect(state.finalized).toBe(true);
  });

  // Regression: 'close' can fire before the handler registers its listener
  // (body parsing is async) — the loop must still see the disconnect instead
  // of streaming the full completion into a destroyed socket.
  it('streams nothing when the client disconnected before the handler ran', async () => {
    const { controller, state } = makeController(5);
    const res = makeRes({ destroyed: true });

    await controller.chatCompletions(
      { messages: MESSAGES, stream: true },
      res as unknown as Response,
    );

    expect(res.writes).toHaveLength(0);
    expect(res.writableEnded).toBe(false);
    expect(state.yielded).toBeLessThanOrEqual(1);
    expect(state.finalized).toBe(true); // generator cleaned up, not abandoned
  });

  // Regression: node cleanup() must run on the streaming path even when the
  // client disconnects mid-stream (break → iterator.return() → finally).
  it('stops consuming and finalizes the generator on mid-stream disconnect', async () => {
    const { controller, state } = makeController(10);
    const res = makeRes();
    res.onWrite = (count) => {
      if (count === 2) res.emitClose();
    };

    await controller.chatCompletions(
      { messages: MESSAGES, stream: true },
      res as unknown as Response,
    );

    expect(res.writes).toHaveLength(2); // no further chunks, no [DONE]
    expect(res.writes.some((w) => w.includes('[DONE]'))).toBe(false);
    expect(res.writableEnded).toBe(false);
    expect(state.yielded).toBeLessThan(10);
    expect(state.finalized).toBe(true);
  });
});
