import type { ZodSchema } from 'zod';
import type { Node } from './node.abstract';

export interface NodeConfig {
  node: Node;
  connections: string[];
  isRouter?: boolean;
  concurrentNodes?: string[];
}

export interface WorkflowSchema {
  start: string;
  nodes: NodeConfig[];
  eventSchema?: ZodSchema<unknown>;
}
