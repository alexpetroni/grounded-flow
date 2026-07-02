import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { AppConfigModule } from './config.module';

// Regression: importing @app/config used to call NestConfigModule.forRoot()
// inside the @Module decorator, validating process.env at import time. In CI
// (no .env) that crashed vitest with an unhandled rejection even though every
// test passed. Validation must only run when forRoot() is called at bootstrap.
describe('AppConfigModule (import-time side effects)', () => {
  it('has empty static module metadata — no eager NestConfigModule.forRoot()', () => {
    expect(Reflect.getMetadata('imports', AppConfigModule) ?? []).toEqual([]);
    expect(Reflect.getMetadata('exports', AppConfigModule) ?? []).toEqual([]);
  });

  describe('forRoot()', () => {
    // forRoot() validates process.env (asynchronously, inside NestConfigModule),
    // so it needs a valid env for the duration of the test file.
    beforeAll(() => {
      vi.stubEnv('DATABASE_URL', 'postgresql://rag:rag@localhost:5432/rag');
      vi.stubEnv('REDIS_URL', 'redis://localhost:6379/0');
      vi.stubEnv('QDRANT_URL', 'http://localhost:6333');
    });
    afterAll(() => {
      vi.unstubAllEnvs();
    });

    it('returns a dynamic module wiring NestConfigModule', () => {
      const dynamic = AppConfigModule.forRoot();
      expect(dynamic.module).toBe(AppConfigModule);
      expect(dynamic.imports).toHaveLength(1);
      expect(dynamic.exports).toHaveLength(1);
    });
  });
});
