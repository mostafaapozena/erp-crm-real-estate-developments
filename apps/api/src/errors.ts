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
  ) {
    super(code);
    this.name = 'AppError';
  }
}
