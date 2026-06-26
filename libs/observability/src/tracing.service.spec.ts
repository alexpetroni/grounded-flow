import { describe, it, expect } from 'vitest';
import { TracingService } from './tracing.service';
import { CollectingSpanExporter } from './exporters';

describe('TracingService (disabled / NoOp)', () => {
  it('reports disabled and never exports when no exporter is configured', () => {
    const tracing = new TracingService(false);
    expect(tracing.isEnabled()).toBe(false);

    const span = tracing.startSpan('x', { attributes: { a: 1 } });
    span.setAttribute('b', 2).setStatus('ok').end(); // must not throw
    expect(tracing.aiTelemetry('fn')).toEqual({ isEnabled: false });
  });

  it('is disabled if enabled=true but no exporter is provided', () => {
    expect(new TracingService(true).isEnabled()).toBe(false);
  });

  it('withSpan returns the value and swallows nothing on the happy path', async () => {
    const tracing = new TracingService(false);
    const result = await tracing.withSpan('op', async () => 42);
    expect(result).toBe(42);
  });
});

describe('TracingService (enabled / fake exporter)', () => {
  let clock: number;
  const now = () => clock;

  function make(): { tracing: TracingService; exporter: CollectingSpanExporter } {
    clock = 0;
    const exporter = new CollectingSpanExporter();
    return { tracing: new TracingService(true, exporter, now), exporter };
  }

  it('exports a completed span with attributes and duration', () => {
    const { tracing, exporter } = make();
    const span = tracing.startSpan('node.process', {
      attributes: { node: 'Echo' },
      traceId: 'trace-1',
    });
    clock = 5;
    span.setAttribute('ok', true).setStatus('ok').end();

    expect(exporter.spans).toHaveLength(1);
    const s = exporter.spans[0]!;
    expect(s.name).toBe('node.process');
    expect(s.traceId).toBe('trace-1');
    expect(s.attributes).toMatchObject({ node: 'Echo', ok: true });
    expect(s.status).toBe('ok');
    expect(s.durationMs).toBe(5);
  });

  it('records exceptions and marks the span errored via withSpan', async () => {
    const { tracing, exporter } = make();
    await expect(
      tracing.withSpan('failing', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(exporter.spans).toHaveLength(1);
    expect(exporter.spans[0]!.status).toBe('error');
    expect(exporter.spans[0]!.exception).toBe('boom');
  });

  it('does not double-export when end() is called twice', () => {
    const { tracing, exporter } = make();
    const span = tracing.startSpan('once');
    span.end();
    span.end();
    expect(exporter.spans).toHaveLength(1);
  });

  it('enables AI SDK telemetry when configured', () => {
    const { tracing } = make();
    expect(tracing.aiTelemetry('rag.generate')).toEqual({
      isEnabled: true,
      functionId: 'rag.generate',
    });
  });
});
