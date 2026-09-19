import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { RequestHandler, Response } from 'express';

/**
 * Correlation IDs (PLAT-007). One ID per request, accepted from a trusted upstream when well-formed,
 * otherwise generated. It is returned in the response header, attached to every log line, and
 * available via `currentCorrelationId()` for audit records, enqueued jobs, and provider calls.
 */
export const CORRELATION_HEADER = 'x-correlation-id';
const WELL_FORMED = /^[A-Za-z0-9_-]{8,128}$/;

interface RequestContext {
  correlationId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function currentCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}

export function correlationIdOf(res: Response): string {
  const value: unknown = res.locals['correlationId'];
  return typeof value === 'string' ? value : 'unknown';
}

export function correlation(): RequestHandler {
  return (req, res, next) => {
    const incoming = req.get(CORRELATION_HEADER);
    // A malformed incoming ID is replaced, not trusted: it would otherwise flow into every log line.
    const correlationId = incoming && WELL_FORMED.test(incoming) ? incoming : randomUUID();
    res.locals['correlationId'] = correlationId;
    res.setHeader(CORRELATION_HEADER, correlationId);
    storage.run({ correlationId }, next);
  };
}
