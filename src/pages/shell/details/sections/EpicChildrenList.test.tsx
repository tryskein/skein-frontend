/**
 * sk-421.2 T019 — the body of the "List" mode (US-2, R-8, INV-7, SC-005).
 *
 * The component owns three messages and the rows. It is checked that the
 * messages mutually exclude each other in the right order and that the rows
 * are handed out as they are, without re-sorting: the order is set by the server (US-6), and
 * a second sort on the frontend could diverge from it.
 *
 * The test of the consumer file (the section) checks something ELSE: that the list
 * gets the right set of rows. Here it is what the list does with it.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { EpicChildrenList } from './EpicChildrenList';
import type {
  IssueTreeNode,
  IssueTreeRowItem,
  TreeBlockerRef,
} from '../../../../api/issues';

// sk-421.2.8 lines 40–41 — a blocker link navigates by path (R-17); a navigation
// spy catches the transition without requiring a real route. The earlier tests of the
// file do not navigate and do not notice the spy.
const router = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('react-router-dom', async (importActual) => {
  const actual = await importActual<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => router.navigate };
});

function wrap(node: ReactNode) {
  return render(<MantineProvider>{node}</MantineProvider>);
}

function row(
  id: string,
  item: Partial<IssueTreeRowItem> = {},
  node: Partial<IssueTreeNode> = {},
): IssueTreeNode {
  return {
    item: {
      id,
      projectId: 'proj-child',
      version: 1,
      title: id,
      type: 'task',
      priority: 2,
      status: 'open',
      pinned: false,
      assignee: null,
      componentIds: [],
      labels: [],
      isBlocked: false,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      ...item,
    } as IssueTreeRowItem,
    depth: 1,
    parentRef: { id: 'demo-32', edgeType: 'parent-child' },
    isReference: false,
    firstSeenAt: null,
    ...node,
  };
}

const NONE = {
  isLoading: false,
  tooLarge: false,
  error: null as unknown,
  onOpen: () => {},
  // sk-421.2.8 T011 — a required prop: the first-level ancestor for the focus fallback
  // target and the trigger for resetting the sub-row focus memory.
  epicId: 'demo-32',
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('EpicChildrenList', () => {
  test('an empty set draws neither a list nor a message', () => {
    const { container } = wrap(<EpicChildrenList rows={[]} {...NONE} />);
    expect(container.querySelector('.epic-children-list')).toBeNull();
    expect(container.querySelector('.col-empty')).toBeNull();
    // sk-421.3 T02 — the seventh structure guard, found by the test plan
    // (N-8). The assertion "there is no list" stays true under the PL-1 markup
    // only ON CONDITION that the category wrapper is not drawn for an empty
    // set either. The condition was implicit; here it is written down, and
    // T06 must hold it.
    expect(container.querySelector('.epic-children-groups')).toBeNull();
    expect(container.querySelectorAll('[data-epic-row]')).toHaveLength(0);
  });

  test('loading is reported separately from the rows', () => {
    wrap(<EpicChildrenList rows={[]} {...NONE} isLoading />);
    expect(screen.getByText('Loading children…')).toBeTruthy();
  });

  test('SC-005 — the "too large" refusal states the fact, with no advice about filters', () => {
    const { container } = wrap(<EpicChildrenList rows={[]} {...NONE} tooLarge />);
    expect(screen.getByText('Too many child issues')).toBeTruthy();
    expect(screen.queryByText(/Narrow the filter set/i)).toBeNull();
    // The refusal is announced to the screen reader.
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  test('the "too large" refusal outranks the error: one message, not two', () => {
    // The server returns 422 as an error, so `error` is filled in on a refusal
    // too. Showing both would explain one event twice.
    wrap(
      <EpicChildrenList rows={[]} {...NONE} tooLarge error={new Error('422')} />,
    );
    expect(screen.getByText('Too many child issues')).toBeTruthy();
    expect(screen.queryByText('Failed to load children')).toBeNull();
  });

  test('a load error is reported with its own text', () => {
    wrap(<EpicChildrenList rows={[]} {...NONE} error={new Error('boom')} />);
    expect(screen.getByText('Failed to load children')).toBeTruthy();
  });

  test('rows are handed out in the server order, without re-sorting', () => {
    const { container } = wrap(
      <EpicChildrenList
        rows={[row('sk-42.10'), row('sk-42.2'), row('sk-42.1')]}
        {...NONE}
      />,
    );
    // The selector is "a section row", not "a direct child of this `ul`":
    // under grouping (T06) there will be several lists, and a positional
    // selector would stay right by accident (sk-421.3 T02).
    const ids = Array.from(container.querySelectorAll('[data-epic-row]')).map(
      (li) => li.textContent ?? '',
    );
    expect(ids[0]).toContain('42.10');
    expect(ids[1]).toContain('42.2');
    expect(ids[2]).toContain('42.1');
  });

  test('an unavailable child is a "no access" row in the shared list', () => {
    const { container } = wrap(
      <EpicChildrenList
        rows={[
          row('sk-42.1'),
          row('hidden-1', { status: '', type: '' }, { isReference: true }),
        ]}
        {...NONE}
      />,
    );
    expect(container.querySelectorAll('[data-epic-row]')).toHaveLength(2);
    expect(screen.getByText('no access')).toBeTruthy();
  });
});

// ───────── sk-421.2.8 line 40 — "List": keyboard, description, accessible name ─────────

function vis(id: string): TreeBlockerRef {
  return { id, title: `Title ${id}`, status: 'open', projectId: 'proj-b' };
}

/** A is blocked by five entries (one hidden), a placeholder, B is an ordinary row. */
function listRows(withBlockers = true): IssueTreeNode[] {
  const blockers: TreeBlockerRef[] = [
    vis('p-1'),
    { id: 'q-9', redacted: true },
    vis('p-2'),
    vis('p-3'),
    vis('p-4'),
  ];
  return [
    row('sk-42.1', { isBlocked: true }, withBlockers ? { blockers } : {}),
    row('hidden-1', { status: '', type: '' }, { isReference: true }),
    row('sk-42.2'),
  ];
}

