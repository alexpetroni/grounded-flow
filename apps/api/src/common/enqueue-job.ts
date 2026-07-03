import type { ConfigService } from '@nestjs/config';
import type { JobsOptions } from 'bullmq';
import type { Env } from '@app/config';

interface JobQueue<T> {
  add(name: string, data: T, opts: JobsOptions): Promise<unknown>;
}

/** Single source of truth for job-submit options — used by every queue producer. */
export async function enqueueJob<T>(
  queue: JobQueue<T>,
  name: string,
  data: T,
  config: ConfigService<Env, true>,
): Promise<void> {
  await queue.add(name, data, {
    attempts: config.get('BULLMQ_ATTEMPTS', { infer: true }),
    backoff: {
      type: 'exponential',
      delay: config.get('BULLMQ_BACKOFF_MS', { infer: true }),
    },
    // Bounded retention: job state lives in Postgres, not the queue —
    // unbounded Redis job history eventually exhausts memory.
    removeOnComplete: 100,
    removeOnFail: 100,
  });
}
