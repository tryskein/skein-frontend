/**
 * sk-303.13 (T025/T026, test matrix row 39) — the Outbox surface is
 * gone, and the two things that had to survive it did.
 *
 * The surface removal has exactly one dangerous failure mode, and it is
 * not "a badge is still on screen" — that would be visible on the first
 * glance at the app. It is the pair of silent ones:
 *
 *   1. a user whose SAVED interface state names the removed tab lands on
 *      an empty screen instead of on Inbox — and the state can be saved
 *      in two independent places (the address and localStorage), so both
 *      routes are pinned here;
 *   2. the global My-assigned lens is removed BY ACCIDENT, because its
 *      internal name is also "outbox". It is a different thing entirely
 *      — a lens over issues, not a queue of notifications — and the root
 *      CLAUDE.md makes keeping it scoping every issue-derived surface a
 *      standing rule.
 *
 * Everything here runs against the real `LayoutProvider` on a real
 * `MemoryRouter`, for the reason row 40's file states: a stubbed
 * navigate would let these assertions pass without a URL ever changing.
 *
 * The column and header rendering side of row 39 lives next to the
 * components it renders (`pages/shell/__tests__/`); this file owns the
 * state layer and the counts DTO.
 */

import { beforeEach, describe, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { LayoutProvider, useLayoutState } from '../useLayoutState';
import { INBOX_TABS, parseTab, normalizeShellSearch } from '../shellUrlState';
import {
  EMPTY_NOTIFICATION_COUNTS,
  type NotificationCounts,
} from '../../api/notification-counts';

const STORAGE_TAB = 'skein.layout.inbox-tab';
const STORAGE_DELEGATED_LENS = 'skein.outbox-mode';

let layout: ReturnType<typeof useLayoutState> | null = null;

function Probe() {
  layout = useLayoutState();
  const loc = useLocation();
  return <span data-testid="url">{`${loc.pathname}${loc.search}`}</span>;
}

function mountAt(entry: string) {
  const element = (
    <LayoutProvider>
      <Probe />
    </LayoutProvider>
  );
  return render(
    <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/" element={element} />
        <Route path="/projects/:alias/issues/:id" element={element} />
      </Routes>
    </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  layout = null;
  cleanup();
});

describe('row 39 — the removed tab is not a tab any more', () => {
  test('the vocabulary of tabs no longer contains it', () => {
    expect([...INBOX_TABS]).toEqual(['inbox', 'mentions', 'watching']);
    // Not merely absent from the list: unparseable, which is what makes
    // every stored copy of it degrade instead of resolve.
    expect(parseTab('outbox')).toBeNull();
  });

  test('a saved ?tab=outbox link opens Inbox, not an empty screen', () => {
    mountAt('/?tab=outbox');
    expect(layout!.inboxTab).toBe('inbox');
  });

  test('…and the address is corrected rather than left lying', () => {
    // The parameter names a tab that cannot be honoured, so it is
    // stripped; everything else on the address survives the correction.
    expect(normalizeShellSearch('?tab=outbox&file=att-1&lens=on-me')).toBe(
      '?file=att-1&lens=on-me',
    );
    mountAt('/?tab=outbox');
    expect(screen.getByTestId('url').textContent).toBe('/');
  });

  test('a stored last-tab of outbox also lands on Inbox', () => {
    // The second, independent copy of "which tab was I on": a user who
    // last used the removed tab and then opens a bare `/`.
    window.localStorage.setItem(STORAGE_TAB, 'outbox');
    mountAt('/');
    expect(layout!.inboxTab).toBe('inbox');
  });

  test('a surviving tab is still restored from storage — the fallback is not dead', () => {
    // Guard against "fix" by ignoring stored state altogether: the
    // removal must cost the removed tab, nothing else.
    window.localStorage.setItem(STORAGE_TAB, 'watching');
    mountAt('/');
    expect(layout!.inboxTab).toBe('watching');
  });
});

describe('row 39 — the global My-assigned lens is a different thing and stays', () => {
  test('?lens=delegated still turns the lens on, alone', () => {
    mountAt('/?lens=delegated');
    expect(layout!.outboxMode).toBe(true);
    expect([layout!.onMeMode, layout!.outboxMode, layout!.budilnikMode].filter(Boolean))
      .toHaveLength(1);
  });

  test('its stored key still seeds it at mount', () => {
    window.localStorage.setItem(STORAGE_DELEGATED_LENS, 'true');
    mountAt('/');
    expect(layout!.outboxMode).toBe(true);
  });

  test('the lens and the removed tab were never the same state', () => {
    // Same word in both storage keys, and this is the case that proves
    // they are unrelated: a stored tab naming the removed queue must not
    // switch the lens on, and a live lens must not resurrect the tab.
    window.localStorage.setItem(STORAGE_TAB, 'outbox');
    window.localStorage.setItem(STORAGE_DELEGATED_LENS, 'true');
    mountAt('/');
    expect(layout!.inboxTab).toBe('inbox');
    expect(layout!.outboxMode).toBe(true);
  });
});

describe('row 39 — the counts DTO survives the field being gone', () => {
  test('the shape carries no outbox bucket', () => {
    // sk-303.14 (T027) — the enumeration grew by the two contract-C2 keys.
    // Kept as a whitelist rather than a `queryBy(outbox) === undefined`:
    // the row is about the header showing what exists, so an unannounced
    // SIXTH bucket has to fail here too.
    expect(Object.keys(EMPTY_NOTIFICATION_COUNTS).sort()).toEqual([
      'delegatedOpenCount',
      'delegatedUnreviewedCount',
      'inbox',
      'mentions',
      'onMeOpenCount',
      'reviewMechanicEnabled',
      'watching',
    ]);
  });

  test('a wire payload without the field yields numbers, not undefined', () => {
    // This is the merge the fetch performs. The point of the assertion
    // is that nothing downstream can render `undefined` / NaN because a
    // field the client once knew is no longer sent.
    //
    // sk-303.14 — the four COUNTERS are still the "never undefined" set and
    // are enumerated by name; the two contract-C2 keys are not counters and
    // are asserted separately below. Iterating `Object.values` and demanding
    // `number` of everything would now be asserting the wrong invariant: the
    // second number's null IS its "no such number" state.
    const wire = { inbox: 3, mentions: 1, watching: 2 };
    const counts: NotificationCounts = { ...EMPTY_NOTIFICATION_COUNTS, ...wire };
    for (const value of [
      counts.inbox,
      counts.mentions,
      counts.watching,
      counts.onMeOpenCount,
      counts.delegatedOpenCount,
    ]) {
      expect(typeof value).toBe('number');
      expect(Number.isNaN(value)).toBe(false);
    }
    expect(counts.watching).toBe(2);
    expect(counts.delegatedOpenCount).toBe(0);
    // An API build that predates contract C2 says nothing about the review
    // mechanic — and "says nothing" must land on OFF, not on a confident
    // zero that would assert "nothing waiting" about an uncounted set.
    expect(counts.reviewMechanicEnabled).toBe(false);
    expect(counts.delegatedUnreviewedCount).toBeNull();
  });
});