function renderList(rows: IssueTreeNode[], onOpen = vi.fn()) {
  const view = render(
    <MantineProvider>
      <MemoryRouter>
        <EpicChildrenList rows={rows} {...NONE} onOpen={onOpen} />
      </MemoryRouter>
    </MantineProvider>,
  );
  return { ...view, onOpen };
}

const ROW_A_NAME = 'Open child issue sk-42.1: sk-42.1';
const ROW_B_NAME = 'Open child issue sk-42.2: sk-42.2';

/** What is focused now, briefly, for the traversal sequence. */
function focused(): string {
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body) return 'body';
  return el.getAttribute('aria-label') ?? el.textContent ?? '?';
}

describe('EpicChildrenList — line 40, "List" keyboard', () => {
  afterEach(() => router.navigate.mockReset());

  test('Tab from the blocked child button: links 1–3 → "+N" → placeholder → next row; hidden ones are skipped', async () => {
    renderList(listRows());
    const user = userEvent.setup();
    screen.getByRole('button', { name: ROW_A_NAME }).focus();

    const walk: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      await user.tab();
      walk.push(focused());
    }
    expect(walk).toEqual(['p-1', 'p-2', '+2', 'no access', ROW_B_NAME]);
  });

  test('with "+N" expanded: "+N" → entries of the expanded list; sub-row entries 1–3 have tabIndex -1 but are clickable', async () => {
    const { container } = renderList(listRows());
    const user = userEvent.setup();
    const more = screen.getByRole('button', { name: '+2' });
    await user.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');

    more.focus();
    const walk: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      await user.tab();
      walk.push(focused());
    }
    expect(walk).toEqual(['p-1', 'p-2', 'p-3', 'p-4', 'no access']);

    const line = container.querySelector<HTMLElement>('.epic-child-blockers-line')!;
    const inlineLinks = Array.from(line.querySelectorAll<HTMLButtonElement>('.detail-row-link')).filter(
      (b) => b !== more,
    );
    expect(inlineLinks.map((b) => [b.textContent, b.tabIndex])).toEqual([
      ['p-1', -1],
      ['p-2', -1],
    ]);
    await user.click(inlineLinks[0]);
    expect(router.navigate).toHaveBeenCalledWith('/projects/proj-b/issues/p-1');
  });

  test('Enter and space on a link → navigates to the blocker, the child onOpen is not called', async () => {
    const { onOpen } = renderList(listRows());
    const user = userEvent.setup();

    screen.getByRole('button', { name: 'p-1' }).focus();
    await user.keyboard('{Enter}');
    expect(router.navigate).toHaveBeenLastCalledWith('/projects/proj-b/issues/p-1');

    screen.getByRole('button', { name: 'p-2' }).focus();
    await user.keyboard(' ');
    expect(router.navigate).toHaveBeenLastCalledWith('/projects/proj-b/issues/p-2');

    expect(router.navigate).toHaveBeenCalledTimes(2);
    expect(onOpen).not.toHaveBeenCalled();
  });

  test('Enter on "+N" toggles the expansion, focus stays on "+N", aria-expanded toggles', async () => {
    const { onOpen } = renderList(listRows());
    const user = userEvent.setup();
    const more = screen.getByRole('button', { name: '+2' });
    more.focus();

    await user.keyboard('{Enter}');
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(more);

    await user.keyboard('{Enter}');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(more);
    expect(onOpen).not.toHaveBeenCalled();
  });

  test('aria-describedby of the row button: three entries and "N more" collapsed, all entries expanded', async () => {
    renderList(listRows());
    const user = userEvent.setup();
    const rowButton = screen.getByRole('button', { name: ROW_A_NAME });
    const describedText = () =>
      (rowButton.getAttribute('aria-describedby') ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ');

    expect(describedText()).toBe('blocked: p-1 · open, unavailable, p-2 · open, 2 more');

    await user.click(screen.getByRole('button', { name: '+2' }));
    expect(describedText()).toBe(
      'blocked: p-1 · Title p-1 · open, unavailable, p-2 · Title p-2 · open, p-3 · Title p-3 · open, p-4 · Title p-4 · open',
    );
    // A row without a sub-row has nothing to describe.
    expect(screen.getByRole('button', { name: ROW_B_NAME }).hasAttribute('aria-describedby')).toBe(
      false,
    );
  });

  test('the accessible name of the row button equals the name of the same row without the blockers field', () => {
    const withIt = renderList(listRows(true));
    const nameWith = within(withIt.container).getByRole('button', { name: ROW_A_NAME });
    expect(nameWith).toBeTruthy();
    withIt.unmount();

    const without = renderList(listRows(false));
    // An exact name match by role: sub-row text that got into the name
    // would make this search empty.
    expect(within(without.container).getByRole('button', { name: ROW_A_NAME })).toBeTruthy();
    expect(without.container.querySelector('.epic-child-blockers')).toBeNull();
  });
});

// ───────── sk-421.2.8 line 41 — focus on element disappearance and retention (R-14) ─────────
//
// (b1) and (b2), the section's fallback target, are checked in EpicProgressSection.test.tsx
// with a real "List": the target is performed by the section.

function listUi(rows: IssueTreeNode[], onOpen: (id: string, projectId: string) => void = () => {}) {
  return (
    <MantineProvider>
      <MemoryRouter>
        <EpicChildrenList rows={rows} {...NONE} onOpen={onOpen} />
      </MemoryRouter>
    </MantineProvider>
  );
}

/** Let the deferred `focusout` check run. */
async function flushFocusOut() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}

