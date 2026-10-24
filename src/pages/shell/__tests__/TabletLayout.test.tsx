/**
 * sk-285.7 T020 — the TABLET layout: Queues and Projects are slivers,
 * and the persisted desktop widths are neither read nor written.
 *
 * Coverage matrix rows 31 and 44 (US-7, plan decision R10):
 *   31 — "a visit to tablet and a return to desktop does not change the persisted widths"
 *   44 — "in tablet the persisted widths are NOT READ (zones are derived from
 *        the available space)"
 *
 * ── Why "not read" needs its own assertions, next to "not written" ───
 *
 * They are different failures with different symptoms. A mode that READ
 * the persisted widths and clamped them would keep localStorage pristine
 * and still be wrong on screen: a Queues column the user had dragged to
 * 200px on desktop would arrive in tablet as a 200px zone where the
 * design says 44, and a Tasks column at 600 would push Details off the
 * row. A mode that read them and also WROTE the clamped values back
 * would additionally destroy the desktop preference — silently, on a
 * visit the user did not think of as an edit.
 *
 * So the file asserts both halves from the OUTSIDE:
 *   - not read → no zone on screen carries a width that only the
 *     persisted numbers could have produced, and the two navigation
 *     zones are their slivers regardless of what was persisted;
 *   - not written → a byte-for-byte snapshot of every `skein.layout.*`
 *     key across a desktop → tablet → desktop round trip.
 *
 * The snapshot covers the whole `skein.layout.*` namespace rather than
 * just `skein.layout.col.*`: the fold flags of the two navigation
 * columns (`skein.layout.col.projects-collapsed`,
 * `skein.layout.inbox-collapsed`) are the state the tablet mode
 * OVERRIDES, and an implementation that folded them by writing instead
 * of by deriving would pass a widths-only snapshot while quietly
 * rewriting the user's desktop preference.
 */

import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { DESKTOP_MIN_PX, MOBILE_MIN_PX } from '../../../lib/useWidthMode';
import { setViewportWidth } from '../../../test/viewport';

// ─────────────────────────── Mocks ───────────────────────────
//
// The same deterministic layer `Shell.test.tsx` uses: the real layout
// components render, the data hooks answer with fixed, empty-ish data.
// One inbox item is seeded on purpose — an EMPTY active queue trips the
// column's own auto-collapse (Q32), and this file has to be able to tell
// "folded because tablet" from "folded because empty".

