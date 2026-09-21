import {
  ERROR_STATUS,
  ErrorCodeSchema,
  type ErrorResponse,
  type FieldIssue,
} from '@alola/contracts';
import type { Logger } from '@alola/security';
import type { ErrorRequestHandler, RequestHandler, Response } from 'express';
import { AppError } from '../errors';
import { correlationIdOf } from './correlation';

function send(res: Response, error: AppError): void {
  if (error.retryAfterSeconds !== undefined) {
    res.setHeader('Retry-After', String(error.retryAfterSeconds));
  }
  const body: ErrorResponse = {
    error: {
      code: error.code,
      correlationId: correlationIdOf(res),
      ...(error.issues ? { issues: error.issues } : {}),
    },
  };
  res.status(error.status).json(body);
}

export function notFound(): RequestHandler {
  return (_req, _res, next) => {
    next(new AppError('NOT_FOUND', 404));
  };
}

/** Body-parser failures arrive as errors with a `type` and `status`. */
function classifyParserError(error: unknown): AppError | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const type = (error as { type?: unknown }).type;
  if (type === 'entity.too.large') return new AppError('PAYLOAD_TOO_LARGE', 413);
  if (typeof type === 'string' && type.startsWith('entity.'))
    return new AppError('MALFORMED_REQUEST', 400);
  if (type === 'charset.unsupported' || type === 'encoding.unsupported') {
    return new AppError('MALFORMED_REQUEST', 400);
  }
  return undefined;
}

/**
 * Domain errors declare the stable code they must be answered with. The classes live in the modules and
 * in `@alola/security`, which cannot import the HTTP layer, so the code on the error is the contract
 * between them. Only codes in the published list are accepted — a Node `ENOENT` or a numeric driver
 * code therefore still falls through to `INTERNAL_ERROR` rather than choosing its own status.
 */
function classifyDomainError(error: unknown): AppError | undefined {
  if (!(error instanceof Error)) return undefined;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== 'string') return undefined;
  const parsed = ErrorCodeSchema.safeParse(code);
  if (!parsed.success) return undefined;
  const issues = (error as { issues?: FieldIssue[] }).issues;
  // A domain error may also state how long to wait; a throttled one always does.
  const retryAfter = (error as { retryAfterSeconds?: unknown }).retryAfterSeconds;
  return new AppError(
    parsed.data,
    ERROR_STATUS[parsed.data],
    issues,
    typeof retryAfter === 'number' ? retryAfter : undefined,
  );
}

/**
 * Centralized error handling (PLAT-008). Expected failures return their stable code. Anything else is
 * logged with its stack and the correlation ID, and the client receives only `INTERNAL_ERROR` — never
 * an exception message, which can contain internal detail.
 */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const known =
      error instanceof AppError
        ? error
        : (classifyParserError(error) ?? classifyDomainError(error));
    if (known) {
      if (known.status >= 500)
        logger.error({ err: error, correlationId: correlationIdOf(res) }, known.code);
      send(res, known);
      return;
    }
    logger.error({ err: error, correlationId: correlationIdOf(res) }, 'Unhandled error');
    send(res, new AppError('INTERNAL_ERROR', 500));
  };
}
