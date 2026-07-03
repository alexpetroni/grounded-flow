import { describe, it, expect } from 'vitest';
import type { ModelMessage } from 'ai';
import { TaskContext, Workflow } from '@app/core';
import type { WorkflowSchema } from '@app/core';
import { AgentStreamingNode } from '../agent-streaming-node.abstract';
import { LlmService } from '../llm.service';
import { createFakeLanguageModel } from '../fake-provider';
import type { OpenAIChunk } from '../agent-streaming-node.abstract';

class TestStreamingNode extends AgentStreamingNode {
  readonly token = 'TestStreamingNode';

  buildMessages(_ctx: TaskContext): ModelMessage[] {
    return [{ role: 'user', content: 'Say hello world' }];
  }
}

function makeLlmService(responses: string[]): LlmService {
  const model = createFakeLanguageModel({ responses });
  const service = new LlmService();
  service.getLanguageModel = () => model;
  return service;
}

function makeStreamingWorkflow(node: TestStreamingNode): Workflow {
  return new (class extends Workflow {
    getSchema(): WorkflowSchema {
      return { start: node.token, nodes: [{ kind: 'linear', node }] };
    }
  })();
}

describe('AgentStreamingNode', () => {
  it('yields OpenAI-shaped chunks and a stop chunk via processStream()', async () => {
    const service = makeLlmService(['hello world']);
    const node = new TestStreamingNode(service);
    const ctx = new TaskContext({});

    const chunks: OpenAIChunk[] = [];
    for await (const chunk of node.processStream(ctx)) {
      chunks.push(chunk as OpenAIChunk);
    }

    expect(chunks[0].choices[0].delta.role).toBe('assistant');
    const contentChunks = chunks.filter((c) => c.choices[0].delta.content !== undefined);
    expect(contentChunks.length).toBeGreaterThan(0);
    const lastChunk = chunks[chunks.length - 1];
    expect(lastChunk.choices[0].finish_reason).toBe('stop');

    for (const chunk of chunks) {
      expect(chunk.object).toBe('chat.completion.chunk');
      expect(chunk.id).toMatch(/^chatcmpl-/);
      expect(typeof chunk.created).toBe('number');
      expect(Array.isArray(chunk.choices)).toBe(true);
    }
  });

  it('saves full text to context after streaming completes', async () => {
    const service = makeLlmService(['hello world']);
    const node = new TestStreamingNode(service);
    const ctx = new TaskContext({});

    for await (const _ of node.processStream(ctx)) {
      /* consume */
    }

    const output = ctx.getOutput<{ text: string }>(node.token)!;
    expect(output.text).toContain('hello');
  });

  it('calls cleanup() in the streaming path via runStream()', async () => {
    const service = makeLlmService(['hello']);
    const node = new TestStreamingNode(service);
    let cleanupCalled = false;
    node.cleanup = async () => {
      cleanupCalled = true;
    };

    const workflow = makeStreamingWorkflow(node);
    for await (const _ of workflow.runStream({})) {
      /* consume */
    }

    expect(cleanupCalled).toBe(true);
  });

  it('runStream() yields chunks ending with a stop chunk', async () => {
    const service = makeLlmService(['foo bar']);
    const node = new TestStreamingNode(service);
    const workflow = makeStreamingWorkflow(node);

    const chunks: OpenAIChunk[] = [];
    for await (const chunk of workflow.runStream({})) {
      chunks.push(chunk as OpenAIChunk);
    }

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[chunks.length - 1].choices[0].finish_reason).toBe('stop');
  });
});
