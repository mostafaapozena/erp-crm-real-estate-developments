import {
  RateLimiterMemory,
  RateLimiterRedis,
  type RateLimiterAbstract,
  type RateLimiterRes,
} from 'rate-limiter-flexible';
import type { Redis } from 'ioredis';

/**
 * Abuse protection for the authentication surface (`SEC-003` applied to `SEC-013`, `SEC-016`, `SEC-017`).
 *
 * Every limiter is **time-bounded**: a counter expires on its own, so no amount of failed attempts can
 * leave an account permanently unusable. Permanent unavailability is an administrative decision
 * (`suspended`, `SEC-019`), never a side effect of a counter store.
 *
 * When Redis is unavailable the in-memory insurance limiter takes over: throttling degrades to
 * per-process instead of disappearing. That is the fail-safe direction — a limiter that opens under
 * pressure is not a limiter.
 */
export interface ThrottleRule {
  points: number;
  durationSeconds: number;
  blockSeconds: number;
}

export const AUTH_THROTTLE_RULES = {
  /**
   * Spray across many accounts from one address. Deliberately generous: a whole branch office behind one
   * NAT shares an address, so a tight limit here would lock out a floor of honest people. Precision is the
   * per-account limiter's job.
   */
  loginByIp: { points: 120, durationSeconds: 900, blockSeconds: 900 },
  /** Guessing one account's password. Triggering this is what "locked out" means. */
  loginByAccount: { points: 8, durationSeconds: 900, blockSeconds: 900 },
  /** Guessing a 6-digit code is only hard if the attempts are few. */
  mfaByAccount: { points: 6, durationSeconds: 300, blockSeconds: 600 },
  /** Reset requests, so the endpoint cannot be used to flood someone or to probe for accounts. */
  passwordResetByIp: { points: 5, durationSeconds: 3600, blockSeconds: 3600 },
  passwordResetByAccount: { points: 5, durationSeconds: 3600, blockSeconds: 3600 },
} as const satisfies Record<string, ThrottleRule>;

export type ThrottleName = keyof typeof AUTH_THROTTLE_RULES;

export class ThrottledError extends Error {
  readonly code = 'RATE_LIMITED';

  constructor(
    readonly retryAfterSeconds: number,
    readonly limiter: ThrottleName,
  ) {
    super('RATE_LIMITED');
    this.name = 'ThrottledError';
  }
}

function build(name: string, rule: ThrottleRule, redis?: Redis): RateLimiterAbstract {
  const options = {
    keyPrefix: `throttle-${name}`,
    points: rule.points,
    duration: rule.durationSeconds,
    blockDuration: rule.blockSeconds,
  };
  const memory = new RateLimiterMemory(options);
  if (!redis) return memory;
  return new RateLimiterRedis({ ...options, storeClient: redis, insuranceLimiter: memory });
}

export class AuthThrottle {
  private readonly limiters: Record<ThrottleName, RateLimiterAbstract>;

  /**
   * `loginByIpPoints` replaces the per-address sign-in budget; configuration validates it (it can
   * only be raised in development and test). Every other rule is fixed.
   */
  constructor(redis?: Redis, overrides: { loginByIpPoints?: number } = {}) {
    this.limiters = {
      loginByIp: build(
        'login-ip',
        {
          ...AUTH_THROTTLE_RULES.loginByIp,
          points: overrides.loginByIpPoints ?? AUTH_THROTTLE_RULES.loginByIp.points,
        },
        redis,
      ),
      loginByAccount: build('login-account', AUTH_THROTTLE_RULES.loginByAccount, redis),
      mfaByAccount: build('mfa-account', AUTH_THROTTLE_RULES.mfaByAccount, redis),
      passwordResetByIp: build('reset-ip', AUTH_THROTTLE_RULES.passwordResetByIp, redis),
      passwordResetByAccount: build(
        'reset-account',
        AUTH_THROTTLE_RULES.passwordResetByAccount,
        redis,
      ),
    };
  }

  /**
   * Consume one attempt. Throws `ThrottledError` when the budget is spent. The error carries the retry
   * delay for the `Retry-After` header and nothing about the configured threshold — a caller learns that
   * it must wait, not how close it got.
   */
  async consume(name: ThrottleName, key: string): Promise<void> {
    try {
      await this.limiters[name].consume(key, 1);
    } catch (error) {
      const result = error as RateLimiterRes;
      if (typeof result?.msBeforeNext !== 'number') throw error;
      throw new ThrottledError(Math.max(1, Math.ceil(result.msBeforeNext / 1000)), name);
    }
  }

  /** True once the key is blocked, i.e. the account is locked out for the block window. */
  async isBlocked(name: ThrottleName, key: string): Promise<boolean> {
    const result = await this.limiters[name].get(key);
    return (result?.remainingPoints ?? 1) <= 0;
  }

  /** Called after a success, so a person who eventually remembers their password is not still blocked. */
  async reset(name: ThrottleName, key: string): Promise<void> {
    await this.limiters[name].delete(key);
  }
}
