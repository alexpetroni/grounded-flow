import { pgTable, text, jsonb, integer, timestamp } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { documents } from './documents';

export const chunks = pgTable('chunks', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  documentId: text('document_id')
    .notNull()
    .references(() => documents.id, { onDelete: 'cascade' }),
  ordinal: integer('ordinal').notNull(),
  text: text('text').notNull(),
  tokenCount: integer('token_count').notNull(),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Chunk = typeof chunks.$inferSelect;
export type NewChunk = typeof chunks.$inferInsert;
