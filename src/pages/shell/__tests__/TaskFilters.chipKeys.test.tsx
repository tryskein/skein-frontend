/**
 * sk-491 — the quick list's chip rows are radio groups by KEYBOARD, not
 * only by ARIA.
 *
 * `TaskFilters.tsx#FilterChipRow` and `TaskFilters.tsx#AssigneeChipRow`
 * declared `role="radiogroup"` but every chip was its own Tab stop and the
 * arrows did nothing. The model now comes from the shared
 * `lib/useRadioGroupKeys.ts#useRadioGroupKeys` (the one the epic section's
 * mode switch, sk-490, runs on): one Tab stop per row on the picked chip,
 * ←/→ and ↑/↓ pick the neighbour round the ring and carry focus there,
 * arrows under Alt/Ctrl/Meta are left alone.
 *
 * The panel is driven by a stateful harness — `TaskFilters` is controlled,
 * and a Tab stop that follows the selection can only be seen when the
 * selection actually changes.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { useState } from 'react';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';

import { TaskFilters, type TaskFiltersProps } from '../TaskFilters';
import type { StatusFilter } from '../../../api/issues';

afterEach(cleanup);

// ───────────────────────────── fixture ─────────────────────────────

type Over = Partial<TaskFiltersProps>;

function baseProps(over: Over): TaskFiltersProps {
  return {
    search: '',
    onSearchChange: vi.fn(),
    statusFilter: 'open',
    onStatusChange: vi.fn(),
    originFilter: 'all',
    onOriginChange: vi.fn(),
    typeFilter: 'all',
    onTypeChange: vi.fn(),
    priorityFilter: 'all',
    onPriorityChange: vi.fn(),
    view: 'cards',
    sort: 'updated',
    onSortChange: vi.fn(),
    showAssigneeRow: true,
    assigneeOptions: [
      { username: 'alice', label: 'Alice', userId: 'u-1' },
      { username: 'bob', label: 'Bob', userId: 'u-2' },
    ],
    assigneeFilter: 'alice',
    onAssigneeChange: vi.fn(),
    searchActive: false,
    filtersEnabled: true,
    withinFilters: false,
    onWithinFiltersToggle: vi.fn(),
    allProjects: false,
    onAllProjectsToggle: vi.fn(),
    allProjectsDisabled: false,
    searchDegraded: false,
    onSearchPaste: vi.fn(),
    blobActive: false,
    collapsed: false,
    onToggleCollapsed: vi.fn(),
    filtersLayout: 'chips',
    onFiltersLayoutChange: vi.fn(),
    ...over,
  };
}

/** Status and assignee held in state, as the column holds them. */
function Harness({
  over,
  onStatus,
  onAssignee,
}: {
  over: Over;
  onStatus: (v: StatusFilter) => void;
  onAssignee: (v: string | null) => void;
}) {
  const props = baseProps(over);
  const [status, setStatus] = useState<StatusFilter>(props.statusFilter);
  const [assignee, setAssignee] = useState<string | null>(props.assigneeFilter);
  return (
    <MantineProvider forceColorScheme="dark">
      <TaskFilters
        {...props}
        statusFilter={status}
        onStatusChange={(v) => {
          onStatus(v);
          setStatus(v);
        }}
        assigneeFilter={assignee}
        onAssigneeChange={(v) => {
          onAssignee(v);
          setAssignee(v);
        }}
      />
    </MantineProvider>
  );
}

function renderPanel(over: Over = {}) {
  const onStatus = vi.fn();
  const onAssignee = vi.fn();
  render(<Harness over={over} onStatus={onStatus} onAssignee={onAssignee} />);
  return { onStatus, onAssignee };
}

const group = (name: string) => screen.getByRole('radiogroup', { name });
const chips = (name: string) => within(group(name)).getAllByRole('radio');
const picked = (name: string) =>
  chips(name).filter((el) => el.getAttribute('aria-checked') === 'true');
const tabStops = (name: string) =>
  chips(name).filter((el) => el.getAttribute('tabindex') === '0');

