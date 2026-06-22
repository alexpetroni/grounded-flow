import { Injectable } from '@nestjs/common';
import { TaskContext } from './task-context';
import type { NodeConfig, WorkflowSchema } from './workflow-schema';
import { WorkflowValidator } from './validator';
import { BaseRouter } from './router.abstract';
import type { Node } from './node.abstract';

@Injectable()
export abstract class Workflow {
  private readonly validator = new WorkflowValidator();

  abstract getSchema(): WorkflowSchema;

  async run(event: unknown, traceId?: string): Promise<TaskContext> {
    const schema = this.getSchema();
    this.validator.validate(schema);

    const validatedEvent = schema.eventSchema ? schema.eventSchema.parse(event) : event;

    const ctx = new TaskContext(validatedEvent, traceId);
    const nodeMap = buildNodeMap(schema.nodes);
    let currentToken: string | null = schema.start;

    while (currentToken !== null && !ctx.shouldStop) {
      const config = nodeMap.get(currentToken);
      if (!config) throw new Error(`Node not found: "${currentToken}"`);
      currentToken = await this.dispatch(config, nodeMap, ctx);
    }

    return ctx;
  }

  async *runStream(event: unknown, traceId?: string): AsyncGenerator<unknown, void, undefined> {
    const schema = this.getSchema();
    this.validator.validate(schema);

    const validatedEvent = schema.eventSchema ? schema.eventSchema.parse(event) : event;

    const ctx = new TaskContext(validatedEvent, traceId);
    const nodeMap = buildNodeMap(schema.nodes);
    let currentToken: string | null = schema.start;

    while (currentToken !== null && !ctx.shouldStop) {
      const config = nodeMap.get(currentToken);
      if (!config) throw new Error(`Node not found: "${currentToken}"`);
      currentToken = await this.dispatch(config, nodeMap, ctx);
    }
    // Phase 3 will replace this with per-node streaming chunks
    yield* [];
  }

  private async dispatch(
    config: NodeConfig,
    nodeMap: Map<string, NodeConfig>,
    ctx: TaskContext,
  ): Promise<string | null> {
    if (config.concurrentNodes?.length) {
      const concurrentConfigs = config.concurrentNodes.map((t) => {
        const c = nodeMap.get(t);
        if (!c) throw new Error(`Concurrent node not found: "${t}"`);
        return c;
      });
      await Promise.all(concurrentConfigs.map((c) => this.executeNode(c.node, ctx)));
      return config.connections[0] ?? null;
    }

    if (config.isRouter) {
      await this.executeNode(config.node, ctx);
      return (config.node as BaseRouter).route(ctx);
    }

    await this.executeNode(config.node, ctx);
    return config.connections[0] ?? null;
  }

  private async executeNode(node: Node, ctx: TaskContext): Promise<void> {
    try {
      await node.process(ctx);
    } finally {
      await node.cleanup();
    }
  }
}

function buildNodeMap(nodes: NodeConfig[]): Map<string, NodeConfig> {
  const map = new Map<string, NodeConfig>();
  for (const config of nodes) {
    map.set(config.node.token, config);
  }
  return map;
}
