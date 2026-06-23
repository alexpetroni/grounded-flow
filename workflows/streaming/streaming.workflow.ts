import { Injectable } from '@nestjs/common';
import { Workflow } from '@app/core';
import type { WorkflowSchema } from '@app/core';
import { StreamingChatNode, streamingEventSchema } from './streaming.nodes';

@Injectable()
export class StreamingWorkflow extends Workflow {
  static readonly TYPE = 'streaming-chat';

  constructor(private readonly streamingChatNode: StreamingChatNode) {
    super();
  }

  getSchema(): WorkflowSchema {
    return {
      start: this.streamingChatNode.token,
      eventSchema: streamingEventSchema,
      nodes: [{ node: this.streamingChatNode, connections: [] }],
    };
  }
}
