import { Injectable } from '@nestjs/common';
import type { TaskContext, OutputKey } from './task-context';

/**
 * `TOutput` is the shape this node saves to the context. `saveOutput` enforces
 * it on the write side and `readOutput`/`outputKey` carry it to readers, so a
 * consumer holding the node instance gets typed access with no cast:
 *
 *   constructor(private readonly echoNode: EchoNode) { ... }
 *   const out = this.echoNode.readOutput(ctx);   // { echo: string } | undefined
 */
@Injectable()
export abstract class Node<TOutput = unknown> {
  abstract readonly token: string;

  abstract process(ctx: TaskContext): Promise<TaskContext>;

  /** Typed key for this node's output — usable with `ctx.getOutput(key)`. */
  get outputKey(): OutputKey<TOutput> {
    return { token: this.token };
  }

  saveOutput(ctx: TaskContext, value: TOutput): void {
    ctx.setOutput(this.token, value);
  }

  /** This node's own saved output, typed by its declared `TOutput`. */
  readOutput(ctx: TaskContext): TOutput | undefined {
    return ctx.getOutput(this.outputKey);
  }

  async cleanup(): Promise<void> {}
}
