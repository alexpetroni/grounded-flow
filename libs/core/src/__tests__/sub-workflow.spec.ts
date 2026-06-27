import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { Workflow } from '../workflow.abstract';
import { Node } from '../node.abstract';
import { TaskContext } from '../task-context';
import { SubWorkflowNode, isSubWorkflowReference } from '../sub-workflow-node';
import type { SubWorkflowResult } from '../sub-workflow-node';
import { WorkflowRegistry } from '../workflow-registry';
import { WorkflowValidator, WorkflowValidationError } from '../validator';
import type { WorkflowSchema } from '../workflow-schema';

// ── fixtures ────────────────────────────────────────────────────────────────

/** Child workflow: doubles `n` and records the traceId it ran under. */
class ChildNode extends Node {
  readonly token = 'Child';
  async process(ctx: TaskContext): Promise<TaskContext> {
    const { n } = ctx.event as { n: number };
    this.saveOutput(ctx, { value: n * 2, traceId: ctx.traceId });
    return ctx;
  }
}

/** A node that also writes under the token 'Child' in the PARENT, to prove isolation. */
class ParentChildShadow extends Node {
  readonly token = 'Child';
  async process(ctx: TaskContext): Promise<TaskContext> {
    this.saveOutput(ctx, { value: 'parent-owns-this' });
    return ctx;
  }
}

class RunChildNode extends SubWorkflowNode {
  readonly token = 'RunChild';
  readonly childWorkflowType = 'child';
  readonly cleanupSpy = vi.fn().mockResolvedValue(undefined);

  protected buildChildEvent(ctx: TaskContext): unknown {
    return { n: (ctx.event as { input: number }).input };
  }

  async cleanup(): Promise<void> {
    return this.cleanupSpy();
  }
}

class ConsumerNode extends Node {
  readonly token = 'Consumer';
  async process(ctx: TaskContext): Promise<TaskContext> {
    const result = ctx.getOutput<SubWorkflowResult>('RunChild');
    const childOut = result.nodes['Child'] as { value: number };
    this.saveOutput(ctx, { doubled: childOut.value });
    return ctx;
  }
}

function makeChildWorkflow(): Workflow {
  return new (class extends Workflow {
    getSchema(): WorkflowSchema {
      return {
        start: 'Child',
        eventSchema: z.object({ n: z.number() }),
        nodes: [{ node: new ChildNode(), connections: [] }],
      };
    }
  })();
}

function makeParentWorkflow(schema: WorkflowSchema, registry: WorkflowRegistry): Workflow {
  return new (class extends Workflow {
    getSchema(): WorkflowSchema {
      return schema;
    }
    protected getRegistry(): WorkflowRegistry {
      return registry;
    }
  })();
}

