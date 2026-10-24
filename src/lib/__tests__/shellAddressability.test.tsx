/**
 * sk-303.13 (T027, test matrix row 40) — the left column's tab and the
 * lens are addressable, and the ADDRESS is what decides.
 *
 * What this file pins, scenario by scenario:
 *   - every `?tab=` and every `?lens=` value opens the state it names,
 *     on a direct entry and after a reload of the same address;
 *   - back / forward walk the tab and lens history like ordinary
 *     navigation;
 *   - a stored preference that contradicts the address loses — for the
 *     tab, for the lens, and for a stored "column collapsed": a link to
 *     a tab expands the column instead of opening it invisible;
 *   - an address that says nothing still honours the stored preference
 *     (that is what "the address wins" means — not "storage is dead").
 *
 * Everything runs against the real `LayoutProvider` on a real
 * `MemoryRouter`: a stubbed navigate would let the assertions pass
 * without a single URL ever changing, which is precisely the bug class
 * this row exists to catch.
 *
 * Row 41 (`shellUrlState.test.ts`) owns the parameter arithmetic —
 * preserving `?file=`, normalising unknown values, the replace-vs-push
 * distinction. Nothing here duplicates it.
 */

import { beforeEach, describe, expect, test } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { LayoutProvider, useLayoutState } from '../useLayoutState';
import type { InboxTab, Lens } from '../shellUrlState';

const STORAGE = {
  tab: 'skein.layout.inbox-tab',
  collapsed: 'skein.layout.inbox-collapsed',
  onMe: 'skein.layout.onmode',
  delegated: 'skein.outbox-mode',
  budilnik: 'skein.layout.budilnik-mode',
} as const;

/** Live handles to the provider's state and to the router. */
let layout: ReturnType<typeof useLayoutState> | null = null;
let go: ReturnType<typeof useNavigate> | null = null;
/**
 * Every value `unreviewedSelected` has held since the mount, first render
 * included.
 *
 * The end-state handle above cannot answer questions about the FIRST
 * frame, and on this parameter the first frame is the whole point: the
 * Tasks column builds its list request during the render that reads the
 * address, so a selection that is true for one render and corrected by an
 * effect afterwards has already gone out on the wire. An address
 * normalisation is exactly such an effect — it lands after the render it
 * corrects, so asserting only the settled state would call a defect fixed
 * while the request it caused was already in flight.
 */
let selectedFrames: boolean[] = [];

function Probe() {
  layout = useLayoutState();
  go = useNavigate();
  selectedFrames.push(layout.unreviewedSelected);
  const loc = useLocation();
  return <span data-testid="url">{`${loc.pathname}${loc.search}`}</span>;
}

function url(): string {
  return screen.getByTestId('url').textContent ?? '';
}

/**
 * Mounts the provider on the same route shapes the app declares, so
 * `useParams` resolves and a navigation between two of them behaves as
 * it does in production.
 */
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
        <Route path="/issues/:id" element={element} />
        <Route path="/projects/:alias" element={element} />
        <Route path="/projects/:alias/issues/:id" element={element} />
      </Routes>
    </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Which lens the provider currently reports, as a single value. */
function activeLens(): Lens | null {
  if (layout === null) return null;
  if (layout.onMeMode) return 'on-me';
  if (layout.outboxMode) return 'delegated';
  if (layout.budilnikMode) return 'budilnik';
  return null;
}

beforeEach(() => {
  window.localStorage.clear();
  layout = null;
  go = null;
  selectedFrames = [];
  cleanup();
});

