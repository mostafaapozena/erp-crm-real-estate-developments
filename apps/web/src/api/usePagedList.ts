import { useCallback, useMemo, useState } from 'react';
import { ApiError, apiRequest } from './client';
import { useApi, type AsyncState } from './useApi';

/**
 * A keyset-paginated list: the first page through `useApi`, further pages appended on request.
 *
 * The server pages by cursor (stable order, no repeats or skips as records arrive) and reports the
 * scoped `total`, so the footer can say "Showing 50 of 132" truthfully and "Show more" fetches the
 * next page rather than a larger first page. Changing `path` (a filter, a search) starts again.
 */
export interface Page<T> {
  items: T[];
  total?: number;
  nextCursor?: string;
}

export interface PagedList<T> {
  state: AsyncState<Page<T>>;
  items: T[];
  total: number | undefined;
  hasMore: boolean;
  loadingMore: boolean;
  moreError: ApiError | undefined;
  loadMore: () => void;
  reload: () => void;
}

export function usePagedList<T>(path: string | undefined): PagedList<T> {
  const first = useApi<Page<T>>(path);
  const [extra, setExtra] = useState<{ path: string | undefined; items: T[]; cursor?: string }>({
    path: undefined,
    items: [],
  });
  const [loadingMore, setLoadingMore] = useState(false);
  // Remembered with the path it belongs to, so a new filter shows no stale "could not load" line.
  const [failure, setFailure] = useState<{ path: string; error: ApiError } | undefined>();
  const moreError = failure && failure.path === path ? failure.error : undefined;

  const firstPage = first.state.kind === 'ready' ? first.state.data : undefined;
  // Pages appended for a different path, or before a reload, are discarded.
  const appended = extra.path === path && firstPage ? extra : undefined;
  const cursor = appended ? appended.cursor : firstPage?.nextCursor;

  const loadMore = useCallback(() => {
    if (!path || !cursor || loadingMore) return;
    setLoadingMore(true);
    setFailure(undefined);
    const separator = path.includes('?') ? '&' : '?';
    apiRequest<Page<T>>(`${path}${separator}cursor=${encodeURIComponent(cursor)}`)
      .then((page) => {
        setExtra((previous) => ({
          path,
          items: [...(previous.path === path ? previous.items : []), ...page.items],
          ...(page.nextCursor ? { cursor: page.nextCursor } : {}),
        }));
      })
      .catch((error: unknown) => {
        setFailure({
          path,
          error: error instanceof ApiError ? error : new ApiError(0, 'NETWORK_ERROR'),
        });
      })
      .finally(() => setLoadingMore(false));
  }, [cursor, loadingMore, path]);

  const { reload: reloadFirst } = first;
  const reload = useCallback(() => {
    setExtra({ path: undefined, items: [] });
    reloadFirst();
  }, [reloadFirst]);

  const items = useMemo(
    () => (firstPage ? [...firstPage.items, ...(appended?.items ?? [])] : []),
    [appended, firstPage],
  );

  return {
    state: first.state,
    items,
    total: firstPage?.total,
    hasMore: Boolean(cursor),
    loadingMore,
    moreError,
    loadMore,
    reload,
  };
}
