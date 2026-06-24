import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { chunks, type Chunk, type NewChunk } from '../schema/chunks';
import type { Db } from './events.repository';

export type ChunkInsert = Pick<
  NewChunk,
  'id' | 'documentId' | 'ordinal' | 'text' | 'tokenCount' | 'metadata'
>;

@Injectable()
export class ChunksRepository {
  constructor(private readonly db: Db) {}

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
        set: {
          text: chunks.text,
          tokenCount: chunks.tokenCount,
          metadata: chunks.metadata,
        },
      });
  }

  async findByDocumentId(documentId: string): Promise<Chunk[]> {
    return this.db.select().from(chunks).where(eq(chunks.documentId, documentId));
  }

  async deleteByDocumentId(documentId: string): Promise<void> {
    await this.db.delete(chunks).where(eq(chunks.documentId, documentId));
  }

  async countByDocumentId(documentId: string): Promise<number> {
    const rows = await this.db.select().from(chunks).where(eq(chunks.documentId, documentId));
    return rows.length;
  }
}
