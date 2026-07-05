import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import type { Env } from '@app/config';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * Optional API-key guard scaffold. Disabled by default: when `API_KEY` is unset
 * every request passes. When set, requests must send a matching `x-api-key`
 * header. Wired as a global guard so enabling it is a single env change.
 * Routes marked @Public() (health probes) are always exempt.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get('API_KEY', { infer: true });
    if (!expected) return true; // guard disabled

    if (isPublic(this.reflector, context)) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const provided = req.headers['x-api-key'];
    // A duplicated header arrives as string[]; only a single string can match.
    if (typeof provided === 'string' && safeEquals(provided, expected)) return true;

    throw new UnauthorizedException('Invalid or missing API key');
  }
}

export function isPublic(reflector: Reflector, context: ExecutionContext): boolean {
  return (
    reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) === true
  );
}

/** Constant-time comparison — a plain `===` leaks the key prefix via timing. */
function safeEquals(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
