import { Injectable } from '@nestjs/common';
import type { TaskContext } from './task-context';

@Injectable()
export abstract class Node {
  abstract readonly token: string;

  abstract process(ctx: TaskContext): Promise<TaskContext>;

  saveOutput(ctx: TaskContext, value: unknown): void {
    ctx.setOutput(this.token, value);
  }

  getOutput<T>(ctx: TaskContext): T | undefined {
    return ctx.getOutput<T>(this.token);
  }

  async cleanup(): Promise<void> {}
}