describe('EpicChildrenList — line 41, sub-row focus memory', () => {
  test('(a) focus on a link, a re-read removes the display for the child → focus on the child row button', () => {
    const { rerender } = render(
      listUi([row('sk-42.1', { isBlocked: true }, { blockers: [vis('p-1')] }), row('sk-42.2')]),
    );
    screen.getByRole('button', { name: 'p-1' }).focus();
    expect(focused()).toBe('p-1');

    rerender(listUi([row('sk-42.1', { isBlocked: false }, { blockers: [vis('p-1')] }), row('sk-42.2')]));

    expect(screen.queryByRole('button', { name: 'p-1' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: ROW_A_NAME }));
  });

  test('(c) focus left "+N" for body by a click on a non-focusable area, then "+N" disappeared → focus is not moved', async () => {
    const five = [vis('p-1'), vis('p-2'), vis('p-3'), vis('p-4'), vis('p-5')];
    const user = userEvent.setup();
    const { container, rerender } = render(
      listUi([row('sk-42.1', { isBlocked: true }, { blockers: five })]),
    );
    screen.getByRole('button', { name: '+2' }).focus();
    expect(focused()).toBe('+2');

    // A click on a non-focusable area: focus goes to body.
    await user.click(container.querySelector('.epic-child-blockers-prefix')!);
    await flushFocusOut();
    expect(document.activeElement).toBe(document.body);

    rerender(listUi([row('sk-42.1', { isBlocked: true }, { blockers: five.slice(0, 3) })]));
    expect(screen.queryByRole('button', { name: '+2' })).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  test('(d) an entry of the same blocker kept its place while neighbours shifted → focus on the same element', () => {
    const { rerender } = render(
      listUi([row('sk-42.1', { isBlocked: true }, { blockers: [vis('p-1'), vis('p-2'), vis('p-3')] })]),
    );
    const before = screen.getByRole('button', { name: 'p-2' });
    before.focus();

    // p-1 left, the neighbours shifted; p-2 stayed in the sub-row of the same row.
    rerender(listUi([row('sk-42.1', { isBlocked: true }, { blockers: [vis('p-2'), vis('p-3')] })]));

    expect(focused()).toBe('p-2');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'p-2' }));
  });

  test('(e) A, X, B: focus went from the link of A to B; one re-read removes the sub-row of A and the row B → focus on X', () => {
    const rowsBefore = [
      row('sk-42.1', { isBlocked: true }, { blockers: [vis('p-1')] }),
      row('sk-42.5'),
      row('sk-42.2'),
    ];
    const { rerender } = render(listUi(rowsBefore));
    screen.getByRole('button', { name: 'p-1' }).focus();
    // A move inside the list: the memory of the link of A must be erased here.
    screen.getByRole('button', { name: ROW_B_NAME }).focus();

    rerender(
      listUi([row('sk-42.1', { isBlocked: false }, { blockers: [vis('p-1')] }), row('sk-42.5')]),
    );

    const active = document.activeElement;
    expect(active).not.toBe(screen.getByRole('button', { name: ROW_A_NAME }));
    expect(active?.closest('.epic-child-blockers')).toBeFalsy();
    // sk-444 — the row with focus (B) disappeared: the sk-421.2 US-2 fallback target,
    // the nearest row above, is X.
    expect(active).toBe(screen.getByRole('button', { name: 'Open child issue sk-42.5: sk-42.5' }));
  });
});

// ───────── sk-421.3 T03 — identifying a row by key, not by position ─────────

describe('EpicChildrenList — T03, non-positional row identification', () => {
  test('P-76 — each row carries its OWN key, including the placeholder', () => {
    const { container } = renderList(listRows());
    const keys = Array.from(container.querySelectorAll('[data-epic-row]')).map((li) =>
      li.getAttribute('data-epic-row-key'),
    );

    // The keys are written as LITERALS, not computed by the same function that
    // computes them in the component: a test that took the key from the implementation
    // would agree with any change of it, including a return to
    // identification by position.
    //
    // The placeholder is the central case: its key is built on the ancestor and
    // the number, NOT on the synthetic id `hidden-1`, because such an id is not stable
    // between re-reads (F-22).
    expect(keys).toEqual(['id:sk-42.1', 'stub:demo-32:0', 'id:sk-42.2']);
  });

  test('P-76 — a row changed position, its sub-row element disappeared → focus on the same row', () => {
    const rowA = (blocked: boolean) =>
      row('sk-42.1', { isBlocked: blocked }, blocked ? { blockers: [vis('p-1')] } : {});

    const { rerender } = render(listUi([rowA(true), row('sk-42.5'), row('sk-42.2')]));
    screen.getByRole('button', { name: 'p-1' }).focus();
    expect(focused()).toBe('p-1');

    // Row A moved to the end, and the blocking display was removed from it:
    // the remembered element disappeared, the row itself stayed, but at ANOTHER
    // place. A search by the index of the former position would carry focus to someone else's
    // row.
    rerender(listUi([row('sk-42.5'), row('sk-42.2'), rowA(false)]));

    expect(screen.queryByRole('button', { name: 'p-1' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: ROW_A_NAME }));
  });
});

// ───────── sk-421.3 T02 — the number of "List" traversal points (INV-5, SC-010) ─────────
//
// Today's number is pinned by a REFERENCE before the markup moves:
// SC-010 promises that there will be no more traversal points inside the list given the
// same data. Any task that adds a point INSIDE the rows (a category
// heading, a grouping control, a new control in a row) goes red here
// immediately, and must explain the increase instead of discovering it later.
//
// It is counted with a real `Tab` through `userEvent`, NOT by counting `tabIndex`:
// the attribute proves half of the contract (the same argument is recorded in the docblock
// `EpicChildrenTree.test.tsx#proves only half`). The set is fixed and
// covers all
// three kinds of row: a blocked one with a sub-row, a "no
// access" placeholder, an ordinary one.

