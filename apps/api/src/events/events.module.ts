import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { DatabaseModule } from '@app/database';
import { EVENTS_QUEUE } from '@app/core';
import { parseRedisUrl, type Env } from '@app/config';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
  imports: [
    BullModule.registerQueueAsync({
      name: EVENTS_QUEUE,
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: parseRedisUrl(config.get('REDIS_URL', { infer: true })),
      }),
      inject: [ConfigService],
    }),
    DatabaseModule,
  ],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
