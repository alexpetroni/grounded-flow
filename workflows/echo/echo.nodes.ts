import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Node, TaskContext } from '@app/core';

export const echoEventSchema = z.object({
  message: z.string(),
});

export interface EchoOutput {
  echo: string;
}

@Injectable()
export class EchoNode extends Node<EchoOutput> {
  readonly token = 'EchoNode';

  async process(ctx: TaskContext): Promise<TaskContext> {
    const event = echoEventSchema.parse(ctx.event);
    this.saveOutput(ctx, { echo: event.message });
    return ctx;
  }
}

@Injectable()
export class UpperCaseNode extends Node<{ result: string }> {
  readonly token = 'UpperCaseNode';

  // The producing node is injected, so its output is read through its own
  // typed key — the write and read shapes share one source of truth.
  constructor(private readonly echoNode: EchoNode) {
    super();
  }

  async process(ctx: TaskContext): Promise<TaskContext> {
    const echoOutput = this.echoNode.readOutput(ctx);
    if (!echoOutput) {
      throw new Error('UpperCaseNode requires EchoNode output, but it has not run');
    }
    this.saveOutput(ctx, { result: echoOutput.echo.toUpperCase() });
    return ctx;
  }
}