describe('EpicChildrenList — T02, the number of sequential traversal points', () => {
  /**
   * A run of a real `Tab` over the set with the given grouping.
   *
   * ⚠ M-3 — before, the guard ran the set ONLY without grouping, so
   * the new markup was never walked by a real `Tab`: the SC-010 promise
   * ("there will be no more traversal points given the same data") was not checked at all for the mode
   * the markup was introduced for.
   */
  async function walk(grouped: boolean, expand: boolean) {
    const view = render(
      <MantineProvider>
        <MemoryRouter>
          <button type="button">before</button>
          <EpicChildrenList rows={listRows()} {...NONE} onOpen={vi.fn()} grouped={grouped} />
          <button type="button">after</button>
        </MemoryRouter>
      </MantineProvider>,
    );
    if (expand) fireEvent.click(screen.getByRole('button', { name: '+2' }));

    const user = userEvent.setup();
    screen.getByRole('button', { name: 'before' }).focus();

    const stops: string[] = [];
    let stopsInsideHead = 0;
    for (let i = 0; i < 30; i += 1) {
      await user.tab();
      const el = document.activeElement as HTMLElement;
      const label = focused();
      if (label === 'after') break;
      if (el?.closest?.('.epic-category-head')) stopsInsideHead += 1;
      stops.push(label);
    }

    // The focusable thing INSIDE a category heading is what makes this check
    // go red on a button nested in a heading.
    const focusableInHeads = Array.from(
      view.container.querySelectorAll('.epic-category-head'),
    ).flatMap((h) =>
      Array.from(
        h.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]'),
      ).filter((el) => el.tabIndex >= 0),
    );

    const heads = view.container.querySelectorAll('.epic-category-head').length;
    view.unmount();
    return { stops, stopsInsideHead, focusableInHeads: focusableInHeads.length, heads };
  }

  test('reference without grouping: exactly as many points as today', async () => {
    const { stops } = await walk(false, false);
    // Row A, two visible links of its sub-row, "+2", the placeholder, row B.
    // A hidden entry is not a traversal point.
    expect(stops).toEqual([ROW_A_NAME, 'p-1', 'p-2', '+2', 'no access', ROW_B_NAME]);
    expect(stops, 'the number of traversal points inside "List" changed').toHaveLength(6);
  });

  test('M-3 — grouping neither adds nor removes traversal points (SC-010)', async () => {
    const off = await walk(false, false);
    const on = await walk(true, false);

    // Grouping REALLY rebuilt the markup, otherwise the comparison
    // below would be a comparison of a set with itself.
    expect(off.heads, 'there must be no headings without grouping').toBe(0);
    expect(on.heads, 'there are no headings under grouping, the markup is wrong').toBeGreaterThan(0);

    // Compared as a SET, not by order: under grouping the placeholder
    // moves to its own category, and the order is legitimately different. The SC-010 promise
    // is about the COMPOSITION and NUMBER of points, not their sequence.
    expect([...on.stops].sort()).toEqual([...off.stops].sort());
    expect(on.stops, 'grouping changed the number of traversal points').toHaveLength(off.stops.length);
  });

  test('M-3 — with "+N" EXPANDED the points are the same under both settings', async () => {
    const off = await walk(false, true);
    const on = await walk(true, true);

    // Expanding must add points, otherwise the run "with "+N" expanded"
    // is no different from the run with it closed and checks the same thing.
    const closed = await walk(false, false);
    expect(off.stops.length, 'expanding "+N" added no points').toBeGreaterThan(
      closed.stops.length,
    );

    expect([...on.stops].sort()).toEqual([...off.stops].sort());
    expect(on.stops).toHaveLength(off.stops.length);
  });

  test('M-3 — a category heading carries no traversal point, even a nested one', () => {
    // A heading is not a traversal point (SC-010), and this must hold not
    // only on its lacking a `tabindex`: a button nested IN it
    // would become a traversal point without violating the earlier check.
    return walk(true, false).then(({ stopsInsideHead, focusableInHeads }) => {
      expect(focusableInHeads, 'there is a focusable element inside a category heading').toBe(0);
      expect(stopsInsideHead, 'the traversal stopped inside a category heading').toBe(0);
    });
  });
});

// ───────── sk-421.3 T06 — "List" categories (US-1, PK-1, SC-003) ─────────

/** Five entries, one hidden: the sub-row has two visible links and "+2". */
function fiveBlockers(): TreeBlockerRef[] {
  return [vis('p-1'), { id: 'q-9', redacted: true }, vis('p-2'), vis('p-3'), vis('p-4')];
}

/** A list with CONTROLLED grouping, for "on versus off" comparisons. */
function listUiG(rows: IssueTreeNode[], grouped: boolean) {
  return (
    <MantineProvider>
      <MemoryRouter>
        <EpicChildrenList rows={rows} {...NONE} grouped={grouped} />
      </MemoryRouter>
    </MantineProvider>
  );
}

/** A set with all the interesting states: three statuses, a blocker, a placeholder. */
function mixedRows(): IssueTreeNode[] {
  return [
    row('sk-42.1', { status: 'open' }),
    row('sk-42.2', { status: 'in_progress', isBlocked: true }, { blockers: [vis('p-1')] }),
    row('hidden-1', { status: '', type: '' }, { isReference: true }),
    row('sk-42.3', { status: 'deferred' }),
  ];
}

function renderGrouped(rows: IssueTreeNode[]) {
  return render(
    <MantineProvider>
      <MemoryRouter>
        <EpicChildrenList rows={rows} {...NONE} grouped />
      </MemoryRouter>
    </MantineProvider>,
  );
}

const headsOf = (c: HTMLElement) =>
  Array.from(c.querySelectorAll<HTMLElement>('.epic-category-head'));

