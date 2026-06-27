import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Node, SubWorkflowNode, TaskContext } from '@app/core';
import type { SubWorkflowResult } from '@app/core';

export const compositeEventSchema = z.object({
  text: z.string(),
});

/**
 * Composes the registered `echo` workflow: feeds it the parent's `text` as its
 * `message`, then exposes the child's outputs (namespaced under this node's
 * token) back to the parent workflow.
 */
@Injectable()
export class EchoSubWorkflowNode extends SubWorkflowNode {
  readonly token = 'EchoSubWorkflow';
  readonly childWorkflowType = 'echo';

  protected buildChildEvent(ctx: TaskContext): unknown {
    const { text } = compositeEventSchema.parse(ctx.event);
    return { message: text };
  }
}

/** Reads the composed child's result and produces a final summary. */
@Injectable()
export class SummarizeNode extends Node {
  readonly token = 'SummarizeNode';

  async process(ctx: TaskContext): Promise<TaskContext> {
    const child = ctx.getOutput<SubWorkflowResult>('EchoSubWorkflow');
    const upper = child?.nodes['UpperCaseNode'] as { result: string } | undefined;
    this.saveOutput(ctx, {
      summary: `echo workflow returned: ${upper?.result ?? '(none)'}`,
      childWorkflow: child?.workflowType,
    });
    return ctx;
  }
}
