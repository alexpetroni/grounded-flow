import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { events, type Event, type EventStatus } from '../schema/events';
import type { Db } from '../db.types';

@Injectable()
export class EventsRepository {
  constructor(private readonly db: Db) {}

  async create(data: { workflowType: string; data: unknown; traceId?: string }): Promise<Event> {
    const [event] = await this.db
      .insert(events)
      .values({
        workflowType: data.workflowType,
        data: data.data as Record<string, unknown>,
        traceId: data.traceId ?? null,
      })
      .returning();
    if (!event) throw new Error('Failed to create event');
    return event;
  }

  async findById(id: string): Promise<Event | null> {
    const [event] = await this.db.select().from(events).where(eq(events.id, id));
    return event ?? null;
  }

  async updateStatus(id: string, status: EventStatus): Promise<void> {
    await this.db.update(events).set({ status, updatedAt: new Date() }).where(eq(events.id, id));
  }

  async complete(id: string, result: unknown): Promise<void> {
    await this.db
      .update(events)
      .set({
        status: 'completed',
        result: result as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(events.id, id));
  }

  async fail(id: string, error: string): Promise<void> {
    await this.db
      .update(events)
      .set({
        status: 'failed',
        error,
        updatedAt: new Date(),
      })
      .where(eq(events.id, id));
  }
}
