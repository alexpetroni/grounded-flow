import { uuidv7 } from 'uuidv7';

declare const outputType: unique symbol;

/**
 * A node-output key carrying the output's compile-time shape. Produced by
 * `Node.outputKey`, so the shape a node writes and the shape readers see have
 * one source of truth — no `getOutput<HandWrittenShape>('Token')` casts.
 */
export interface OutputKey<T> {
  readonly token: string;
  /** Phantom marker only — never set at runtime. */
  readonly [outputType]?: T;
}

/** Build a typed output key for a raw token (escape hatch for dynamic tokens). */
export function outputKey<T>(token: string): OutputKey<T> {
  return { token };
}

export class TaskContext {
  readonly event: unknown;
  readonly metadata: Record<string, unknown>;
  readonly traceId: string;
  private readonly _nodes: Map<string, unknown> = new Map();
  shouldStop = false;

  constructor(event: unknown, traceId?: string, metadata: Record<string, unknown> = {}) {
    this.event = event;
    this.traceId = traceId ?? uuidv7();
    this.metadata = metadata;
  }

  setOutput(token: string, value: unknown): void {
    this._nodes.set(token, value);
  }

  /**
   * Returns the node's saved output, or `undefined` when the node has not run
   * (or saved nothing). Prefer the `OutputKey` form (via `node.outputKey` or
   * `node.readOutput(ctx)`) — it types the result from the writer's declared
   * shape. The string form remains for dynamic tokens and test assertions and
   * requires the caller to assert the type.
   */
  getOutput<T>(key: OutputKey<T>): T | undefined;
  getOutput<T>(token: string): T | undefined;
  getOutput<T>(keyOrToken: OutputKey<T> | string): T | undefined {
    const token = typeof keyOrToken === 'string' ? keyOrToken : keyOrToken.token;
    return this._nodes.get(token) as T | undefined;
  }

  get nodes(): ReadonlyMap<string, unknown> {
    return this._nodes;
  }
}
