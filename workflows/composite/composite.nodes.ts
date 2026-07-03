import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Node, SubWorkflowNode, TaskContext } from '@app/core';

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

export interface CompositeSummary {
  summary: string;
  childWorkflow: string | undefined;
}

/** Reads the composed child's result and produces a final summary. */
@Injectable()
export class SummarizeNode extends Node<CompositeSummary> {
  readonly token = 'SummarizeNode';

  constructor(private readonly echoSubWorkflow: EchoSubWorkflowNode) {
    super();
  }

  async process(ctx: TaskContext): Promise<TaskContext> {
    const child = this.echoSubWorkflow.readOutput(ctx);
    const upper = this.echoSubWorkflow.getChildOutput<{ result: string }>(ctx, 'UpperCaseNode');
    this.saveOutput(ctx, {
      summary: `echo workflow returned: ${upper?.result ?? '(none)'}`,
      childWorkflow: child?.workflowType,
    });
    return ctx;
  }
}
