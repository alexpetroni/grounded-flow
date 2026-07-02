import { describe, it, expect, vi } from 'vitest';
import { WorkflowValidator, WorkflowValidationError } from '../validator';
import { Node } from '../node.abstract';
import { BaseRouter } from '../router.abstract';
import type { TaskContext } from '../task-context';
import type { WorkflowSchema } from '../workflow-schema';

function makeNode(token: string): Node {
  return {
    token,
    process: vi.fn().mockResolvedValue(undefined),
    saveOutput: vi.fn(),
    getOutput: vi.fn(),
    cleanup: vi.fn().mockResolvedValue(undefined),
  } as unknown as Node;
}

function makeRouter(token: string, route: (ctx: TaskContext) => string): BaseRouter {
  return {
    token,
    route,
    process: vi.fn().mockResolvedValue(undefined),
    saveOutput: vi.fn(),
    getOutput: vi.fn(),
    cleanup: vi.fn().mockResolvedValue(undefined),
  } as unknown as BaseRouter;
}

const validator = new WorkflowValidator();

describe('WorkflowValidator', () => {
  it('accepts a valid linear schema', () => {
    const schema: WorkflowSchema = {
      start: 'A',
      nodes: [
        { node: makeNode('A'), connections: ['B'] },
        { node: makeNode('B'), connections: [] },
      ],
    };
    expect(() => validator.validate(schema)).not.toThrow();
  });

  it('rejects a cycle', () => {
    const schema: WorkflowSchema = {
      start: 'A',
      nodes: [
        { node: makeNode('A'), connections: ['B'] },
        { node: makeNode('B'), connections: ['A'] },
      ],
    };
    expect(() => validator.validate(schema)).toThrow(WorkflowValidationError);
    expect(() => validator.validate(schema)).toThrow(/Cycle detected/);
  });

  it('rejects an unreachable node', () => {
    const schema: WorkflowSchema = {
      start: 'A',
      nodes: [
        { node: makeNode('A'), connections: [] },
        { node: makeNode('B'), connections: [] },
      ],
    };
    expect(() => validator.validate(schema)).toThrow(WorkflowValidationError);
    expect(() => validator.validate(schema)).toThrow(/unreachable/);
  });

  it('rejects a non-router node with more than one connection', () => {
    const schema: WorkflowSchema = {
      start: 'A',
      nodes: [
        { node: makeNode('A'), connections: ['B', 'C'] },
        { node: makeNode('B'), connections: [] },
        { node: makeNode('C'), connections: [] },
      ],
    };
    expect(() => validator.validate(schema)).toThrow(WorkflowValidationError);
    expect(() => validator.validate(schema)).toThrow(/only routers/i);
  });

  it('allows a router node with multiple connections', () => {
    const router = makeRouter('R', () => 'B');
    const schema: WorkflowSchema = {
      start: 'R',
      nodes: [
        { node: router, connections: ['B', 'C'], isRouter: true },
        { node: makeNode('B'), connections: [] },
        { node: makeNode('C'), connections: [] },
      ],
    };
    expect(() => validator.validate(schema)).not.toThrow();
  });

  it('rejects a missing start node', () => {
    const schema: WorkflowSchema = {
      start: 'X',
      nodes: [{ node: makeNode('A'), connections: [] }],
    };
    expect(() => validator.validate(schema)).toThrow(WorkflowValidationError);
    expect(() => validator.validate(schema)).toThrow(/Start node/);
  });

  it('rejects a connection to an unknown node', () => {
    const schema: WorkflowSchema = {
      start: 'A',
      nodes: [{ node: makeNode('A'), connections: ['MISSING'] }],
    };
    expect(() => validator.validate(schema)).toThrow(WorkflowValidationError);
    expect(() => validator.validate(schema)).toThrow(/unknown node/);
  });

  it('rejects a concurrentNode that does not exist in the schema', () => {
    const schema: WorkflowSchema = {
      start: 'A',
      nodes: [{ node: makeNode('A'), connections: [], concurrentNodes: ['MISSING'] }],
    };
    expect(() => validator.validate(schema)).toThrow(WorkflowValidationError);
    expect(() => validator.validate(schema)).toThrow(/concurrentNode/i);
  });

  it('accepts valid concurrentNodes', () => {
    const schema: WorkflowSchema = {
      start: 'A',
      nodes: [
        { node: makeNode('A'), connections: ['C'], concurrentNodes: ['B'] },
        { node: makeNode('B'), connections: [] },
        { node: makeNode('C'), connections: [] },
      ],
    };
    expect(() => validator.validate(schema)).not.toThrow();
  });

  it('rejects duplicate node tokens', () => {
    const schema: WorkflowSchema = {
      start: 'A',
      nodes: [
        { node: makeNode('A'), connections: [] },
        { node: makeNode('A'), connections: [] },
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
        { node: makeNode('A'), connections: [], concurrentNodes: ['B'] },
        { node: makeNode('B'), connections: ['C'] },
        { node: makeNode('C'), connections: [] },
      ],
    };
    expect(() => validator.validate(schema)).toThrow(/never follows a concurrent child/);
  });

  it('allows connections on a concurrent child that is also a normal connection target', () => {
    const schema: WorkflowSchema = {
      start: 'A',
      nodes: [
        { node: makeNode('A'), connections: ['B'], concurrentNodes: ['B'] },
        { node: makeNode('B'), connections: ['C'] },
        { node: makeNode('C'), connections: [] },
      ],
    };
    expect(() => validator.validate(schema)).not.toThrow();
  });
});
