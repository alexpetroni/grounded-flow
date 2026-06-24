import { Module } from '@nestjs/common';
import { AppConfigModule } from '@app/config';
import { EventsWorkerModule } from './events/events.worker.module';
import { IngestWorkerModule } from './ingest/ingest.worker.module';

@Module({
  imports: [AppConfigModule, EventsWorkerModule, IngestWorkerModule],
})
export class WorkerModule {}
