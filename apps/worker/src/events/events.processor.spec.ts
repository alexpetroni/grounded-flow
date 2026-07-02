import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { EventsRepository } from '@app/database';
import type { WorkflowRegistry } from '@app/core';
import { TracingService } from '@app/observability';
import type { DeadLetterService } from '../dead-letter.service';
import { EventsProcessor } from './events.processor';

function makeJob(attemptsMade: number, attempts: number): Job<{ eventId: string }> {
  return {
    data: { eventId: 'evt-1' },
    attemptsMade,
    opts: { attempts },
  } as unknown as Job<{ eventId: string }>;
}

describe('EventsProcessor', () => {
  let repo: EventsRepository;
  let registry: WorkflowRegistry;
  let processor: EventsProcessor;
  let run: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    repo = {
      findById: vi.fn().mockResolvedValue({ id: 'evt-1', workflowType: 'wf', data: {} }),
      updateStatus: vi.fn().mockResolvedValue(undefined),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn().mockResolvedValue(undefined),
    } as unknown as EventsRepository;
    run = vi.fn().mockRejectedValue(new Error('boom'));
    registry = { resolve: vi.fn().mockReturnValue({ run }) } as unknown as WorkflowRegistry;
    processor = new EventsProcessor(repo, registry, new TracingService(false), {
      isTerminal: vi.fn(),
      deadLetter: vi.fn(),
    } as unknown as DeadLetterService);
  });

  // Regression: `failed` was written on EVERY failed attempt, so a poller saw
  // a terminal-looking status that later flipped back to `processing` when the
  // job retried and could succeed.
  it('does not write terminal failed status while retries remain', async () => {
    await expect(processor.process(makeJob(0, 3))).rejects.toThrow('boom');
    expect(repo.fail).not.toHaveBeenCalled();
    expect(repo.updateStatus).toHaveBeenCalledWith('evt-1', 'processing');
  });

  it('writes failed status on the final attempt', async () => {
    await expect(processor.process(makeJob(2, 3))).rejects.toThrow('boom');
    expect(repo.fail).toHaveBeenCalledWith('evt-1', 'boom');
  });

  it('completes the event on success', async () => {
    run.mockResolvedValue({ nodes: new Map([['Node', { ok: true }]]) });
    await processor.process(makeJob(0, 3));
    expect(repo.complete).toHaveBeenCalledWith('evt-1', { Node: { ok: true } });
    expect(repo.fail).not.toHaveBeenCalled();
  });
});
