/**
 * sk-285.1.11 — the project hover popup: stacking context and auto-close.
 *
 * The popup stays HOVER-triggered — that is the product decision, not an
 * accident. What was wrong was the mechanics around it:
 *
 *   1. STACKING WAS A RACE. Every popup was portalled straight to
 *      `<body>` with `z-index: 1000` hand-picked to beat the sticky
 *      headers of the day. Any component that later needed a higher
 *      number joined the race. Now there is ONE layer element
 *      (`#skein-floating-layer`) with `isolation: isolate`: popups stack
 *      against each other inside it, and the group is ordered against the
 *      app exactly once, by `--z-floating`.
 *
 *   2. THE POPUP WAS A HIT TARGET. The Projects column's right edge is
 *      the Tasks column's left edge, so a project row's popup lands on
 *      the Tasks filter bar — the Cards / Tree view toggle. While the
 *      popup was open (a focus-opened one stays open with the pointer
 *      free to be anywhere) it swallowed the clicks aimed at that toggle.
 *      The layer and the popup are `pointer-events: none`: the popup is a
 *      description of what the pointer is on, never something the pointer
 *      can hit.
 *
 *   3. AUTO-CLOSE HAD HOLES. `mouseleave` and Escape both need an event
 *      the pointer generates against the anchor. When the pointer leaves
 *      the WINDOW, when the tab loses focus, or when the anchor is
 *      scrolled/folded out from under a motionless pointer, no such event
 *      arrives and the popup stayed on screen. Each of those now closes.
 *
 *   4. IT GREW UPWARD OVER THE TOGGLE. A centred `right` placement puts
 *      half the popup ABOVE its row, so rows near the top of the list
 *      reached up over the Tasks filter bar. `right-start` top-aligns it:
 *      the popup can only grow downward from the row it describes.
 *
 * Anything geometric (which pixels overlap what) is not observable in
 * jsdom; the placement alignment is pinned on the rendered node.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';

import type { ProjectListItem } from '../../../api/projects';
import { LayoutProvider } from '../../../lib/useLayoutState';
import { ProjectRow } from '../ProjectRow';
import { FLOATING_LAYER_ID, SkeinTooltip } from '../../../components/SkeinTooltip';

/* The popup's background `getProject` call is irrelevant here — the first
   paint renders from the lean list item, which is the point of it. */
vi.mock('../../../api/projects', async (importOriginal) => {
  const actual = await (importOriginal() as Promise<Record<string, unknown>>);
  return {
    ...actual,
    getProject: vi.fn(() => new Promise(() => {})),
  };
});

const PROJECT: ProjectListItem = {
  id: 'proj-uuid-1',
  name: 'Storefront',
  idPrefix: 'shop',
  defaultIdMode: 'counter',
  description: '',
  createdAt: '2026-06-01T00:00:00Z',
  updatedAt: '2026-06-01T00:00:00Z',
  openCount: 3,
  inProgressCount: 1,
  blockedCount: 0,
  myOutboxOpenCount: 0,
  myOutboxInProgressCount: 0,
  myOutboxBlockedCount: 0,
};

function renderRow() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MantineProvider forceColorScheme="dark">
        <QueryClientProvider client={qc}>
          <MemoryRouter initialEntries={['/']}>
            <Routes>
              <Route path="/" element={<LayoutProvider>{children}</LayoutProvider>} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </MantineProvider>
    );
  }
  return render(
    <Wrapper>
      <ProjectRow
        project={PROJECT}
        selected={false}
        searchQuery=""
        onSelect={() => {}}
        collapsed={false}
        onToggleCollapsed={() => {}}
      />
    </Wrapper>,
  );
}

// sk-551.15 — the popup's anchor is the row's ⓘ now, not the whole row
// (owner: the row popped a large card on every pass of the mouse). Every
// behaviour below is the same contract on the new anchor.
const rowBody = () =>
  screen.getByRole('button', { name: /Select project Storefront/ });
const infoButton = () => screen.getByLabelText(/About Storefront/);
const popup = () => document.querySelector('.skein-tooltip');

async function openPopup() {
  renderRow();
  const user = userEvent.setup();
  await user.hover(infoButton());
  await waitFor(() => expect(popup()).toBeTruthy());
  return user;
}

afterEach(() => {
  cleanup();
  // The layer outlives React (it is created outside the render tree), so
  // leftovers from one test must not be read as another test's popup.
  document.getElementById(FLOATING_LAYER_ID)?.replaceChildren();
  // The one test below hands Floating UI a laid-out viewport by defining
  // these on `documentElement`. Taken down HERE and not at the end of
  // that test: a failure before its last line would otherwise leave a
  // 1024px viewport standing for the whole file, and the environment's
  // own width (`src/test/viewport.ts`, 1440) does not own this pair —
  // nothing would notice the disagreement.
  Reflect.deleteProperty(document.documentElement, 'clientWidth');
  Reflect.deleteProperty(document.documentElement, 'clientHeight');
});

