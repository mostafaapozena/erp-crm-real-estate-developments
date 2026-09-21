import type { Request, Response } from 'express';

/**
 * The refresh-token cookie (`SEC-014`, `SEC-002`).
 *
 * Deliberate properties, each for a stated reason:
 *
 * - `httpOnly` — the refresh token is never readable by page scripts, so an XSS defect cannot walk away
 *   with long-lived access. This is the whole reason it lives in a cookie rather than in a response body.
 *   The *access* token is short-lived and held in memory by the client; that asymmetry is the design
 *   (Master Mapping §6), and neither token is ever placed in `localStorage` or in a URL.
 * - `secure` — set outside development. It is **not** relaxed for staging or production to make local
 *   HTTP convenient; only a development environment gets a cookie without it.
 * - `sameSite: 'strict'` — the browser never sends it on a cross-site request, which removes the CSRF
 *   class for the refresh endpoint outright. The origin guard (`SEC-002`) still applies on top.
 * - `path` — scoped to the authentication routes, so it is not attached to every API call.
 */
export const REFRESH_COOKIE_NAME = 'alola_rt';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

export interface CookiePolicy {
  secure: boolean;
}

/** Development is the only environment that gets a cookie without `Secure`. */
export function cookiePolicyFor(appEnv: string): CookiePolicy {
  return { secure: appEnv !== 'development' && appEnv !== 'test' };
}

export function setRefreshCookie(
  res: Response,
  policy: CookiePolicy,
  token: string,
  maxAgeSeconds: number,
): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: policy.secure,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    maxAge: maxAgeSeconds * 1000,
  });
}

export function clearRefreshCookie(res: Response, policy: CookiePolicy): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: policy.secure,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
  });
}

/**
 * Reads one cookie from the request header. Parsing it here avoids a cookie-parser dependency and, more
 * usefully, means no other value in the header is ever turned into request state.
 */
export function readRefreshCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== REFRESH_COOKIE_NAME) continue;
    const value = part.slice(separator + 1).trim();
    return value.length > 0 ? decodeURIComponent(value) : undefined;
  }
  return undefined;
}

/**
 * A coarse client description for the session list (`SEC-018`): family and platform only. A full user
 * agent is a fingerprint, and storing one would turn a convenience feature into tracking.
 */
export function summarizeClient(userAgent: string | undefined): string | undefined {
  if (!userAgent) return undefined;
  const browser = /\bEdg\//.test(userAgent)
    ? 'Edge'
    : /\bChrome\//.test(userAgent)
      ? 'Chrome'
      : /\bFirefox\//.test(userAgent)
        ? 'Firefox'
        : /\bSafari\//.test(userAgent) && !/\bChrome\//.test(userAgent)
          ? 'Safari'
          : 'Other';
  const platform = /Windows/.test(userAgent)
    ? 'Windows'
    : /Android/.test(userAgent)
      ? 'Android'
      : /iPhone|iPad|iOS/.test(userAgent)
        ? 'iOS'
        : /Mac OS X|Macintosh/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : 'Other';
  return `${browser} on ${platform}`;
}
