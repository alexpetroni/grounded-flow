import { pgTable, text, jsonb, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';

export const documentStatusEnum = pgEnum('document_status', [
  'pending',
  'processing',
  'completed',
  'failed',
]);

export const documents = pgTable('documents', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  source: text('source').notNull(),
  mimeType: text('mime_type').notNull(),
  status: documentStatusEnum('status').notNull().default('pending'),
  error: text('error'),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type DocumentStatus = Document['status'];
