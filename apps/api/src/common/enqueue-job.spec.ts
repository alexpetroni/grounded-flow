import { describe, it, expect, vi } from 'vitest';
import type { Queue } from 'bullmq';
import type { ConfigService } from '@nestjs/config';
import { enqueueJob } from './enqueue-job';

function configOf(values: Record<string, unknown>): ConfigService {
  return { get: (k: string) => values[k] } as unknown as ConfigService;
}

describe('enqueueJob', () => {
  it('submits attempts/backoff/removeOn* read from config', async () => {
    const add = vi.fn().mockResolvedValue({ id: 'job-1' });
    const queue = { add } as unknown as Queue;
    const config = configOf({ BULLMQ_ATTEMPTS: 5, BULLMQ_BACKOFF_MS: 2000 });

    await enqueueJob(queue, 'process', { eventId: 'evt-1' }, config as never);

    expect(add).toHaveBeenCalledWith(
      'process',
      { eventId: 'evt-1' },
      {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
  });
});
