import { Module } from '@nestjs/common';
import { AppConfigModule } from '@app/config';
import { HealthModule } from './health/health.module';
import { EventsModule } from './events/events.module';

@Module({
  imports: [AppConfigModule, HealthModule, EventsModule],
})
export class AppModule {}