describe('sk-285.1.11 — project hover popup behaviour', () => {
  test('sk-551.15 — hovering the row itself opens nothing', async () => {
    renderRow();
    const user = userEvent.setup();
    await user.hover(rowBody());
    // Give a would-be popup the same chance the opening tests give it.
    await new Promise((r) => setTimeout(r, 50));
    expect(popup()).toBeNull();
  });

  test('hover opens the popup, and hover is still the trigger', async () => {
    renderRow();
    // Nothing on screen until the pointer arrives.
    expect(popup()).toBeNull();
    cleanup();

    await openPopup();

    // Rendered from the lean list item — no waiting on the detail query.
    // sk-551.15 — the compact card: the name and the counts line; the id
    // prefix is no longer repeated (the row already shows it).
    expect(popup()!.textContent).toContain('Storefront');
    expect(popup()!.querySelector('.project-tooltip-line')).toBeTruthy();
  });

  test('the popup closes when the pointer leaves its anchor', async () => {
    const user = await openPopup();
    await user.unhover(infoButton());
    await waitFor(() => expect(popup()).toBeNull());
  });

  test('Escape closes the popup', async () => {
    const user = await openPopup();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(popup()).toBeNull());
  });

  // sk-551.8 D1 — reference — the lead's decision on D1: by default the tooltip
  // swallows the Esc that closed it (it does not reach window), the
  // `escapePassesThrough` option lets it through — to the shell's Esc
  // (`DetailsColumn` closes the open task on the window-level Esc).
  test.each([
    { escapePassesThrough: undefined, reachesWindow: false },
    { escapePassesThrough: true, reachesWindow: true },
  ])(
    'sk-551.8 D1 — Escape closes the tooltip; escapePassesThrough=$escapePassesThrough → reaches window: $reachesWindow',
    async ({ escapePassesThrough, reachesWindow }) => {
      const windowEsc = vi.fn();
      window.addEventListener('keydown', windowEsc);
      try {
        render(
          <SkeinTooltip content="Hint" escapePassesThrough={escapePassesThrough}>
            <button type="button">Anchor</button>
          </SkeinTooltip>,
        );
        const user = userEvent.setup();
        await user.hover(screen.getByRole('button', { name: 'Anchor' }));
        await waitFor(() => expect(popup()).toBeTruthy());

        await user.keyboard('{Escape}');

        await waitFor(() => expect(popup()).toBeNull());
        expect(windowEsc.mock.calls.length).toBe(reachesWindow ? 1 : 0);
      } finally {
        window.removeEventListener('keydown', windowEsc);
      }
    },
  );

  test('the popup closes when the pointer leaves the window entirely', async () => {
    await openPopup();
    // A move out of the top edge of the window onto browser chrome: the
    // anchor gets no `mouseleave`, the document does.
    fireEvent.mouseLeave(document.documentElement);
    await waitFor(() => expect(popup()).toBeNull());
  });

  test('the popup closes when the window loses focus', async () => {
    await openPopup();
    fireEvent.blur(window);
    await waitFor(() => expect(popup()).toBeNull());
  });

  test('the popup closes when the tab is hidden', async () => {
    await openPopup();
    const spy = vi
      .spyOn(document, 'visibilityState', 'get')
      .mockReturnValue('hidden');
    fireEvent(document, new Event('visibilitychange'));
    await waitFor(() => expect(popup()).toBeNull());
    spy.mockRestore();
  });

  test('the popup closes when its anchor is scrolled out of the column', async () => {
    // jsdom has no layout: every rect is 0×0 and the viewport measures 0
    // wide, which makes "is the anchor clipped?" answerable only if we
    // hand the geometry over by hand. So this test supplies exactly two
    // facts Floating UI reads — a viewport, and the anchor's box — and
    // then moves the anchor out of that viewport. The teardown is in the
    // file-level `afterEach`, so a failure below cannot leave the
    // viewport standing for the rest of the file.
    const viewport = (prop: 'clientWidth' | 'clientHeight', value: number) =>
      Object.defineProperty(document.documentElement, prop, {
        configurable: true,
        get: () => value,
      });
    viewport('clientWidth', 1024);
    viewport('clientHeight', 768);
    const boxAt = (top: number) =>
      ({
        x: 0,
        y: top,
        top,
        bottom: top + 20,
        left: 0,
        right: 200,
        width: 200,
        height: 20,
        toJSON() {},
      }) as DOMRect;

    renderRow();
    const anchor = infoButton();
    anchor.getBoundingClientRect = () => boxAt(100);

    const user = userEvent.setup();
    await user.hover(anchor);
    await waitFor(() => expect(popup()).toBeTruthy());

    // The pointer never moves: the LIST moves under it. No `mouseleave`
    // is dispatched for that, and Floating UI's own scroll-close path
    // only runs for tooltips configured with a close handler (a 0-delay
    // tooltip has none) — so the popup used to stay pinned to an anchor
    // that had left the screen. `hide()` reports the anchor as clipped
    // and the popup closes itself.
    anchor.getBoundingClientRect = () => boxAt(-500);
    fireEvent.scroll(window);

    await waitFor(() => expect(popup()).toBeNull());
  });

  test('the popup renders inside the single isolated floating layer', async () => {
    await openPopup();

    const layers = document.querySelectorAll(`#${FLOATING_LAYER_ID}`);
    // One layer for the whole app — the isolation only means something if
    // there is exactly one stacking context to isolate into.
    expect(layers.length).toBe(1);
    expect(layers[0].contains(popup())).toBe(true);
  });

  test('the popup is top-aligned to its row, never centred on it', async () => {
    await openPopup();
    // jsdom has no layout, so Floating UI resolves a degenerate side here
    // (every rect is 0×0) — but the ALIGNMENT is ours, and it survives a
    // flip. `-start` is what keeps the popup from reaching up over the
    // Tasks-column view toggle; a centred `right` would resolve without
    // any alignment suffix at all.
    expect(popup()!.getAttribute('data-placement')).toMatch(/-start$/);
  });
});
