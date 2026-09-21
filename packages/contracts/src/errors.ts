import { z } from 'zod';

/**
 * Stable machine error codes (PLAT-008, I18N-008).
 *
 * The API never returns user-facing prose. It returns one of these codes and the client renders the
 * localized message from the `errors` translation namespace. Adding a code means adding its Arabic and
 * English message in the same change — the i18n key check enforces it.
 */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'MALFORMED_REQUEST',
  'PAYLOAD_TOO_LARGE',
  'UNAUTHENTICATED',
  /** Password accepted, second factor still required or not yet enrolled (SEC-017). */
  'MFA_REQUIRED',
  /** The action needs the credential re-entered, even though the session is valid. */
  'REAUTHENTICATION_REQUIRED',
  'FORBIDDEN',
  'CSRF_REJECTED',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'SERVICE_NOT_CONFIGURED',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;

export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/**
 * The HTTP status each code is answered with. Declared once, so a code cannot mean 403 on one route and
 * 404 on another — which for authorization codes would itself leak policy (SEC-030).
 */
export const ERROR_STATUS: Readonly<Record<ErrorCode, number>> = {
  VALIDATION_FAILED: 400,
  MALFORMED_REQUEST: 400,
  PAYLOAD_TOO_LARGE: 413,
  UNAUTHENTICATED: 401,
  MFA_REQUIRED: 401,
  REAUTHENTICATION_REQUIRED: 403,
  FORBIDDEN: 403,
  CSRF_REJECTED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  SERVICE_NOT_CONFIGURED: 503,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

/** One field-level validation problem. `code` is a machine code; `path` locates the field. */
export const FieldIssueSchema = z.strictObject({
  path: z.array(z.union([z.string(), z.number()])),
  code: z.string(),
});
export type FieldIssue = z.infer<typeof FieldIssueSchema>;

export const ErrorResponseSchema = z.strictObject({
  error: z.strictObject({
    code: ErrorCodeSchema,
    correlationId: z.string(),
    issues: z.array(FieldIssueSchema).optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
