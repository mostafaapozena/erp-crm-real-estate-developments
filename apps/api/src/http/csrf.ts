import type { RequestHandler } from 'express';
import { AppError } from '../errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function originOfReferer(referer: string | undefined): string | undefined {
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}

/**
 * CSRF protection where cookie authentication applies (SEC-002, foundation).
 *
 * A state-changing request that carries cookies must come from an allow-listed origin. Browsers always
 * send `Origin` on cross-origin unsafe requests, and a page on another origin cannot forge it. Requests
 * without cookies (server-to-server, signed webhooks) are not cookie-authenticated and are unaffected.
 *
 * When session cookies are introduced (SEC-014), a double-submit token is added on top of this check.
 */
export function csrfOriginGuard(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method) || !req.headers.cookie) {
      next();
      return;
    }
    const origin = req.get('origin') ?? originOfReferer(req.get('referer'));
    if (!origin || !allowed.has(origin)) {
      next(new AppError('CSRF_REJECTED', 403));
      return;
    }
    next();
  };
}
