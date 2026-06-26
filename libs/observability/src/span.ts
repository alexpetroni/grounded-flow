export type SpanStatus = 'unset' | 'ok' | 'error';

export type AttributeValue = string | number | boolean;

export interface FinishedSpan {
  name: string;
  traceId?: string;
  attributes: Record<string, AttributeValue>;
  status: SpanStatus;
  exception?: string;
  durationMs: number;
}

export interface SpanExporter {
  export(span: FinishedSpan): void;
}

export interface Span {
  setAttribute(key: string, value: AttributeValue): this;
  recordException(error: unknown): this;
  setStatus(status: SpanStatus): this;
  end(): void;
}

/** Span used when tracing is disabled — every method is a no-op. */
export class NoopSpan implements Span {
  setAttribute(): this {
    return this;
  }
  recordException(): this {
    return this;
  }
  setStatus(): this {
    return this;
  }
  end(): void {
    // no-op
  }
}

/** Span that records its lifecycle and emits a {@link FinishedSpan} on `end()`. */
export class RecordingSpan implements Span {
  private readonly attributes: Record<string, AttributeValue> = {};
  private status: SpanStatus = 'unset';
  private exception?: string;
  private ended = false;

  constructor(
    private readonly name: string,
    private readonly traceId: string | undefined,
    private readonly exporter: SpanExporter,
    private readonly startedAt: number,
    private readonly now: () => number,
    attributes?: Record<string, AttributeValue>,
  ) {
    if (attributes) Object.assign(this.attributes, attributes);
  }

  setAttribute(key: string, value: AttributeValue): this {
    this.attributes[key] = value;
    return this;
  }

  recordException(error: unknown): this {
    this.exception = error instanceof Error ? error.message : String(error);
    this.status = 'error';
    return this;
  }

  setStatus(status: SpanStatus): this {
    // Never downgrade an error status to ok.
    if (this.status !== 'error') this.status = status;
    return this;
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.exporter.export({
      name: this.name,
      traceId: this.traceId,
      attributes: this.attributes,
      status: this.status,
      exception: this.exception,
      durationMs: Math.max(0, this.now() - this.startedAt),
    });
  }
}