describe('T027 — a direct address opens the tab and the lens it names', () => {
  const tabs: InboxTab[] = ['inbox', 'mentions', 'watching'];
  for (const tab of tabs) {
    test(`?tab=${tab} opens the ${tab} tab`, () => {
      mountAt(`/?tab=${tab}`);
      expect(layout!.inboxTab).toBe(tab);
    });
  }

  const lenses: Lens[] = ['on-me', 'delegated', 'budilnik'];
  for (const lens of lenses) {
    test(`?lens=${lens} turns on exactly that lens`, () => {
      mountAt(`/?lens=${lens}`);
      expect(activeLens()).toBe(lens);
      // One parameter, so "two lenses at once" is not expressible: the
      // other two are off by construction, not by a setter's diligence.
      expect(
        [layout!.onMeMode, layout!.outboxMode, layout!.budilnikMode].filter(Boolean).length,
      ).toBe(1);
    });
  }

  test('tab and lens ride the same address together', () => {
    mountAt('/projects/sk/issues/sk-42?tab=mentions&lens=budilnik');
    expect(layout!.inboxTab).toBe('mentions');
    expect(layout!.budilnikMode).toBe(true);
    // …without disturbing the entity selection carried by the path.
    expect(layout!.selectedProject).toBe('sk');
    expect(layout!.selectedIssue).toBe('sk-42');
  });

  test('a reload of the same address reproduces the state', () => {
    const first = mountAt('/?tab=watching&lens=delegated');
    expect(layout!.inboxTab).toBe('watching');
    expect(activeLens()).toBe('delegated');

    // A reload is a fresh mount on the same URL — nothing survives in
    // memory, so this is the honest form of "press F5".
    first.unmount();
    layout = null;
    mountAt('/?tab=watching&lens=delegated');
    expect(layout!.inboxTab).toBe('watching');
    expect(activeLens()).toBe('delegated');
  });
});

describe('T027 — back / forward walk tab and lens history', () => {
  test('switching tabs writes history entries the back button walks', () => {
    mountAt('/?tab=inbox');
    act(() => layout!.setInboxTab('mentions'));
    expect(url()).toBe('/?tab=mentions');
    act(() => layout!.setInboxTab('watching'));
    expect(url()).toBe('/?tab=watching');

    act(() => go!(-1));
    expect(url()).toBe('/?tab=mentions');
    expect(layout!.inboxTab).toBe('mentions');

    act(() => go!(-1));
    expect(url()).toBe('/?tab=inbox');
    expect(layout!.inboxTab).toBe('inbox');

    // …and forward returns to where we came from.
    act(() => go!(1));
    expect(layout!.inboxTab).toBe('mentions');
  });

  test('turning a lens on and off is navigation, not a hidden toggle', () => {
    mountAt('/projects/sk/issues/sk-42');
    expect(activeLens()).toBeNull();

    // ON — the lens is cross-project, so it lands on the all-projects
    // view, and the address names the active lens rather than leaving
    // the user in an unexplained one.
    act(() => layout!.setOnMeMode(true));
    expect(url()).toBe('/?lens=on-me');
    expect(activeLens()).toBe('on-me');

    // Back returns to the issue with no lens.
    act(() => go!(-1));
    expect(url()).toBe('/projects/sk/issues/sk-42');
    expect(activeLens()).toBeNull();

    // Forward re-enters the lens.
    act(() => go!(1));
    expect(activeLens()).toBe('on-me');

    // OFF restores the address the cycle started from.
    act(() => layout!.setOnMeMode(false));
    expect(url()).toBe('/projects/sk/issues/sk-42');
    expect(activeLens()).toBeNull();
  });

  test('switching lens rewrites ?lens= in place', () => {
    mountAt('/?lens=on-me');
    act(() => layout!.setBudilnikMode(true));
    expect(url()).toBe('/?lens=budilnik');
    expect(activeLens()).toBe('budilnik');
  });
});

