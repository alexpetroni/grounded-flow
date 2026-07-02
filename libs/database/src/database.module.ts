import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema/index';
import { EventsRepository, type Db } from './repositories/events.repository';
import { DocumentsRepository } from './repositories/documents.repository';
import { ChunksRepository } from './repositories/chunks.repository';
import { UnitOfWork } from './unit-of-work';
import type { Env } from '@app/config';

export const DATABASE_TOKEN = Symbol('DATABASE');

@Module({
  providers: [
    {
      provide: DATABASE_TOKEN,
      useFactory: (config: ConfigService<Env, true>): Db => {
        const pool = new Pool({
          connectionString: config.get('DATABASE_URL', { infer: true }),
        });
        return drizzle(pool, { schema }) as Db;
      },
      inject: [ConfigService],
    },
    {
      provide: EventsRepository,
      useFactory: (db: Db) => new EventsRepository(db),
      inject: [DATABASE_TOKEN],
    },
    {
      provide: DocumentsRepository,
      useFactory: (db: Db) => new DocumentsRepository(db),
      inject: [DATABASE_TOKEN],
    },
    {
      provide: ChunksRepository,
      useFactory: (db: Db) => new ChunksRepository(db),
      inject: [DATABASE_TOKEN],
    },
    {
      provide: UnitOfWork,
      useFactory: (db: Db) => new UnitOfWork(db),
      inject: [DATABASE_TOKEN],
    },
  ],
  exports: [DATABASE_TOKEN, EventsRepository, DocumentsRepository, ChunksRepository, UnitOfWork],
})
export class DatabaseModule {}
