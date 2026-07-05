import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type { Job } from 'bullmq';
import { parseRedisUrl, type Env } from '@app/config';

export interface DeadLetterRecord {
  originalQueue: string;
  originalJobId: string | undefined;
  data: unknown;
  failedReason: string;
  attemptsMade: number;
}

export const MAX_DLQ_ENTRIES = 1_000;

/**
 * Routes terminally-failed jobs (retries exhausted) to a per-queue
 * `<queue>-dlq` dead-letter queue so nothing is silently lost and operators can
 * inspect/replay failures. Lazily opens one DLQ producer per source queue.
 *
 * Nothing consumes the DLQ, so it is capped at MAX_DLQ_ENTRIES to keep a
 * persistently-failing producer from growing Redis without bound. Trimming is
 * loud: every dropped record is logged with its id so an over-cap incident is
 * visible, not silent.
 */
@Injectable()
export class DeadLetterService implements OnModuleDestroy {
  private readonly logger = new Logger(DeadLetterService.name);
  private readonly queues = new Map<string, Queue>();

  constructor(private readonly config: ConfigService<Env, true>) {}

  static dlqName(queueName: string): string {
    return `${queueName}-dlq`;
  }

  /** A job is terminal when it has used up all its configured attempts. */
  isTerminal(job: Job): boolean {
    const maxAttempts = job.opts.attempts ?? 1;
    return job.attemptsMade >= maxAttempts;
  }

  async deadLetter(queueName: string, job: Job, error: Error): Promise<void> {
    const record: DeadLetterRecord = {
      originalQueue: queueName,
      originalJobId: job.id,
      data: job.data,
      failedReason: error.message,
      attemptsMade: job.attemptsMade,
    };
    const queue = this.queueFor(queueName);
    await queue.add('dead-letter', record, {
      removeOnComplete: false,
      removeOnFail: false,
    });
    await this.trimToCap(queue);
    this.logger.warn(
      `Dead-lettered job ${job.id ?? '?'} from "${queueName}" after ${job.attemptsMade} attempts`,
    );
  }

  /**
   * Best-effort cap enforcement. The record itself is already durably added;
   * a trim failure must never reject the caller — worker `failed` handlers
   * don't catch, and an unhandled rejection would take down the process.
   */
  private async trimToCap(queue: Queue): Promise<void> {
    try {
      // Entries land in 'paused' instead of 'waiting' while an operator has
      // the DLQ paused for inspection — the cap must see both.
      const total = await queue.getJobCountByTypes('waiting', 'paused');
      if (total <= MAX_DLQ_ENTRIES) return;
      const oldest = await queue.getJobs(
        ['waiting', 'paused'],
        0,
        total - MAX_DLQ_ENTRIES - 1,
        true,
      );
      const dropped: string[] = [];
      await Promise.all(
        oldest.map(async (j) => {
          try {
            await j.remove();
            dropped.push(j.id ?? '?');
          } catch {
            // Concurrent removal or transient Redis error; the cap re-runs on
            // the next dead-letter.
          }
        }),
      );
      if (dropped.length > 0) {
        this.logger.error(
          `DLQ "${queue.name}" exceeded cap (${total} > ${MAX_DLQ_ENTRIES}); ` +
            `dropped ${dropped.length} oldest record(s): ${dropped.join(', ')}`,
        );
      }
    } catch (err) {
      this.logger.warn(`Failed to trim DLQ "${queue.name}": ${(err as Error).message}`);
    }
  }

  private queueFor(queueName: string): Queue {
    const dlq = DeadLetterService.dlqName(queueName);
    let queue = this.queues.get(dlq);
    if (!queue) {
      queue = new Queue(dlq, {
        connection: parseRedisUrl(this.config.get('REDIS_URL', { infer: true })),
      });
      this.queues.set(dlq, queue);
    }
    return queue;
  }

  async onModuleDestroy(): Promise<void> {
    for (const queue of this.queues.values()) {
      await queue.close();
    }
    this.queues.clear();
  }
}