describe('T027 — the address beats what the browser remembered', () => {
  test('a stored tab cannot override the tab in the address', () => {
    window.localStorage.setItem(STORAGE.tab, 'inbox');
    mountAt('/?tab=watching');
    expect(layout!.inboxTab).toBe('watching');
  });

  test('a stored lens cannot override the lens in the address', () => {
    window.localStorage.setItem(STORAGE.onMe, 'true');
    mountAt('/?lens=budilnik');
    expect(activeLens()).toBe('budilnik');
  });

  test('a stored "collapsed" cannot swallow a link to a tab', () => {
    window.localStorage.setItem(STORAGE.collapsed, 'true');
    mountAt('/?tab=mentions');
    // The link opened the column, it did not open it invisible.
    expect(layout!.inboxCollapsed).toBe(false);
    expect(layout!.inboxTab).toBe('mentions');
  });

  test('storage still answers where the address says nothing', () => {
    window.localStorage.setItem(STORAGE.tab, 'mentions');
    window.localStorage.setItem(STORAGE.budilnik, 'true');
    window.localStorage.setItem(STORAGE.collapsed, 'true');
    mountAt('/');
    expect(layout!.inboxTab).toBe('mentions');
    expect(activeLens()).toBe('budilnik');
    // No tab in the address → nothing overrides the user's own collapse.
    expect(layout!.inboxCollapsed).toBe(true);
  });

  test('a lens taken from storage can still be turned off', () => {
    // Regression: the stored lens used to re-light the lens the instant
    // the (absent) parameter was deleted, making the toggle a no-op.
    window.localStorage.setItem(STORAGE.onMe, 'true');
    mountAt('/');
    expect(activeLens()).toBe('on-me');
    act(() => layout!.setOnMeMode(false));
    expect(activeLens()).toBeNull();
  });

  test('a lens taken from storage still STARTS the cycle when another lens is picked', () => {
    // Regression: "in a lens cycle" is a property of the address. A
    // stored lens leaves the URL silent, so no snapshot was ever taken —
    // treating it as an already-running cycle sent the switch down the
    // in-place branch and pinned `?lens=` to the project path instead of
    // going cross-project (and left the OFF switch with nothing to
    // restore).
    window.localStorage.setItem(STORAGE.onMe, 'true');
    mountAt('/projects/sk/issues/sk-42');
    expect(activeLens()).toBe('on-me');

    act(() => layout!.setBudilnikMode(true));
    expect(url()).toBe('/?lens=budilnik');
    expect(activeLens()).toBe('budilnik');

    // The snapshot the cycle start took is what OFF restores.
    act(() => layout!.setBudilnikMode(false));
    expect(url()).toBe('/projects/sk/issues/sk-42');
    expect(activeLens()).toBeNull();
  });

  test('a stored tab that no longer exists falls back to Inbox', () => {
    window.localStorage.setItem(STORAGE.tab, 'a-tab-that-was-removed');
    mountAt('/');
    expect(layout!.inboxTab).toBe('inbox');
  });
});

describe('T027 — an explicit choice is written back for the next session', () => {
  test('the chosen tab and lens land in storage as the next mount fallback', () => {
    mountAt('/');
    act(() => layout!.setInboxTab('watching'));
    expect(window.localStorage.getItem(STORAGE.tab)).toBe('watching');

    act(() => layout!.setBudilnikMode(true));
    expect(window.localStorage.getItem(STORAGE.budilnik)).toBe('true');
    expect(window.localStorage.getItem(STORAGE.onMe)).toBe('false');
    expect(window.localStorage.getItem(STORAGE.delegated)).toBe('false');
  });
});

// ────── sk-303.14 (T024) — the selection is addressable on the same
//        terms as the lens: carried, dropped, reproducible ──────

