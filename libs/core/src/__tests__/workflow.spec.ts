import { describe, it, expect, vi } from 'vitest';
import { Workflow } from '../workflow.abstract';
import { Node } from '../node.abstract';
import { BaseRouter } from '../router.abstract';
import { TaskContext } from '../task-context';
import type { WorkflowSchema } from '../workflow-schema';
import { z } from 'zod';

// ── helpers ───────────────────────────────────────────────────────────────────

class TestNode extends Node {
  readonly cleanupSpy = vi.fn().mockResolvedValue(undefined);

  constructor(public readonly token: string) {
    super();
  }

  async process(ctx: TaskContext): Promise<TaskContext> {
    this.saveOutput(ctx, { ran: true });
    return ctx;
  }

  async cleanup(): Promise<void> {
    return this.cleanupSpy();
  }
}

class ThrowingNode extends Node {
  readonly cleanupSpy = vi.fn().mockResolvedValue(undefined);

  constructor(public readonly token: string) {
    super();
  }

  async process(_ctx: TaskContext): Promise<TaskContext> {
    throw new Error(`${this.token} intentionally threw`);
  }

  async cleanup(): Promise<void> {
    return this.cleanupSpy();
  }
}

class SlowNode extends Node {
  startTime = 0;
  endTime = 0;
  readonly cleanupSpy = vi.fn().mockResolvedValue(undefined);

  constructor(
    public readonly token: string,
    private readonly delayMs: number,
  ) {
    super();
  }

  async process(ctx: TaskContext): Promise<TaskContext> {
    this.startTime = Date.now();
    await new Promise((r) => setTimeout(r, this.delayMs));
    this.endTime = Date.now();
    this.saveOutput(ctx, { token: this.token });
    return ctx;
  }

  async cleanup(): Promise<void> {
    return this.cleanupSpy();
  }
}

class TestRouter extends BaseRouter {
  readonly cleanupSpy = vi.fn().mockResolvedValue(undefined);

  constructor(
    public readonly token: string,
    private readonly nextToken: string,
  ) {
    super();
  }

  route(_ctx: TaskContext): string {
    return this.nextToken;
  }

  async cleanup(): Promise<void> {
    return this.cleanupSpy();
  }
}

class StopNode extends Node {
  readonly cleanupSpy = vi.fn().mockResolvedValue(undefined);

  constructor(public readonly token: string) {
    super();
  }

  async process(ctx: TaskContext): Promise<TaskContext> {
    ctx.shouldStop = true;
    return ctx;
  }

  async cleanup(): Promise<void> {
    return this.cleanupSpy();
  }
}

