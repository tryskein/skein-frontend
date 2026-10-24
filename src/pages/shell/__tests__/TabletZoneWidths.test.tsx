/**
 * sk-285.7 T020 / coverage row 44 — "in tablet the persisted widths are NOT READ",
 * asserted at the boundary where the reading either happens or does not:
 * the props `Shell.tsx` hands its four zones.
 *
 * ── Why this file exists next to `TabletLayout.test.tsx` ─────────────
 *
 * That file asserts the RENDERED result, and for two of the four zones
 * the rendered result cannot see the difference. Queues and Projects are
 * slivers in tablet, and a sliver draws no width at all — so a `Shell`
 * that read `colWidths.inbox` and handed it over anyway would look
 * identical on screen. Measured, not assumed: replacing
 * `tabletSlivers ? null : colWidths.inbox` with a bare `colWidths.inbox`
 * left all 14 assertions of that file green.
 *
 * A claim nothing can falsify is not a claim. The reading is visible at
 * exactly one place — the value that crosses the prop boundary — so that
 * is where it is pinned. The three column components are replaced with
 * recorders; what they render does not matter here, only what they were
 * given.
 *
 * The seeded widths differ from each other and from the defaults, so a
 * number arriving in tablet names the key it came from rather than being
 * explainable as a fallback.
 */

import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { DESKTOP_MIN_PX, MOBILE_MIN_PX } from '../../../lib/useWidthMode';
import { setViewportWidth } from '../../../test/viewport';

/** Every `width` prop seen this render, by zone. */
const seen: Record<string, Array<number | null>> = {
  inbox: [],
  projects: [],
  tasks: [],
};

vi.mock('../InboxColumn', () => ({
  InboxColumn: ({ width, collapsed }: { width: number | null; collapsed: boolean }) => {
    seen.inbox.push(width);
    return <div data-testid="inbox" data-collapsed={String(collapsed)} />;
  },
}));

vi.mock('../ProjectsColumn', () => ({
  ProjectsColumn: ({ width, collapsed }: { width: number | null; collapsed: boolean }) => {
    seen.projects.push(width);
    return <div data-testid="projects" data-collapsed={String(collapsed)} />;
  },
}));

vi.mock('../TasksColumn', () => ({
  TasksColumn: ({ width }: { width: number | null }) => {
    seen.tasks.push(width);
    return <div data-testid="tasks" />;
  },
}));

vi.mock('../DetailsColumn', () => ({
  DetailsColumn: () => <div data-testid="details" />,
}));

vi.mock('../HeaderBar', () => ({
  HeaderBar: () => <div data-testid="header" />,
}));

// sk-551.5 — Shell reads the signed-in person's pop-up window setting.
// Nobody is signed in here: the setting stays in its factory position (no
// window), which is the layout these width assertions are about.
vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ user: null, isLoading: false, logout: vi.fn() }),
  useAuthOptional: () => null,
}));

import { Shell } from '../Shell';

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

/** The width each zone was handed on the LAST render pass. */
function latest(): Record<string, number | null | undefined> {
  return {
    inbox: seen.inbox.at(-1),
    projects: seen.projects.at(-1),
    tasks: seen.tasks.at(-1),
  };
}

beforeEach(() => {
  seen.inbox = [];
  seen.projects = [];
  seen.tasks = [];
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

describe('T020 / row 44 — what Shell hands each zone, per mode', () => {
  test('desktop hands every zone its persisted width', () => {
    // The control: without it, "null in tablet" could mean the persist
    // was never loaded in the first place.
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    expect(latest()).toEqual({ inbox: 311, projects: 277, tasks: 523 });
  });

  test('tablet hands every zone null — no persisted number crosses the boundary', () => {
    setViewportWidth(1024);
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    expect(latest()).toEqual({ inbox: null, projects: null, tasks: null });

    // Not just the last pass: no render since mount carried a number.
    // A first pass that read the persist and a second that corrected it
    // is still a read, and on a real browser it is also a frame.
    expect([...seen.inbox, ...seen.projects, ...seen.tasks]).toEqual(
      new Array(seen.inbox.length + seen.projects.length + seen.tasks.length).fill(null),
    );
  });

  test('the two navigation zones are folded by derivation, at both tablet edges', () => {
    for (const width of [MOBILE_MIN_PX, DESKTOP_MIN_PX - 1]) {
      setViewportWidth(width);
      const view = render(
        <Wrapper>
          <Shell />
        </Wrapper>,
      );
      expect(
        view.getByTestId('inbox').getAttribute('data-collapsed'),
        `${width}px`,
      ).toBe('true');
      expect(
        view.getByTestId('projects').getAttribute('data-collapsed'),
        `${width}px`,
      ).toBe('true');
      view.unmount();
    }
  });

  test('crossing back to desktop hands the persisted widths over again', () => {
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    act(() => setViewportWidth(1024));
    expect(latest()).toEqual({ inbox: null, projects: null, tasks: null });

    act(() => setViewportWidth(DESKTOP_MIN_PX));
    expect(latest()).toEqual({ inbox: 311, projects: 277, tasks: 523 });

    // …and nothing was rewritten on the way through.
    for (const [key, value] of Object.entries(SEEDED)) {
      expect(window.localStorage.getItem(key)).toBe(value);
    }
  });

  test('mobile hands null too — a phone zone is the screen, not a persisted width', () => {
    // This assertion was written by T020 the other way round («mobile is
    // NOT this task — it still receives the desktop numbers»), precisely
    // so the hand-off would announce itself. T019 landed and it went
    // red, which is what a hand-off pinned in the suite is for.
    //
    // The reasoning is the tablet reasoning taken one step further: a
    // phone zone occupies the whole screen, so a persisted desktop width
    // is not merely unhelpful there, it is a number for a box that does
    // not exist. Reading it would be the same defect in a narrower
    // window.
    setViewportWidth(390);
    render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    expect(latest()).toEqual({ inbox: null, projects: null, tasks: null });

    // …and, as in tablet, nothing was written back on the way in.
    for (const [key, value] of Object.entries(SEEDED)) {
      expect(window.localStorage.getItem(key)).toBe(value);
    }
  });

  test('mobile never folds a zone to a sliver — the strip already does that job', () => {
    // The one place mobile parts company with tablet. A folded zone in
    // tablet is a 44px shortcut standing beside the zones it returns
    // to; on a phone it would be a 44px stripe alone on the screen,
    // under a tab strip that already navigates. So the persisted fold
    // flags — which a phone user never set and cannot see — are not
    // consulted at all.
    window.localStorage.setItem('skein.layout.inbox-collapsed', 'true');
    window.localStorage.setItem('skein.layout.col.projects-collapsed', 'true');
    setViewportWidth(390);
    const view = render(
      <Wrapper>
        <Shell />
      </Wrapper>,
    );
    expect(view.getByTestId('inbox').getAttribute('data-collapsed')).toBe('false');
    expect(view.getByTestId('projects').getAttribute('data-collapsed')).toBe('false');

    // The flags themselves survive untouched, so the desktop preference
    // is still there on the way back out.
    expect(window.localStorage.getItem('skein.layout.inbox-collapsed')).toBe('true');
    expect(window.localStorage.getItem('skein.layout.col.projects-collapsed')).toBe('true');
  });
});