describe('T024 — the unreviewed selection lives in the address', () => {
  test('a direct address opens the Delegated surface WITH the selection applied', () => {
    mountAt('/?lens=delegated&select=unreviewed');
    expect(activeLens()).toBe('delegated');
    expect(layout!.unreviewedSelected).toBe(true);
  });

  test('a reload of that address reproduces the selection', () => {
    const first = mountAt('/?lens=delegated&select=unreviewed');
    expect(layout!.unreviewedSelected).toBe(true);
    first.unmount();
    layout = null;
    mountAt('/?lens=delegated&select=unreviewed');
    expect(layout!.unreviewedSelected).toBe(true);
  });

  test('the selection needs its lens: `select` beside another lens narrows nothing', () => {
    // The set exists only on the Delegated surface. Honouring the
    // parameter anywhere else would promise a narrowing the surface
    // underneath cannot perform — so it reads as "no selection", which is
    // what a stale or hand-edited address deserves.
    mountAt('/?lens=on-me&select=unreviewed');
    expect(activeLens()).toBe('on-me');
    expect(layout!.unreviewedSelected).toBe(false);
  });

  test('`select` with no lens at all narrows nothing either', () => {
    mountAt('/?select=unreviewed');
    expect(layout!.unreviewedSelected).toBe(false);
  });

  test('taking the selection lands on ALL projects with the entity selection dropped', () => {
    // SC-017: the jump is to the whole set across every visible project.
    // Starting deep inside one project is the case that proves it — the
    // path has to be rewritten, not merely decorated with a parameter.
    mountAt('/projects/sk/issues/sk-42');
    act(() => layout!.setUnreviewedSelected(true));
    expect(url()).toBe('/?lens=delegated&select=unreviewed');
    expect(layout!.selectedProject).toBeNull();
    expect(layout!.selectedIssue).toBeNull();
    expect(layout!.unreviewedSelected).toBe(true);
  });

  test('taking it with the lens ALREADY open on a project still lands on all projects', () => {
    // No lens edge fires here. An implementation that only decorated the
    // current address would leave the reader inside one project, showing a
    // fraction of the set the chip claims.
    mountAt('/projects/sk?lens=delegated');
    expect(activeLens()).toBe('delegated');
    act(() => layout!.setUnreviewedSelected(true));
    expect(url()).toBe('/?lens=delegated&select=unreviewed');
    expect(layout!.selectedProject).toBeNull();
  });

  test('dropping the selection keeps the lens and stays put', () => {
    mountAt('/?lens=delegated&select=unreviewed');
    act(() => layout!.setUnreviewedSelected(false));
    expect(url()).toBe('/?lens=delegated');
    expect(activeLens()).toBe('delegated');
    expect(layout!.unreviewedSelected).toBe(false);
  });

  test('leaving the lens takes the selection with it', () => {
    // "Cleared on exit": the parameter must not outlive the surface it
    // narrows, or the next entry into the lens would silently arrive
    // pre-selected.
    mountAt('/projects/sk/issues/sk-42');
    act(() => layout!.setUnreviewedSelected(true));
    expect(url()).toBe('/?lens=delegated&select=unreviewed');

    act(() => layout!.setOutboxMode(false));
    // Back to where the cycle started, with neither parameter left behind.
    expect(url()).toBe('/projects/sk/issues/sk-42');
    expect(layout!.unreviewedSelected).toBe(false);
  });

  test('taking the selection INSIDE an open cycle does not move where the cycle returns to', () => {
    // B/1 review W2. The lens cycle keeps ONE snapshot, taken when the
    // cycle starts, and leaving the lens restores it. Taking the selection
    // navigates too — it lands on all projects — but it is a narrowing
    // INSIDE the cycle, not a new entry into one, so it must not overwrite
    // the address the cycle owes the reader on the way out.
    //
    // The existing "leaving the lens takes the selection with it" test
    // cannot see this: it takes the selection from a NON-lens address,
    // where the same call both starts the cycle and takes the selection,
    // so the snapshot is taken either way. Here the cycle is already open
    // when the selection is taken — the only shape where the guard is
    // load-bearing.
    mountAt('/projects/sk/issues/sk-42');
    act(() => layout!.setOutboxMode(true));
    expect(url()).toBe('/?lens=delegated');

    act(() => layout!.setUnreviewedSelected(true));
    expect(url()).toBe('/?lens=delegated&select=unreviewed');

    act(() => layout!.setOutboxMode(false));
    // Back to where the cycle started — not to the cross-project address
    // the selection happened to be taken from.
    expect(url()).toBe('/projects/sk/issues/sk-42');
    expect(layout!.selectedProject).toBe('sk');
    expect(layout!.selectedIssue).toBe('sk-42');
  });

  test('switching to another lens takes the selection with it', () => {
    mountAt('/?lens=delegated&select=unreviewed');
    act(() => layout!.setOnMeMode(true));
    expect(url()).toBe('/?lens=on-me');
    expect(layout!.unreviewedSelected).toBe(false);
  });

  test('the selection survives a path change, like the lens does', () => {
    // Picking a project inside the selection must not silently drop it:
    // the same navigation helpers carry both parameters, and the
    // project-scoped half of the surface applies the same selection.
    mountAt('/?lens=delegated&select=unreviewed');
    act(() => layout!.setSelectedProject('sk'));
    expect(url()).toBe('/projects/sk?lens=delegated&select=unreviewed');
    expect(layout!.unreviewedSelected).toBe(true);
  });

  test('taking and dropping the selection are history entries the back button walks', () => {
    mountAt('/?lens=delegated');
    act(() => layout!.setUnreviewedSelected(true));
    expect(url()).toBe('/?lens=delegated&select=unreviewed');
    act(() => layout!.setUnreviewedSelected(false));
    expect(url()).toBe('/?lens=delegated');

    act(() => go!(-1));
    expect(layout!.unreviewedSelected).toBe(true);
    act(() => go!(1));
    expect(layout!.unreviewedSelected).toBe(false);
  });

  test('an unknown selection value is normalised out of the address', () => {
    mountAt('/?lens=delegated&select=nonsense');
    expect(url()).toBe('/?lens=delegated');
    expect(layout!.unreviewedSelected).toBe(false);
  });

  // ────── B/1 review W1 — the selection has no back door through storage ──
  //
  // The two tests above ("needs its lens", "with no lens at all") only
  // proved the address half, because `beforeEach` wipes localStorage: with
  // nothing stored, "no lens in the address" and "no lens at all" are the
  // same state. They are not the same state for a reader who was last in
  // the Delegated lens — the stored key lights `outboxMode` — and the
  // selection used to be derived from that effective lens. One address,
  // two different surfaces depending on whose browser opened it, which is
  // the opposite of what `?select=` is for.

  test('a STORED Delegated lens does not make a lensless `select` narrow', () => {
    window.localStorage.setItem(STORAGE.delegated, 'true');
    mountAt('/projects/sk?select=unreviewed');

    // The stored lens still answers for the silent address — that part is
    // the lens contract and is unchanged.
    expect(activeLens()).toBe('delegated');
    // The selection does not: it names no lens of its own, and the
    // parameter has no storage fallback by design.
    expect(layout!.unreviewedSelected).toBe(false);
    // …and it was never true, not even for the one render before the
    // address correction lands. Two mechanisms answer this address and
    // only one of them is an effect: the derivation reads the ADDRESSED
    // lens, so the very first frame is already unnarrowed, and the
    // normalisation then cleans the address. Asserting only the settled
    // value would be satisfied by the effect alone — while the Tasks
    // column had already built and sent a narrowed request from the frame
    // before it.
    expect(selectedFrames).not.toContain(true);
    // …and the address is corrected rather than left carrying a parameter
    // the app is not honouring — a link copied out of the bar would
    // otherwise keep promising a narrowing that never happened.
    expect(url()).toBe('/projects/sk');
  });

  test('a stored lens beside `select` does not turn OFF into a navigation', () => {
    // The second half of the same defect. With the selection lit by a
    // stored lens, `setUnreviewedSelected(false)` ran down the "the lens
    // cycle is starting" branch — no `?lens=` in the address to say
    // otherwise — and moved the reader to `/`, breaking this module's own
    // contract: "OFF drops the parameter and leaves the user where they
    // are."
    window.localStorage.setItem(STORAGE.delegated, 'true');
    mountAt('/projects/sk?select=unreviewed');
    expect(layout!.unreviewedSelected).toBe(false);

    act(() => layout!.setUnreviewedSelected(false));

    // Nothing to drop, so nothing moves.
    expect(url()).toBe('/projects/sk');
    expect(layout!.selectedProject).toBe('sk');
  });

  test('the address that DOES name the lens still narrows, stored or not', () => {
    // The guard above must not cost the real thing: a full address works
    // the same whether or not storage agrees with it.
    window.localStorage.setItem(STORAGE.onMe, 'true');
    mountAt('/projects/sk?lens=delegated&select=unreviewed');
    expect(activeLens()).toBe('delegated');
    expect(layout!.unreviewedSelected).toBe(true);
    expect(url()).toBe('/projects/sk?lens=delegated&select=unreviewed');
  });
});
