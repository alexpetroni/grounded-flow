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

/**
 * Routes terminally-failed jobs (retries exhausted) to a per-queue
 * `<queue>-dlq` dead-letter queue so nothing is silently lost and operators can
 * inspect/replay failures. Lazily opens one DLQ producer per source queue.
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
    await this.queueFor(queueName).add('dead-letter', record, {
      removeOnComplete: false,
      removeOnFail: false,
    });
    this.logger.warn(
      `Dead-lettered job ${job.id ?? '?'} from "${queueName}" after ${job.attemptsMade} attempts`,
    );
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
