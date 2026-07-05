import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Exempts a route/controller from the global ApiKeyGuard and RateLimitGuard.
 * Exists for /health: infrastructure probes (Docker healthcheck, orchestrator
 * liveness) send no credentials, and gating them bricks the container the
 * moment API_KEY is set.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