describe('EpicChildrenList — T06, categories', () => {
  test('P-22 — grouping is OFF: the markup matches today\'s (SC-003)', () => {
    const { container } = renderList(mixedRows());
    // One list, no wrapper, no headings: letter for letter as before the feature.
    expect(container.querySelectorAll('.epic-children-list')).toHaveLength(1);
    expect(container.querySelector('.epic-children-groups')).toBeNull();
    expect(headsOf(container)).toHaveLength(0);
    // ...and the row order is the server's, not categorized.
    const ids = Array.from(container.querySelectorAll('[data-epic-row]')).map(
      (li) => li.getAttribute('data-epic-row-key'),
    );
    expect(ids).toEqual([
      'id:sk-42.1',
      'id:sk-42.2',
      'stub:demo-32:0',
      'id:sk-42.3',
    ]);
  });

  test('P-09 — the heading prints the contract value in English words', () => {
    const { container } = renderGrouped(mixedRows());
    const labels = headsOf(container).map(
      (h) => h.querySelector('.epic-category-label')?.textContent,
    );
    // The category order is PK-1, and it does not depend on the data order.
    // `in_progress` is printed as "in progress": the spelling is taken from
    // the shared `statusChipText`, no second rule is made (INV-1).
    expect(labels).toEqual(['in progress', 'open', 'deferred', 'unavailable']);
    expect(labels.join(' ')).not.toContain('in_progress');
  });

  test('P-10 — "unavailable" is last, the label is localized', () => {
    const { container } = renderGrouped(mixedRows());
    const labels = headsOf(container).map(
      (h) => h.querySelector('.epic-category-label')?.textContent,
    );
    expect(labels[labels.length - 1]).toBe('unavailable');
    // The placeholder row lies exactly in it, not in a status category.
    const lastList = Array.from(container.querySelectorAll('ul.epic-children-list')).pop()!;
    const keys = Array.from(lastList.querySelectorAll('[data-epic-row]')).map((li) =>
      li.getAttribute('data-epic-row-key'),
    );
    expect(keys).toEqual(['stub:demo-32:0']);
  });

  test('P-78 — the category `ul` is named by the heading, the name carries the label AND the counter', () => {
    const { container } = renderGrouped(mixedRows());
    const lists = Array.from(container.querySelectorAll<HTMLElement>('ul.epic-children-list'));
    expect(lists).toHaveLength(4);

    for (const list of lists) {
      const headId = list.getAttribute('aria-labelledby');
      expect(headId, 'the category list is not named').toBeTruthy();
      // Looked up by id directly, not by a selector: there is no `CSS.escape` in jsdom
      // at all (the `CSS` object does not exist there). Escaping is not
      // needed here either: `categoryHeadId` leaves only
      // [A-Za-z0-9_-] in the identifier, reversibly encoding everything else (m-10).
      const head = document.getElementById(headId!);
      expect(head, `heading ${headId} not found`).not.toBeNull();

      const label = head!.querySelector('.epic-category-label')!.textContent!;
      const count = list.querySelectorAll('[data-epic-row]').length;
      const name = head!.getAttribute('aria-label') ?? '';
      // m-6 — first make sure there IS something to compare with: `toContain('')`
      // is true for any string, and on an empty label both checks below
      // would pass, checking nothing. An empty heading with a counter is
      // exactly the outcome the maintainers rejected in PK-1 item 4.
      expect(label.trim(), 'the category label is empty, toContain() degenerated').not.toBe('');
      expect(count, 'a category without rows is not drawn (P-03)').toBeGreaterThan(0);
      expect(name, `the name of category ${label} does not carry the label`).toContain(label);
      expect(name, `the name of category ${label} does not carry the counter`).toContain(String(count));
    }
  });

  test('P-79 — the counter is not read as part of the first row of the category', () => {
    const { container } = renderGrouped(mixedRows());
    for (const count of container.querySelectorAll('.epic-category-count')) {
      // The counter lives in the heading, outside the `ul`, so it cannot get
      // into a row, and if it did, a screen reader would read it as part of the
      // first row of the category.
      expect(count.closest('[data-epic-row]'), 'the counter ended up inside a row').toBeNull();
      expect(count.closest('ul.epic-children-list'), 'the counter ended up inside a list').toBeNull();
    }
    // The heading is not a traversal point here (SC-010).
    for (const head of headsOf(container)) {
      expect(head.hasAttribute('tabindex')).toBe(false);
    }
  });

  test('P-74 — placeholder keys match with grouping on and off (m-10)', () => {
    // The placeholder number is counted among placeholders of THE SAME depth under the same
    // ancestor in display order. In "List" all rows are depth 1, the ancestor of
    // all is the epic itself, and PK-1 puts all placeholders in one category, without
    // changing their relative order. So the number must be the same.
    // Rows of DIFFERENT statuses deliberately stand between the placeholders: under
    // grouping they spread across categories, and if the number
    // were counted by screen order, it would move.
    const rows = [
      row('hidden-1', { status: '', type: '' }, { isReference: true }),
      row('sk-42.1', { status: 'closed' }),
      row('sk-42.2', { status: 'in_progress' }),
      row('hidden-2', { status: '', type: '' }, { isReference: true }),
    ];
    const stubKeys = (c: HTMLElement) =>
      Array.from(c.querySelectorAll('[data-epic-row]'))
        .map((li) => li.getAttribute('data-epic-row-key'))
        .filter((k) => k?.startsWith('stub:'));

    const off = renderList(rows);
    const before = stubKeys(off.container);
    off.unmount();

    const on = renderGrouped(rows);
    const after = stubKeys(on.container);

    expect(before).toEqual(['stub:demo-32:0', 'stub:demo-32:1']);
    expect(after, 'the placeholder number moved under grouping').toEqual(before);
  });

  test('P-71 — toggling grouping itself resets the "+N" expansion (m-14)', () => {
    const rows = [row('sk-42.1', { isBlocked: true }, { blockers: fiveBlockers() })];
    const view = render(listUiG(rows, true));

    fireEvent.click(screen.getByRole('button', { name: '+2' }));
    expect(screen.getByRole('button', { name: '+2' }).getAttribute('aria-expanded')).toBe('true');

    // One `ul` <-> several: the row's parent is different, React mounts the
    // subtree anew, and the sub-row's local state disappears with
    // it. m-14 is satisfied by the STRUCTURE, not by a separate reset.
    view.rerender(listUiG(rows, false));

    expect(screen.getByRole('button', { name: '+2' }).getAttribute('aria-expanded')).toBe('false');
    expect(view.container.querySelector('.epic-child-blockers-list')).toBeNull();
  });

  test('P-70 — a row moving between categories resets the expansion (m-2)', () => {
    // The move is "open → deferred", NOT "open → closed": a terminal
    // status clears the derived blocked marker, and the whole sub-row
    // disappears with it, so there would be nothing to observe "the expansion is reset" on,
    // and the check would pass for another reason. `deferred` changes the category
    // and keeps the sub-row.
    const subject = (status: 'open' | 'deferred') =>
      row('sk-42.1', { status, isBlocked: true }, { blockers: fiveBlockers() });
    const other = row('sk-42.9', { status: 'in_progress' });

    const view = render(listUiG([subject('open'), other], true));
    fireEvent.click(screen.getByRole('button', { name: '+2' }));
    expect(screen.getByRole('button', { name: '+2' }).getAttribute('aria-expanded')).toBe('true');

    // ⚠ M-4 — FOCUS. Before, `.focus()` was not called in this check
    // at all, and half of the US-8 acceptance, "focus on the row of the same child
    // in the new category", was proven by nothing: the test looked only at the
    // expansion reset.
    screen.getByRole('button', { name: '+2' }).focus();
    expect(focused(), 'focus did not land on the sub-row element').toBe('+2');

    // The same row changed status and moved to another category, that
    // is to another `ul`.
    view.rerender(listUiG([subject('deferred'), other], true));

    expect(screen.getByRole('button', { name: '+2' }).getAttribute('aria-expanded')).toBe('false');
    expect(view.container.querySelector('.epic-child-blockers-list')).toBeNull();
    // The row has not gone anywhere, though: it is in the category of its status.
    expect(screen.getByRole('button', { name: ROW_A_NAME })).toBeTruthy();

    // The category was remounted, and with it the sub-row. Focus
    // must stay on the row of THE SAME child: not go to `body` and not
    // jump to a neighbouring row that survived in its own category.
    //
    // A ROW is checked, not a specific element inside it, and this is not a
    // weakening: the US-8 acceptance says "focus on the row of the same
    // child", and which of its elements picks up focus is decided by the shared
    // restore rule (the remembered sub-row element if it is
    // redrawn, otherwise the row button). Demanding exactly the button here
    // would pin the rule's internals instead of its promise.
    const active = document.activeElement as HTMLElement | null;
    expect(active, 'focus went to body on a move between categories').not.toBe(document.body);
    expect(
      active?.closest('[data-epic-row]')?.getAttribute('data-epic-row-key'),
      'focus went to someone else\'s row on a move between categories',
    ).toBe('id:sk-42.1');
  });

  test('P-69 — the focus memory is the same with grouping on and off', () => {
    const withSubline = (blocked: boolean) =>
      row('sk-42.1', { isBlocked: blocked }, blocked ? { blockers: [vis('p-1')] } : {});

    const focusAfterDrop = (grouped: boolean) => {
      const view = render(listUiG([withSubline(true), row('sk-42.2')], grouped));
      screen.getByRole('button', { name: 'p-1' }).focus();
      expect(focused()).toBe('p-1');
      // The blocking display is removed: the remembered element disappeared, the row is intact.
      view.rerender(listUiG([withSubline(false), row('sk-42.2')], grouped));
      const active = focused();
      view.unmount();
      return active;
    };

    expect(focusAfterDrop(false)).toBe(ROW_A_NAME);
    expect(focusAfterDrop(true), 'under grouping the focus memory behaves differently').toBe(
      ROW_A_NAME,
    );
  });

  test('P-72 — focus that went OUTSIDE the list is not intercepted by the restore (m-14)', () => {
    // The grouping control lives in the section, outside the list; here an adjacent
    // button plays its role. If focus went to it, the list has no right to
    // take it away, even when the remembered element has disappeared.
    const withSubline = (blocked: boolean) =>
      row('sk-42.1', { isBlocked: blocked }, blocked ? { blockers: [vis('p-1')] } : {});
    const ui = (blocked: boolean) => (
      <MantineProvider>
        <MemoryRouter>
          <EpicChildrenList rows={[withSubline(blocked), row('sk-42.2')]} {...NONE} grouped />
          <button type="button">organ</button>
        </MemoryRouter>
      </MantineProvider>
    );

    const view = render(ui(true));
    screen.getByRole('button', { name: 'p-1' }).focus();
    const organ = screen.getByRole('button', { name: 'organ' });
    organ.focus();

    view.rerender(ui(false));

    expect(document.activeElement, 'the list took focus away from the control').toBe(organ);
  });

  test('P-73 — the fallback target follows the SERVER order, the same under both settings', () => {
    // The row with focus disappears entirely. The target must be chosen by the
    // server order, not the screen order: otherwise grouping would give a
    // different target on the same data (PK-2 item 3). The statuses are chosen so
    // that the screen order under grouping DIFFERS from the server one.
    // `deferred`, not `closed`: a terminal status would clear the blocked marker
    // together with the sub-row, and there would be nothing to focus.
    const gone = row('sk-42.1', { status: 'deferred', isBlocked: true }, { blockers: [vis('p-1')] });
    // The server order of the survivors is "open, in_progress"; the screen order under
    // grouping is the reverse (PK-1 puts `in progress` first). So
    // "the first shown row" by the server is sk-42.2, and by the screen sk-42.3,
    // and a substitution of the order would become visible.
    const rest = [row('sk-42.2', { status: 'open' }), row('sk-42.3', { status: 'in_progress' })];

    const targetAfterDrop = (grouped: boolean) => {
      const view = render(listUiG([gone, ...rest], grouped));
      screen.getByRole('button', { name: 'p-1' }).focus();
      view.rerender(listUiG(rest, grouped));
      const active = focused();
      view.unmount();
      return active;
    };

    const off = targetAfterDrop(false);
    const on = targetAfterDrop(true);
    // The target is named explicitly, not merely compared with itself: two identical
    // halves would be identical also if both took
    // the screen order.
    expect(off, 'the fallback target was not taken by the server order').toBe(
      'Open child issue sk-42.2: sk-42.2',
    );
    expect(on, 'grouping changed the fallback target, so the screen order was used').toBe(off);
  });

  test('P-68 — the blockers sub-row is directly under its row and in the same category', () => {
    const { container } = renderGrouped(mixedRows());
    const subline = container.querySelector('.epic-child-blockers');
    expect(subline, 'the sub-row is not rendered').not.toBeNull();

    // INV-3: the sub-row is in THE SAME `li` as its row...
    const li = subline!.closest('[data-epic-row]');
    expect(li).not.toBeNull();
    expect(li!.getAttribute('data-epic-row-key')).toBe('id:sk-42.2');
    // ...and the `li` lies in the category of the status the row has.
    const head = document.getElementById(
      li!.closest('ul')!.getAttribute('aria-labelledby')!,
    );
    expect(head, 'the row list is not named by a heading').not.toBeNull();
    expect(head!.querySelector('.epic-category-label')!.textContent).toBe('in progress');
  });
});

