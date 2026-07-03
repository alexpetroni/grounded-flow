import { Inject, Injectable } from '@nestjs/common';
import { asc, count, eq, sql } from 'drizzle-orm';
import { chunks, type Chunk, type NewChunk } from '../schema/chunks';
import { DATABASE_TOKEN, type Db } from '../db.types';

export type ChunkInsert = Pick<
  NewChunk,
  'id' | 'documentId' | 'ordinal' | 'text' | 'tokenCount' | 'metadata'
>;

@Injectable()
export class ChunksRepository {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Db) {}

  async upsertMany(rows: ChunkInsert[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db
      .insert(chunks)
      .values(
        rows.map((r) => ({
          id: r.id,
          documentId: r.documentId,
          ordinal: r.ordinal,
          text: r.text,
          tokenCount: r.tokenCount,
          metadata: (r.metadata ?? {}) as Record<string, unknown>,
        })),
      )
      .onConflictDoUpdate({
        target: chunks.id,
        // `excluded` refers to the incoming row; referencing the table column
        // here would assign each column to itself (a no-op "upsert").
        set: {
          text: sql`excluded.text`,
          tokenCount: sql`excluded.token_count`,
          metadata: sql`excluded.metadata`,
        },
      });
  }

  async findByDocumentId(documentId: string): Promise<Chunk[]> {
    return this.db
      .select()
      .from(chunks)
      .where(eq(chunks.documentId, documentId))
      .orderBy(asc(chunks.ordinal));
  }

  async deleteByDocumentId(documentId: string): Promise<void> {
    await this.db.delete(chunks).where(eq(chunks.documentId, documentId));
  }

  async countByDocumentId(documentId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(chunks)
      .where(eq(chunks.documentId, documentId));
    return row?.value ?? 0;
  }
}
