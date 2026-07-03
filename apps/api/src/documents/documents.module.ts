import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { DatabaseModule } from '@app/database';
import { INGEST_QUEUE } from '@app/core';
import { parseRedisUrl, type Env } from '@app/config';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

@Module({
  imports: [
    BullModule.registerQueueAsync({
      name: INGEST_QUEUE,
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: parseRedisUrl(config.get('REDIS_URL', { infer: true })),
      }),
      inject: [ConfigService],
    }),
    DatabaseModule,
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
