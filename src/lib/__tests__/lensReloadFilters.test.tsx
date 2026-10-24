/**
 * sk-46 — reload-mid-lens must NOT clobber the user's persisted filter
 * preferences.
 *
 * Regression: the On-me / Delegated lenses (sk-30) used to apply their
 * preset (status='active', type='all', origin='human-driven') by writing
 * the PERSISTED filter setters in `useTasksUiState` through an imperative
 * bridge. Those setters write-through to localStorage. So flipping a lens
 * ON overwrote the user's real prefs in storage, and the only restore
 * path was an in-memory snapshot that a page reload dropped — leaving the
 * preset stuck in localStorage forever.
 *
 * Fix (mirrors sk-44.4 search): the lens preset is now an EPHEMERAL
 * OVERLAY derived in `useTaskSearchModes`. The persisted state is never
 * touched. This test pins the contract at the real provider boundary
 * (the same `LayoutProvider` > `TasksUiStateProvider` stack the Shell
 * mounts):
 *
 *   1. The user's prefs (open / bug / human-driven) live in localStorage.
 *   2. Flipping a lens ON does NOT mutate those localStorage keys.
 *   3. A reload (provider remount) while the lens flag is still set in
 *      localStorage re-reads the ORIGINAL prefs — they were never
 *      overwritten.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { LayoutProvider, useLayoutState } from '../useLayoutState';
import { TasksUiStateProvider, useTasksUiState } from '../useTasksUiState';

// The lens cycle navigates via useNavigate. Since sk-303.13 (T027) the
// lens is READ BACK from `?lens=` in the address, so the navigation has
// to actually happen — a stubbed navigate would leave the hook
// reporting "no lens" and this test would assert nothing. The spy
// records the call and forwards to the real router (the memory history
// stays on the "/" route the stack is mounted at).
const navigateSpy = vi.fn();
vi.mock('react-router-dom', async (importActual) => {
  const actual = await importActual<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => {
      const real = actual.useNavigate();
      return (...args: Parameters<typeof real>) => {
        navigateSpy(...args);
        return real(...args);
      };
    },
  };
});

const STORAGE = {
  status: 'skein.tasks.statusFilter',
  origin: 'skein.tasks.originFilter',
  type: 'skein.tasks.typeFilter',
} as const;

let layout: ReturnType<typeof useLayoutState> | null = null;
let ui: ReturnType<typeof useTasksUiState> | null = null;

function Probe() {
  layout = useLayoutState();
  ui = useTasksUiState();
  return null;
}

/**
 * Mounts the real Shell provider stack (LayoutProvider outer,
 * TasksUiStateProvider inner — same nesting as Shell.tsx) on the "/"
 * route. A fresh mount re-reads localStorage exactly like a reload.
 */
function mountShellStack() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route
          path="/"
          element={
            <LayoutProvider>
              <TasksUiStateProvider>
                <Probe />
              </TasksUiStateProvider>
            </LayoutProvider>
          }
        />
      </Routes>
    </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  navigateSpy.mockReset();
  // Seed the user's REAL filter preferences into storage.
  window.localStorage.setItem(STORAGE.status, 'open');
  window.localStorage.setItem(STORAGE.type, 'bug');
  window.localStorage.setItem(STORAGE.origin, 'human-driven');
});

afterEach(() => {
  cleanup();
  layout = null;
  ui = null;
  vi.restoreAllMocks();
});

