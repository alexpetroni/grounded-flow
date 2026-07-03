import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { EventsRepository } from '@app/database';
import { EVENTS_QUEUE } from '@app/core';
import type { Env } from '@app/config';
import { enqueueJob } from '../common/enqueue-job';
import { parseOrThrow } from '../common/validate-body';
import { createEventSchema, type EventResponseDto } from './events.dto';

@Injectable()
export class EventsService {
  constructor(
    private readonly eventsRepository: EventsRepository,
    @InjectQueue(EVENTS_QUEUE) private readonly eventsQueue: Queue,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async create(body: unknown): Promise<{ eventId: string; status: string }> {
    const dto = parseOrThrow(createEventSchema, body);

    const event = await this.eventsRepository.create({
      workflowType: dto.workflowType,
      data: dto.data,
    });

    await enqueueJob(this.eventsQueue, 'process', { eventId: event.id }, this.config);

    return { eventId: event.id, status: 'pending' };
  }

  async findById(id: string): Promise<EventResponseDto> {
    const event = await this.eventsRepository.findById(id);
    if (!event) {
      throw new NotFoundException(`Event "${id}" not found`);
    }

    return {
      eventId: event.id,
      status: event.status,
      result: event.result ?? undefined,
      error: event.error,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    };
  }
}
