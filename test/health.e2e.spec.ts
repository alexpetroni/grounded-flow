import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { HealthController } from '../apps/api/src/health/health.controller';
import { HealthService } from '../apps/api/src/health/health.service';

describe('GET /health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthService,
          useValue: {
            check: async () => ({
              status: 'degraded',
              timestamp: new Date().toISOString(),
              services: { database: 'error', redis: 'error', qdrant: 'error' },
            }),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with status ok or degraded', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      timestamp: expect.any(String),
      services: expect.any(Object),
    });
    expect(['ok', 'degraded']).toContain(res.body.status);
  });
});
