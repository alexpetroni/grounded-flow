import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { RagModule } from '@app/rag';
import { INGEST_QUEUE } from '@app/core';
import { parseRedisUrl, type Env } from '@app/config';
import { IngestProcessor } from './ingest.processor';

@Module({
  imports: [
    BullModule.registerQueueAsync({
      name: INGEST_QUEUE,
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: parseRedisUrl(config.get('REDIS_URL', { infer: true })),
      }),
      inject: [ConfigService],
    }),
    RagModule,
  ],
  providers: [IngestProcessor],
})
export class IngestWorkerModule {}
