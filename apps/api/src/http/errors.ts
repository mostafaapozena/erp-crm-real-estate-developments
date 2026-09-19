import type { ErrorResponse } from '@alola/contracts';
import type { Logger } from '@alola/security';
import type { ErrorRequestHandler, RequestHandler, Response } from 'express';
import { AppError } from '../errors';
import { correlationIdOf } from './correlation';

function send(res: Response, error: AppError): void {
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
    const known = error instanceof AppError ? error : classifyParserError(error);
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
