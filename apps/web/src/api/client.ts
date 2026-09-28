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
  /** A file sent as-is (an import upload). Mutually exclusive with `body`. */
  file?: Blob;
  /**
   * The declared type of `file`. The server never trusts it — it checks the bytes — but an endpoint
   * that accepts only certain types refuses a mismatch, so a brand image says what it is.
   */
  fileType?: string;
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
  if (options.file !== undefined) {
    headers['Content-Type'] = options.fileType ?? 'application/octet-stream';
  }
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  return fetch(path, {
    method: options.method ?? 'GET',
    headers,
    // The refresh token is an HttpOnly cookie; it must ride along, and only to our own origin.
    credentials: 'same-origin',
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    ...(options.file !== undefined ? { body: options.file } : {}),
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

/**
 * The same request, returning the body as a file rather than JSON — for a download that needs the
 * access token, which a plain link would not carry (an import's issue report).
 */
export async function apiBlob(path: string): Promise<Blob> {
  let response = await send(path, {}).catch(() => {
    throw new ApiError(0, 'NETWORK_ERROR');
  });
  if (response.status === 401 && (await tryRefresh())) {
    response = await send(path, {}).catch(() => {
      throw new ApiError(0, 'NETWORK_ERROR');
    });
  }
  if (!response.ok) throw await parseError(response);
  return response.blob();
}

/**
 * The refresh currently on the wire, shared by every caller that needs one.
 *
 * A refresh token is single-use: the server rotates it and treats a second presentation as theft,
 * revoking the whole session family (SEC-015). Two refreshes started together — React StrictMode runs
 * the session-restoring effect twice in development, and several requests can hit a 401 at the same
 * moment — both carry the **same** cookie, so the second one is indistinguishable from a replay and
 * signs the person out. Sharing one request is the client-side half of rotation; the server's replay
 * detection is unchanged and still fires on a genuine reuse.
 */
let refreshInFlight: Promise<string | undefined> | undefined;

async function performRefresh(): Promise<string | undefined> {
  let response: Response;
  try {
    response = await send('/api/v1/auth/refresh', { method: 'POST', skipRefresh: true });
  } catch {
    return undefined;
  }
  if (!response.ok) return undefined;
  try {
    const body = (await response.json()) as { accessToken?: string };
    return body.accessToken || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Exchange the refresh cookie for a new access token, at most once at a time.
 *
 * Resolves to the new token, or `undefined` when there is no live session. The token is stored before
 * the promise resolves, so every waiter sees it.
 */
export function refreshSession(): Promise<string | undefined> {
  refreshInFlight ??= performRefresh()
    .then((token) => {
      setAccessToken(token);
      return token;
    })
    .finally(() => {
      refreshInFlight = undefined;
    });
  return refreshInFlight;
}

async function tryRefresh(): Promise<boolean> {
  return (await refreshSession()) !== undefined;
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