/** The whole Tab walk from `body` until it wraps back (or a hard limit). */
async function tabWalk(user: ReturnType<typeof userEvent.setup>): Promise<Element[]> {
  act(() => (document.activeElement as HTMLElement | null)?.blur());
  const seen: Element[] = [];
  for (let i = 0; i < 120; i += 1) {
    await user.tab();
    const el = document.activeElement;
    if (!el || el === document.body || seen.includes(el)) break;
    seen.push(el);
  }
  return seen;
}

const ROWS = ['Assignee', 'Status', 'Priority', 'Type', 'Source', 'Sort by'] as const;

// ───────────────────────────── every row ─────────────────────────────

describe('sk-491 — every chip row is one Tab stop, on the picked chip', () => {
  test('a full Tab walk visits each row exactly once, on its checked chip', async () => {
    const user = userEvent.setup();
    renderPanel();
    const walk = await tabWalk(user);
    for (const name of ROWS) {
      const visited = walk.filter((el) => group(name).contains(el));
      expect(visited, `${name}: Tab stops inside the row`).toEqual(picked(name));
      expect(picked(name)).toHaveLength(1);
      expect(tabStops(name)).toEqual(picked(name));
    }
  });
});

// ───────────────────────────── FilterChipRow ─────────────────────────────

describe('sk-491 — FilterChipRow (Status): arrows round the ring', () => {
  test('→ picks the next chip and moves focus; the last wraps to the first', async () => {
    const user = userEvent.setup();
    const { onStatus } = renderPanel({ statusFilter: 'open' });
    const all = chips('Status');
    const at = all.indexOf(picked('Status')[0]);
    act(() => all[at].focus());

    await user.keyboard('{ArrowRight}');
    expect(picked('Status')).toEqual([all[at + 1]]);
    expect(document.activeElement).toBe(all[at + 1]);
    expect(onStatus).toHaveBeenLastCalledWith('in_progress');

    act(() => all[all.length - 1].click());
    act(() => all[all.length - 1].focus());
    await user.keyboard('{ArrowRight}');
    expect(picked('Status')).toEqual([all[0]]);
    expect(document.activeElement).toBe(all[0]);
  });

  test('← from the first wraps to the last; ↓ / ↑ act like → / ←', async () => {
    const user = userEvent.setup();
    renderPanel({ statusFilter: 'active' });
    const all = chips('Status');
    expect(picked('Status')).toEqual([all[0]]);
    act(() => all[0].focus());

    await user.keyboard('{ArrowLeft}');
    expect(picked('Status')).toEqual([all[all.length - 1]]);
    expect(document.activeElement).toBe(all[all.length - 1]);

    await user.keyboard('{ArrowDown}');
    expect(picked('Status')).toEqual([all[0]]);
    expect(document.activeElement).toBe(all[0]);

    await user.keyboard('{ArrowDown}');
    expect(picked('Status')).toEqual([all[1]]);
    await user.keyboard('{ArrowUp}');
    expect(picked('Status')).toEqual([all[0]]);
    expect(document.activeElement).toBe(all[0]);
  });

  test('after an arrow the single Tab stop moves to the new pick', async () => {
    const user = userEvent.setup();
    renderPanel({ statusFilter: 'open' });
    const all = chips('Status');
    act(() => picked('Status')[0].focus());
    await user.keyboard('{ArrowRight}');
    expect(tabStops('Status')).toEqual(picked('Status'));
    const walk = await tabWalk(user);
    expect(walk.filter((el) => group('Status').contains(el))).toEqual(picked('Status'));
    expect(all.filter((el) => el.getAttribute('tabindex') === '-1')).toHaveLength(all.length - 1);
  });

  for (const mod of ['Alt', 'Control', 'Meta'] as const) {
    test(`an arrow under ${mod} changes nothing`, async () => {
      const user = userEvent.setup();
      const { onStatus } = renderPanel({ statusFilter: 'open' });
      const before = picked('Status')[0];
      act(() => before.focus());
      await user.keyboard(`{${mod}>}{ArrowRight}{/${mod}}`);
      expect(picked('Status')).toEqual([before]);
      expect(document.activeElement).toBe(before);
      expect(onStatus).not.toHaveBeenCalled();
    });
  }

  test('an inert row (unfiltered search) ignores arrows but keeps its Tab stop', async () => {
    const user = userEvent.setup();
    const { onStatus } = renderPanel({ statusFilter: 'open', filtersEnabled: false });
    const before = picked('Status')[0];
    expect(tabStops('Status')).toEqual([before]);
    act(() => before.focus());
    await user.keyboard('{ArrowRight}{ArrowLeft}{ArrowDown}');
    expect(onStatus).not.toHaveBeenCalled();
    expect(picked('Status')).toEqual([before]);
    expect(document.activeElement).toBe(before);
  });

  test('a value outside the option list leaves the FIRST chip as the Tab stop', async () => {
    // `unreviewed` without its chip: nothing is checked, and a row whose
    // every chip were -1 would drop out of the Tab order entirely.
    const user = userEvent.setup();
    const { onStatus } = renderPanel({ statusFilter: 'unreviewed', showUnreviewedChip: false });
    const all = chips('Status');
    expect(picked('Status')).toEqual([]);
    expect(tabStops('Status')).toEqual([all[0]]);
    act(() => all[0].focus());
    await user.keyboard('{ArrowRight}');
    expect(onStatus).toHaveBeenLastCalledWith('open');
    expect(document.activeElement).toBe(all[1]);
  });
});

