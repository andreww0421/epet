import {
  AuthService,
  type AuthRateLimitPolicy,
} from '../auth';
import type {
  AuthRateLimitResult,
  AuthRateLimitScope,
} from '../contracts';

export const DEFAULT_FORGOT_RESPONSE_FLOOR_MS = 300;

export const AUTH_RATE_LIMIT_POLICIES: Record<
  AuthRateLimitScope,
  AuthRateLimitPolicy
> = {
  login: {
    windowMs: 15 * 60 * 1000,
    maxAttempts: 10,
    blockMs: 15 * 60 * 1000,
  },
  register: {
    windowMs: 60 * 60 * 1000,
    maxAttempts: 5,
    blockMs: 60 * 60 * 1000,
  },
  forgot: {
    windowMs: 15 * 60 * 1000,
    maxAttempts: 5,
    blockMs: 15 * 60 * 1000,
  },
  reset: {
    windowMs: 15 * 60 * 1000,
    maxAttempts: 10,
    blockMs: 15 * 60 * 1000,
  },
  verify: {
    windowMs: 60 * 60 * 1000,
    maxAttempts: 5,
    blockMs: 60 * 60 * 1000,
  },
};

export const AUTH_GLOBAL_RATE_LIMIT_POLICIES: Record<
  AuthRateLimitScope,
  AuthRateLimitPolicy
> = {
  login: {
    windowMs: 15 * 60 * 1000,
    maxAttempts: 30,
    blockMs: 15 * 60 * 1000,
  },
  register: {
    windowMs: 60 * 60 * 1000,
    maxAttempts: 20,
    blockMs: 60 * 60 * 1000,
  },
  forgot: {
    windowMs: 15 * 60 * 1000,
    maxAttempts: 20,
    blockMs: 15 * 60 * 1000,
  },
  reset: {
    windowMs: 15 * 60 * 1000,
    maxAttempts: 30,
    blockMs: 15 * 60 * 1000,
  },
  verify: {
    windowMs: 60 * 60 * 1000,
    maxAttempts: 20,
    blockMs: 60 * 60 * 1000,
  },
};

export const getPlatformClientIdentity = (request: Request) =>
  request.headers.get('cf-connecting-ip');

export const normalizeClientIdentity = (
  value: string | null | undefined,
) => {
  const normalized = value?.trim().slice(0, 256);
  return normalized || 'unknown-client';
};

export const normalizeRateLimitDiscriminator = (value: string) =>
  value.trim().toLocaleLowerCase('en-US').slice(0, 512) || '<empty>';

export const combineRateLimitResults = (
  globalResult: AuthRateLimitResult,
  discriminatorResult: AuthRateLimitResult,
): AuthRateLimitResult => ({
  allowed: globalResult.allowed && discriminatorResult.allowed,
  remaining: Math.min(globalResult.remaining, discriminatorResult.remaining),
  retryAfterMs: Math.max(
    globalResult.retryAfterMs,
    discriminatorResult.retryAfterMs,
  ),
});

export const consumeRequestRateLimit = async (
  authService: AuthService,
  scope: AuthRateLimitScope,
  clientIdentity: string,
  discriminator: string,
) => {
  const normalizedDiscriminator = normalizeRateLimitDiscriminator(discriminator);
  const [globalResult, discriminatorResult] = await Promise.all([
    authService.consumeRateLimit(
      scope,
      `client:${clientIdentity}`,
      AUTH_GLOBAL_RATE_LIMIT_POLICIES[scope],
    ),
    authService.consumeRateLimit(
      scope,
      `subject:${normalizedDiscriminator}`,
      AUTH_RATE_LIMIT_POLICIES[scope],
    ),
  ]);
  return combineRateLimitResults(globalResult, discriminatorResult);
};

export const waitForResponseFloor = async (
  startedAt: number,
  floorMs: number,
) => {
  const remainingMs = floorMs - (performance.now() - startedAt);
  if (remainingMs <= 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, remainingMs));
};