function makeWorkflow(schema: WorkflowSchema): Workflow {
  return new (class extends Workflow {
    getSchema() {
      return schema;
    }
  })();
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('Workflow engine', () => {
  describe('linear execution', () => {
    it('runs all nodes in order and populates context', async () => {
      const nodeA = new TestNode('A');
      const nodeB = new TestNode('B');

      const ctx = await makeWorkflow({
        start: 'A',
        nodes: [
          { node: nodeA, connections: ['B'] },
          { node: nodeB, connections: [] },
        ],
      }).run({ test: true });

      expect(ctx.getOutput<{ ran: boolean }>('A')?.ran).toBe(true);
      expect(ctx.getOutput<{ ran: boolean }>('B')?.ran).toBe(true);
    });

    it('validates event against eventSchema', async () => {
      const node = new TestNode('A');
      await expect(
        makeWorkflow({
          start: 'A',
          eventSchema: z.object({ name: z.string() }),
          nodes: [{ node, connections: [] }],
        }).run({ name: 42 }),
      ).rejects.toThrow();
    });

    it('passes when event matches schema', async () => {
      const node = new TestNode('A');
      await expect(
        makeWorkflow({
          start: 'A',
          eventSchema: z.object({ name: z.string() }),
          nodes: [{ node, connections: [] }],
        }).run({ name: 'ok' }),
      ).resolves.toBeDefined();
    });
  });

  describe('router', () => {
    it('selects the correct branch based on route()', async () => {
      const router = new TestRouter('Router', 'BranchB');
      const branchA = new TestNode('BranchA');
      const branchB = new TestNode('BranchB');

      const ctx = await makeWorkflow({
        start: 'Router',
        nodes: [
          { node: router, connections: ['BranchA', 'BranchB'], isRouter: true },
          { node: branchA, connections: [] },
          { node: branchB, connections: [] },
        ],
      }).run({});

      expect(ctx.getOutput('BranchB')).toBeDefined();
      expect(ctx.getOutput('BranchA')).toBeUndefined();
    });
  });

  describe('concurrent fan-out', () => {
    it('runs concurrentNodes in parallel (wall-clock ≪ serial)', async () => {
      const DELAY = 80;
      const coord = new TestNode('Coord');
      const slowA = new SlowNode('SlowA', DELAY);
      const slowB = new SlowNode('SlowB', DELAY);
      const done = new TestNode('Done');

      const start = Date.now();
      const ctx = await makeWorkflow({
        start: 'Coord',
        nodes: [
          { node: coord, connections: ['Done'], concurrentNodes: ['SlowA', 'SlowB'] },
          { node: slowA, connections: [] },
          { node: slowB, connections: [] },
          { node: done, connections: [] },
        ],
      }).run({});
      const elapsed = Date.now() - start;

      // Parallel: ~80 ms; serial: ~160 ms
      expect(elapsed).toBeLessThan(DELAY * 1.7);
      expect(ctx.getOutput('SlowA')).toBeDefined();
      expect(ctx.getOutput('SlowB')).toBeDefined();
    });

    // Regression: the coordinator node itself used to be skipped entirely on
    // the fan-out path — its process() never ran and its cleanup() was never
    // called, violating the cleanup-on-every-path invariant.
    it('executes the coordinator: process() before the fan-out, cleanup() after', async () => {
      const coord = new TestNode('Coord');
      const child = new TestNode('Child');

      const ctx = await makeWorkflow({
        start: 'Coord',
        nodes: [
          { node: coord, connections: [], concurrentNodes: ['Child'] },
          { node: child, connections: [] },
        ],
      }).run({});

      expect(ctx.getOutput('Coord')).toBeDefined();
      expect(coord.cleanupSpy).toHaveBeenCalledOnce();
    });

    it("calls the coordinator's cleanup() when a concurrent child throws", async () => {
      const coord = new TestNode('Coord');
      const bad = new ThrowingNode('Bad');

      await expect(
        makeWorkflow({
          start: 'Coord',
          nodes: [
            { node: coord, connections: [], concurrentNodes: ['Bad'] },
            { node: bad, connections: [] },
          ],
        }).run({}),
      ).rejects.toThrow('Bad intentionally threw');

      expect(coord.cleanupSpy).toHaveBeenCalledOnce();
    });

    // Regression: Promise.all rejected on the first failing child and left the
    // slower siblings running detached (write-after-return / unhandled
    // rejection hazard). run() must not settle until every child has.
    it('awaits all siblings before rejecting when one child fails', async () => {
      const coord = new TestNode('Coord');
      const bad = new ThrowingNode('Bad');
      const slow = new SlowNode('Slow', 40);

      await expect(
        makeWorkflow({
          start: 'Coord',
          nodes: [
            { node: coord, connections: [], concurrentNodes: ['Bad', 'Slow'] },
            { node: bad, connections: [] },
            { node: slow, connections: [] },
          ],
        }).run({}),
      ).rejects.toThrow('Bad intentionally threw');

      // No settle hack: by the time run() rejects, the slow sibling finished
      // and was cleaned up.
      expect(slow.endTime).toBeGreaterThan(0);
      expect(slow.cleanupSpy).toHaveBeenCalledOnce();
    });
  });

  describe('shouldStop', () => {
    it('halts execution after a node sets shouldStop', async () => {
      const stopNode = new StopNode('Stop');
      const neverRan = new TestNode('NeverRan');

      const ctx = await makeWorkflow({
        start: 'Stop',
        nodes: [
          { node: stopNode, connections: ['NeverRan'] },
          { node: neverRan, connections: [] },
        ],
      }).run({});

      expect(ctx.getOutput('NeverRan')).toBeUndefined();
      expect(ctx.shouldStop).toBe(true);
    });
  });

  describe('regression: cleanup() always called', () => {
    it('calls cleanup() on success', async () => {
      const node = new TestNode('A');
      await makeWorkflow({
        start: 'A',
        nodes: [{ node, connections: [] }],
      }).run({});
      expect(node.cleanupSpy).toHaveBeenCalledOnce();
    });

    it('calls cleanup() when process() throws', async () => {
      const node = new ThrowingNode('A');
      await expect(
        makeWorkflow({
          start: 'A',
          nodes: [{ node, connections: [] }],
        }).run({}),
      ).rejects.toThrow('A intentionally threw');
      expect(node.cleanupSpy).toHaveBeenCalledOnce();
    });

    it('calls cleanup() in the streaming path on success', async () => {
      const node = new TestNode('A');
      const gen = makeWorkflow({
        start: 'A',
        nodes: [{ node, connections: [] }],
      }).runStream({});

      for await (const _ of gen) {
        /* consume */
      }
      expect(node.cleanupSpy).toHaveBeenCalledOnce();
    });

    it('calls cleanup() in the streaming path when process() throws', async () => {
      const node = new ThrowingNode('A');
      const gen = makeWorkflow({
        start: 'A',
        nodes: [{ node, connections: [] }],
      }).runStream({});

      await expect(async () => {
        for await (const _ of gen) {
          /* consume */
        }
      }).rejects.toThrow('A intentionally threw');
      expect(node.cleanupSpy).toHaveBeenCalledOnce();
    });

    it('calls cleanup() on concurrent nodes even when one throws', async () => {
      const good = new SlowNode('Good', 20); // small delay so both start
      const bad = new ThrowingNode('Bad');
      const coord = new TestNode('Coord');

      const runPromise = makeWorkflow({
        start: 'Coord',
        nodes: [
          { node: coord, connections: [], concurrentNodes: ['Good', 'Bad'] },
          { node: good, connections: [] },
          { node: bad, connections: [] },
        ],
      }).run({});

      await expect(runPromise).rejects.toThrow();
      // After rejection, let micro-tasks settle
      await new Promise((r) => setTimeout(r, 50));
      expect(bad.cleanupSpy).toHaveBeenCalledOnce();
      expect(good.cleanupSpy).toHaveBeenCalledOnce();
    });
  });
});
