import { AsyncLocalStorage } from 'node:async_hooks';
import type { Logger } from '@alola/security';
import type { RequestHandler, Response } from 'express';
import { AppError } from '../errors';
import { correlationIdOf } from './correlation';

/**
 * "Automatic audit on every mutation" as an enforced invariant (AUDIT-003).
 *
 * Remembering to audit is exactly the kind of discipline that decays. So the pipeline counts audit writes
 * per request and refuses to return a successful response for a mutating request that recorded none: the
 * response becomes `500 INTERNAL_ERROR` and the gap is logged loudly. A missed audit therefore shows up as
 * a failing test the first time, instead of as missing evidence months later.
 */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

interface AuditRequestState {
  writes: number;
}

const storage = new AsyncLocalStorage<AuditRequestState>();

export function auditRequestContext(): RequestHandler {
  return (_req, _res, next) => {
    storage.run({ writes: 0 }, next);
  };
}

/** Called by the audit service after every successful append. */
export function noteAuditWrite(): void {
  const state = storage.getStore();
  if (state) state.writes += 1;
}

export function auditWritesInRequest(): number {
  return storage.getStore()?.writes ?? 0;
}

/**
 * Declare that a mutating-method route changes no persistent state, so it needs no audit record. Use it
 * sparingly and deliberately: the flag is the documented exception, and every domain mutation must audit.
 */
export function markAuditExempt(res: Response): void {
  res.locals['auditExempt'] = true;
}

/**
 * Wraps `res.json` so the check runs at the moment of responding — before anything reaches the client.
 * Routes that legitimately mutate nothing (none today) would opt out explicitly via `res.locals`.
 */
export function assertMutationAudited(logger: Logger): RequestHandler {
  return (req, res, next) => {
    if (!MUTATING_METHODS.has(req.method)) {
      next();
      return;
    }
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      const succeeded = res.statusCode >= 200 && res.statusCode < 400;
      const exempt = res.locals['auditExempt'] === true;
      if (succeeded && !exempt && auditWritesInRequest() === 0) {
        logger.error(
          {
            code: 'AUDIT_MISSING_FOR_MUTATION',
            method: req.method,
            route: req.originalUrl.split('?')[0],
            correlationId: correlationIdOf(res as Response),
          },
          'Mutating request produced no audit record; failing the response (AUDIT-003).',
        );
        // Hand control to the error pipeline so the client gets a stable code, not a half-written result.
        res.json = originalJson;
        next(new AppError('INTERNAL_ERROR', 500));
        return res;
      }
      res.json = originalJson;
      return originalJson(body);
    };
    next();
  };
}
