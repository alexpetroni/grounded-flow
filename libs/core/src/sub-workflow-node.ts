import { Injectable } from '@nestjs/common';
import { Node } from './node.abstract';
import type { TaskContext } from './task-context';
import type { WorkflowRegistry } from './workflow-registry';

/** Marker implemented by nodes that delegate to a registered child workflow. */
export interface SubWorkflowReference {
  readonly childWorkflowType: string;
}

export function isSubWorkflowReference(
  node: { childWorkflowType?: unknown } & object,
): node is SubWorkflowReference {
  return typeof node.childWorkflowType === 'string';
}

/** The value a {@link SubWorkflowNode} writes into the parent context under its token. */
export interface SubWorkflowResult {
  workflowType: string;
  /** The event that was passed to the child workflow. */
  event: unknown;
  /** The child's per-node outputs, namespaced under this node's token. */
  nodes: Record<string, unknown>;
}

/**
 * A node that composes another registered workflow as a sub-step — the missing
 * "workflow composition" primitive from the reference engine.
 *
 * The child runs in its **own** {@link TaskContext} (full isolation: child nodes
 * cannot see or overwrite parent node outputs), sharing only the parent
 * `traceId` for trace continuity. The child's node outputs are then merged back
 * into the parent context, namespaced under this node's token, so sibling nodes
 * read them via {@link getChildOutput} with no risk of token collisions.
 *
 * Concrete subclasses declare which workflow to run (`childWorkflowType`) and how
 * to derive its input event from the parent context (`buildChildEvent`).
 */
@Injectable()
export abstract class SubWorkflowNode extends Node implements SubWorkflowReference {
  abstract readonly childWorkflowType: string;

  constructor(protected readonly registry: WorkflowRegistry) {
    super();
  }

  /** Derive the child workflow's input event from the parent context. */
  protected abstract buildChildEvent(ctx: TaskContext): unknown;

  async process(ctx: TaskContext): Promise<TaskContext> {
    const child = this.registry.resolve(this.childWorkflowType);
    const event = this.buildChildEvent(ctx);
    const childCtx = await child.run(event, ctx.traceId);

    const result: SubWorkflowResult = {
      workflowType: this.childWorkflowType,
      event,
      nodes: Object.fromEntries(childCtx.nodes.entries()),
    };
    this.saveOutput(ctx, result);
    return ctx;
  }

  /** Read a specific child node's output from this node's completed result. */
  getChildOutput<T>(ctx: TaskContext, childToken: string): T | undefined {
    const result = this.getOutput<SubWorkflowResult | undefined>(ctx);
    return result?.nodes[childToken] as T | undefined;
  }
}
