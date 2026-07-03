import { Injectable } from '@nestjs/common';
import { Workflow, WorkflowRegistry, WorkflowSchema } from '@app/core';
import { EchoSubWorkflowNode, SummarizeNode, compositeEventSchema } from './composite.nodes';

/**
 * Demonstrates workflow composition: a parent workflow that runs the `echo`
 * workflow as a sub-step (via {@link EchoSubWorkflowNode}) and then summarizes
 * its result. `getRegistry()` is exposed so the engine validates at run time
 * that the composed child workflow is registered.
 */
@Injectable()
export class CompositeWorkflow extends Workflow {
  static readonly TYPE = 'composite';

  constructor(
    private readonly echoSubWorkflowNode: EchoSubWorkflowNode,
    private readonly summarizeNode: SummarizeNode,
    private readonly registry: WorkflowRegistry,
  ) {
    super();
  }

  protected getRegistry(): WorkflowRegistry {
    return this.registry;
  }

  getSchema(): WorkflowSchema {
    return {
      start: this.echoSubWorkflowNode.token,
      eventSchema: compositeEventSchema,
      nodes: [
        { kind: 'linear', node: this.echoSubWorkflowNode, next: this.summarizeNode.token },
        { kind: 'linear', node: this.summarizeNode },
      ],
    };
  }
}
