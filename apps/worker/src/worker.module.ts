import { Module } from '@nestjs/common';
import { AppConfigModule } from '@app/config';

@Module({
  imports: [AppConfigModule],
})
export class WorkerModule {}
