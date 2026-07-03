import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  documents,
  type Document,
  type DocumentStatus,
  type NewDocument,
} from '../schema/documents';
import type { Db } from '../db.types';

@Injectable()
export class DocumentsRepository {
  constructor(private readonly db: Db) {}

  async create(data: Pick<NewDocument, 'source' | 'mimeType' | 'metadata'>): Promise<Document> {
    const [doc] = await this.db
      .insert(documents)
      .values({
        source: data.source,
        mimeType: data.mimeType,
        metadata: (data.metadata ?? {}) as Record<string, unknown>,
      })
      .returning();
    if (!doc) throw new Error('Failed to create document');
    return doc;
  }

  async findById(id: string): Promise<Document | null> {
    const [doc] = await this.db.select().from(documents).where(eq(documents.id, id));
    return doc ?? null;
  }

  async updateStatus(id: string, status: DocumentStatus): Promise<void> {
    await this.db
      .update(documents)
      .set({ status, updatedAt: new Date() })
      .where(eq(documents.id, id));
  }

  async complete(id: string): Promise<void> {
    await this.db
      .update(documents)
      .set({ status: 'completed', updatedAt: new Date() })
      .where(eq(documents.id, id));
  }

  async fail(id: string, error: string): Promise<void> {
    await this.db
      .update(documents)
      .set({ status: 'failed', error, updatedAt: new Date() })
      .where(eq(documents.id, id));
  }
}
