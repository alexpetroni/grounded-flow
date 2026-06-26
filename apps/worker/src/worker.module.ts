import { Module } from '@nestjs/common';
import { AppConfigModule } from '@app/config';
import { ObservabilityModule } from '@app/observability';
import { DeadLetterModule } from './dead-letter.module';
import { EventsWorkerModule } from './events/events.worker.module';
import { IngestWorkerModule } from './ingest/ingest.worker.module';

@Module({
  imports: [
    AppConfigModule,
    ObservabilityModule,
    DeadLetterModule,
    EventsWorkerModule,
    IngestWorkerModule,
  ],
})
export class WorkerModule {}
