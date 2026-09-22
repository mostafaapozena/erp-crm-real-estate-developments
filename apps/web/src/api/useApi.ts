import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, apiRequest } from './client';

/**
 * Loading, empty, error and success as **one** state, not four booleans.
 *
 * Four booleans allow states that cannot happen — loading and error at once, data present while
 * loading — and every screen then guards against them slightly differently. A single discriminated
 * value makes the five interface states (`THEME-010`) a `switch`, which is how they end up handled
 * consistently rather than by whoever wrote the screen.
 *
 * There is no cache and no request de-duplication. A demonstration does not need one, and a cache
 * that is wrong about permissions is worse than a refetch: authorization is resolved per request
 * (ADR-0022), so a stale response could show a person data a changed grant has just taken away.
 */
export type AsyncState<T> =
  { kind: 'loading' } | { kind: 'error'; error: ApiError } | { kind: 'ready'; data: T };

export interface UseApiResult<T> {
  state: AsyncState<T>;
  /** Re-run the request. Used by the error state's retry action and after a mutation. */
  reload: () => void;
}

/** What a stored result belongs to. Compared against the current request to derive `loading`. */
interface Settled<T> {
  path: string | undefined;
  attempt: number;
  state: AsyncState<T>;
}

const LOADING = { kind: 'loading' } as const;

/**
 * Fetch `path`, re-fetching whenever it changes or `reload` is called.
 *
 * **Loading is derived, never set.** The stored result remembers which path and attempt produced it,
 * so a request whose result has not arrived is loading by definition rather than by a `setState` at
 * the top of an effect. That keeps one render per state change instead of two, and it makes the
 * "changed path, stale data" window impossible rather than merely short.
 *
 * `path` is `undefined` when the caller has decided not to ask — a screen that omits a request the
 * actor has no permission for. That stays `loading` and never fires, which is what the callers want:
 * a card that is not requested simply never resolves.
 */
export function useApi<T>(path: string | undefined): UseApiResult<T> {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled<T>>({
    path: undefined,
    attempt: -1,
    state: LOADING,
  });

  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const data = await apiRequest<T>(path, { signal: controller.signal });
        if (!controller.signal.aborted)
          setSettled({ path, attempt, state: { kind: 'ready', data } });
      } catch (error) {
        if (controller.signal.aborted) return;
        setSettled({
          path,
          attempt,
          state: {
            kind: 'error',
            error: error instanceof ApiError ? error : new ApiError(0, 'NETWORK_ERROR'),
          },
        });
      }
    })();
    return () => controller.abort();
  }, [path, attempt]);

  const state: AsyncState<T> =
    settled.path === path && settled.attempt === attempt ? settled.state : LOADING;

  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  return useMemo(() => ({ state, reload }), [state, reload]);
}

/**
 * A mutation, with its own in-flight and error state.
 *
 * Deliberately not optimistic. A reservation that appears to succeed and then vanishes is worse than
 * a spinner, and every mutation here changes money or inventory.
 */
export interface UseMutationResult<TInput, TOutput> {
  run: (input: TInput) => Promise<TOutput>;
  pending: boolean;
  error: ApiError | undefined;
  reset: () => void;
}

export function useMutation<TInput, TOutput>(
  request: (input: TInput) => Promise<TOutput>,
): UseMutationResult<TInput, TOutput> {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | undefined>();

  /**
   * The latest closure, updated **after** render rather than during it.
   *
   * Call sites write `useMutation(() => apiRequest(...))`, so the function is a new value every
   * render and capturing it in `useCallback`'s dependencies would give every consumer a new `run` as
   * well. Assigning the ref in an effect keeps `run` stable while still calling the current closure —
   * mutating a ref during render is what React's rules forbid, and for good reason.
   */
  const requestRef = useRef(request);
  useEffect(() => {
    requestRef.current = request;
  });

  const run = useCallback(async (input: TInput) => {
    setPending(true);
    setError(undefined);
    try {
      return await requestRef.current(input);
    } catch (caught) {
      const failure = caught instanceof ApiError ? caught : new ApiError(0, 'NETWORK_ERROR');
      setError(failure);
      throw failure;
    } finally {
      setPending(false);
    }
  }, []);

  const reset = useCallback(() => setError(undefined), []);
  return useMemo(() => ({ run, pending, error, reset }), [error, pending, reset, run]);
}

/**
 * An idempotency key that is stable for the life of a form.
 *
 * Returns a **getter**, called from the submit handler rather than during render. Three properties
 * follow from that shape and all three matter:
 *
 * - `crypto.randomUUID` is impure, so calling it during render would give a value that changes when
 *   the component happens to re-render — at which point it has stopped being an idempotency key.
 * - The key is generated once and kept in a ref, so a double-click, a slow network and a retry all
 *   send the same one and the server records **one** reservation, contract or receipt.
 * - Nothing re-renders to produce it, so there is no first frame where the form cannot be submitted.
 */
export function useIdempotencyKey(prefix: string): () => string {
  const keyRef = useRef<string | undefined>(undefined);
  return useCallback(() => {
    keyRef.current ??= `${prefix}-${crypto.randomUUID()}`;
    return keyRef.current;
  }, [prefix]);
}
