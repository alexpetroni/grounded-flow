import { describe, it, expect } from 'vitest';
import { Node } from '../node.abstract';
import { TaskContext, outputKey } from '../task-context';

interface GreetOutput {
  greeting: string;
}

class GreetNode extends Node<GreetOutput> {
  readonly token = 'GreetNode';

  async process(ctx: TaskContext): Promise<TaskContext> {
    this.saveOutput(ctx, { greeting: 'hello' });
    return ctx;
  }
}

// Follow-up to the R4 refactor (docs/REFACTOR-STATUS.md deferred item): node
// outputs are typed at the source — writers enforce the shape via saveOutput,
// readers get it back through the instance/key with no hand-written cast.
describe('typed node outputs', () => {
  it('readOutput returns the writer-declared shape, undefined before the node ran', async () => {
    const node = new GreetNode();
    const ctx = new TaskContext({});

    expect(node.readOutput(ctx)).toBeUndefined();
    await node.process(ctx);

    const out = node.readOutput(ctx);
    // No cast: `out` is GreetOutput | undefined by construction.
    expect(out?.greeting.toUpperCase()).toBe('HELLO');
  });

  it('outputKey reads through TaskContext.getOutput with the same typing', async () => {
    const node = new GreetNode();
    const ctx = new TaskContext({});
    await node.process(ctx);

    expect(ctx.getOutput(node.outputKey)?.greeting).toBe('hello');
    // Escape hatch for dynamic tokens keeps working.
    expect(ctx.getOutput(outputKey<GreetOutput>('GreetNode'))?.greeting).toBe('hello');
    expect(ctx.getOutput<GreetOutput>('GreetNode')?.greeting).toBe('hello');
  });

  it('rejects wrong-shaped writes at compile time', () => {
    const node = new GreetNode();
    const ctx = new TaskContext({});

    // @ts-expect-error — GreetNode's output is { greeting: string }, not { echo: string }
    const write = () => node.saveOutput(ctx, { echo: 'wrong shape' });
    expect(write).toBeInstanceOf(Function);
  });
});
