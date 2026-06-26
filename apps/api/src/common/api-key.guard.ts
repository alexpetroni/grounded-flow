import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Env } from '@app/config';

/**
 * Optional API-key guard scaffold. Disabled by default: when `API_KEY` is unset
 * every request passes. When set, requests must send a matching `x-api-key`
 * header. Wired as a global guard so enabling it is a single env change.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Env, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get('API_KEY', { infer: true });
    if (!expected) return true; // guard disabled

    const req = context.switchToHttp().getRequest<Request>();
    const provided = req.headers['x-api-key'];
    if (provided === expected) return true;

    throw new UnauthorizedException('Invalid or missing API key');
  }
}
