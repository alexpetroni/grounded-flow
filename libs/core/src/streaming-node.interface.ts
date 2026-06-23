import type { TaskContext } from './task-context';

export interface StreamingNode {
  processStream(ctx: TaskContext): AsyncGenerator<unknown, void, undefined>;
}

export function isStreamingNode(node: object): node is StreamingNode {
  return 'processStream' in node && typeof (node as StreamingNode).processStream === 'function';
}
