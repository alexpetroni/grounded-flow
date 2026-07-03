import { describe, it, expect, vi } from 'vitest';
import { WorkflowValidator, WorkflowValidationError } from '../validator';
import { Node } from '../node.abstract';
import { BaseRouter } from '../router.abstract';
import type { TaskContext } from '../task-context';
import type { NodeConfig, WorkflowSchema } from '../workflow-schema';

function makeNode(token: string): Node {
  return {
    token,
    process: vi.fn().mockResolvedValue(undefined),
    saveOutput: vi.fn(),
    getOutput: vi.fn(),
    cleanup: vi.fn().mockResolvedValue(undefined),
  } as unknown as Node;
}

class MockRouter extends BaseRouter {
  constructor(
    public readonly token: string,
    private readonly routeFn: (ctx: TaskContext) => string,
  ) {
    super();
  }

  route(ctx: TaskContext): string {
    return this.routeFn(ctx);
  }
}

function makeRouter(token: string, route: (ctx: TaskContext) => string): BaseRouter {
  return new MockRouter(token, route);
}

const validator = new WorkflowValidator();

describe('WorkflowValidator', () => {
  it('accepts a valid linear schema', () => {
    const schema: WorkflowSchema = {
      start: 'A',
      nodes: [
        { kind: 'linear', node: makeNode('A'), next: 'B' },
        { kind: 'linear', node: makeNode('B') },
      ],
    };
    expect(() => validator.validate(schema)).not.toThrow();
  });

  it('rejects a cycle', () => {
    const schema: WorkflowSchema = {
      start: 'A',
      nodes: [
        { kind: 'linear', node: makeNode('A'), next: 'B' },
        { kind: 'linear', node: makeNode('B'), next: 'A' },
      ],
    };
    expect(() => validator.validate(schema)).toThrow(WorkflowValidationError);
    expect(() => validator.validate(schema)).toThrow(/Cycle detected/);
  });

  it('rejects an unreachable node', () => {
    const schema: WorkflowSchema = {
      start: 'A',
      nodes: [
        { kind: 'linear', node: makeNode('A') },
        { kind: 'linear', node: makeNode('B') },
      ],
    };
    expect(() => validator.validate(schema)).toThrow(WorkflowValidationError);
    expect(() => validator.validate(schema)).toThrow(/unreachable/);
  });

  // Regression: the old flat NodeConfig let a non-router node declare more
  // than one connection, requiring a runtime check to reject it. The
  // discriminated union now makes this unrepresentable at compile time — a
  // LinearNodeConfig has only a single `next?: string`, so this is now a
  // compile-time assertion instead of a runtime one.
  it('linear nodes cannot represent more than one outgoing edge (compile-time)', () => {
    function build(): NodeConfig {
      // @ts-expect-error - LinearNodeConfig has only `next?: string`; a router
      // is required to declare more than one target via `connections`.
      return { kind: 'linear', node: makeNode('A'), connections: ['B', 'C'] };
    }
    expect(build).toBeTypeOf('function');
  });

  it('allows a router node with multiple connections', () => {
    const router = makeRouter('R', () => 'B');
    const schema: WorkflowSchema = {
      start: 'R',
      nodes: [
        { kind: 'router', node: router, connections: ['B', 'C'] },
        { kind: 'linear', node: makeNode('B') },
        { kind: 'linear', node: makeNode('C') },
      ],
    };
    expect(() => validator.validate(schema)).not.toThrow();
  });

  it('rejects a missing start node', () => {
    const schema: WorkflowSchema = {
      start: 'X',
      nodes: [{ kind: 'linear', node: makeNode('A') }],
    };
    expect(() => validator.validate(schema)).toThrow(WorkflowValidationError);
    expect(() => validator.validate(schema)).toThrow(/Start node/);
  });

  it('rejects a connection to an unknown node', () => {
    const schema: WorkflowSchema = {
      start: 'A',
      nodes: [{ kind: 'linear', node: makeNode('A'), next: 'MISSING' }],
    };
    expect(() => validator.validate(schema)).toThrow(WorkflowValidationError);
    expect(() => validator.validate(schema)).toThrow(/unknown node/);
  });

  it('rejects a concurrentNode that does not exist in the schema', () => {
    const schema: WorkflowSchema = {
      start: 'A',
      nodes: [{ kind: 'concurrent', node: makeNode('A'), children: ['MISSING'] }],
    };
    expect(() => validator.validate(schema)).toThrow(WorkflowValidationError);
    expect(() => validator.validate(schema)).toThrow(/concurrentNode/i);
  });

  it('accepts valid concurrentNodes', () => {
    const schema: WorkflowSchema = {
      start: 'A',
      nodes: [
        { kind: 'concurrent', node: makeNode('A'), children: ['B'], next: 'C' },
        { kind: 'linear', node: makeNode('B') },
        { kind: 'linear', node: makeNode('C') },
      ],
    };
    expect(() => validator.validate(schema)).not.toThrow();
  });

  it('rejects duplicate node tokens', () => {
    const schema: WorkflowSchema = {
      start: 'A',
      nodes: [
        { kind: 'linear', node: makeNode('A') },
        { kind: 'linear', node: makeNode('A') },
      ],
    };
    expect(() => validator.validate(schema)).toThrow(WorkflowValidationError);
    expect(() => validator.validate(schema)).toThrow(/Duplicate/);
  });

  // Regression: a concurrent child's connections validated as graph edges but
  // the engine never follows them — the edge silently never fired.
  it('rejects connections on a node reachable only as a concurrent child', () => {
    const schema: WorkflowSchema = {
      start: 'A',
      nodes: [
        { kind: 'concurrent', node: makeNode('A'), children: ['B'] },
        { kind: 'linear', node: makeNode('B'), next: 'C' },
        { kind: 'linear', node: makeNode('C') },
      ],
    };
    expect(() => validator.validate(schema)).toThrow(/never follows a concurrent child/);
  });

  it('allows connections on a concurrent child that is also a normal connection target', () => {
    const schema: WorkflowSchema = {
      start: 'A',
      nodes: [
        { kind: 'concurrent', node: makeNode('A'), children: ['B'], next: 'B' },
        { kind: 'linear', node: makeNode('B'), next: 'C' },
        { kind: 'linear', node: makeNode('C') },
      ],
    };
    expect(() => validator.validate(schema)).not.toThrow();
  });
});
