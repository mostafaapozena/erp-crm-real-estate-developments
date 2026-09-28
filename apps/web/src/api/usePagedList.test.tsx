import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePagedList } from './usePagedList';

/**
 * Keyset paging as the lists use it: the first page, then pages appended by cursor, with the
 * server's scoped total reported unchanged — and a changed filter starting again from the top.
 */
const pages: Record<string, unknown> = {
  '/api/v1/items?state=a': { items: [{ id: 1 }, { id: 2 }], total: 3, nextCursor: 'c1' },
  '/api/v1/items?state=a&cursor=c1': { items: [{ id: 3 }], total: 3 },
  '/api/v1/items?state=b': { items: [{ id: 9 }], total: 1 },
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string) => {
      const body = pages[path];
      return Promise.resolve(
        new Response(JSON.stringify(body ?? { error: {} }), {
          status: body ? 200 : 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('usePagedList', () => {
  it('appends the next page by cursor and stops when there is none', async () => {
    const { result } = renderHook(() => usePagedList<{ id: number }>('/api/v1/items?state=a'));
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.total).toBe(3);
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual([1, 2, 3]));
    expect(result.current.hasMore).toBe(false);
    expect(result.current.total).toBe(3);
  });

  it('starts again when the path changes', async () => {
    const { result, rerender } = renderHook(({ path }) => usePagedList<{ id: number }>(path), {
      initialProps: { path: '/api/v1/items?state=a' },
    });
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items).toHaveLength(3));

    rerender({ path: '/api/v1/items?state=b' });
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual([9]));
    expect(result.current.hasMore).toBe(false);
  });
});
