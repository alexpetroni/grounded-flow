import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Env } from '@app/config';
import { isPublic } from './api-key.guard';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Simple in-memory fixed-window rate limiter keyed by client IP. Disabled by
 * default (`RATE_LIMIT_MAX=0`). Intended as a lightweight safety net; a
 * distributed deployment would back this with Redis, but the guard seam stays
 * the same.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweep = 0;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly reflector: Reflector,
    // Not a DI token — @Optional() lets Nest pass undefined so the default applies;
    // tests inject a deterministic clock.
    @Optional() private readonly now: () => number = () => Date.now(),
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const max = this.config.get('RATE_LIMIT_MAX', { infer: true });
    if (!max || max <= 0) return true; // disabled

    // Health probes must never be throttled — a rate-limited liveness check
    // reads as an unhealthy container.
    if (isPublic(this.reflector, context)) return true;

    const windowMs = this.config.get('RATE_LIMIT_WINDOW_MS', { infer: true });
    const req = context.switchToHttp().getRequest<Request>();
    const key = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const now = this.now();

    // Evict expired buckets once per window: one-shot clients (IP rotation)
    // otherwise grow the map without bound.
    if (now - this.lastSweep >= windowMs) {
      this.lastSweep = now;
      for (const [k, b] of this.buckets) {
        if (now >= b.resetAt) this.buckets.delete(k);
      }
    }

    const bucket = this.buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }

    if (bucket.count >= max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      throw new HttpException(
        { message: 'Too many requests', retryAfter },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    bucket.count += 1;
    return true;
  }
}
