import { Injectable } from '@nestjs/common';
import { TaskContext } from './task-context';
import type { NodeConfig, WorkflowSchema } from './workflow-schema';
import { WorkflowValidator } from './validator';
import type { Node } from './node.abstract';
import type { WorkflowRegistry } from './workflow-registry';
import { isStreamingNode } from './streaming-node.interface';

@Injectable()
export abstract class Workflow {
  private readonly validator = new WorkflowValidator();
  private validated = false;

  abstract getSchema(): WorkflowSchema;

  /**
   * Workflows that compose sub-workflows override this to expose the registry,
   * enabling validate-time checks that referenced child workflows are
   * registered. Returns undefined for leaf workflows (no sub-workflow checks).
   */
  protected getRegistry(): WorkflowRegistry | undefined {
    return undefined;
  }

  async run(event: unknown, traceId?: string): Promise<TaskContext> {
    const { schema, ctx, nodeMap } = this.prologue(event, traceId);
    let currentToken: string | null = schema.start;

    while (currentToken !== null && !ctx.shouldStop) {
      const config = nodeMap.get(currentToken);
      if (!config) throw new Error(`Node not found: "${currentToken}"`);
      currentToken = await this.dispatch(config, nodeMap, ctx);
    }

    return ctx;
  }

  async *runStream(event: unknown, traceId?: string): AsyncGenerator<unknown, void, undefined> {
    const { schema, ctx, nodeMap } = this.prologue(event, traceId);
    let currentToken: string | null = schema.start;

    while (currentToken !== null && !ctx.shouldStop) {
      const config = nodeMap.get(currentToken);
      if (!config) throw new Error(`Node not found: "${currentToken}"`);

      if (config.kind === 'linear' && isStreamingNode(config.node)) {
        try {
          yield* config.node.processStream(ctx);
        } finally {
          await config.node.cleanup();
        }
        currentToken = config.next ?? null;
      } else {
        currentToken = await this.dispatch(config, nodeMap, ctx);
      }
    }
  }

  /**
   * Shared setup for `run`/`runStream`: validate the schema (once per
   * instance — the schema shape is fixed per subclass, so re-validating on
   * every invocation is wasted work), parse the event, and build the context
   * and node map.
   */
  private prologue(
    event: unknown,
    traceId: string | undefined,
  ): { schema: WorkflowSchema; ctx: TaskContext; nodeMap: Map<string, NodeConfig> } {
    const schema = this.getSchema();
    if (!this.validated) {
      this.validator.validate(schema, this.getRegistry());
      this.validated = true;
    }

    const validatedEvent = schema.eventSchema ? schema.eventSchema.parse(event) : event;
    const ctx = new TaskContext(validatedEvent, traceId);
    const nodeMap = buildNodeMap(schema.nodes);
    return { schema, ctx, nodeMap };
  }

  private async dispatch(
    config: NodeConfig,
    nodeMap: Map<string, NodeConfig>,
    ctx: TaskContext,
  ): Promise<string | null> {
    switch (config.kind) {
      case 'concurrent': {
        const concurrentConfigs = config.children.map((t) => {
          const c = nodeMap.get(t);
          if (!c) throw new Error(`Concurrent node not found: "${t}"`);
          return c;
        });
        // The coordinator's process() runs as setup before the fan-out and its
        // cleanup() runs after every child has settled — no path skips cleanup,
        // and a failing child never leaves siblings running detached.
        try {
          await config.node.process(ctx);
          const results = await Promise.allSettled(
            concurrentConfigs.map((c) => this.executeNode(c.node, ctx)),
          );
          const rejected = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
          if (rejected) throw rejected.reason;
        } finally {
          await config.node.cleanup();
        }
        return config.next ?? null;
      }

      case 'router': {
        await this.executeNode(config.node, ctx);
        const next = config.node.route(ctx);
        // The validator only guarantees the DECLARED connections form a DAG; an
        // unchecked route() return could jump to any registered node and bypass
        // every graph invariant.
        if (!config.connections.includes(next)) {
          throw new Error(
            `Router "${config.node.token}" routed to "${next}", which is not one of its declared connections [${config.connections.join(', ')}]`,
          );
        }
        return next;
      }

      case 'linear': {
        await this.executeNode(config.node, ctx);
        return config.next ?? null;
      }
    }
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
