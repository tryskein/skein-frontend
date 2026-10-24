/**
 * sk-44.4 / sk-44.5 — `useTaskSearchModes` state machine.
 *
 * Post-review (Fix A/B) contract:
 *   - The hook is an EPHEMERAL OVERLAY: it NEVER calls the persisted
 *     filter setters. The filters axis is realised purely through the
 *     returned `effective*Filter` derivation.
 *   - During an unfiltered search (search active AND withinFilters OFF)
 *     the effective filters are the cleared defaults; otherwise they
 *     mirror the live persisted props.
 *   - The scope axis still does remember → jump → restore, with the
 *     Fix B null-snapshot guard against clobbering a pending restore.
 *   - The whole hook stays inert under a lens (outboxMode/onMeMode).
 */

import { useEffect, useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

import {
  useTaskSearchModes,
  type UseTaskSearchModesResult,
} from '../useTaskSearchModes';
import type {
  OriginFilter,
  PriorityFilter,
  StatusFilter,
  TasksSortKey,
  TypeFilter,
} from '../../api/issues';

interface HostState {
  search: string;
  statusFilter: StatusFilter;
  originFilter: OriginFilter;
  typeFilter: TypeFilter;
  priorityFilter: PriorityFilter;
  sort: TasksSortKey;
  selectedProject: string | null;
  selectedComponent: string | null;
}

let hooks: UseTaskSearchModesResult | null = null;
let setHost: ((updater: (s: HostState) => HostState) => void) | null = null;
let host: HostState | null = null;
/** sk-46 — escape hatch for the lens-toggle test to flip onMeMode. */
let toggleLens: (() => void) | null = null;

interface HostProps extends Omit<HostState, 'sort' | 'priorityFilter'> {
  outboxMode?: boolean;
  onMeMode?: boolean;
  /** sk-50 — persisted sort. Defaults to 'id' when omitted. */
  sort?: TasksSortKey;
  /** sk-86 — persisted priority. Defaults to 'all' when omitted. */
  priorityFilter?: PriorityFilter;
}

function Host(initial: HostProps) {
  const [state, setState] = useState<HostState>(() => ({
    search: initial.search,
    statusFilter: initial.statusFilter,
    originFilter: initial.originFilter,
    typeFilter: initial.typeFilter,
    priorityFilter: initial.priorityFilter ?? 'all',
    sort: initial.sort ?? 'id',
    selectedProject: initial.selectedProject,
    selectedComponent: initial.selectedComponent,
  }));
  host = state;
  setHost = setState;

  const result = useTaskSearchModes({
    search: state.search,
    outboxMode: initial.outboxMode ?? false,
    onMeMode: initial.onMeMode ?? false,
    statusFilter: state.statusFilter,
    originFilter: state.originFilter,
    typeFilter: state.typeFilter,
    priorityFilter: state.priorityFilter,
    // sk-69 — persisted setters write the host's filter fields. Under a
    // lens the hook routes chip edits to its OWN ephemeral state instead,
    // so these must stay untouched while a lens is on (asserted below).
    setStatusFilter: (v) => setState((s) => ({ ...s, statusFilter: v })),
    setOriginFilter: (v) => setState((s) => ({ ...s, originFilter: v })),
    setTypeFilter: (v) => setState((s) => ({ ...s, typeFilter: v })),
    setPriorityFilter: (v) => setState((s) => ({ ...s, priorityFilter: v })),
    sort: state.sort,
    selectedProject: state.selectedProject,
    selectedComponent: state.selectedComponent,
    setSelectedProject: (h) =>
      setState((s) => ({ ...s, selectedProject: h, selectedComponent: null })),
    setSelectedComponent: (cid, h) =>
      setState((s) => ({ ...s, selectedProject: h, selectedComponent: cid })),
  });
  hooks = result;
  return null;
}

function Wrapper({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function setSearch(v: string) {
  act(() => {
    setHost!((s) => ({ ...s, search: v }));
  });
}

/** sk-50 — change the persisted sort key on the host (simulates the
 *  user picking a value while NOT searching, or the localStorage value). */
function setPersistedSort(v: TasksSortKey) {
  act(() => {
    setHost!((s) => ({ ...s, sort: v }));
  });
}

afterEach(() => {
  cleanup();
  hooks = null;
  setHost = null;
  host = null;
  toggleLens = null;
});

describe('useTaskSearchModes — sk-44.4 filters axis (effective overlay)', () => {
  test('search begins → effective filters CLEARED, chips disabled, no setter called', () => {
    render(
      <Wrapper>
        <Host
          search=""
          statusFilter="open"
          originFilter="human-driven"
          typeFilter="bug"
          selectedProject="sk"
          selectedComponent={null}
        />
      </Wrapper>,
    );
    expect(hooks!.searchActive).toBe(false);
    expect(hooks!.filtersEnabled).toBe(true);
    // Outside search: effective = persisted.
    expect(hooks!.effectiveStatusFilter).toBe('open');
    expect(hooks!.effectiveOriginFilter).toBe('human-driven');
    expect(hooks!.effectiveTypeFilter).toBe('bug');

    setSearch('hello');
    expect(hooks!.searchActive).toBe(true);
    // Effective filters surface the cleared defaults while unfiltered.
    // sk-55 — cleared status is 'all' (a search must reach closed issues).
    expect(hooks!.effectiveStatusFilter).toBe('all');
    expect(hooks!.effectiveOriginFilter).toBe('all');
    expect(hooks!.effectiveTypeFilter).toBe('all');
    // Chips disabled while unfiltered search runs.
    expect(hooks!.filtersEnabled).toBe(false);
    expect(hooks!.withinFilters).toBe(false);

    // Persisted state is UNTOUCHED — this is the whole point of Fix A.
    expect(host!.statusFilter).toBe('open');
    expect(host!.originFilter).toBe('human-driven');
    expect(host!.typeFilter).toBe('bug');
  });

  test('within-filters toggle flips effective filters back to persisted, no setter', () => {
    render(
      <Wrapper>
        <Host
          search=""
          statusFilter="open"
          originFilter="human-driven"
          typeFilter="bug"
          selectedProject="sk"
          selectedComponent={null}
        />
      </Wrapper>,
    );
    setSearch('hello');
    expect(hooks!.effectiveStatusFilter).toBe('all'); // sk-55 cleared = all

    act(() => hooks!.toggleWithinFilters());
    expect(hooks!.withinFilters).toBe(true);
    expect(hooks!.filtersEnabled).toBe(true);
    // Effective filters now mirror the (untouched) persisted values.
    expect(hooks!.effectiveStatusFilter).toBe('open');
    expect(hooks!.effectiveOriginFilter).toBe('human-driven');
    expect(hooks!.effectiveTypeFilter).toBe('bug');

    // Toggle back off → effective cleared again; persisted still intact.
    act(() => hooks!.toggleWithinFilters());
    expect(hooks!.withinFilters).toBe(false);
    expect(hooks!.effectiveStatusFilter).toBe('all'); // sk-55 cleared = all
    expect(host!.statusFilter).toBe('open');

    // Re-toggle restores the persisted view again (no remembered set
    // needed — persisted state IS the memory).
    act(() => hooks!.toggleWithinFilters());
    expect(hooks!.effectiveStatusFilter).toBe('open');
  });

  test('clearing search re-enables chips, resets withinFilters, leaves persisted intact', () => {
    render(
      <Wrapper>
        <Host
          search=""
          statusFilter="open"
          originFilter="human-driven"
          typeFilter="bug"
          selectedProject="sk"
          selectedComponent={null}
        />
      </Wrapper>,
    );
    setSearch('hello');
    act(() => hooks!.toggleWithinFilters());
    expect(hooks!.withinFilters).toBe(true);

    setSearch('');
    expect(hooks!.searchActive).toBe(false);
    // Effective = persisted (unchanged throughout).
    expect(hooks!.effectiveStatusFilter).toBe('open');
    expect(hooks!.effectiveOriginFilter).toBe('human-driven');
    expect(hooks!.effectiveTypeFilter).toBe('bug');
    expect(hooks!.filtersEnabled).toBe(true);
    expect(hooks!.withinFilters).toBe(false);
  });

  test('persisted props never change across a full begin → toggle → clear cycle', () => {
    // Structural guarantee: the hook signature carries NO
    // setStatusFilter/setOriginFilter/setTypeFilter — it CANNOT write
    // them. We assert the persisted host fields stay byte-identical
    // through the entire transition sequence (only the effective
    // derivation moves).
    render(
      <Wrapper>
        <Host
          search=""
          statusFilter="in_progress"
          originFilter="agent-autonomous"
          typeFilter="epic"
          selectedProject="sk"
          selectedComponent={null}
        />
      </Wrapper>,
    );
    const assertPersistedIntact = () => {
      expect(host!.statusFilter).toBe('in_progress');
      expect(host!.originFilter).toBe('agent-autonomous');
      expect(host!.typeFilter).toBe('epic');
    };

    assertPersistedIntact();
    setSearch('q');
    assertPersistedIntact();
    expect(hooks!.effectiveStatusFilter).toBe('all'); // sk-55 cleared = all
    act(() => hooks!.toggleWithinFilters());
    assertPersistedIntact();
    expect(hooks!.effectiveStatusFilter).toBe('in_progress');
    act(() => hooks!.toggleWithinFilters());
    assertPersistedIntact();
    expect(hooks!.effectiveStatusFilter).toBe('all'); // sk-55 cleared = all
    setSearch('');
    assertPersistedIntact();
    expect(hooks!.effectiveStatusFilter).toBe('in_progress');
  });
});

describe('useTaskSearchModes — sk-50 sort axis (effective overlay)', () => {
  test('outside search → effectiveSort mirrors the persisted sort', () => {
    render(
      <Wrapper>
        <Host
          search=""
          statusFilter="active"
          originFilter="all"
          typeFilter="all"
          sort="id"
          selectedProject="sk"
          selectedComponent={null}
        />
      </Wrapper>,
    );
    expect(hooks!.searchActive).toBe(false);
    expect(hooks!.effectiveSort).toBe('id');
  });

  test('search begins → effectiveSort defaults to relevance (begin edge)', () => {
    render(
      <Wrapper>
        <Host
          search=""
          statusFilter="active"
          originFilter="all"
          typeFilter="all"
          sort="id"
          selectedProject="sk"
          selectedComponent={null}
        />
      </Wrapper>,
    );
    setSearch('hello');
    expect(hooks!.searchActive).toBe(true);
    // Auto-selected relevance on the search-begin edge.
    expect(hooks!.effectiveSort).toBe('relevance');
    // Persisted sort UNTOUCHED — this is the whole point of the overlay.
    expect(host!.sort).toBe('id');
  });

  test('switching searchSort to a real key holds; persisted sort untouched', () => {
    render(
      <Wrapper>
        <Host
          search=""
          statusFilter="active"
          originFilter="all"
          typeFilter="all"
          sort="id"
          selectedProject="sk"
          selectedComponent={null}
        />
      </Wrapper>,
    );
    setSearch('hello');
    expect(hooks!.effectiveSort).toBe('relevance');

    // User picks Priority mid-search → the combobox calls setSearchSort.
    act(() => hooks!.setSearchSort('priority'));
    expect(hooks!.effectiveSort).toBe('priority');
    // Persisted sort still untouched.
    expect(host!.sort).toBe('id');
  });

  test('auto-select fires ONLY on the begin edge, not on later keystrokes', () => {
    render(
      <Wrapper>
        <Host
          search=""
          statusFilter="active"
          originFilter="all"
          typeFilter="all"
          sort="id"
          selectedProject="sk"
          selectedComponent={null}
        />
      </Wrapper>,
    );
    setSearch('h');
    expect(hooks!.effectiveSort).toBe('relevance');

    // User switches to Priority mid-search.
    act(() => hooks!.setSearchSort('priority'));
    expect(hooks!.effectiveSort).toBe('priority');

    // More keystrokes (still non-empty → searchActive stays true, NO
    // begin edge) must NOT reset back to relevance.
    setSearch('he');
    expect(hooks!.searchActive).toBe(true);
    expect(hooks!.effectiveSort).toBe('priority');
    setSearch('hel');
    expect(hooks!.effectiveSort).toBe('priority');
  });

  test('clearing search → effectiveSort reverts to persisted; relevance never persisted', () => {
    render(
      <Wrapper>
        <Host
          search=""
          statusFilter="active"
          originFilter="all"
          typeFilter="all"
          sort="id"
          selectedProject="sk"
          selectedComponent={null}
        />
      </Wrapper>,
    );
    setSearch('hello');
    act(() => hooks!.setSearchSort('priority'));
    expect(hooks!.effectiveSort).toBe('priority');

    setSearch('');
    expect(hooks!.searchActive).toBe(false);
    // Overlay vanishes → effective = persisted ('id'), NOT 'relevance'
    // and NOT the mid-search 'priority'.
    expect(hooks!.effectiveSort).toBe('id');
    // Persisted sort never moved — 'relevance' / 'priority' were
    // ephemeral only.
    expect(host!.sort).toBe('id');
  });

  test('begin edge re-arms relevance on each fresh search cycle', () => {
    render(
      <Wrapper>
        <Host
          search=""
          statusFilter="active"
          originFilter="all"
          typeFilter="all"
          sort="updated"
          selectedProject="sk"
          selectedComponent={null}
        />
      </Wrapper>,
    );
    // First cycle: begin → relevance, switch to created.
    setSearch('a');
    expect(hooks!.effectiveSort).toBe('relevance');
    act(() => hooks!.setSearchSort('created'));
    expect(hooks!.effectiveSort).toBe('created');
    // Clear → back to persisted.
    setSearch('');
    expect(hooks!.effectiveSort).toBe('updated');
    // Second cycle: a NEW begin edge re-arms relevance.
    setSearch('b');
    expect(hooks!.effectiveSort).toBe('relevance');
  });

  test('persisted sort change while searching does not disturb the overlay', () => {
    render(
      <Wrapper>
        <Host
          search=""
          statusFilter="active"
          originFilter="all"
          typeFilter="all"
          sort="id"
          selectedProject="sk"
          selectedComponent={null}
        />
      </Wrapper>,
    );
    setSearch('q');
    expect(hooks!.effectiveSort).toBe('relevance');
    // A persisted-sort change mid-search (e.g. a stray write) must not
    // bleed into effectiveSort while searchActive — overlay wins.
    setPersistedSort('created');
    expect(hooks!.effectiveSort).toBe('relevance');
    // On clear it surfaces the new persisted value.
    setSearch('');
    expect(hooks!.effectiveSort).toBe('created');
  });

  test('sort overlay is inert under a lens (effective = persisted)', () => {
    render(
      <Wrapper>
        <Host
          search="something"
          statusFilter="active"
          originFilter="all"
          typeFilter="all"
          sort="id"
          selectedProject="sk"
          selectedComponent={null}
          outboxMode
        />
      </Wrapper>,
    );
    // Lens active → searchActive false even with a non-empty box, so
    // effectiveSort mirrors the persisted key (no relevance overlay).
    expect(hooks!.searchActive).toBe(false);
    expect(hooks!.effectiveSort).toBe('id');
  });
});

describe('useTaskSearchModes — sk-44.5 scope axis', () => {
  test('all-projects toggle moves cursor to All Projects + restores on off', () => {
    render(
      <Wrapper>
        <Host
          search=""
          statusFilter="active"
          originFilter="all"
          typeFilter="all"
          selectedProject="sk"
          selectedComponent="comp-1"
        />
      </Wrapper>,
    );
    setSearch('q');
    expect(hooks!.allProjects).toBe(false);
    expect(hooks!.allProjectsDisabled).toBe(false);

    act(() => hooks!.toggleAllProjects());
    expect(hooks!.allProjects).toBe(true);
    expect(host!.selectedProject).toBeNull();
    expect(host!.selectedComponent).toBeNull();

    act(() => hooks!.toggleAllProjects());
    expect(hooks!.allProjects).toBe(false);
    expect(host!.selectedProject).toBe('sk');
    expect(host!.selectedComponent).toBe('comp-1');
  });

  test('clearing search restores the tree cursor when all-projects was on', () => {
    render(
      <Wrapper>
        <Host
          search=""
          statusFilter="active"
          originFilter="all"
          typeFilter="all"
          selectedProject="sk"
          selectedComponent={null}
        />
      </Wrapper>,
    );
    setSearch('q');
    act(() => hooks!.toggleAllProjects());
    expect(host!.selectedProject).toBeNull();

    setSearch('');
    expect(host!.selectedProject).toBe('sk');
    expect(hooks!.allProjects).toBe(false);
  });

  test('all-projects toggle is disabled when already on the cross-project surface', () => {
    render(
      <Wrapper>
        <Host
          search=""
          statusFilter="active"
          originFilter="all"
          typeFilter="all"
          selectedProject={null}
          selectedComponent={null}
        />
      </Wrapper>,
    );
    setSearch('q');
    expect(hooks!.allProjectsDisabled).toBe(true);
  });

  test('Fix B — rapid re-toggle ON does not clobber a pending remembered scope', () => {
    render(
      <Wrapper>
        <Host
          search=""
          statusFilter="active"
          originFilter="all"
          typeFilter="all"
          selectedProject="sk"
          selectedComponent="comp-1"
        />
      </Wrapper>,
    );
    setSearch('q');
    // ON — snapshot {sk, comp-1}, cursor → null.
    act(() => hooks!.toggleAllProjects());
    expect(host!.selectedProject).toBeNull();

    // Toggle ON again WITHOUT the OFF in between (simulating a double
    // press / a stale render). allProjects is already true so the next
    // flip is conceptually OFF, but to specifically exercise the guard
    // we force a manual ON path: turn OFF (restores + nulls ref) then ON
    // while the cursor is already null. The guard's
    // `selectedProject !== null` AND `ref === null` conjunction must
    // prevent stamping a {null,...} snapshot over nothing.
    act(() => hooks!.toggleAllProjects()); // OFF → restore sk/comp-1, ref nulled
    expect(host!.selectedProject).toBe('sk');
    expect(host!.selectedComponent).toBe('comp-1');

    act(() => hooks!.toggleAllProjects()); // ON again → fresh snapshot sk/comp-1
    expect(host!.selectedProject).toBeNull();
    act(() => hooks!.toggleAllProjects()); // OFF → must restore the GOOD sk/comp-1
    expect(host!.selectedProject).toBe('sk');
    expect(host!.selectedComponent).toBe('comp-1');
  });

  test('Fix B — turning ON while already on All Projects stamps no snapshot', () => {
    render(
      <Wrapper>
        <Host
          search=""
          statusFilter="active"
          originFilter="all"
          typeFilter="all"
          selectedProject={null}
          selectedComponent={null}
        />
      </Wrapper>,
    );
    setSearch('q');
    // allProjectsDisabled is true here, but exercise the guard directly:
    // toggling ON with selectedProject === null must NOT remember a
    // {null, null} scope (guard: selectedProject !== null).
    act(() => hooks!.toggleAllProjects());
    // No project to widen from → cursor stays null, nothing to restore.
    expect(host!.selectedProject).toBeNull();
    act(() => hooks!.toggleAllProjects()); // OFF — ref was null, no-op restore
    expect(host!.selectedProject).toBeNull();
  });
});

describe('useTaskSearchModes — axes combine freely', () => {
  test('within-filters + all-projects can be on simultaneously', () => {
    render(
      <Wrapper>
        <Host
          search=""
          statusFilter="open"
          originFilter="all"
          typeFilter="all"
          selectedProject="sk"
          selectedComponent={null}
        />
      </Wrapper>,
    );
    setSearch('q');
    act(() => hooks!.toggleWithinFilters());
    act(() => hooks!.toggleAllProjects());

    expect(hooks!.withinFilters).toBe(true);
    expect(hooks!.allProjects).toBe(true);
    expect(hooks!.filtersEnabled).toBe(true);
    // within filters ON → effective mirrors persisted.
    expect(hooks!.effectiveStatusFilter).toBe('open');
    expect(host!.selectedProject).toBeNull(); // scope widened

    setSearch('');
    expect(hooks!.withinFilters).toBe(false);
    expect(hooks!.allProjects).toBe(false);
    expect(hooks!.effectiveStatusFilter).toBe('open');
    expect(host!.selectedProject).toBe('sk');
  });
});

describe('useTaskSearchModes — lens overlay (sk-46 / sk-69)', () => {
  // sk-46 — while a lens is active the effective filters come from the
  // lens overlay, NOT the user's persisted preferences, and the persisted
  // state (host fields) is NEVER written — that's what lets a reload
  // mid-lens preserve the user's real prefs.
  // sk-69 — the lens overlay is now EPHEMERAL EDITABLE state seeded to the
  // preset (status='active', type='all', origin='human-driven') on each
  // lens-enter edge. On entry effective === preset (asserted here); the
  // edit/seed/revert behaviour lives in the sk-69 describe block below.

  test('outboxMode=true → searchActive false, effective = LENS PRESET on entry, persisted untouched', () => {
    render(
      <Wrapper>
        <Host
          search="something"
          statusFilter="open"
          originFilter="human-driven"
          typeFilter="bug"
          selectedProject="sk"
          selectedComponent="comp-1"
          outboxMode
        />
      </Wrapper>,
    );
    // Lens active → search is inert even with a non-empty box.
    expect(hooks!.searchActive).toBe(false);
    expect(hooks!.filtersEnabled).toBe(true);
    // Effective filters surface the lens preset, overriding persisted.
    expect(hooks!.effectiveStatusFilter).toBe('active');
    expect(hooks!.effectiveOriginFilter).toBe('human-driven');
    expect(hooks!.effectiveTypeFilter).toBe('all');
    // Persisted state is UNTOUCHED — the overlay is a pure derivation,
    // never a write-through. This is the sk-46 invariant.
    expect(host!.statusFilter).toBe('open');
    expect(host!.originFilter).toBe('human-driven');
    expect(host!.typeFilter).toBe('bug');
    // No scope move (the cursor only shifts on an explicit toggle).
    expect(host!.selectedProject).toBe('sk');
  });

  test('onMeMode=true → effective = LENS PRESET, persisted untouched', () => {
    render(
      <Wrapper>
        <Host
          search="abc"
          statusFilter="in_progress"
          originFilter="agent-autonomous"
          typeFilter="epic"
          selectedProject="sk"
          selectedComponent={null}
          onMeMode
        />
      </Wrapper>,
    );
    expect(hooks!.searchActive).toBe(false);
    expect(hooks!.filtersEnabled).toBe(true);
    // Preset overlay applied.
    expect(hooks!.effectiveStatusFilter).toBe('active');
    expect(hooks!.effectiveOriginFilter).toBe('human-driven');
    expect(hooks!.effectiveTypeFilter).toBe('all');
    // Persisted prefs survive verbatim.
    expect(host!.statusFilter).toBe('in_progress');
    expect(host!.originFilter).toBe('agent-autonomous');
    expect(host!.typeFilter).toBe('epic');
  });

  test('lens OFF reverts effective filters to the persisted prefs (no restore step)', () => {
    // Start under a lens; flip it off by toggling the host prop. The
    // effective derivation snaps straight back to the persisted values —
    // there is no snapshot to restore because nothing was ever written.
    function ToggleHost() {
      const [onMe, setOnMe] = useState(true);
      // expose the toggle via a module-level escape hatch
      toggleLens = () => setOnMe((v) => !v);
      const [state, setState] = useState<HostState>(() => ({
        search: '',
        statusFilter: 'open',
        originFilter: 'agent-autonomous',
        typeFilter: 'bug',
        priorityFilter: 'all',
        sort: 'id',
        selectedProject: 'sk',
        selectedComponent: null,
      }));
      host = state;
      setHost = setState;
      hooks = useTaskSearchModes({
        search: state.search,
        outboxMode: false,
        onMeMode: onMe,
        statusFilter: state.statusFilter,
        originFilter: state.originFilter,
        typeFilter: state.typeFilter,
        priorityFilter: state.priorityFilter,
        setStatusFilter: (v) => setState((s) => ({ ...s, statusFilter: v })),
        setOriginFilter: (v) => setState((s) => ({ ...s, originFilter: v })),
        setTypeFilter: (v) => setState((s) => ({ ...s, typeFilter: v })),
        setPriorityFilter: (v) => setState((s) => ({ ...s, priorityFilter: v })),
        sort: state.sort,
        selectedProject: state.selectedProject,
        selectedComponent: state.selectedComponent,
        setSelectedProject: (h) =>
          setState((s) => ({ ...s, selectedProject: h, selectedComponent: null })),
        setSelectedComponent: (cid, h) =>
          setState((s) => ({ ...s, selectedProject: h, selectedComponent: cid })),
      });
      return null;
    }
    render(
      <Wrapper>
        <ToggleHost />
      </Wrapper>,
    );
    // Lens ON → preset overlay.
    expect(hooks!.effectiveStatusFilter).toBe('active');
    expect(hooks!.effectiveOriginFilter).toBe('human-driven');
    expect(hooks!.effectiveTypeFilter).toBe('all');

    // Lens OFF → effective reverts to the (always-intact) persisted prefs.
    act(() => toggleLens!());
    expect(hooks!.effectiveStatusFilter).toBe('open');
    expect(hooks!.effectiveOriginFilter).toBe('agent-autonomous');
    expect(hooks!.effectiveTypeFilter).toBe('bug');
    // Persisted prefs never moved across the whole cycle.
    expect(host!.statusFilter).toBe('open');
    expect(host!.originFilter).toBe('agent-autonomous');
    expect(host!.typeFilter).toBe('bug');
  });
});

describe('useTaskSearchModes — sk-69 editable lens filters', () => {
  // sk-69 — under a lens the chips are LIVE: their onChange routes to the
  // returned effectiveSet*Filter, which writes the hook's EPHEMERAL
  // lens-filter state (so the user can narrow the On-me / Delegated list)
  // and NEVER the persisted prefs. Outside a lens the same effective
  // setters pass straight through to the persisted setters.

  test('edit under lens changes effective, leaves persisted untouched', () => {
    render(
      <Wrapper>
        <Host
          search=""
          statusFilter="open"
          originFilter="agent-autonomous"
          typeFilter="bug"
          selectedProject="sk"
          selectedComponent={null}
          onMeMode
        />
      </Wrapper>,
    );
    // Seeded to the preset on entry.
    expect(hooks!.effectiveStatusFilter).toBe('active');
    expect(hooks!.effectiveTypeFilter).toBe('all');
    expect(hooks!.effectiveOriginFilter).toBe('human-driven');

    // User clicks chips under the lens — narrows status, type, origin.
    act(() => hooks!.effectiveSetStatusFilter('closed'));
    act(() => hooks!.effectiveSetTypeFilter('epic'));
    act(() => hooks!.effectiveSetOriginFilter('all'));

    // Effective reflects the edits — the chips are LIVE (the bug fix).
    expect(hooks!.effectiveStatusFilter).toBe('closed');
    expect(hooks!.effectiveTypeFilter).toBe('epic');
    expect(hooks!.effectiveOriginFilter).toBe('all');

    // sk-46 invariant: the durable prefs are UNTOUCHED by lens edits.
    expect(host!.statusFilter).toBe('open');
    expect(host!.typeFilter).toBe('bug');
    expect(host!.originFilter).toBe('agent-autonomous');
  });

  test('outside a lens, effective setters pass through to the persisted setters', () => {
    render(
      <Wrapper>
        <Host
          search=""
          statusFilter="open"
          originFilter="human-driven"
          typeFilter="bug"
          selectedProject="sk"
          selectedComponent={null}
        />
      </Wrapper>,
    );
    // No lens, no search → effective mirrors persisted.
    expect(hooks!.effectiveStatusFilter).toBe('open');

    act(() => hooks!.effectiveSetStatusFilter('closed'));
    act(() => hooks!.effectiveSetTypeFilter('epic'));

    // Persisted prefs ARE written here — this is the normal board path.
    expect(host!.statusFilter).toBe('closed');
    expect(host!.typeFilter).toBe('epic');
    expect(hooks!.effectiveStatusFilter).toBe('closed');
    expect(hooks!.effectiveTypeFilter).toBe('epic');
  });

  test('re-entering a lens RE-SEEDS to the preset, discarding the prior edit', () => {
    function ToggleHost() {
      const [onMe, setOnMe] = useState(true);
      toggleLens = () => setOnMe((v) => !v);
      const [state, setState] = useState<HostState>(() => ({
        search: '',
        statusFilter: 'open',
        originFilter: 'agent-autonomous',
        typeFilter: 'bug',
        priorityFilter: 'all',
        sort: 'id',
        selectedProject: 'sk',
        selectedComponent: null,
      }));
      host = state;
      setHost = setState;
      hooks = useTaskSearchModes({
        search: state.search,
        outboxMode: false,
        onMeMode: onMe,
        statusFilter: state.statusFilter,
        originFilter: state.originFilter,
        typeFilter: state.typeFilter,
        priorityFilter: state.priorityFilter,
        setStatusFilter: (v) => setState((s) => ({ ...s, statusFilter: v })),
        setOriginFilter: (v) => setState((s) => ({ ...s, originFilter: v })),
        setTypeFilter: (v) => setState((s) => ({ ...s, typeFilter: v })),
        setPriorityFilter: (v) => setState((s) => ({ ...s, priorityFilter: v })),
        sort: state.sort,
        selectedProject: state.selectedProject,
        selectedComponent: state.selectedComponent,
        setSelectedProject: (h) =>
          setState((s) => ({ ...s, selectedProject: h, selectedComponent: null })),
        setSelectedComponent: (cid, h) =>
          setState((s) => ({ ...s, selectedProject: h, selectedComponent: cid })),
      });
      return null;
    }
    render(
      <Wrapper>
        <ToggleHost />
      </Wrapper>,
    );
    // Lens ON → seeded to preset; user edits status to 'closed'.
    expect(hooks!.effectiveStatusFilter).toBe('active');
    act(() => hooks!.effectiveSetStatusFilter('closed'));
    expect(hooks!.effectiveStatusFilter).toBe('closed');

    // Lens OFF → effective reverts to persisted; the edit is NOT leaked.
    act(() => toggleLens!());
    expect(hooks!.effectiveStatusFilter).toBe('open');
    expect(host!.statusFilter).toBe('open'); // persisted never moved

    // Lens ON again → RE-SEEDED to the preset, NOT the stale 'closed'.
    act(() => toggleLens!());
    expect(hooks!.effectiveStatusFilter).toBe('active');
  });
});

describe('useTaskSearchModes — sk-86 priority overlay', () => {
  test('priority follows the same overlay rules as status/type/origin', () => {
    render(
      <Wrapper>
        <Host
          search=""
          statusFilter="open"
          originFilter="human-driven"
          typeFilter="bug"
          priorityFilter="2"
          selectedProject="sk"
          selectedComponent={null}
        />
      </Wrapper>,
    );
    // Outside search: effective = persisted concrete value.
    expect(hooks!.effectivePriorityFilter).toBe('2');

    // Unfiltered search → cleared to 'all'.
    setSearch('hello');
    expect(hooks!.effectivePriorityFilter).toBe('all');

    // "within filters" ON → persisted value returns.
    act(() => hooks!.toggleWithinFilters());
    expect(hooks!.effectivePriorityFilter).toBe('2');

    // Clear search → back to persisted.
    setSearch('');
    expect(hooks!.effectivePriorityFilter).toBe('2');
  });

  test('lens seeds priority to the preset (all) and never leaks an edit to persisted', () => {
    function ToggleHost() {
      const [onMe, setOnMe] = useState(true);
      toggleLens = () => setOnMe((v) => !v);
      const [state, setState] = useState<HostState>(() => ({
        search: '',
        statusFilter: 'open',
        originFilter: 'agent-autonomous',
        typeFilter: 'bug',
        priorityFilter: '3',
        sort: 'id',
        selectedProject: 'sk',
        selectedComponent: null,
      }));
      host = state;
      setHost = setState;
      hooks = useTaskSearchModes({
        search: state.search,
        outboxMode: false,
        onMeMode: onMe,
        statusFilter: state.statusFilter,
        originFilter: state.originFilter,
        typeFilter: state.typeFilter,
        priorityFilter: state.priorityFilter,
        setStatusFilter: (v) => setState((s) => ({ ...s, statusFilter: v })),
        setOriginFilter: (v) => setState((s) => ({ ...s, originFilter: v })),
        setTypeFilter: (v) => setState((s) => ({ ...s, typeFilter: v })),
        setPriorityFilter: (v) => setState((s) => ({ ...s, priorityFilter: v })),
        sort: state.sort,
        selectedProject: state.selectedProject,
        selectedComponent: state.selectedComponent,
        setSelectedProject: (h) =>
          setState((s) => ({ ...s, selectedProject: h, selectedComponent: null })),
        setSelectedComponent: (cid, h) =>
          setState((s) => ({ ...s, selectedProject: h, selectedComponent: cid })),
      });
      return null;
    }
    render(
      <Wrapper>
        <ToggleHost />
      </Wrapper>,
    );
    // Lens ON → seeded to preset ('all'), NOT the persisted '3'.
    expect(hooks!.effectivePriorityFilter).toBe('all');
    act(() => hooks!.effectiveSetPriorityFilter('1'));
    expect(hooks!.effectivePriorityFilter).toBe('1');
    // Persisted prefs untouched under the lens.
    expect(host!.priorityFilter).toBe('3');

    // Lens OFF → effective reverts to persisted; the edit is NOT leaked.
    act(() => toggleLens!());
    expect(hooks!.effectivePriorityFilter).toBe('3');
    expect(host!.priorityFilter).toBe('3');
  });
});

// ────── sk-303.14 (T024/T025, rows 89, 92, 93, 107) — the unreviewed
//        selection: what the first frame is made of ──────
//
// The obligation these tests carry is NOT "the value is eventually right".
// It is that the value is right in the render the list query is built in.
// The old seed lived in an effect, which runs after the commit, so the
// column had already asked the server with the previous filters and the
// correction arrived as a second request. Row 88 (the request count) is
// pinned end-to-end in `unreviewedEntry.test.tsx`; here we pin the two
// things that make it possible — the value, and WHEN it appears.

/**
 * A host whose lens and selection are both togglable, and which records
 * the effective filters of every COMMITTED render.
 *
 * The recording is the point. A committed render is a render the rest of
 * the tree (the list query included) actually saw. An effect-seeded
 * overlay commits the stale values once before correcting itself, so the
 * recording holds two entries; a value derived during render never does.
 * Asserting only the final value cannot tell those two apart.
 */
let committedOrigins: OriginFilter[] = [];
let committedStatuses: StatusFilter[] = [];
let setLensOn: ((v: boolean) => void) | null = null;
let setSelectOn: ((v: boolean) => void) | null = null;
let selectWrites: boolean[] = [];

function SelectionHost({
  lens: initialLens = false,
  select: initialSelect = false,
  statusFilter = 'open',
  originFilter = 'agent-autonomous',
  typeFilter = 'bug',
  priorityFilter = '3',
}: {
  lens?: boolean;
  select?: boolean;
  statusFilter?: StatusFilter;
  originFilter?: OriginFilter;
  typeFilter?: TypeFilter;
  priorityFilter?: PriorityFilter;
}) {
  const [lensOn, setLens] = useState(initialLens);
  const [selectOn, setSelect] = useState(initialSelect);
  setLensOn = setLens;
  setSelectOn = setSelect;
  const [state, setState] = useState<HostState>(() => ({
    search: '',
    statusFilter,
    originFilter,
    typeFilter,
    priorityFilter,
    sort: 'id',
    selectedProject: 'sk',
    selectedComponent: null,
  }));
  host = state;
  setHost = setState;
  const result = useTaskSearchModes({
    search: state.search,
    outboxMode: lensOn,
    onMeMode: false,
    unreviewedSelected: selectOn,
    setUnreviewedSelected: (v) => {
      selectWrites.push(v);
      setSelect(v);
    },
    statusFilter: state.statusFilter,
    originFilter: state.originFilter,
    typeFilter: state.typeFilter,
    priorityFilter: state.priorityFilter,
    setStatusFilter: (v) => setState((s) => ({ ...s, statusFilter: v })),
    setOriginFilter: (v) => setState((s) => ({ ...s, originFilter: v })),
    setTypeFilter: (v) => setState((s) => ({ ...s, typeFilter: v })),
    setPriorityFilter: (v) => setState((s) => ({ ...s, priorityFilter: v })),
    sort: state.sort,
    selectedProject: state.selectedProject,
    selectedComponent: state.selectedComponent,
    setSelectedProject: (h) =>
      setState((s) => ({ ...s, selectedProject: h, selectedComponent: null })),
    setSelectedComponent: (cid, h) =>
      setState((s) => ({ ...s, selectedProject: h, selectedComponent: cid })),
  });
  hooks = result;
  // No dep array: fires on every commit, in commit order.
  useEffect(() => {
    committedOrigins.push(result.effectiveOriginFilter);
    committedStatuses.push(result.effectiveStatusFilter);
  });
  return null;
}

beforeEach(() => {
  committedOrigins = [];
  committedStatuses = [];
  selectWrites = [];
  setLensOn = null;
  setSelectOn = null;
});

describe('useTaskSearchModes — sk-303.14 unreviewed selection', () => {
  test('row 107 — RE-entering the lens never commits the previous cycle\'s edits, not even once', () => {
    // The seed matters on RE-entry, where the overlay is carrying whatever
    // the reader narrowed it to last time. An effect-seeded overlay commits
    // that stale narrowing once — the column asks the server for the old
    // cycle's list — and corrects itself a render later.
    render(
      <Wrapper>
        <SelectionHost lens originFilter="agent-autonomous" />
      </Wrapper>,
    );
    act(() => hooks!.effectiveSetOriginFilter('agent-autonomous'));
    expect(hooks!.effectiveOriginFilter).toBe('agent-autonomous');

    act(() => setLensOn!(false));
    committedOrigins = [];
    act(() => setLensOn!(true));

    // Every committed render since the lens came back shows the seeded
    // value. Not "the last one" — every one.
    expect(committedOrigins.length).toBeGreaterThan(0);
    expect(committedOrigins.every((o) => o === 'human-driven')).toBe(true);
  });

  test('row 89 — entering WITH the selection normalises every axis, and origin is NOT the lens preset', () => {
    render(
      <Wrapper>
        <SelectionHost
          lens={false}
          statusFilter="open"
          originFilter="agent-autonomous"
          typeFilter="bug"
          priorityFilter="3"
        />
      </Wrapper>,
    );
    committedOrigins = [];
    committedStatuses = [];

    // The jump: lens and selection arrive together, as one address change.
    act(() => {
      setLensOn!(true);
      setSelectOn!(true);
    });

    // The status axis IS the selection.
    expect(hooks!.effectiveStatusFilter).toBe('unreviewed');
    // …and every other axis is in the "does not narrow" state. `origin`
    // is the one that would silently break: the LENS preset narrows it to
    // 'human-driven', which drops every agent-filed result and makes the
    // row count disagree with the second number (INV-3). 'all' is the
    // whole assertion — 'human-driven' here would be the defect.
    expect(hooks!.effectiveOriginFilter).toBe('all');
    expect(hooks!.effectiveTypeFilter).toBe('all');
    expect(hooks!.effectivePriorityFilter).toBe('all');

    // And it was never anything else on the way in.
    expect(committedOrigins.every((o) => o === 'all')).toBe(true);
    expect(committedStatuses.every((s) => s === 'unreviewed')).toBe(true);
  });

  test('row 107 — taking the selection with the lens ALREADY open re-normalises the narrowed chips', () => {
    // The reader is deep inside a narrowed Delegated view and jumps to the
    // unreviewed set. No lens edge fires here — an implementation keyed on
    // the lens alone would leave type=epic in place and produce a first
    // frame narrower than the count it is supposed to match.
    render(
      <Wrapper>
        <SelectionHost lens select={false} />
      </Wrapper>,
    );
    act(() => hooks!.effectiveSetTypeFilter('epic'));
    act(() => hooks!.effectiveSetPriorityFilter('1'));
    act(() => hooks!.effectiveSetOriginFilter('agent-autonomous'));
    expect(hooks!.effectiveTypeFilter).toBe('epic');
    committedOrigins = [];

    act(() => setSelectOn!(true));

    expect(hooks!.effectiveStatusFilter).toBe('unreviewed');
    expect(hooks!.effectiveTypeFilter).toBe('all');
    expect(hooks!.effectivePriorityFilter).toBe('all');
    expect(hooks!.effectiveOriginFilter).toBe('all');
    expect(committedOrigins.every((o) => o === 'all')).toBe(true);
  });

  test('leaving the selection does NOT re-seed — the chips keep what they show', () => {
    render(
      <Wrapper>
        <SelectionHost lens select />
      </Wrapper>,
    );
    act(() => hooks!.effectiveSetTypeFilter('epic'));
    expect(hooks!.effectiveTypeFilter).toBe('epic');

    // Drop the selection: the list widens, the chips stay put. A re-seed
    // here would silently undo a narrowing the reader just made.
    act(() => setSelectOn!(false));
    expect(hooks!.effectiveTypeFilter).toBe('epic');
    // Status falls back to the entry seed 'all', not the lens preset
    // 'active': the unreviewed set is closed results, so 'active' would
    // hand the reader an empty list for dropping a filter.
    expect(hooks!.effectiveStatusFilter).toBe('all');
  });

  test('row 93 — picking the sentinel writes the SELECTION, never a filter store', () => {
    render(
      <Wrapper>
        <SelectionHost lens select={false} />
      </Wrapper>,
    );
    const persistedBefore = host!.statusFilter;

    act(() => hooks!.effectiveSetStatusFilter('unreviewed'));

    expect(selectWrites).toEqual([true]);
    expect(hooks!.effectiveStatusFilter).toBe('unreviewed');
    // The durable pref never saw the sentinel.
    expect(host!.statusFilter).toBe(persistedBefore);
  });

  test('row 93 — picking a real status while selected drops the selection and stores the real value', () => {
    render(
      <Wrapper>
        <SelectionHost lens={false} select={false} />
      </Wrapper>,
    );
    // Outside a lens the effective setter routes to the PERSISTED store —
    // the path where a leaked sentinel would survive a reload.
    act(() => hooks!.effectiveSetStatusFilter('unreviewed'));
    expect(host!.statusFilter).not.toBe('unreviewed');

    act(() => hooks!.effectiveSetStatusFilter('closed'));
    expect(selectWrites).toEqual([true, false]);
    expect(host!.statusFilter).toBe('closed');
  });

  test('rows 89/109 — arriving BY ADDRESS (mounted already selected) gets the SAME normalised frame', () => {
    // A shared link, a bookmark, a tap on a stale push notification: the
    // shell mounts straight into the selected state. No edge fires — it
    // started that way — so an entry seed applied only on edges would
    // leave this door open with the lens preset behind it, i.e. origin
    // narrowed to 'human-driven' and a row count that cannot match.
    render(
      <Wrapper>
        <SelectionHost lens select originFilter="agent-autonomous" typeFilter="bug" />
      </Wrapper>,
    );
    expect(hooks!.effectiveStatusFilter).toBe('unreviewed');
    expect(hooks!.effectiveOriginFilter).toBe('all');
    expect(hooks!.effectiveTypeFilter).toBe('all');
    expect(hooks!.effectivePriorityFilter).toBe('all');
    expect(committedOrigins.every((o) => o === 'all')).toBe(true);

    // Dropping the selection widens rather than empties: the fallback
    // status is 'all', not the lens preset's 'active' (the set is closed
    // results, so 'active' would answer a widening with zero rows).
    act(() => setSelectOn!(false));
    expect(hooks!.effectiveStatusFilter).toBe('all');
  });

  test('the selection is inert while it is off — the lens preset still applies', () => {
    // Guard against the sentinel leaking into the ordinary lens path.
    render(
      <Wrapper>
        <SelectionHost lens select={false} />
      </Wrapper>,
    );
    expect(hooks!.effectiveStatusFilter).toBe('active');
    expect(hooks!.effectiveOriginFilter).toBe('human-driven');
  });
});
