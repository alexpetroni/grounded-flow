import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema/index';
import { EventsRepository, type Db } from './repositories/events.repository';
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
  ],
  exports: [DATABASE_TOKEN, EventsRepository],
})
export class DatabaseModule {}
