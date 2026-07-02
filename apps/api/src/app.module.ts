import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppConfigModule } from '@app/config';
import { ObservabilityModule } from '@app/observability';
import { HealthModule } from './health/health.module';
import { EventsModule } from './events/events.module';
import { ChatModule } from './chat/chat.module';
import { DocumentsModule } from './documents/documents.module';
import { RagApiModule } from './rag/rag.module';
import { RateLimitGuard } from './common/rate-limit.guard';
import { ApiKeyGuard } from './common/api-key.guard';

@Module({
  imports: [
    AppConfigModule.forRoot(),
    ObservabilityModule,
    HealthModule,
    EventsModule,
    ChatModule,
    DocumentsModule,
    RagApiModule,
  ],
  providers: [
    // Order matters: rate-limit before auth so abusive unauthenticated traffic is shed first.
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: ApiKeyGuard },
  ],
})
export class AppModule {}
