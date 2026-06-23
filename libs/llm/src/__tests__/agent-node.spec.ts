import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { ModelMessage } from 'ai';
import { TaskContext } from '@app/core';
import { AgentNode } from '../agent-node.abstract';
import { LlmService } from '../llm.service';
import { createFakeLanguageModel } from '../fake-provider';

const responseSchema = z.object({ answer: z.string() });

class TestAgentNode extends AgentNode<z.infer<typeof responseSchema>> {
  readonly token = 'TestAgentNode';
  readonly outputSchema = responseSchema;

  buildMessages(_ctx: TaskContext): ModelMessage[] {
    return [{ role: 'user', content: 'Answer with a JSON object {"answer": "yes"}' }];
  }
}

function makeLlmService(responses: string[]): LlmService {
  const model = createFakeLanguageModel({ responses });
  const service = new LlmService();
  service.getLanguageModel = () => model;
  return service;
}

describe('AgentNode', () => {
  it('returns a typed object from the model output', async () => {
    const service = makeLlmService(['{"answer":"yes"}']);
    const node = new TestAgentNode(service);
    const ctx = new TaskContext({});

    await node.process(ctx);

    const output = ctx.getOutput<{ answer: string }>(node.token);
    expect(output).toEqual({ answer: 'yes' });
  });

  it('calls cleanup() after success without throwing', async () => {
    const service = makeLlmService(['{"answer":"yes"}']);
    const node = new TestAgentNode(service);
    const ctx = new TaskContext({});

    await node.process(ctx);
    await expect(node.cleanup()).resolves.toBeUndefined();
  });

  it('saves output under the correct node token', async () => {
    const service = makeLlmService(['{"answer":"hello"}']);
    const node = new TestAgentNode(service);
    const ctx = new TaskContext({});

    await node.process(ctx);

    expect(ctx.getOutput<{ answer: string }>('TestAgentNode')).toMatchObject({ answer: 'hello' });
    expect(ctx.getOutput<unknown>('OtherNode')).toBeUndefined();
  });
});
