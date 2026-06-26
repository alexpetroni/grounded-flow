import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@app/config';
import { TracingService } from './tracing.service';
import { LoggerSpanExporter } from './exporters';

/**
 * Provides {@link TracingService} globally. Tracing turns on only when both
 * Langfuse keys are present; otherwise it is a NoOp (graceful degradation).
 */
@Global()
@Module({
  providers: [
    {
      provide: TracingService,
      useFactory: (config: ConfigService<Env, true>): TracingService => {
        const publicKey = config.get('LANGFUSE_PUBLIC_KEY', { infer: true });
        const secretKey = config.get('LANGFUSE_SECRET_KEY', { infer: true });
        const enabled = Boolean(publicKey && secretKey);
        return new TracingService(enabled, enabled ? new LoggerSpanExporter() : undefined);
      },
      inject: [ConfigService],
    },
  ],
  exports: [TracingService],
})
export class ObservabilityModule {}
