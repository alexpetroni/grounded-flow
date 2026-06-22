import { Module } from '@nestjs/common';
import { AppConfigModule } from '@app/config';
import { EventsWorkerModule } from './events/events.worker.module';

@Module({
  imports: [AppConfigModule, EventsWorkerModule],
})
export class WorkerModule {}
