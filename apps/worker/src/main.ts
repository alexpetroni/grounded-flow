import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['error', 'warn', 'log'],
  });
  await app.init();
  console.log('Worker started');

  // Keep the event loop alive until BullMQ processors are added in Phase 2.
  const keepAlive = setInterval(() => {}, 30_000);

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down worker`);
    clearInterval(keepAlive);
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  console.error('Fatal error during worker bootstrap:', err);
  process.exit(1);
});
