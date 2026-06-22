import { pgTable, text, jsonb, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';

export const eventStatusEnum = pgEnum('event_status', [
  'pending',
  'processing',
  'completed',
  'failed',
]);

export const events = pgTable('events', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  workflowType: text('workflow_type').notNull(),
  data: jsonb('data').notNull(),
  result: jsonb('result'),
  status: eventStatusEnum('status').notNull().default('pending'),
  error: text('error'),
  traceId: text('trace_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type EventStatus = Event['status'];
