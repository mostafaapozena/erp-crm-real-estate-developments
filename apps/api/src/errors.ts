import type { ErrorCode, FieldIssue } from '@alola/contracts';

/**
 * An expected, classified failure. Carries a stable code (PLAT-008) — never user-facing prose; the
 * client localizes the code.
 */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    readonly issues?: FieldIssue[],
    /**
     * Seconds until the caller may retry. Present on a throttled answer, so a client waits the right
     * amount instead of guessing — a 429 with no `Retry-After` invites an immediate retry loop.
     */
    readonly retryAfterSeconds?: number,
  ) {
    super(code);
    this.name = 'AppError';
  }
}
