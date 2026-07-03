import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@app/config';
import type Redis from 'ioredis';

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
      this.checkDatabase(),
      this.checkRedis(),
      this.checkQdrant(),
    ]);

    const services = { database: db, redis, qdrant };
    const allOk = Object.values(services).every((s) => s === 'ok');

    return {
      status: allOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      services,
    };
  }

  private async checkDatabase(): Promise<'ok' | 'error'> {
    try {
      const url = this.config.get('DATABASE_URL', { infer: true });
      const { Client } = await import('pg');
      const client = new Client({ connectionString: url });
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return 'ok';
    } catch (err) {
      this.logger.warn(`Database health check failed: ${(err as Error).message}`);
      return 'error';
    }
  }

  private async checkRedis(): Promise<'ok' | 'error'> {
    let client: Redis | undefined;
    try {
      const url = this.config.get('REDIS_URL', { infer: true });
      const { default: IORedis } = await import('ioredis');
      client = new IORedis(url, { lazyConnect: true, maxRetriesPerRequest: 0 });
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
      const res = await fetch(`${url}/healthz`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return 'ok';
    } catch (err) {
      this.logger.warn(`Qdrant health check failed: ${(err as Error).message}`);
      return 'error';
    }
  }
}