// ───────── sk-421.3 T13a — the "no status" category (PK-1 item 4, SC-002) ─────────
//
// A row with an EMPTY status that is not an unavailable-task placeholder: it
// does not satisfy the triple predicate of PK-1 item 1, and items 2 and 3 require a
// non-empty status. Until it was fixed it fell past all three branches
// and ended up in the tail category of the empty value, that is under an
// EMPTY heading and in a position decided by the composition of the data.
//
// The server does not produce such rows today, but the contract does not
// guarantee that, and the distribution rule must be complete: a silent
// disappearance of a row from the counters (INV-4) is worse than a category
// nobody will see.

describe('EpicChildrenList — T13a, the "no status" category', () => {
  /** An ordinary row with an empty status: the type is non-empty, it is not a reference. */
  const noStatus = (id: string) => row(id, { status: '' });

  /**
   * A row with ANY status value, including one the client
   * does not know. The cast here is not carelessness: `IssueStatus` is a closed
   * union describing what the client KNOWS, while on the wire anything
   * happens (a server newer than the client is routine). Without
   * the cast an unknown value could not even be fed in,
   * that is the behaviour the tail categories exist for could not be
   * checked. The same approach is in `epicChildCategories.test.ts`.
   */
  const wireStatus = (id: string, status: string) =>
    row(id, { status } as Partial<IssueTreeRowItem>);

  test('the label is LOCALIZED and non-empty (the maintainers rejected an empty heading)', () => {
    const { container } = renderGrouped([row('sk-42.1', { status: 'open' }), noStatus('sk-42.7')]);
    const labels = headsOf(container).map(
      (h) => h.querySelector('.epic-category-label')?.textContent ?? '',
    );
    expect(labels).toEqual(['open', 'no status']);
    expect(labels[1].trim(), 'the "no status" category label is empty').not.toBe('');
  });

  test('SC-002 — second to last: after the tail ones, BEFORE "unavailable"', () => {
    // The input DISCRIMINATES: the row with an empty status stands first, the tail
    // value after it. If "no status" lay in the table of tail
    // categories, the first-appearance order would put it before `weird`,
    // and the screen order would differ from the required one. Remove the fourth
    // distribution branch and this test goes red.
    const { container } = renderGrouped([
      noStatus('sk-42.7'),
      wireStatus('sk-42.8', 'weird'),
      row('hidden-1', { status: '', type: '' }, { isReference: true }),
      row('sk-42.1', { status: 'open' }),
    ]);
    const labels = headsOf(container).map(
      (h) => h.querySelector('.epic-category-label')?.textContent,
    );
    expect(labels).toEqual(['open', 'weird', 'no status', 'unavailable']);
  });

  test('the rows lie exactly in it, the counter matches the shown ones (INV-4)', () => {
    const { container } = renderGrouped([
      noStatus('sk-42.7'),
      row('sk-42.1', { status: 'open' }),
      noStatus('sk-42.9'),
    ]);
    const heads = headsOf(container);
    const lists = Array.from(container.querySelectorAll<HTMLElement>('ul.epic-children-list'));
    expect(heads.map((h) => h.querySelector('.epic-category-label')?.textContent)).toEqual([
      'open',
      'no status',
    ]);
    expect(lists[1].querySelectorAll('[data-epic-row]')).toHaveLength(2);
    expect(heads[1].querySelector('.epic-category-count')?.textContent).toBe('2');
    // The order inside a category is the input one, without a single sort (R-2).
    const ids = Array.from(lists[1].querySelectorAll('[data-epic-row]')).map((li) =>
      li.getAttribute('data-epic-row-key'),
    );
    expect(ids).toEqual(['id:sk-42.7', 'id:sk-42.9']);
  });

  test('m-10 — two categories do not share one heading identifier', () => {
    // The value of an unknown status comes OVER THE WIRE, so "such
    // values do not exist" is not an argument here. Before, everything non-alphanumeric
    // collapsed into a hyphen, and `a:b` with `a-b` gave one `id`; two
    // elements with one identifier break `aria-labelledby`, and a screen reader
    // would name both categories by the first heading.
    const { container } = renderGrouped([
      wireStatus('sk-42.1', 'a:b'),
      wireStatus('sk-42.2', 'a-b'),
    ]);
    const ids = headsOf(container).map((h) => h.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size, 'two categories share one identifier').toBe(2);
    // ...and each list is named by ITS OWN heading, not a neighbouring one.
    const named = Array.from(container.querySelectorAll('ul.epic-children-list')).map(
      (l) =>
        document
          .getElementById(l.getAttribute('aria-labelledby')!)!
          .querySelector('.epic-category-label')!.textContent,
    );
    expect(named).toEqual(['a:b', 'a-b']);
  });
});
// ───────── sk-444 — the ROW with focus disappeared (sk-421.2 US-2 "Focus fallback target", SC-013) ─────────
//
// A row button unmounted by a re-read gives focus to `body`.
// The target is chosen by the SERVER order (sk-421.3 PK-2 item 3), so with
// grouping on and off it is the same. The switch and
// "Add child" are handled by the section via `onFocusFallback`.

