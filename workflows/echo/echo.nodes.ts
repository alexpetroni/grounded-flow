import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Node, TaskContext } from '@app/core';

export const echoEventSchema = z.object({
  message: z.string(),
});

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
    const echoOutput = ctx.getOutput<{ echo: string }>('EchoNode');
    this.saveOutput(ctx, { result: echoOutput.echo.toUpperCase() });
    return ctx;
  }
}