vi.mock('../../../auth/AuthContext', () => ({
  useAuthOptional: () => null,
  useAuth: () => ({
    user: {
      id: 'u-1',
      email: 'admin@test.com',
      username: 'admin',
      name: 'Admin',
      role: 'admin',
      createdAt: null,
      lastLoginAt: null,
    },
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

/**
 * A title long enough to be the "very long title" negative path: the
 * layout contract must not depend on what the zones contain, and a
 * content-sized flex basis is exactly how that dependency sneaks in
 * (which is why `.col-details` gets a LENGTH basis in this mode —
 * `flex: 0 1 400px` since sk-285.7.2.77, `flex: 1 1 0%` before it).
 */
const LONG_TITLE = `Very long task title ${'—'.repeat(400)} end`;

vi.mock('../../../lib/useInbox', () => ({
  inboxQueryKey: ['inbox', 'assigned-to-me-unaccepted-open'] as const,
  useInbox: () => ({
    data: {
      items: [
        {
          id: 'sk-1',
          projectId: 'p1',
          parentIdCurrent: null,
          version: 1,
          title: `Very long task title ${'—'.repeat(400)} end`,
          type: 'task',
          priority: 3,
          status: 'open',
          pinned: false,
          componentIds: [],
          labels: [],
          updatedAt: '2026-05-01T10:00:00Z',
          createdAt: '2026-05-01T09:00:00Z',
        },
      ],
      hasMore: false,
      nextCursor: null,
    },
    isLoading: false,
    isError: false,
    isSuccess: true,
    error: null,
  }),
}));

// Deliberately EMPTY — the "empty zones" negative path. A zone with
// nothing in it still has to render its sliver, with its label and its
// zero count, or the tablet mode loses a navigation affordance exactly
// when the user most needs to go somewhere else.
vi.mock('../../../lib/useProjectsList', () => ({
  projectsListQueryKey: ['projects', 'list', 'shell'] as const,
  useProjectsList: () => ({
    data: { items: [], total: 0, hasMore: false, nextCursor: null },
    isLoading: false,
    isError: false,
    isSuccess: true,
    error: null,
  }),
  useProjectsInfinite: () => ({
    items: [],
    total: 0,
    isLoading: false,
    isFetching: false,
    isFetchingNextPage: false,
    isError: false,
    hasNextPage: false,
    fetchNextPage: () => {},
  }),
}));

vi.mock('../../../lib/useNotificationCounts', () => ({
  notificationCountsKey: ['notification-counts'] as const,
  useNotificationCounts: () => ({
    counts: {
      inbox: 0,
      outbox: 0,
      mentions: 0,
      watching: 0,
      onMeOpenCount: 0,
      delegatedOpenCount: 0,
    },
    isLoading: false,
    error: null,
  }),
}));

import { Shell } from '../Shell';

// ─────────────────────────── Harness ───────────────────────────

/**
 * Widths seeded into localStorage before every render.
 *
 * Chosen INSIDE `COL_BOUNDS` but away from the defaults, and different
 * from each other, so a number that leaks onto the screen in tablet mode
 * names the key it came from instead of being explainable as a default.
 */
const SEEDED: Readonly<Record<string, string>> = {
  'skein.layout.col.inbox': '311',
  'skein.layout.col.projects': '277',
  'skein.layout.col.tasks': '523',
};

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return (
    <MantineProvider forceColorScheme="dark">
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/']}>{children}</MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
}

/** Every `skein.layout.*` key currently in storage, as a plain object. */
function layoutStorage(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (key !== null && key.startsWith('skein.layout.')) {
      out[key] = window.localStorage.getItem(key) as string;
    }
  }
  return out;
}

function zone(selector: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(selector);
}

/** Inline pixel width a zone renders, or `null` when it renders none. */
function inlineWidth(selector: string): string | null {
  const el = zone(selector);
  if (el === null) return null;
  return el.style.width === '' ? null : el.style.width;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  for (const [key, value] of Object.entries(SEEDED)) {
    window.localStorage.setItem(key, value);
  }
  setViewportWidth(1440);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-width-mode');
});

// ── Row 44 — in tablet the persist is not read ──────────────────────

describe('T020 / row 44 — tablet derives the zones from the room, not from the persist', () => {
  test('desktop first: the seeded widths ARE what desktop renders', () => {
    // The control. Without it, "the numbers are absent in tablet" could
    // just as well mean the seeding never worked, and every assertion
    // below would be vacuous.
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    expect(inlineWidth('.col-inbox')).toBe('311px');
    expect(inlineWidth('.col-projects')).toBe('277px');
    expect(inlineWidth('.col-tasks')).toBe('523px');
  });

  test('at tablet width no zone carries a persisted number', () => {
    setViewportWidth(1024);
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );

    // The two navigation zones are not sized at all — they are slivers,
    // and the sliver's width is the stylesheet's `--width-sliver`.
    expect(zone('.col-inbox')).toBeNull();
    expect(zone('.col-projects')).toBeNull();
    expect(zone('.col-inbox-collapsed')).not.toBeNull();
    expect(zone('.col-projects-collapsed')).not.toBeNull();

    // Tasks renders, and renders NO pixel width: it takes the row's
    // leftover beside Details.
    const tasks = zone('.col-tasks');
    expect(tasks).not.toBeNull();
    expect(inlineWidth('.col-tasks')).toBeNull();
    expect((tasks as HTMLElement).style.flexGrow).toBe('1');
    expect((tasks as HTMLElement).style.flexBasis).toBe('0%');

    // …and, said once over the whole subtree: none of the seeded numbers
    // reached the DOM by any route.
    const markup = (document.querySelector('.shell-columns') as HTMLElement).outerHTML;
    for (const value of Object.values(SEEDED)) {
      expect(markup, `persisted ${value}px must not appear in tablet`).not.toContain(
        `${value}px`,
      );
    }
  });

  test('the slivers keep their name and their count — including an empty zone', () => {
    // The "empty zones" negative path. `useProjectsList` is mocked empty,
    // so the Projects sliver's count is 0 — and it still has to be there,
    // printed and spoken, or a screen-reader user cannot tell "no
    // projects" from "not loaded".
    setViewportWidth(1024);
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );

    const projects = screen.getByRole('button', { name: /Projects/i });
    expect(projects.className).toContain('col-projects-collapsed');
    expect(projects.getAttribute('aria-expanded')).toBe('false');
    expect(projects.textContent).toContain('0');

    const queues = zone('.col-inbox-collapsed');
    expect(queues).not.toBeNull();
    expect((queues as HTMLElement).getAttribute('aria-label')).toBeTruthy();
    expect((queues as HTMLElement).textContent).toContain('Queues');
  });

  test('no drag handles in tablet — the one writer of the widths is not on screen', () => {
    setViewportWidth(1024);
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    expect(document.querySelectorAll('.resize-handle').length).toBe(0);
  });

  test('a very long title changes nothing about the zone sizing', () => {
    // The layout contract has to be a function of the WINDOW, not of the
    // content. The seeded inbox item's title is ~400 characters; if a
    // zone were sized from its content the assertions below would move.
    setViewportWidth(1024);
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    expect(LONG_TITLE.length).toBeGreaterThan(400);
    expect(inlineWidth('.col-tasks')).toBeNull();
    expect((zone('.col-tasks') as HTMLElement).style.flexBasis).toBe('0%');
    expect(inlineWidth('.col-details')).toBeNull();
  });

  test('both tablet edges behave the same way — the mode is the whole range', () => {
    // The boundary widths, not just a comfortable middle: `MOBILE_MIN_PX`
    // is the first width that is tablet and `DESKTOP_MIN_PX - 1` the
    // last, and a mode implemented against one end only would show up
    // here.
    for (const width of [MOBILE_MIN_PX, DESKTOP_MIN_PX - 1]) {
      setViewportWidth(width);
      const { unmount } = render(
        <Wrapper>
          <Shell />
        </Wrapper>,
      );
      expect(zone('.col-inbox-collapsed'), `${width}px`).not.toBeNull();
      expect(zone('.col-projects-collapsed'), `${width}px`).not.toBeNull();
      expect(inlineWidth('.col-tasks'), `${width}px`).toBeNull();
      unmount();
    }
  });
});

// ── Row 31 — the round trip leaves the persist alone ────────────────

describe('T020 / row 31 — a visit to tablet does not touch the persisted widths', () => {
  test('desktop → tablet → desktop leaves every skein.layout.* key byte-identical', () => {
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    const before = layoutStorage();
    // The seeded keys are actually in the snapshot — otherwise "nothing
    // changed" would be a statement about an empty object.
    for (const key of Object.keys(SEEDED)) expect(before).toHaveProperty(key);

    act(() => setViewportWidth(1024)); // into tablet
    expect(zone('.col-inbox-collapsed')).not.toBeNull();

    act(() => setViewportWidth(1440)); // and back out
    expect(zone('.col-inbox')).not.toBeNull();

    expect(layoutStorage()).toEqual(before);
  });

  test('the desktop widths come back on the way out, unchanged', () => {
    // The other half of "not written": storage being untouched would
    // still be worthless if the RENDER had lost the numbers.
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    act(() => setViewportWidth(1024));
    expect(inlineWidth('.col-tasks')).toBeNull();

    act(() => setViewportWidth(1440));
    expect(inlineWidth('.col-inbox')).toBe('311px');
    expect(inlineWidth('.col-projects')).toBe('277px');
    expect(inlineWidth('.col-tasks')).toBe('523px');
  });

  test('a fold the user made by hand survives the round trip', () => {
    // The tablet mode OVERRIDES the fold flags; it must not write them.
    // A user who folded Projects on desktop has to find it folded on the
    // way back, and one who did not has to find it open — the same flag
    // read twice, not a flag the mode rewrote.
    window.localStorage.setItem('skein.layout.col.projects-collapsed', 'true');
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    expect(zone('.col-projects-collapsed')).not.toBeNull();

    act(() => setViewportWidth(1024));
    act(() => setViewportWidth(1440));

    expect(window.localStorage.getItem('skein.layout.col.projects-collapsed')).toBe('true');
    expect(zone('.col-projects-collapsed')).not.toBeNull();
    // …and the zone the user had left OPEN is open again, which is what
    // proves the override was an override and not an assignment.
    expect(zone('.col-inbox')).not.toBeNull();
  });

  test('the mode can change mid-session without disturbing anything but the layout', () => {
    // "Mode change during interaction": the window moves while the shell
    // is mounted and the user is looking at it. Four crossings in a row,
    // then the same equality — a write that happened on any one of them
    // would show up here.
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    const before = layoutStorage();

    for (const width of [1024, 1440, MOBILE_MIN_PX, DESKTOP_MIN_PX]) {
      act(() => setViewportWidth(width));
    }

    expect(layoutStorage()).toEqual(before);
    expect(inlineWidth('.col-tasks')).toBe('523px'); // ends on desktop
  });
});

// ── Negative: no attribute at all ───────────────────────────────────

describe('T020 — negative paths', () => {
  test('a document with NO data-width-mode still renders the desktop layout', () => {
    // The state before the boot script has run, or after it failed to
    // load. The React side asks `matchMedia`, not the attribute, so a
    // missing attribute cannot make a wide window narrow — and the
    // stylesheet enumerates the two narrow modes rather than negating
    // desktop, so it cannot either. Asserted rather than argued: this is
    // the direction where a wrong answer is a wide window flashing the
    // phone layout.
    document.documentElement.removeAttribute('data-width-mode');
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    expect(inlineWidth('.col-inbox')).toBe('311px');
    expect(zone('.col-inbox-collapsed')).toBeNull();
  });

  test('storage that cannot be read falls back to the defaults, in both modes', () => {
    // The persist is not just "not read" in tablet — it is not read
    // ANYWHERE on this path in a way that could throw. A getItem that
    // raises (private mode) must leave the shell standing.
    // Spied on the PROTOTYPE: jsdom's `localStorage` is a proxy whose own
    // properties are not writable, so assigning `window.localStorage.getItem`
    // silently does nothing and the "blocked storage" case would never
    // actually be entered (observed while writing this file — the desktop
    // assertion below read the seeded 311px back).
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    try {
      setViewportWidth(1024);
      const tablet = render(
        <Wrapper>
          <Shell />
        </Wrapper>,
      );
      expect(zone('.col-inbox-collapsed')).not.toBeNull();
      expect(inlineWidth('.col-tasks')).toBeNull();
      tablet.unmount();

      setViewportWidth(1440);
      render(
        <Wrapper>
          <Shell />
        </Wrapper>,
      );
      expect(inlineWidth('.col-inbox')).toBe('264px'); // COL_BOUNDS default
    } finally {
      spy.mockRestore();
    }
  });
});
