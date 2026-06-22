import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { EventsRepository } from '@app/database';
import { WorkflowRegistry } from '@app/core';
import { EVENTS_QUEUE } from './events.constants';

interface EventJobData {
  eventId: string;
}

@Processor(EVENTS_QUEUE)
export class EventsProcessor extends WorkerHost {
  private readonly logger = new Logger(EventsProcessor.name);

  constructor(
    private readonly eventsRepository: EventsRepository,
    private readonly workflowRegistry: WorkflowRegistry,
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
      const workflow = this.workflowRegistry.resolve(event.workflowType);
      const ctx = await workflow.run(event.data, event.traceId ?? undefined);

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
  onFailed(job: Job<EventJobData> | undefined, err: Error): void {
    const eventId = job?.data?.eventId ?? 'unknown';
    this.logger.error(`Job failed permanently for event ${eventId}: ${err.message}`);
  }
}
