import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import type { Env } from '@app/config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log'],
    bodyParser: false,
  });

  const config = app.get(ConfigService<Env, true>);

  // Enforce a payload-size limit (oversized bodies are rejected with 413).
  const bodyLimit = config.get('API_BODY_LIMIT', { infer: true });
  app.useBodyParser('json', { limit: bodyLimit });
  app.useBodyParser('urlencoded', { extended: true, limit: bodyLimit });

  // Drain in-flight requests and run OnModuleDestroy hooks (PG pool, queues)
  // on SIGTERM/SIGINT instead of dropping connections on redeploy.
  app.enableShutdownHooks();

  // Open-by-default is deliberate for local/demo use, but must be loud: a
  // deployment with both protections off is an unmetered LLM cost surface.
  const logger = new Logger('Bootstrap');
  if (!config.get('API_KEY', { infer: true })) {
    logger.warn('API_KEY is empty — ALL endpoints are unauthenticated. Set API_KEY in production.');
  }
  if ((config.get('RATE_LIMIT_MAX', { infer: true }) ?? 0) <= 0) {
    logger.warn('RATE_LIMIT_MAX=0 — rate limiting is DISABLED. Set a limit in production.');
  }

  const port = config.get('API_PORT', { infer: true }) ?? 8080;
  await app.listen(port, '0.0.0.0');
  console.log(`API listening on port ${port}`);
}

bootstrap().catch((err) => {
  console.error('Fatal error during bootstrap:', err);
  process.exit(1);
});
