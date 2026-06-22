import { Module } from '@nestjs/common';
import { AppConfigModule } from '@app/config';
import { HealthModule } from './health/health.module';

@Module({
  imports: [AppConfigModule, HealthModule],
})
export class AppModule {}