describe('sk-444 — "List": the row with focus disappeared', () => {
  const openName = (id: string) => `Open child issue ${id}: ${id}`;

  function ui(rows: IssueTreeNode[], grouped: boolean, onFocusFallback?: () => void) {
    return (
      <MantineProvider>
        <MemoryRouter>
          <EpicChildrenList rows={rows} {...NONE} grouped={grouped} onFocusFallback={onFocusFallback} />
        </MemoryRouter>
      </MantineProvider>
    );
  }

  function focusButton(id: string) {
    const el = screen.getByRole('button', { name: openName(id) });
    act(() => el.focus());
    expect(document.activeElement).toBe(el);
  }

  const AXB = () => [row('sk-42.1'), row('sk-42.5'), row('sk-42.2')];

  for (const grouped of [false, true]) {
    const mode = grouped ? 'grouping on' : 'grouping off';

    test(`${mode}: the row with focus disappeared → the button of the nearest row above`, () => {
      const { rerender } = render(ui(AXB(), grouped));
      focusButton('sk-42.2');

      rerender(ui([row('sk-42.1'), row('sk-42.5')], grouped));

      expect(document.activeElement).toBe(screen.getByRole('button', { name: openName('sk-42.5') }));
    });

    test(`${mode}: the first row disappeared → the button of the first row`, () => {
      const { rerender } = render(ui(AXB(), grouped));
      focusButton('sk-42.1');

      rerender(ui([row('sk-42.5'), row('sk-42.2')], grouped));

      expect(document.activeElement).toBe(screen.getByRole('button', { name: openName('sk-42.5') }));
    });

    test(`${mode}: no rows left → the fallback target is requested from the section`, () => {
      const fallback = vi.fn();
      const { rerender } = render(ui(AXB(), grouped, fallback));
      focusButton('sk-42.5');

      rerender(ui([], grouped, fallback));

      expect(fallback).toHaveBeenCalledTimes(1);
    });

    test(`${mode}: focus left on its own, then the row disappeared → focus is not moved`, async () => {
      const fallback = vi.fn();
      const { rerender } = render(ui(AXB(), grouped, fallback));
      focusButton('sk-42.2');
      act(() => (document.activeElement as HTMLElement).blur());
      await flushFocusOut();
      expect(document.activeElement).toBe(document.body);

      rerender(ui([row('sk-42.1'), row('sk-42.5')], grouped, fallback));

      expect(document.activeElement).toBe(document.body);
      expect(fallback).not.toHaveBeenCalled();
    });
  }

  test('regrouping: the row with focus moved to another category → focus on its button', () => {
    const { rerender, container } = render(ui(AXB(), true));
    focusButton('sk-42.5');
    const before = document.activeElement;

    rerender(ui([row('sk-42.1'), row('sk-42.5', { status: 'in_progress' }), row('sk-42.2')], true));

    const after = screen.getByRole('button', { name: openName('sk-42.5') });
    // The row really moved: the button is another node in another category.
    expect(after).not.toBe(before);
    expect(container.querySelectorAll('.epic-category').length).toBe(2);
    expect(document.activeElement).toBe(after);
  });

  test('grouping: the target follows the server order, not the screen order', () => {
    // Server: A(open), X(in_progress), B(open). On screen A and B stand together
    // in the open category, X in its own. The neighbour above by the server order is X.
    const rows = () => [row('sk-42.1'), row('sk-42.5', { status: 'in_progress' }), row('sk-42.2')];
    const { rerender } = render(ui(rows(), true));
    focusButton('sk-42.2');

    rerender(ui([row('sk-42.1'), row('sk-42.5', { status: 'in_progress' })], true));

    expect(document.activeElement).toBe(screen.getByRole('button', { name: openName('sk-42.5') }));
  });
});