describe('sk-46 — reload mid-lens preserves persisted filter prefs', () => {
  test('flipping a lens ON does not overwrite the persisted filter localStorage keys', () => {
    mountShellStack();

    // Prefs read back from storage on mount.
    expect(ui!.statusFilter).toBe('open');
    expect(ui!.typeFilter).toBe('bug');
    expect(ui!.originFilter).toBe('human-driven');

    // Turn the On-me lens ON — this used to push the preset through the
    // persisted setters (write-through). It must not anymore.
    act(() => layout!.setOnMeMode(true));
    expect(layout!.onMeMode).toBe(true);

    // The persisted UI state is untouched...
    expect(ui!.statusFilter).toBe('open');
    expect(ui!.typeFilter).toBe('bug');
    expect(ui!.originFilter).toBe('human-driven');
    // ...and so are the underlying localStorage keys (the bug was the
    // preset 'active'/'all'/'human-driven' landing here permanently).
    expect(window.localStorage.getItem(STORAGE.status)).toBe('open');
    expect(window.localStorage.getItem(STORAGE.type)).toBe('bug');
    expect(window.localStorage.getItem(STORAGE.origin)).toBe('human-driven');
  });

  test('reload (remount) while lens is active re-reads the ORIGINAL prefs', () => {
    const first = mountShellStack();

    // Enter the lens, then simulate a page reload by unmounting and
    // remounting the whole provider stack. The lens flag persists in
    // localStorage (skein.layout.onmode), the snapshot does not — exactly
    // the reload-mid-lens scenario that used to leave the preset stuck.
    act(() => layout!.setOnMeMode(true));
    expect(window.localStorage.getItem('skein.layout.onmode')).toBe('true');
    first.unmount();
    layout = null;
    ui = null;

    mountShellStack();

    // Reload re-arms the lens from storage...
    expect(layout!.onMeMode).toBe(true);
    // ...but the user's filter prefs are intact — NOT the lens preset.
    // Pre-fix this read back as active/all/human-driven (the preset that
    // had been written through on lens-on).
    expect(ui!.statusFilter).toBe('open');
    expect(ui!.typeFilter).toBe('bug');
    expect(ui!.originFilter).toBe('human-driven');
  });

  test('lens OFF after a reload leaves prefs at their original values', () => {
    const first = mountShellStack();
    act(() => layout!.setOnMeMode(true));
    first.unmount();
    layout = null;
    ui = null;

    // Reload mid-lens.
    mountShellStack();
    expect(layout!.onMeMode).toBe(true);

    // Now turn the lens OFF. Without a persisted-filter snapshot to
    // restore, the prefs simply stay where they always were.
    act(() => layout!.setOnMeMode(false));
    expect(layout!.onMeMode).toBe(false);
    expect(ui!.statusFilter).toBe('open');
    expect(ui!.typeFilter).toBe('bug');
    expect(ui!.originFilter).toBe('human-driven');
    expect(window.localStorage.getItem(STORAGE.status)).toBe('open');
  });
});

// ────── sk-303.14 (T024, row 90) — the jump to the unreviewed set does
//        not write to the filter store either ──────
//
// This file's subject is the STORE, and the row belongs here for that
// reason. The entry normalises the filters the QUERY is built from — it
// has to, or the first frame comes back narrower than the count it must
// match — and the two statements do not contradict each other: the
// normalisation is a derivation, and a derivation writes nothing. The
// distinction is precisely what sk-46 established, and precisely what the
// entry could quietly undo by "just setting the filters" on the way in.

describe('sk-303.14 — the unreviewed entry leaves the persisted prefs alone', () => {
  test('taking the selection writes no filter key', () => {
    mountShellStack();
    expect(ui!.statusFilter).toBe('open');

    act(() => layout!.setUnreviewedSelected(true));
    expect(layout!.unreviewedSelected).toBe(true);

    // Neither the in-memory prefs…
    expect(ui!.statusFilter).toBe('open');
    expect(ui!.typeFilter).toBe('bug');
    expect(ui!.originFilter).toBe('human-driven');
    // …nor the storage behind them. In particular the sentinel itself is
    // nowhere near this key: it lives in the address.
    expect(window.localStorage.getItem(STORAGE.status)).toBe('open');
    expect(window.localStorage.getItem(STORAGE.type)).toBe('bug');
    expect(window.localStorage.getItem(STORAGE.origin)).toBe('human-driven');
  });

  test('a reload while selected still reads back the ORIGINAL prefs', () => {
    const first = mountShellStack();
    act(() => layout!.setUnreviewedSelected(true));
    first.unmount();
    layout = null;
    ui = null;

    mountShellStack();
    expect(ui!.statusFilter).toBe('open');
    expect(ui!.typeFilter).toBe('bug');
    expect(ui!.originFilter).toBe('human-driven');
    // The sentinel cannot come back from storage — it was never put there,
    // and the whitelist would refuse it if it had been.
    expect(window.localStorage.getItem(STORAGE.status)).toBe('open');
  });
});

// ────── sk-303.14 (T024, row 89) — the entry also drops the narrowings
//        that are NOT filters ──────
//
// B/1 review W1/W2. Row 89 and the T024 gate name the assignee pick and
// the rooted-subtree anchor by name, and the product code drops both — but
// nothing asserted it, and both mutations (delete the two lines that clear
// them) survived the entire suite.
//
// Why the e2e test could not see them. The assignee pick: its surviving
// effect is a CLIENT-side post-filter, and the fixture gives the row
// before the jump and the row after it the same assignee, so a filter left
// standing cuts nothing. The anchor: no test ever sets one before jumping,
// and this one is not just another filter — `anchored` takes render
// priority over the whole column body, so an anchor left standing replaces
// the first frame outright with somebody else's rooted subtree.
//
// Both are in-memory state of THIS provider, so the statement belongs at
// this boundary, where it is a direct read rather than an inference from
// what the wire happened to carry.

