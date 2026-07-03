import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { ZodError } from 'zod';
import { EventsRepository } from '@app/database';
import { EVENTS_QUEUE } from '@app/core';
import type { Env } from '@app/config';
import { createEventSchema, type CreateEventDto, type EventResponseDto } from './events.dto';

@Injectable()
export class EventsService {
  constructor(
    private readonly eventsRepository: EventsRepository,
    @InjectQueue(EVENTS_QUEUE) private readonly eventsQueue: Queue,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async create(body: unknown): Promise<{ eventId: string; status: string }> {
    let dto: CreateEventDto;
    try {
      dto = createEventSchema.parse(body);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException({
          message: 'Validation failed',
          errors: err.errors,
        });
      }
      throw err;
    }

    const event = await this.eventsRepository.create({
      workflowType: dto.workflowType,
      data: dto.data,
    });

    await this.eventsQueue.add(
      'process',
      { eventId: event.id },
      {
        attempts: this.config.get('BULLMQ_ATTEMPTS', { infer: true }),
        backoff: {
          type: 'exponential',
          delay: this.config.get('BULLMQ_BACKOFF_MS', { infer: true }),
        },
        // Bounded retention: event state lives in Postgres, not the queue —
        // unbounded Redis job history eventually exhausts memory.
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );

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
