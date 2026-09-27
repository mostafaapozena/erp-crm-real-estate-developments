import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, currentAccessToken, refreshSession, setAccessToken } from './client';

/**
 * Refresh is single-flight (SEC-014, SEC-015).
 *
 * A refresh token is single-use, and the server treats a second presentation as theft. These tests pin
 * the client-side half of that contract: however many callers need a refresh at once, one request
 * carries the cookie. The server's replay detection is not weakened — it is simply never provoked by
 * the client's own concurrency.
 */

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(undefined);
});

describe('refreshSession', () => {
  it('shares one request between concurrent callers, as StrictMode double effects do', async () => {
    let release: (value: Response) => void = () => undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const first = refreshSession();
    const second = refreshSession();
    release(jsonResponse(200, { accessToken: 'token-1' }));

    await expect(first).resolves.toBe('token-1');
    await expect(second).resolves.toBe('token-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(currentAccessToken()).toBe('token-1');
  });

  it('starts a fresh request once the previous one has settled', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { accessToken: 'token-1' }))
      .mockResolvedValueOnce(jsonResponse(200, { accessToken: 'token-2' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(refreshSession()).resolves.toBe('token-1');
    await expect(refreshSession()).resolves.toBe('token-2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('resolves to no token and clears the stored one when there is no live session', async () => {
    setAccessToken('stale');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, { error: {} })));
    await expect(refreshSession()).resolves.toBeUndefined();
    expect(currentAccessToken()).toBeUndefined();
  });

  it('resolves to no token on a network failure rather than throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(refreshSession()).resolves.toBeUndefined();
  });
});

describe('apiRequest', () => {
  it('refreshes once for several requests that expire together, then retries each', async () => {
    const calls: string[] = [];
    let refreshed = false;
    vi.stubGlobal(
      'fetch',
      vi.fn((path: string) => {
        calls.push(path);
        if (path === '/api/v1/auth/refresh') {
          refreshed = true;
          return Promise.resolve(jsonResponse(200, { accessToken: 'fresh' }));
        }
        return Promise.resolve(
          refreshed ? jsonResponse(200, { ok: true }) : jsonResponse(401, { error: {} }),
        );
      }),
    );

    await Promise.all([apiRequest('/api/v1/a'), apiRequest('/api/v1/b'), apiRequest('/api/v1/c')]);
    expect(calls.filter((path) => path === '/api/v1/auth/refresh')).toHaveLength(1);
  });
});
