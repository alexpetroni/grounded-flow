import { Injectable } from '@nestjs/common';
import { Workflow, WorkflowSchema } from '@app/core';
import { EchoNode, UpperCaseNode, echoEventSchema } from './echo.nodes';

@Injectable()
export class EchoWorkflow extends Workflow {
  static readonly TYPE = 'echo';

  constructor(
    private readonly echoNode: EchoNode,
    private readonly upperCaseNode: UpperCaseNode,
  ) {
    super();
  }

  getSchema(): WorkflowSchema {
    return {
      start: this.echoNode.token,
      eventSchema: echoEventSchema,
      nodes: [
        { kind: 'linear', node: this.echoNode, next: this.upperCaseNode.token },
        { kind: 'linear', node: this.upperCaseNode },
      ],
    };
  }
}
