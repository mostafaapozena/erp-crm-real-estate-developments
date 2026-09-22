import type { ErrorCode } from '@alola/contracts';

/**
 * The browser's single door to the API.
 *
 * Three things it deliberately does **not** do:
 *
 * - **Store the access token in `localStorage`.** It lives in a module variable, so it dies with the
 *   tab and is never readable by injected script the way storage is. Session continuity across a
 *   reload comes from the refresh cookie, which is `HttpOnly` and therefore unreadable by any script.
 * - **Decide anything about permissions.** The server owns authorization (ADR-0006); the interface
 *   hides what an actor cannot use, and hiding is a courtesy, not a control.
 * - **Render an error message of its own.** The API returns a stable code and the client localizes it,
 *   so no English string can leak onto an Arabic screen (I18N-008).
 */
let accessToken: string | undefined;

export function setAccessToken(token: string | undefined): void {
  accessToken = token;
}

export function currentAccessToken(): string | undefined {
  return accessToken;
}

/** A failure the interface can act on: a stable code, the correlation id, and the field issues. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK_ERROR',
    readonly correlationId?: string,
    readonly issues?: { path: (string | number)[]; code: string }[],
    readonly retryAfterSeconds?: number,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Set for the refresh call itself, so a failed refresh cannot recurse into another refresh. */
  skipRefresh?: boolean;
}

/** Callers that need to react to the session ending — the shell redirects to the sign-in screen. */
type SessionEndedListener = () => void;
let onSessionEnded: SessionEndedListener | undefined;

export function setSessionEndedListener(listener: SessionEndedListener | undefined): void {
  onSessionEnded = listener;
}

async function parseError(response: Response): Promise<ApiError> {
  const retryAfter = response.headers.get('Retry-After');
  try {
    const body = (await response.json()) as {
      error?: {
        code?: ErrorCode;
        correlationId?: string;
        issues?: { path: (string | number)[]; code: string }[];
      };
    };
    return new ApiError(
      response.status,
      body.error?.code ?? 'INTERNAL_ERROR',
      body.error?.correlationId,
      body.error?.issues,
      retryAfter ? Number(retryAfter) : undefined,
    );
  } catch {
    return new ApiError(response.status, 'INTERNAL_ERROR');
  }
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  return fetch(path, {
    method: options.method ?? 'GET',
    headers,
    // The refresh token is an HttpOnly cookie; it must ride along, and only to our own origin.
    credentials: 'same-origin',
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

/**
 * One request, with a single transparent refresh on a 401.
 *
 * The retry happens once. An access token is short-lived by design (ADR-0023), so the common 401 is
 * simply an expired token and the refresh cookie fixes it without the person noticing. A second 401
 * means the session is genuinely over, and looping would turn that into a request storm.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await send(path, options);
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR');
  }

  if (response.status === 401 && !options.skipRefresh) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      try {
        response = await send(path, options);
      } catch {
        throw new ApiError(0, 'NETWORK_ERROR');
      }
    } else {
      setAccessToken(undefined);
      onSessionEnded?.();
    }
  }

  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function tryRefresh(): Promise<boolean> {
  try {
    const response = await send('/api/v1/auth/refresh', { method: 'POST', skipRefresh: true });
    if (!response.ok) return false;
    const body = (await response.json()) as { accessToken?: string };
    if (!body.accessToken) return false;
    setAccessToken(body.accessToken);
    return true;
  } catch {
    return false;
  }
}

/** Build a query string, omitting empty values so a filter that is not set is simply absent. */
export function query(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}
