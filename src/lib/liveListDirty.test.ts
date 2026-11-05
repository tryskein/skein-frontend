/**
 * sk-763 — the apply of a held list belongs to ONE cache entry.
 *
 * The reference is the sk-763 amendment (`lib/liveListDirty.ts`, module
 * header): the operation belongs to a concrete `Query` of a concrete
 * `QueryClient`; after the list is removed from the cache, or replaced by a
 * new entry of the same key, the old operation brings no data back and
 * touches nothing of the replacement.
 *
 * A real `QueryClient` and a real `InfiniteQueryObserver` run the list; its
 * server is literal — pages written out by hand, answered by cursor.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { InfiniteQueryObserver, QueryClient, type InfiniteData } from '@tanstack/react-query';
import { applyHeldList, mayContinue } from './liveListDirty';

interface Page {
  items: string[];
  nextCursor: string | null;
}

const KEY = ['tasks', 'project', 'p-1', 'list'] as const;
const FIRST = '<first>';

/** The literal server: page by cursor. */
const server: Record<string, Page> = {
  [FIRST]: { items: ['a', 'b'], nextCursor: 'c-b' },
  'c-b': { items: ['c', 'd'], nextCursor: null },
};

let qc: QueryClient;
let reads: Array<string | null>;
let observer: InfiniteQueryObserver<Page, Error, InfiniteData<Page>, typeof KEY, string | null>;
let stop: () => void = () => {};

/** The list as the column observes it: the literal server, one page per cursor. */
function listOptions() {
  return {
    queryKey: KEY,
    initialPageParam: null,
    getNextPageParam: (last: Page) => last.nextCursor,
    queryFn: ({ pageParam }: { pageParam: string | null }) => {
      reads.push(pageParam);
      return Promise.resolve(server[pageParam ?? FIRST]);
    },
  };
}

function observe(): void {
  observer = new InfiniteQueryObserver(qc, listOptions());
  stop = observer.subscribe(() => {});
}

/** Let every pending promise continuation and timer of the client run. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(50);
}

beforeEach(async () => {
  vi.useFakeTimers();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  reads = [];
  observe();
  await settle();
  await observer.fetchNextPage();
  await settle();
  expect(qc.getQueryData<InfiniteData<Page>>(KEY)?.pages.map((p) => p.items)).toEqual([['a', 'b'], ['c', 'd']]);
  reads = [];
});

afterEach(() => {
  stop();
  qc.clear();
  vi.useRealTimers();
});

describe('sk-763 — an apply whose list left the cache does nothing more', () => {
  test.each<[string, (client: QueryClient) => void]>([
    ['the whole cache is cleared', (client) => client.clear()],
    ['the list is removed', (client) => client.removeQueries({ queryKey: KEY, exact: true })],
  ])('%s right after the apply: the list does not come back and is not read', async (_n, leave) => {
    applyHeldList(qc, KEY);
    leave(qc);
    await settle();

    expect(qc.getQueryCache().find({ queryKey: KEY, exact: true })).toBeUndefined();
    expect(reads).toEqual([]);
  });

  test('the list is replaced by a new entry of the same key: the new entry keeps its own data and is not read', async () => {
    const fresh: InfiniteData<Page, string | null> = {
      pages: [{ items: ['x', 'y'], nextCursor: 'c-y' }, { items: ['z'], nextCursor: null }],
      pageParams: [null, 'c-y'],
    };
    applyHeldList(qc, KEY);
    qc.clear();
    qc.setQueryData(KEY, fresh);
    await settle();

    expect(qc.getQueryData<InfiniteData<Page>>(KEY)?.pages.map((p) => p.items)).toEqual([['x', 'y'], ['z']]);
    expect(reads).toEqual([]);
  });
});

// The operation is finite: an apply whose own read is never started (the
// client skips a list whose observer is switched off) is over, with no
// answer — the next page is not held back for a read that will not come.
describe('sk-763 — an apply whose read never starts is over', () => {
  test('the list is switched off when the apply asks for its read: nothing is read, and the next page may be read', async () => {
    observer.setOptions({ ...listOptions(), enabled: false });
    applyHeldList(qc, KEY);
    await settle();

    expect(reads).toEqual([]);
    expect(mayContinue(qc.getQueryCache().find({ queryKey: KEY, exact: true }), false)).toBe(true);
  });
});
