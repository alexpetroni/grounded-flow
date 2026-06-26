import { Injectable } from '@nestjs/common';
import { NoopSpan, RecordingSpan } from './span';
import type { AttributeValue, Span, SpanExporter } from './span';

export interface StartSpanOptions {
  attributes?: Record<string, AttributeValue>;
  traceId?: string;
}

/**
 * Minimal, dependency-free tracing facade.
 *
 * When `enabled` is false (no observability keys configured) every span is a
 * no-op — the first run never crashes and nothing is exported. When enabled,
 * spans are recorded and handed to the injected {@link SpanExporter} on `end()`.
 * This is the integration point for Langfuse / OpenTelemetry: provide an
 * exporter that forwards to the collector.
 */
@Injectable()
export class TracingService {
  constructor(
    private readonly enabled: boolean,
    private readonly exporter?: SpanExporter,
    private readonly now: () => number = () => Date.now(),
  ) {}

  isEnabled(): boolean {
    return this.enabled && this.exporter !== undefined;
  }

  startSpan(name: string, options: StartSpanOptions = {}): Span {
    if (!this.isEnabled()) return new NoopSpan();
    return new RecordingSpan(
      name,
      options.traceId,
      this.exporter!,
      this.now(),
      this.now,
      options.attributes,
    );
  }

  /** Run `fn` inside a span, recording exceptions and always ending the span. */
  async withSpan<T>(
    name: string,
    fn: (span: Span) => Promise<T>,
    options: StartSpanOptions = {},
  ): Promise<T> {
    const span = this.startSpan(name, options);
    try {
      const result = await fn(span);
      span.setStatus('ok');
      return result;
    } catch (err) {
      span.recordException(err);
      throw err;
    } finally {
      span.end();
    }
  }

  /** AI SDK `experimental_telemetry` settings; disabled telemetry when tracing is off. */
  aiTelemetry(functionId?: string): { isEnabled: boolean; functionId?: string } {
    return this.isEnabled() ? { isEnabled: true, functionId } : { isEnabled: false };
  }
}
