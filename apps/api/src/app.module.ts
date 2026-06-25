import { Module } from '@nestjs/common';
import { AppConfigModule } from '@app/config';
import { HealthModule } from './health/health.module';
import { EventsModule } from './events/events.module';
import { ChatModule } from './chat/chat.module';
import { DocumentsModule } from './documents/documents.module';
import { RagApiModule } from './rag/rag.module';

@Module({
  imports: [AppConfigModule, HealthModule, EventsModule, ChatModule, DocumentsModule, RagApiModule],
})
export class AppModule {}
