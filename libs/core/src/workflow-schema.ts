import type { ZodSchema } from 'zod';
import type { Node } from './node.abstract';
import type { BaseRouter } from './router.abstract';

/** A plain step: at most one outgoing edge. */
export interface LinearNodeConfig {
  kind: 'linear';
  node: Node;
  next?: string;
}

/** A branching step: `route()` picks one of the declared `connections` at run time. */
export interface RouterNodeConfig {
  kind: 'router';
  node: BaseRouter;
  connections: string[];
}

/** A fan-out coordinator: `children` run in parallel, then execution continues at `next`. */
export interface ConcurrentNodeConfig {
  kind: 'concurrent';
  node: Node;
  children: string[];
  next?: string;
}

export type NodeConfig = LinearNodeConfig | RouterNodeConfig | ConcurrentNodeConfig;

export interface WorkflowSchema {
  start: string;
  nodes: NodeConfig[];
  eventSchema?: ZodSchema<unknown>;
}