// ───────────────────────────── AssigneeChipRow ─────────────────────────────

describe('sk-491 — AssigneeChipRow: arrows round "anyone" + the people', () => {
  test('→ walks Alice → Bob → anyone → Alice, moving focus and the Tab stop', async () => {
    const user = userEvent.setup();
    const { onAssignee } = renderPanel({ assigneeFilter: 'alice' });
    const [anyone, alice, bob] = chips('Assignee');
    expect(picked('Assignee')).toEqual([alice]);
    expect(tabStops('Assignee')).toEqual([alice]);
    act(() => alice.focus());

    await user.keyboard('{ArrowRight}');
    expect(onAssignee).toHaveBeenLastCalledWith('bob');
    expect(picked('Assignee')).toEqual([bob]);
    expect(document.activeElement).toBe(bob);
    expect(tabStops('Assignee')).toEqual([bob]);

    await user.keyboard('{ArrowRight}');
    expect(onAssignee).toHaveBeenLastCalledWith(null);
    expect(picked('Assignee')).toEqual([anyone]);
    expect(document.activeElement).toBe(anyone);

    await user.keyboard('{ArrowDown}');
    expect(picked('Assignee')).toEqual([alice]);
    expect(document.activeElement).toBe(alice);
  });

  test('← from "anyone" wraps to the last chip — the synthetic one included', async () => {
    const user = userEvent.setup();
    const { onAssignee } = renderPanel({ assigneeFilter: null });
    const all = chips('Assignee');
    expect(all).toHaveLength(3);
    act(() => all[0].focus());
    await user.keyboard('{ArrowUp}');
    expect(onAssignee).toHaveBeenLastCalledWith('bob');
    expect(document.activeElement).toBe(all[2]);

    // A filter naming someone outside the options draws an extra chip;
    // it is on the ring like any other.
    cleanup();
    renderPanel({ assigneeFilter: 'carol' });
    const withCarol = chips('Assignee');
    expect(withCarol).toHaveLength(4);
    expect(tabStops('Assignee')).toEqual([withCarol[3]]);
    act(() => withCarol[3].focus());
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(withCarol[0]);
  });

  test('an arrow under a modifier changes nothing', async () => {
    const user = userEvent.setup();
    const { onAssignee } = renderPanel({ assigneeFilter: 'alice' });
    const alice = picked('Assignee')[0];
    act(() => alice.focus());
    await user.keyboard('{Control>}{ArrowLeft}{/Control}');
    expect(onAssignee).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(alice);
  });
});
