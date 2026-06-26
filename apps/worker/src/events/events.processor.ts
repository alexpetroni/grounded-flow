import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { EventsRepository } from '@app/database';
import { WorkflowRegistry } from '@app/core';
import { TracingService } from '@app/observability';
import { DeadLetterService } from '../dead-letter.service';
import { workerConcurrency } from '../worker.config';
import { EVENTS_QUEUE } from './events.constants';

interface EventJobData {
  eventId: string;
}

@Processor(EVENTS_QUEUE, { concurrency: workerConcurrency() })
export class EventsProcessor extends WorkerHost {
  private readonly logger = new Logger(EventsProcessor.name);

  constructor(
    private readonly eventsRepository: EventsRepository,
    private readonly workflowRegistry: WorkflowRegistry,
    private readonly tracing: TracingService,
    private readonly deadLetter: DeadLetterService,
  ) {
    super();
  }

  async process(job: Job<EventJobData>): Promise<void> {
    const { eventId } = job.data;
    this.logger.log(`Processing event ${eventId} (attempt ${job.attemptsMade + 1})`);

    const event = await this.eventsRepository.findById(eventId);
    if (!event) {
      this.logger.error(`Event ${eventId} not found`);
      return;
    }

    await this.eventsRepository.updateStatus(eventId, 'processing');

    try {
      const ctx = await this.tracing.withSpan(
        'workflow.run',
        async (span) => {
          span.setAttribute('workflowType', event.workflowType).setAttribute('eventId', eventId);
          const workflow = this.workflowRegistry.resolve(event.workflowType);
          return workflow.run(event.data, event.traceId ?? undefined);
        },
        { traceId: event.traceId ?? undefined, attributes: { 'event.id': eventId } },
      );

      const result = Object.fromEntries(ctx.nodes.entries());
      await this.eventsRepository.complete(eventId, result);
      this.logger.log(`Event ${eventId} completed`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Event ${eventId} failed: ${message}`);
      await this.eventsRepository.fail(eventId, message);
      throw err;
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<EventJobData> | undefined, err: Error): Promise<void> {
    if (!job) return;
    const eventId = job.data?.eventId ?? 'unknown';
    if (this.deadLetter.isTerminal(job)) {
      this.logger.error(`Job failed permanently for event ${eventId}: ${err.message}`);
      await this.deadLetter.deadLetter(EVENTS_QUEUE, job, err);
    } else {
      this.logger.warn(
        `Event ${eventId} failed (attempt ${job.attemptsMade}); will retry: ${err.message}`,
      );
    }
  }
}
