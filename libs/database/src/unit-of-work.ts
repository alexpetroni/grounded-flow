import { Injectable } from '@nestjs/common';
import type { Db } from './repositories/events.repository';
import { ChunksRepository } from './repositories/chunks.repository';
import { DocumentsRepository } from './repositories/documents.repository';
import { EventsRepository } from './repositories/events.repository';

export interface TransactionalRepositories {
  chunks: ChunksRepository;
  documents: DocumentsRepository;
  events: EventsRepository;
}

/**
 * Owns the transaction boundary (repositories never self-commit): `fn`
 * receives repositories bound to one transaction, committed iff it resolves.
 */
@Injectable()
export class UnitOfWork {
  constructor(private readonly db: Db) {}

  async withTransaction<T>(fn: (repos: TransactionalRepositories) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) =>
      fn({
        chunks: new ChunksRepository(tx as unknown as Db),
        documents: new DocumentsRepository(tx as unknown as Db),
        events: new EventsRepository(tx as unknown as Db),
      }),
    );
  }
}
