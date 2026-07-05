import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:net';
import type { Server, Socket } from 'node:net';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '@app/config';
import { HealthService } from './health.service';

// Accepts TCP connections and never sends a byte: a connected-but-silent
// dependency (Redis LOADING a large RDB, a black-holed connection, …).
let silent: Server;
let silentPort: number;
const sockets = new Set<Socket>();

beforeAll(async () => {
  silent = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => {
    silent.listen(0, '127.0.0.1', resolve);
  });
  silentPort = (silent.address() as { port: number }).port;
});

afterAll(async () => {
  for (const socket of sockets) socket.destroy();
  await new Promise<void>((resolve) => {
    silent.close(() => resolve());
  });
});

function configOf(values: Record<string, string>): ConfigService<Env, true> {
  return { get: (key: string) => values[key] } as unknown as ConfigService<Env, true>;
}

describe('HealthService probe budgets', () => {
  // Regression: connectTimeout bounds only the TCP connect — a Redis that
  // accepts the connection but never answers PING must still fail within the
  // probe budget (commandTimeout) instead of stalling /health until the
  // Docker healthcheck kills the container.
  it('reports degraded, not a hang, when Redis accepts but never responds', async () => {
    const service = new HealthService(
      configOf({
        REDIS_URL: `redis://127.0.0.1:${silentPort}`,
        DATABASE_URL: 'postgres://user:pw@127.0.0.1:1/db',
        QDRANT_URL: 'http://127.0.0.1:1',
      }),
    );

    const started = Date.now();
    const result = await service.check();
    const elapsed = Date.now() - started;

    expect(result.status).toBe('degraded');
    expect(result.services.redis).toBe('error');
    // Must fit Docker's 5s healthcheck: the per-step client timeouts stack
    // (connect + command), so only the outer per-probe deadline keeps this
    // under budget.
    expect(elapsed).toBeLessThan(5_000);
  }, 15_000);
});