describe('sk-303.14 — the unreviewed entry drops the in-memory narrowings', () => {
  test('an assignee pick and a rooted-subtree anchor are both released', () => {
    mountShellStack();

    act(() => ui!.setAssigneeFilter('bob'));
    act(() => ui!.setTreeRootAnchor({ id: 'sk-9', projectId: 'proj-uuid-test' }));
    act(() => ui!.setSearch('leftover'));
    // Pre-condition, asserted rather than assumed: all three really are
    // narrowing before the jump. Without this the test would pass on a
    // build where the setters no-op — proving nothing about the entry.
    expect(ui!.assigneeFilter).toBe('bob');
    expect(ui!.treeRootAnchor).not.toBeNull();
    expect(ui!.search).toBe('leftover');

    act(() => layout!.setUnreviewedSelected(true));
    expect(layout!.unreviewedSelected).toBe(true);

    expect(ui!.assigneeFilter).toBeNull();
    expect(ui!.treeRootAnchor).toBeNull();
    expect(ui!.search).toBe('');
  });

  test('leaving the selection puts none of them back', () => {
    // The entry is a normalisation, not a snapshot: nothing was stashed, so
    // nothing is restored. Asserting it keeps a future "helpful" restore
    // from re-narrowing a surface the reader has already been shown wide.
    mountShellStack();
    act(() => ui!.setAssigneeFilter('bob'));
    act(() => layout!.setUnreviewedSelected(true));
    expect(ui!.assigneeFilter).toBeNull();

    act(() => layout!.setUnreviewedSelected(false));
    expect(layout!.unreviewedSelected).toBe(false);
    expect(ui!.assigneeFilter).toBeNull();
    expect(ui!.treeRootAnchor).toBeNull();
  });
});

// ────── sk-303.14 (B/1 review C1) — the selection and a non-empty search
//        box cannot both be on ──────
//
// The end-to-end proof lives in `unreviewedEntry.test.tsx` (jump → pick a
// project → type). This is the same rule read at the provider boundary,
// where it is one statement about state rather than a sequence of
// gestures: typing releases the selection; clearing the box does not take
// it back.

describe('sk-303.14 — typing releases the unreviewed selection', () => {
  test('a non-empty search drops the selection; an empty one leaves it alone', () => {
    mountShellStack();
    act(() => layout!.setUnreviewedSelected(true));
    expect(layout!.unreviewedSelected).toBe(true);

    // Clearing an already-empty box is not "typing" and must not release
    // anything — the entry itself writes '' through this same setter.
    act(() => ui!.setSearch(''));
    expect(layout!.unreviewedSelected).toBe(true);

    act(() => ui!.setSearch('auth'));
    expect(layout!.unreviewedSelected).toBe(false);
    // The search won the tie — it is not dropped along with the selection.
    expect(ui!.search).toBe('auth');

    // And emptying the box afterwards does NOT bring the selection back:
    // it was released, not suspended.
    act(() => ui!.setSearch(''));
    expect(layout!.unreviewedSelected).toBe(false);
  });
});

// sk-303.14 (T025, row 93) — the store refuses the sentinel outright.
//
// The chips route it to the address instead of here, so this path should
// never be taken. It is guarded anyway because "the sentinel cannot reach
// storage" must be a property of the store, not a habit of one call site:
// a value that DID land here would survive a reload and open the shell on
// a selection the reader never took, on a surface that may not even offer
// it.
describe('sk-303.14 — the status store refuses the selection sentinel', () => {
  test('setStatusFilter("unreviewed") changes nothing, in memory or in storage', () => {
    mountShellStack();
    expect(ui!.statusFilter).toBe('open');

    act(() => ui!.setStatusFilter('unreviewed'));

    expect(ui!.statusFilter).toBe('open');
    expect(window.localStorage.getItem(STORAGE.status)).toBe('open');
  });

  test('a real status still writes through — the guard is a whitelist, not a wall', () => {
    mountShellStack();
    act(() => ui!.setStatusFilter('closed'));
    expect(ui!.statusFilter).toBe('closed');
    expect(window.localStorage.getItem(STORAGE.status)).toBe('closed');

    // sk-118's standing filter is on the whitelist too. It was missing
    // when the guard was added, and a whitelist with a hole turns a
    // working chip into a dead one — silently, since nothing rejects out
    // loud.
    act(() => ui!.setStatusFilter('standing'));
    expect(ui!.statusFilter).toBe('standing');
    expect(window.localStorage.getItem(STORAGE.status)).toBe('standing');
  });
});
