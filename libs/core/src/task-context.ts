import { uuidv7 } from 'uuidv7';

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
   * (or saved nothing). The honest `| undefined` forces callers to handle the
   * missing case instead of crashing on a phantom value.
   */
  getOutput<T>(token: string): T | undefined {
    return this._nodes.get(token) as T | undefined;
  }

  get nodes(): ReadonlyMap<string, unknown> {
    return this._nodes;
  }
}
