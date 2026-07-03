import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema/index';
import { DATABASE_TOKEN, type Db } from './db.types';
import { EventsRepository } from './repositories/events.repository';
import { DocumentsRepository } from './repositories/documents.repository';
import { ChunksRepository } from './repositories/chunks.repository';
import { UnitOfWork } from './unit-of-work';
import type { Env } from '@app/config';

export { DATABASE_TOKEN };

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
    EventsRepository,
    DocumentsRepository,
    ChunksRepository,
    UnitOfWork,
  ],
  exports: [DATABASE_TOKEN, EventsRepository, DocumentsRepository, ChunksRepository, UnitOfWork],
})
export class DatabaseModule {}
