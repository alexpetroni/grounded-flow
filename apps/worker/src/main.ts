import 'reflect-metadata';
import { writeFileSync } from 'fs';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

// Liveness heartbeat for the container healthcheck: a wedged event loop stops
// refreshing the file, so Docker can detect and restart the worker.
const HEARTBEAT_FILE = process.env.WORKER_HEARTBEAT_FILE ?? '/tmp/worker-heartbeat';
const HEARTBEAT_INTERVAL_MS = 10_000;

function beat(): void {
  try {
    writeFileSync(HEARTBEAT_FILE, String(Date.now()));
  } catch {
    // Non-fatal: heartbeat must never take the worker down.
  }
}

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['error', 'warn', 'log'],
  });
  await app.init();
  console.log('Worker started');

  beat();
  setInterval(beat, HEARTBEAT_INTERVAL_MS).unref();

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down worker`);
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
