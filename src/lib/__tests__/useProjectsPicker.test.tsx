/**
 * `useProjectsPicker` — the projects an API key's scope may name (US-10).
 *
 * The scope picker offers every active project the owner sees, not the
 * first page of a list that also holds archived ones: the request asks
 * for active projects only, pages on with the server's cursor, passes the
 * search and the space through, and carries no header lens (a key's scope
 * is not a view of the caller's tasks).
 */
import { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const listProjects = vi.hoisted(() => vi.fn());
vi.mock('../../api/projects', () => ({ listProjects }));

import { useProjectsPicker } from '../useProjectsList';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const page = (ids: string[], nextCursor: string | null) => ({
  items: ids.map((id) => ({ id, name: `P ${id}` })),
  total: 3,
  hasMore: nextCursor !== null,
  nextCursor,
});

beforeEach(() => listProjects.mockReset());

describe('useProjectsPicker', () => {
  it('asks for active projects only, with the search and the space, and no lens', async () => {
    listProjects.mockResolvedValue(page(['a'], null));
    const { result } = renderHook(() => useProjectsPicker('  alp ', { space: 'k3x9p2qa' }), { wrapper });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    const params = listProjects.mock.calls[0][0];
    expect(params).toMatchObject({ archived: 'false', q: 'alp', space: 'k3x9p2qa' });
    expect(params.lens).toBeUndefined();
  });

  it('pages on with the server cursor and keeps the earlier pages', async () => {
    listProjects.mockResolvedValueOnce(page(['a', 'b'], 'c-1')).mockResolvedValueOnce(page(['c'], null));
    const { result } = renderHook(() => useProjectsPicker(''), { wrapper });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    act(() => result.current.fetchNextPage());
    await waitFor(() => expect(result.current.items.map((p) => p.id)).toEqual(['a', 'b', 'c']));
    expect(listProjects.mock.calls[1][0].cursor).toBe('c-1');
    expect(result.current.hasNextPage).toBe(false);
  });

  it('asks nothing while disabled', async () => {
    const { result } = renderHook(() => useProjectsPicker('', { enabled: false }), { wrapper });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(listProjects).not.toHaveBeenCalled();
    expect(result.current.items).toEqual([]);
  });
});
