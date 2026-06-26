import { describe, it, expect } from 'vitest';
import { ConfigService } from '@nestjs/config';
import type { ExecutionContext } from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard';
import { RateLimitGuard } from './rate-limit.guard';

function configOf(values: Record<string, unknown>): ConfigService {
  return { get: (k: string) => values[k] } as unknown as ConfigService;
}

function ctxWith(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('ApiKeyGuard', () => {
  it('allows all requests when API_KEY is unset', () => {
    const guard = new ApiKeyGuard(configOf({ API_KEY: '' }));
    expect(guard.canActivate(ctxWith({ headers: {} }))).toBe(true);
  });

  it('accepts a matching x-api-key header', () => {
    const guard = new ApiKeyGuard(configOf({ API_KEY: 'secret' }));
    expect(guard.canActivate(ctxWith({ headers: { 'x-api-key': 'secret' } }))).toBe(true);
  });

  it('rejects a missing or wrong key when enabled', () => {
    const guard = new ApiKeyGuard(configOf({ API_KEY: 'secret' }));
    expect(() => guard.canActivate(ctxWith({ headers: {} }))).toThrow();
    expect(() => guard.canActivate(ctxWith({ headers: { 'x-api-key': 'nope' } }))).toThrow();
  });
});

describe('RateLimitGuard', () => {
  it('allows all when RATE_LIMIT_MAX is 0 (disabled)', () => {
    const guard = new RateLimitGuard(configOf({ RATE_LIMIT_MAX: 0 }));
    for (let i = 0; i < 100; i++) {
      expect(guard.canActivate(ctxWith({ ip: '1.1.1.1' }))).toBe(true);
    }
  });

  it('permits up to the limit then throws 429 within the window', () => {
    const clock = 1000;
    const guard = new RateLimitGuard(
      configOf({ RATE_LIMIT_MAX: 2, RATE_LIMIT_WINDOW_MS: 60000 }),
      () => clock,
    );
    const ctx = ctxWith({ ip: '2.2.2.2' });
    expect(guard.canActivate(ctx)).toBe(true);
    expect(guard.canActivate(ctx)).toBe(true);
    expect(() => guard.canActivate(ctx)).toThrow(/Too many requests|429/);
  });

  it('resets after the window elapses', () => {
    let clock = 0;
    const guard = new RateLimitGuard(
      configOf({ RATE_LIMIT_MAX: 1, RATE_LIMIT_WINDOW_MS: 1000 }),
      () => clock,
    );
    const ctx = ctxWith({ ip: '3.3.3.3' });
    expect(guard.canActivate(ctx)).toBe(true);
    expect(() => guard.canActivate(ctx)).toThrow();
    clock = 1001;
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('tracks limits per client IP independently', () => {
    const guard = new RateLimitGuard(configOf({ RATE_LIMIT_MAX: 1, RATE_LIMIT_WINDOW_MS: 60000 }));
    expect(guard.canActivate(ctxWith({ ip: 'a' }))).toBe(true);
    expect(guard.canActivate(ctxWith({ ip: 'b' }))).toBe(true);
    expect(() => guard.canActivate(ctxWith({ ip: 'a' }))).toThrow();
  });
});