function makeComposite(): {
  registry: WorkflowRegistry;
  runChild: RunChildNode;
  parent: Workflow;
} {
  const registry = new WorkflowRegistry();
  registry.register('child', makeChildWorkflow());
  const runChild = new RunChildNode(registry);
  const parent = makeParentWorkflow(
    {
      start: 'RunChild',
      nodes: [
        { node: runChild, connections: ['Consumer'] },
        { node: new ConsumerNode(), connections: [] },
      ],
    },
    registry,
  );
  return { registry, runChild, parent };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('SubWorkflowNode composition', () => {
  it('runs the child workflow and merges its outputs namespaced under the node token', async () => {
    const { parent } = makeComposite();
    const ctx = await parent.run({ input: 21 });

    const result = ctx.getOutput<SubWorkflowResult>('RunChild');
    expect(result.workflowType).toBe('child');
    expect(result.event).toEqual({ n: 21 });
    expect(result.nodes['Child']).toMatchObject({ value: 42 });

    // Downstream node consumed the merged child output.
    expect(ctx.getOutput<{ doubled: number }>('Consumer')).toEqual({ doubled: 42 });
  });

  it('isolates the child context — child outputs do not leak under their own token', async () => {
    const { parent } = makeComposite();
    const ctx = await parent.run({ input: 5 });

    // The parent context has no top-level "Child" key; it lives only nested
    // inside the RunChild result.
    expect(ctx.getOutput('Child')).toBeUndefined();
    expect(ctx.getOutput<SubWorkflowResult>('RunChild').nodes['Child']).toBeDefined();
  });

  it('shares the parent traceId with the child for trace continuity', async () => {
    const { parent } = makeComposite();
    const ctx = await parent.run({ input: 1 }, 'trace-xyz');
    const result = ctx.getOutput<SubWorkflowResult>('RunChild');
    expect((result.nodes['Child'] as { traceId: string }).traceId).toBe('trace-xyz');
  });

  it('a parent node may reuse a child node token without collision', async () => {
    // Parent has its OWN node also tokened 'Child'; it must not clash with the
    // child workflow's 'Child' (which is namespaced under RunChild).
    const registry = new WorkflowRegistry();
    registry.register('child', makeChildWorkflow());
    const runChild = new RunChildNode(registry);
    const parent = makeParentWorkflow(
      {
        start: 'RunChild',
        nodes: [
          { node: runChild, connections: ['Child'] },
          { node: new ParentChildShadow(), connections: [] },
        ],
      },
      registry,
    );

    const ctx = await parent.run({ input: 3 });
    expect(ctx.getOutput('Child')).toEqual({ value: 'parent-owns-this' });
    expect(ctx.getOutput<SubWorkflowResult>('RunChild').nodes['Child']).toMatchObject({
      value: 6,
    });
  });

  it('getChildOutput reads a specific child node output', async () => {
    const { parent, runChild } = makeComposite();
    const ctx = await parent.run({ input: 10 });
    expect(runChild.getChildOutput<{ value: number }>(ctx, 'Child')).toMatchObject({ value: 20 });
    expect(runChild.getChildOutput(ctx, 'NoSuchNode')).toBeUndefined();
  });

  it('calls cleanup() on the sub-workflow node', async () => {
    const { parent, runChild } = makeComposite();
    await parent.run({ input: 2 });
    expect(runChild.cleanupSpy).toHaveBeenCalledOnce();
  });

  it('throws at run time when the composed child workflow is not registered', async () => {
    const registry = new WorkflowRegistry(); // child intentionally NOT registered
    const runChild = new RunChildNode(registry);
    const parent = makeParentWorkflow(
      { start: 'RunChild', nodes: [{ node: runChild, connections: [] }] },
      registry,
    );
    await expect(parent.run({ input: 1 })).rejects.toThrow(WorkflowValidationError);
  });
});

describe('validator sub-workflow registration check', () => {
  const validator = new WorkflowValidator();

  function schemaWith(registry: WorkflowRegistry): WorkflowSchema {
    return { start: 'RunChild', nodes: [{ node: new RunChildNode(registry), connections: [] }] };
  }

  it('passes when the referenced child workflow is registered', () => {
    const registry = new WorkflowRegistry();
    registry.register('child', makeChildWorkflow());
    expect(() => validator.validate(schemaWith(registry), registry)).not.toThrow();
  });

  it('rejects an unregistered sub-workflow reference', () => {
    const registry = new WorkflowRegistry();
    expect(() => validator.validate(schemaWith(registry), registry)).toThrow(
      /unregistered sub-workflow "child"/,
    );
  });

  it('skips the check entirely when no registry is supplied (backwards compatible)', () => {
    const registry = new WorkflowRegistry();
    expect(() => validator.validate(schemaWith(registry))).not.toThrow();
  });
});

describe('isSubWorkflowReference', () => {
  it('detects sub-workflow nodes by their childWorkflowType marker', () => {
    const registry = new WorkflowRegistry();
    expect(isSubWorkflowReference(new RunChildNode(registry))).toBe(true);
    expect(isSubWorkflowReference(new ChildNode())).toBe(false);
  });
});