// ───────── sk-489 T017 — "List": the outcome mark reaches the row (US-7, line 63) ─────────
//
// A guard of the SEAM, not of the rule. The rule "when and by what word the outcome is named" is
// proven on the row itself (`EpicChildRow.test.tsx`); here
// it is checked that the "List" mode draws EXACTLY THAT row and the word
// reaches the document with it. The hole this closes
// was paid for by wave F/1: the pure helper was green, while the only
// production wiring lost the value.
//
// The second assertion is negative and concerns the CATEGORIES (PK-1,
// "Not included"): the split by status does not depend on the outcome. Both closed
// children, "done" and "won't do", lie in ONE `closed` category
// and its label is the former one. An implementation that gave the outcome its own
// bucket or renamed the closed category goes red here, while the pure
// category rule is guarded by `lib/__tests__/epicChildCategories.test.ts`.

describe('EpicChildrenList — the outcome mark in a row (sk-489 T017)', () => {
  const closedRows = (): IssueTreeNode[] => [
    row('sk-42.7', { status: 'closed', closeOutcome: 'done' } as Partial<IssueTreeRowItem>),
    row('sk-42.8', { status: 'closed', closeOutcome: 'wont_do' } as Partial<IssueTreeRowItem>),
  ];

  const liOf = (container: HTMLElement, id: string) =>
    Array.from(container.querySelectorAll<HTMLElement>('[data-epic-row]')).find(
      (li) => li.getAttribute('data-epic-row-key') === `id:${id}`,
    )!;

  test('a dropped child is named by a word, a done one is not', () => {
    const { container } = renderList(closedRows());
    expect(liOf(container, 'sk-42.8').textContent).toContain("won't do");
    expect(liOf(container, 'sk-42.7').textContent).not.toContain('done');
  });

  test('the "Completed" category does not change with the outcome', () => {
    const { container } = renderGrouped(closedRows());
    const labels = headsOf(container).map(
      (h) => h.querySelector('.epic-category-label')?.textContent,
    );
    expect(labels).toEqual(['closed']);
    // Both rows are in it, and the order is the input one.
    const lists = Array.from(container.querySelectorAll<HTMLElement>('ul.epic-children-list'));
    expect(lists).toHaveLength(1);
    expect(
      Array.from(lists[0].querySelectorAll('[data-epic-row]')).map((li) =>
        li.getAttribute('data-epic-row-key'),
      ),
    ).toEqual(['id:sk-42.7', 'id:sk-42.8']);
  });
});
