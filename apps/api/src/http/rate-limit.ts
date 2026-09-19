import type { Request, RequestHandler } from 'express';
import { RateLimiterRes, type RateLimiterAbstract } from 'rate-limiter-flexible';
import { AppError } from '../errors';

/**
 * Rate limiting (SEC-003, foundation). The limiter is injected: Redis-backed when Redis is configured
 * (shared across API instances), in-memory otherwise. Stricter per-account limiters for authentication,
 * export, and provider-triggering endpoints use the same middleware with their own key function.
 */
export function rateLimit(
  limiter: RateLimiterAbstract,
  keyOf: (req: Request) => string,
): RequestHandler {
  return async (req, res, next) => {
    try {
      const result = await limiter.consume(keyOf(req));
      res.setHeader('RateLimit-Remaining', String(result.remainingPoints));
      next();
    } catch (error) {
      if (error instanceof RateLimiterRes) {
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil(error.msBeforeNext / 1000))));
        next(new AppError('RATE_LIMITED', 429));
        return;
      }
      next(error);
    }
  };
}
