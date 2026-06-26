import { Logger } from '@nestjs/common';
import type { FinishedSpan, SpanExporter } from './span';

/** Collects spans in memory — used by tests and assertable in integration. */
export class CollectingSpanExporter implements SpanExporter {
  readonly spans: FinishedSpan[] = [];

  export(span: FinishedSpan): void {
    this.spans.push(span);
  }

  reset(): void {
    this.spans.length = 0;
  }
}

/**
 * Default exporter when tracing is enabled but no dedicated backend is wired.
 * Emits a structured debug line per span. This is the seam where a Langfuse /
 * OpenTelemetry exporter plugs in — swap this for an OTLP-backed exporter and
 * spans flow to the collector with no other code change.
 */
export class LoggerSpanExporter implements SpanExporter {
  private readonly logger = new Logger('Tracing');

  export(span: FinishedSpan): void {
    this.logger.debug(
      `span ${span.name} status=${span.status} dur=${span.durationMs}ms ` +
        `${span.traceId ? `trace=${span.traceId} ` : ''}` +
        `attrs=${JSON.stringify(span.attributes)}` +
        `${span.exception ? ` exception=${span.exception}` : ''}`,
    );
  }
}
