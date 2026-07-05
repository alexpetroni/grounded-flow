import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@app/config';
import type Redis from 'ioredis';

/** Per-dependency probe budget; well under Docker's 5s healthcheck timeout. */
const CHECK_TIMEOUT_MS = 3_000;

export interface HealthStatus {
  status: 'ok' | 'degraded';
  timestamp: string;
  services: Record<string, 'ok' | 'error' | 'unconfigured'>;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  async check(): Promise<HealthStatus> {
    const [db, redis, qdrant] = await Promise.all([
      this.bounded('database', () => this.checkDatabase()),
      this.bounded('redis', () => this.checkRedis()),
      this.bounded('qdrant', () => this.checkQdrant()),
    ]);

    const services = { database: db, redis, qdrant };
    const allOk = Object.values(services).every((s) => s === 'ok');

    return {
      status: allOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      services,
    };
  }

  /**
   * Hard per-probe deadline. The per-step client timeouts below can stack
   * (ioredis spends its full connectTimeout before commandTimeout even
   * starts), so without an outer bound a single silent dependency pushes
   * /health past Docker's 5s healthcheck. The losing probe still settles on
   * its own clock, so its `finally` cleanup runs — nothing leaks.
   */
  private async bounded(
    name: string,
    probe: () => Promise<'ok' | 'error'>,
  ): Promise<'ok' | 'error'> {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<'error'>((resolve) => {
      timer = setTimeout(() => {
        this.logger.warn(`${name} health check timed out after ${CHECK_TIMEOUT_MS}ms`);
        resolve('error');
      }, CHECK_TIMEOUT_MS);
    });
    try {
      return await Promise.race([probe(), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async checkDatabase(): Promise<'ok' | 'error'> {
    // Bounded + leak-free: a black-holed host must yield `degraded` within
    // the probe budget (not the ~2 min OS TCP timeout), and a failed query
    // after a successful connect must still release the connection.
    let client: InstanceType<(typeof import('pg'))['Client']> | undefined;
    try {
      const url = this.config.get('DATABASE_URL', { infer: true });
      const { Client } = await import('pg');
      client = new Client({
        connectionString: url,
        connectionTimeoutMillis: CHECK_TIMEOUT_MS,
        query_timeout: CHECK_TIMEOUT_MS,
      });
      await client.connect();
      await client.query('SELECT 1');
      return 'ok';
    } catch (err) {
      this.logger.warn(`Database health check failed: ${(err as Error).message}`);
      return 'error';
    } finally {
      await client?.end().catch(() => undefined);
    }
  }

  private async checkRedis(): Promise<'ok' | 'error'> {
    let client: Redis | undefined;
    try {
      const url = this.config.get('REDIS_URL', { infer: true });
      const { default: IORedis } = await import('ioredis');
      // connectTimeout bounds only the TCP connect; a connected-but-silent
      // Redis (LOADING, blocked script) must still fail within budget, so the
      // PING is bounded too. The implicit ready-check is disabled — it is an
      // unbounded extra round-trip and the probe sends its own PING.
      client = new IORedis(url, {
        lazyConnect: true,
        maxRetriesPerRequest: 0,
        connectTimeout: CHECK_TIMEOUT_MS,
        commandTimeout: CHECK_TIMEOUT_MS,
        enableReadyCheck: false,
      });
      await client.connect();
      await client.ping();
      return 'ok';
    } catch (err) {
      this.logger.warn(`Redis health check failed: ${(err as Error).message}`);
      return 'error';
    } finally {
      client?.disconnect();
    }
  }

  private async checkQdrant(): Promise<'ok' | 'error'> {
    try {
      const url = this.config.get('QDRANT_URL', { infer: true });
      const res = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return 'ok';
    } catch (err) {
      this.logger.warn(`Qdrant health check failed: ${(err as Error).message}`);
      return 'error';
    }
  }
}
