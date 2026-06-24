import { Module } from '@nestjs/common';
import { AppConfigModule } from '@app/config';
import { HealthModule } from './health/health.module';
import { EventsModule } from './events/events.module';
import { ChatModule } from './chat/chat.module';
import { DocumentsModule } from './documents/documents.module';

@Module({
  imports: [AppConfigModule, HealthModule, EventsModule, ChatModule, DocumentsModule],
})
export class AppModule {}
