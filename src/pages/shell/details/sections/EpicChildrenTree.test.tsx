/**
 * sk-421.2 T020 — the "Tree" mode of the epic section
 * (US-2, US-3, R-7, INV-7, SC-010, SC-011, SC-013, SC-017, F-9).
 *
 * The tests are written from the ACCEPTANCE, not from the component: what the tree shows,
 * what it does NOT show, and what the keys listed in US-2 do.
 *
 * SC-017 requires a fixture that gives TWO DIFFERENT responses for one epic:
 * depth 1 and the full subtree. So below there are two sets of rows from one
 * root, and the test compares the first level of "Tree" with "List" on them.
 */

import { useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import type { ReactNode } from 'react';
import {
  EpicChildrenTree,
  expandableIds,
  isEpicSectionRow,
  isExpandableTreeRow,
  treeRowsOf,
  type EpicChildrenTreeProps,
} from './EpicChildrenTree';
// sk-421.3 T16 — P-52 compares a CORRECT input with an incorrect one, and for the
// second a raw unfolder is needed: `treeRowsOf` differs
// from it precisely in that it drops the root and repeated occurrences.
import { layeredToFlatRows } from '../../../../lib/flattenTree';
import { EpicChildrenList } from './EpicChildrenList';
import type {
  IssueTreeNode,
  IssueTreeRowItem,
  TreeBlockerRef,
} from '../../../../api/issues';
// sk-421.3 T12 — P-32 compares the mark tone with the SHARED map, not with a
// literal rewritten here: a second copy of the answer would diverge from the first.
// sk-421.3 T12 — P-33 reads the pair of heading weights by PARSING declarations:
// jsdom works with `css: false`, there is no cascade, and a weight taken off by rendering would
// be taken off emptiness.

// sk-421.2.8 — the blockers sub-row in "Tree" navigates by path (R-17) and
// reads `useNavigate`; this file's stand has no router. A navigation spy
// replaces the router; the earlier tests of the file do not navigate and do not notice the spy.
const router = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('react-router-dom', async (importActual) => {
  const actual = await importActual<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => router.navigate };
});

function wrap(node: ReactNode) {
  return render(<MantineProvider>{node}</MantineProvider>);
}

function n(
  id: string,
  depth: number,
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
    depth,
    parentRef: depth === 0 ? null : { id: 'sk-42', edgeType: 'parent-child' },
    isReference: false,
    firstSeenAt: null,
    ...node,
  };
}

/** The full subtree: the root, two direct children, a grandchild under the first. */
const FULL: IssueTreeNode[] = [
  n('sk-42', 0),
  n('sk-42.1', 1),
  n('sk-42.1.1', 2),
  n('sk-42.2', 1),
];

/**
 * The same epic, a response with a depth limit of 1.
 *
 * sk-460.12 — this is NO LONGER "what the 'List' sees": the list's scope was reconciled
 * with the tree, and both modes are built from one set. The fixture is kept
 * as a response of an OLD server that does not know the depth parameter; on it
 * it is checked that the predicate of the section rows does not depend on whether the
 * server cut the traversal.
 */
const DEPTH1: IssueTreeNode[] = [n('sk-42', 0), n('sk-42.1', 1), n('sk-42.2', 1)];


/**
 * Since T022 the collapsed state comes from above, so the test holds it itself,
 * exactly as the section does. A new mount gives an empty set,
 * that is "fully expanded", which is what 3.3 requires.
 */
function Tree(
  props: Omit<
    EpicChildrenTreeProps,
    'collapsed' | 'onCollapsedChange' | 'epicId'
  > & { epicId?: string },
) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  return (
    <EpicChildrenTree
      {...props}
      // The root of this file's fixtures. Needed to identify placeholders between
      // re-reads: their synthetic ids are not stable (F-22).
      epicId={props.epicId ?? 'sk-42'}
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
    />
  );
}

const NONE = {
  isLoading: false,
  tooLarge: false,
  error: null as unknown,
  onOpen: () => {},
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('EpicChildrenTree — what is shown', () => {
  test('the root is not shown: the card is already about it', () => {
    const { container } = wrap(<Tree rows={FULL} {...NONE} />);
    expect(container.querySelectorAll('[role="treeitem"]')).toHaveLength(3);
    // We judge by the row TITLES, not by a text search for "sk-42": the badge
    // splits the identifier into several spans, and a search for the whole id
    // would return null even if the root were drawn, so the assertion would
    // pass vacuously. In the fixture the title equals the identifier.
    const titles = Array.from(
      container.querySelectorAll('.epic-child-title'),
    ).map((el) => el.textContent);
    expect(titles).toEqual(['sk-42.1', 'sk-42.1.1', 'sk-42.2']);
  });

  test('SC-017 — "List" and "Tree" are built from ONE set of rows (sk-460.12)', () => {
    // Before, the FIRST LEVEL of the tree was compared here with the "List" rows, and
    // both sides were fixtures, so the assertion would have kept
    // passing after it stopped being true of the product.
    // Now what the scope reconciliation actually means is compared: the set is one.
    const treeRows = treeRowsOf(FULL).map((r) => r.item.id);
    const listRows = FULL.filter(isEpicSectionRow).map((r) => r.item.id);
    expect(listRows).toEqual(treeRows);
    // And it INCLUDES the grandchild, otherwise the equality would converge on a flat
    // fixture and prove nothing.
    expect(listRows).toContain('sk-42.1.1');
    expect(listRows).toHaveLength(3);
  });

  test('sk-460.12 — the root is cut off at any response depth, including a truncated one', () => {
    // A negative control to the previous one: the predicate selects the section rows
    // by a row marker, not by whether the server cut the traversal.
    expect(DEPTH1.filter(isEpicSectionRow).map((r) => r.item.id)).toEqual([
      'sk-42.1',
      'sk-42.2',
    ]);
  });

  test('sk-460.13 — the task type is printed in "Tree" too', () => {
    // Before, the OPPOSITE assertion stood here, and its ground was
    // a reference to the spec ("the row field set stays today's"),
    // exactly the form of justification that the decision "the design
    // wins" (sk-460.8) cancelled. The design prints the type chip on both boards.
    //
    // We check by the row TEXT, not by an invented attribute: a selector
    // that is not in the markup would return null under any behaviour.
    // A positive control that the `showType` handle works at all
    // lives in the row's own suite (EpicChildRow.test.tsx).
    const { container } = wrap(<Tree rows={FULL} {...NONE} />);
    const rows = Array.from(container.querySelectorAll<HTMLElement>('.epic-children-row'));
    expect(rows).toHaveLength(3);

    // The TYPE chip is a descendant whose text EQUALS the type value ENTIRELY: exactly
    // how the "List" suite selects it (`typeChipsOf`). The comparison is exact,
    // not by substring, and this is not pedantry: a row's `textContent` glues
    // neighbours WITHOUT spaces ("open" + "task" gives "opentask"), so
    // the first edition of this check looked for `\btask\b` and failed on a correct
    // implementation. A word boundary never appears there.
    for (const row of rows) {
      const typeChips = Array.from(row.querySelectorAll('span'))
        .map((s) => s.textContent ?? '')
        .filter((t) => t === 'task');
      // Exactly one: zero means the type is not printed (the state before sk-460.13),
      // two means the row grew a second carrier of the same fact.
      expect(typeChips, 'a "Tree" row does not have exactly one type chip').toHaveLength(1);
    }
  });

  test('a repeated occurrence of a node is not shown, a placeholder is', () => {
    const rows = [
      n('sk-42', 0),
      n('sk-42.1', 1),
      // a duplicate of an already shown task
      n('sk-9', 1, {}, { isReference: true, firstSeenAt: 'sk-1' }),
      // an unavailable task: a reference AND with empty values
      n('hidden-1', 1, { status: '', type: '' }, { isReference: true }),
    ];
    const { container } = wrap(<Tree rows={rows} {...NONE} />);
    expect(container.querySelectorAll('[role="treeitem"]')).toHaveLength(2);
    expect(screen.getByText('no access')).toBeTruthy();
    expect(screen.queryByText('sk-9')).toBeNull();
  });

  test('F-9 — descendants of a "no access" row are always visible', () => {
    const rows = [
      n('sk-42', 0),
      n('hidden-1', 1, { status: '', type: '' }, { isReference: true }),
      n('sk-42.1.1', 2),
    ];
    const { container } = wrap(<Tree rows={rows} {...NONE} />);
    // Both rows are on screen: a placeholder does not become a collapse boundary.
    expect(container.querySelectorAll('[role="treeitem"]')).toHaveLength(2);
    expect(screen.getByText('no access')).toBeTruthy();
    expect(screen.getByText('sk-42.1.1')).toBeTruthy();
  });

  test('on every open the tree is fully expanded', () => {
    const { container } = wrap(<Tree rows={FULL} {...NONE} />);
    // The grandchild is visible without a single user action.
    expect(screen.getByText('sk-42.1.1')).toBeTruthy();
    const parent = container.querySelector('[aria-expanded]');
    expect(parent?.getAttribute('aria-expanded')).toBe('true');
  });

  test('the "too large" refusal advises switching to the list', () => {
    wrap(<Tree rows={[]} {...NONE} tooLarge />);
    expect(
      screen.getByText('The tree is too large — switch to the list'),
    ).toBeTruthy();
  });

  test('a load error is reported with its own text', () => {
    wrap(<Tree rows={[]} {...NONE} error={new Error('boom')} />);
    expect(screen.getByText('Failed to load children')).toBeTruthy();
  });
});

// ───────── sk-421.3 T12 — the status mark on the left edge of a "Tree" row ─────────
//
// The status mark is painted by the stylesheet and seen in a browser;
// what a render can see is which rows the row box contains.

describe('sk-421.3 T12 — the status mark on the left edge of a row', () => {
  const rowByTitle = (c: HTMLElement, title: string): HTMLElement => {
    const el = Array.from(c.querySelectorAll<HTMLElement>('.epic-child-title')).find(
      (t) => t.textContent === title,
    );
    const row = el?.closest<HTMLElement>('.epic-tree-row') ?? null;
    expect(row, `row ${title} not found`).not.toBeNull();
    return row!;
  };

  const BLOCKERS: TreeBlockerRef[] = [
    { id: 'p-1', title: 'P1', status: 'open', projectId: 'proj-b' },
    { id: 'p-2', title: 'P2', status: 'open', projectId: 'proj-b' },
    { id: 'p-3', title: 'P3', status: 'open', projectId: 'proj-b' },
    { id: 'p-4', title: 'P4', status: 'open', projectId: 'proj-b' },
    { id: 'p-5', title: 'P5', status: 'open', projectId: 'proj-b' },
  ];

  test('P-29 — the mark runs along the FULL row height: the sub-row and the expanded "+N" are inside the row', () => {
    // This is proven by NESTING, not by pixels: the mark is the row's border,
    // so everything that lies INSIDE the row it goes around by definition.
    // jsdom does not compute layout, and a measurement here would be a measurement of zeros.
    //
    // Finding F-05 requires carrying the check to the expanded "+N": the sub-row nesting
    // exists BEFORE the mark appears, so it alone is not enough:
    // a list that appears only on press is needed as well.
    const rows = [
      n('sk-42', 0),
      n('sk-42.1', 1, { isBlocked: true }, { blockers: BLOCKERS.map((b) => ({ ...b })) }),
    ];
    const { container } = wrap(<Tree rows={rows} {...NONE} />);
    const row = rowByTitle(container, 'sk-42.1');

    const subline = row.querySelector('.epic-child-blockers');
    expect(subline, 'the blockers sub-row is not inside the row').not.toBeNull();

    const more = Array.from(row.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
      /^\+\d+$/.test(b.textContent ?? ''),
    );
    expect(more, 'the row has no "+N", nothing to expand, the check degenerated').toBeTruthy();
    fireEvent.click(more!);

    const expanded = row.querySelector('.epic-child-blockers-list');
    expect(expanded, 'the expanded list ended up OUTSIDE the row, so the mark will not go around it').not.toBeNull();
  });

  test('P-33 — an expandable row is declared expandable, a leaf is not', () => {
    // The expandable mark is `aria-expanded`, and it sits exactly on the
    // expandable rows.
    const { container } = wrap(<Tree rows={FULL} {...NONE} />);
    const parent = rowByTitle(container, 'sk-42.1');
    const leaf = rowByTitle(container, 'sk-42.2');
    expect(parent.hasAttribute('aria-expanded')).toBe(true);
    expect(leaf.hasAttribute('aria-expanded')).toBe(false);
  });

  test('P-34 — an unavailable row does not get a parent marker even with shown descendants', () => {
    // The expandability predicate is `hasChildren && !isReference`. The placeholder
    // is a reference, so it does not expand even though its descendants are on screen
    // (F-9: a reference row does not become a collapse boundary).
    const rows = [
      n('sk-42', 0),
      n('hidden-1', 1, { status: '', type: '' }, { isReference: true }),
      n('sk-42.1.1', 2, {}, { parentRef: { id: 'hidden-1', edgeType: 'parent-child' } }),
    ];
    const { container } = wrap(<Tree rows={rows} {...NONE} />);
    const stubRow = container
      .querySelector<HTMLElement>('.epic-child-no-access')!
      .closest<HTMLElement>('.epic-tree-row')!;

    // The descendant is really shown, otherwise the check would pass for another
    // reason ("no descendants, hence no marker").
    expect(screen.getByText('sk-42.1.1')).toBeTruthy();
    expect(stubRow.hasAttribute('aria-expanded'), 'the placeholder is declared expandable').toBe(false);
    expect(
      stubRow.querySelector('.epic-tree-chevron'),
      'the placeholder got a chevron button',
    ).toBeNull();
  });
});

// ───────── sk-421.3 T16 — the set of expandable nodes and the "*" key ─────────

describe('sk-421.3 T16 — expandableIds: the set of expandable nodes', () => {
  test('P-52 — the input is FLAT rows after treeRowsOf, not a layered response', () => {
    // The comparison DISCRIMINATES: the same set passed through the raw
    // unfolder gives an extra node, the root. Without this half the check
    // "sk-42.1 is in the set" would pass on a wrong input too.
    const right = expandableIds(treeRowsOf(FULL));
    const wrong = expandableIds(layeredToFlatRows(FULL));

    expect(right).toEqual(['sk-42.1']);
    expect(wrong, 'the raw unfolder must give an extra node').toContain('sk-42');
    expect(right, 'the root got into the set, the control would count it as a node').not.toContain('sk-42');
  });

  test('P-52 — a reference row with descendants is NOT counted as expandable', () => {
    // `treeRowsOf` keeps the placeholder of an unavailable task, but it cannot
    // be expanded (F-9: its descendants are always visible). If it got into the set,
    // the control could never offer "expand", because there is
    // nothing to collapse it with.
    const rows = [
      n('sk-42', 0),
      n('hidden-1', 1, { status: '', type: '' }, { isReference: true }),
      n('sk-42.1.1', 2, {}, { parentRef: { id: 'hidden-1', edgeType: 'parent-child' } }),
    ];
    const flat = treeRowsOf(rows);
    const stub = flat.find((r) => r.item.id === 'hidden-1');
    expect(stub, 'the placeholder dropped out of the flat rows').toBeTruthy();
    expect(stub!.hasChildren, 'the placeholder has no descendants, the check degenerated').toBe(true);
    expect(isExpandableTreeRow(stub!)).toBe(false);
    expect(expandableIds(flat)).not.toContain('hidden-1');
  });

  test('the expandability predicate is ONE for the chevron and for the set', () => {
    // A row with a chevron and a row that the control will collapse must be
    // one and the same row. It is compared by rendering: every id in the
    // set has a chevron, and vice versa.
    const { container } = wrap(<Tree rows={FULL} {...NONE} />);
    const withChevron = Array.from(
      container.querySelectorAll<HTMLElement>('[role="treeitem"]'),
    )
      .filter((el) => el.querySelector('.epic-tree-chevron'))
      .map((el) => el.querySelector('.epic-child-title')?.textContent);
    expect(withChevron).toEqual(expandableIds(treeRowsOf(FULL)));
  });
});

describe('sk-421.3 T16 — the "*" key ON THE ROW ITSELF (US-6)', () => {
  /** Two expandable first-level siblings, each with a descendant. */
  const SIBLINGS: IssueTreeNode[] = [
    n('sk-42', 0),
    n('sk-42.1', 1),
    n('sk-42.1.1', 2, {}, { parentRef: { id: 'sk-42.1', edgeType: 'parent-child' } }),
    n('sk-42.2', 1),
    n('sk-42.2.1', 2, {}, { parentRef: { id: 'sk-42.2', edgeType: 'parent-child' } }),
  ];

  const titles = (c: HTMLElement) =>
    Array.from(c.querySelectorAll('.epic-child-title')).map((el) => el.textContent);

  const itemByTitle = (c: HTMLElement, title: string): HTMLElement => {
    const el = Array.from(c.querySelectorAll<HTMLElement>('.epic-child-title')).find(
      (t) => t.textContent === title,
    );
    const item = el?.closest<HTMLElement>('[role="treeitem"]') ?? null;
    expect(item, `row ${title} not found`).not.toBeNull();
    return item!;
  };

  test('P-53 — "*" expands the siblings AND THE ROW ITSELF', () => {
    // ⚠ New work, not a re-check: no test of the epic section
    // pressed "*" on the row itself; only the path from a sub-row element
    // and the `treeKeyboardNav` unit level were covered.
    const { container } = wrap(<Tree rows={SIBLINGS} {...NONE} />);

    // Collapse both siblings by hand.
    for (const title of ['sk-42.1', 'sk-42.2']) {
      fireEvent.click(itemByTitle(container, title).querySelector('.epic-tree-chevron')!);
    }
    expect(titles(container)).toEqual(['sk-42.1', 'sk-42.2']);

    // "*" on the FIRST row: it itself is collapsed too.
    const row = itemByTitle(container, 'sk-42.1');
    act(() => row.focus());
    fireEvent.keyDown(row, { key: '*' });

    // Both are expanded: the sibling and the row under focus itself.
    expect(titles(container)).toEqual(['sk-42.1', 'sk-42.1.1', 'sk-42.2', 'sk-42.2.1']);
  });

  test('P-54 — "*" when there is nothing to expand: nothing changes', () => {
    const { container } = wrap(<Tree rows={SIBLINGS} {...NONE} />);
    const before = titles(container);
    expect(before).toHaveLength(4);

    const row = itemByTitle(container, 'sk-42.1');
    act(() => row.focus());
    fireEvent.keyDown(row, { key: '*' });

    expect(titles(container), '"*" changed the set of rows although there was nothing to expand').toEqual(
      before,
    );
  });
});

describe('EpicChildrenTree — keyboard (SC-013)', () => {
  function mounted() {
    const r = wrap(<Tree rows={FULL} {...NONE} />);
    const tree = r.container.querySelector('[role="tree"]') as HTMLElement;
    return { ...r, tree };
  }

  /** The index of the row that is currently the tab stop. */
  function focusedIndex(container: HTMLElement): number {
    const items = Array.from(container.querySelectorAll('[role="treeitem"]'));
    return items.findIndex((el) => el.getAttribute('tabindex') === '0');
  }

  /**
   * The index of the row on which the REAL document focus stands.
   *
   * sk-421.2, wave B/2 review: before, only the `tabindex` attribute was checked here,
   * and all the keyboard cases were green for an implementation
   * that did not move focus at all while the screen reader stayed silent. The attribute
   * stays part of the contract (roving tabindex), but by itself it
   * proves only half: the other half is `document.activeElement`.
   */
  function activeIndex(container: HTMLElement): number {
    const items = Array.from(container.querySelectorAll('[role="treeitem"]'));
    return items.indexOf(document.activeElement as Element);
  }

  test('one tab stop for the whole tree', () => {
    const { container } = mounted();
    const zero = Array.from(
      container.querySelectorAll('[role="treeitem"][tabindex="0"]'),
    );
    expect(zero).toHaveLength(1);
  });

  test('↓ and ↑ move focus across the shown rows', () => {
    const { container, tree } = mounted();
    expect(focusedIndex(container)).toBe(0);
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    expect(focusedIndex(container)).toBe(1);
    expect(activeIndex(container)).toBe(1);
    fireEvent.keyDown(tree, { key: 'ArrowUp' });
    expect(focusedIndex(container)).toBe(0);
    expect(activeIndex(container)).toBe(0);
  });

  test('← collapses an expanded node, then climbs to the parent', () => {
    const { container, tree } = mounted();
    // Node sk-42.1 is expanded: ← collapses it, the grandchild disappears.
    expect(screen.getByText('sk-42.1.1')).toBeTruthy();
    fireEvent.keyDown(tree, { key: 'ArrowLeft' });
    expect(screen.queryByText('sk-42.1.1')).toBeNull();
    // A repeated ← no longer collapses (nothing to), it goes to the parent; a
    // first-level row has no parent, focus stays in place.
    fireEvent.keyDown(tree, { key: 'ArrowLeft' });
    expect(focusedIndex(container)).toBe(0);
  });

  test('→ expands a collapsed node, then steps to the first child', () => {
    const { container, tree } = mounted();
    fireEvent.keyDown(tree, { key: 'ArrowLeft' }); // collapsed
    expect(screen.queryByText('sk-42.1.1')).toBeNull();
    fireEvent.keyDown(tree, { key: 'ArrowRight' }); // expanded
    expect(screen.getByText('sk-42.1.1')).toBeTruthy();
    expect(focusedIndex(container)).toBe(0);
    fireEvent.keyDown(tree, { key: 'ArrowRight' }); // stepped inside
    expect(focusedIndex(container)).toBe(1);
    expect(activeIndex(container)).toBe(1);
  });

  test('Home and End jump to the first and last shown row', () => {
    const { container, tree } = mounted();
    fireEvent.keyDown(tree, { key: 'End' });
    expect(focusedIndex(container)).toBe(2);
    expect(activeIndex(container)).toBe(2);
    fireEvent.keyDown(tree, { key: 'Home' });
    expect(focusedIndex(container)).toBe(0);
    expect(activeIndex(container)).toBe(0);
  });

  test('Enter opens the row card by its own project', () => {
    const onOpen = vi.fn();
    const r = wrap(
      <Tree
        rows={[n('sk-42', 0), n('sk-42.1', 1, { projectId: 'proj-other' })]}
        {...NONE}
        onOpen={onOpen}
      />,
    );
    const tree = r.container.querySelector('[role="tree"]') as HTMLElement;
    fireEvent.keyDown(tree, { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledWith('sk-42.1', 'proj-other');
  });

  test('Enter on a "no access" row opens nothing', () => {
    const onOpen = vi.fn();
    const r = wrap(
      <Tree
        rows={[
          n('sk-42', 0),
          n('hidden-1', 1, { status: '', type: '' }, { isReference: true }),
        ]}
        {...NONE}
        onOpen={onOpen}
      />,
    );
    const tree = r.container.querySelector('[role="tree"]') as HTMLElement;
    fireEvent.keyDown(tree, { key: 'Enter' });
    expect(onOpen).not.toHaveBeenCalled();
  });

  test('→ on a "no access" row leads to its first descendant', () => {
    // The shared resolver is silent for reference rows; this US-2 case
    // is handled above it, so it is checked separately.
    const r = wrap(
      <Tree
        rows={[
          n('sk-42', 0),
          n('hidden-1', 1, { status: '', type: '' }, { isReference: true }),
          n('sk-42.1.1', 2),
        ]}
        {...NONE}
      />,
    );
    const tree = r.container.querySelector('[role="tree"]') as HTMLElement;
    fireEvent.keyDown(tree, { key: 'ArrowRight' });
    const items = Array.from(r.container.querySelectorAll('[role="treeitem"]'));
    expect(items[1].getAttribute('tabindex')).toBe('0');
  });
});

// ─────────── sk-421.2.8 T014 — line 43: the "Tree" traversal point guard ───────────
//
// ALL focusable descendants of `role="tree"` are counted, not only `treeitem`:
// `tabIndex ≥ 0`, both set by an attribute and native (a button without
// `tabindex="-1"`). The set must equal the active row plus the visible
// focusable elements of its sub-row (SC-010, sk-441, R-12). The existing
// test "one tab stop for the whole tree" counts only `treeitem` and
// is overlapped by this guard.

function blocker(id: string): TreeBlockerRef {
  return { id, title: `Title ${id}`, status: 'open', projectId: 'proj-b' };
}

/** Five entries, one hidden: the sub-row has 2 visible links and "+2". */
function fiveBlockers(prefix: string): TreeBlockerRef[] {
  return [
    blocker(`${prefix}-1`),
    { id: `${prefix}-hidden`, redacted: true },
    blocker(`${prefix}-2`),
    blocker(`${prefix}-3`),
    blocker(`${prefix}-4`),
  ];
}

/** All focusable descendants of the tree in DOM order. */
function tabStopsOf(tree: Element): HTMLElement[] {
  return Array.from(
    tree.querySelectorAll<HTMLElement>(
      'button, a[href], input, select, textarea, [tabindex], [contenteditable="true"]',
    ),
  ).filter((el) => el.tabIndex >= 0 && !el.hasAttribute('disabled'));
}

/** A short label of a traversal point: a row by title or the element text. */
function describeStop(el: HTMLElement): string {
  if (el.getAttribute('role') === 'treeitem') {
    const title = el.querySelector('.epic-child-title')?.textContent;
    return `row:${title ?? 'no-access'}`;
  }
  return el.textContent ?? '?';
}

describe('EpicChildrenTree — T014, the traversal point guard over all focusable descendants (line 43)', () => {
  afterEach(() => router.navigate.mockReset());

  function guardRows(): IssueTreeNode[] {
    return [
      n('sk-42', 0),
      n('sk-42.1', 1, { isBlocked: true }, { blockers: fiveBlockers('a') }),
      n('hidden-1', 1, { status: '', type: '' }, { isReference: true }),
      n('sk-42.2', 1, { isBlocked: true }, { blockers: [blocker('b-1'), blocker('b-2')] }),
      n('sk-42.3', 1),
      n('sk-42.4', 1, { isBlocked: true }, { blockers: fiveBlockers('d') }),
    ];
  }

  test('with blocked rows, a placeholder and an expanded "+N" on a NON-active row — only the active row and its sub-row', () => {
    const { container } = wrap(<Tree rows={guardRows()} {...NONE} />);
    const tree = container.querySelector('[role="tree"]')!;
    const items = Array.from(tree.querySelectorAll<HTMLElement>('[role="treeitem"]'));

    // Expand "+2" on row sk-42.4: the click makes it active...
    const dLine = items[4].querySelector('.epic-child-blockers-line')!;
    const dMore = Array.from(dLine.querySelectorAll('button')).find((b) => b.textContent === '+2')!;
    fireEvent.click(dMore);
    expect(dMore.getAttribute('aria-expanded')).toBe('true');
    // ...and move the active row to sk-42.1 by focus: the expanded list of sk-42.4
    // stays on screen, but the row is no longer active. `act`: the update of the
    // active row goes through `onFocus` and must render before the check.
    act(() => items[0].focus());
    expect(items[0].getAttribute('tabindex')).toBe('0');
    expect(items[4].querySelector('.epic-child-blockers-list')).not.toBeNull();

    expect(tabStopsOf(tree).map(describeStop)).toEqual(['row:sk-42.1', 'a-1', 'a-2', '+2']);

    // The active one is an unblocked row: there is one traversal point, the row itself.
    act(() => items[3].focus());
    expect(tabStopsOf(tree).map(describeStop)).toEqual(['row:sk-42.3']);

    // The active one is a "no access" placeholder: also one point, the placeholder row.
    act(() => items[1].focus());
    expect(tabStopsOf(tree).map(describeStop)).toEqual(['row:no-access']);
  });

  test('30 children, 12 blocked, an unblocked row active → Tab enters with one press and leaves with the next', async () => {
    const children: IssueTreeNode[] = [];
    for (let i = 1; i <= 30; i += 1) {
      // 12 rows from the middle are blocked; the first (active by default)
      // is free. One of the blocked ones has an expanded "+N" by the volume of entries.
      const blocked = i >= 10 && i <= 21;
      children.push(
        n(
          `sk-42.${i}`,
          1,
          { isBlocked: blocked },
          blocked ? { blockers: i % 2 === 0 ? fiveBlockers(`x${i}`) : [blocker(`y${i}`)] } : {},
        ),
      );
    }
    wrap(
      <>
        <button type="button">before</button>
        <Tree rows={[n('sk-42', 0), ...children]} {...NONE} />
        <button type="button">after</button>
      </>,
    );
    const user = userEvent.setup();
    screen.getByRole('button', { name: 'before' }).focus();

    await user.tab();
    const entered = document.activeElement as HTMLElement;
    expect(entered.getAttribute('role')).toBe('treeitem');
    expect(entered.querySelector('.epic-child-title')?.textContent).toBe('sk-42.1');

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'after' }));
  });

  // ───────── sk-421.3 T02 — the number of "Tree" traversal points (INV-5, SC-010) ─────────
  //
  // A twin guard of the same in "List". The tests above check the COMPOSITION
  // of points with different active rows; here the NUMBER is pinned on a fixed
  // set, walked with a real `Tab`, so that a task adding a traversal point
  // inside rows goes red immediately and in both modes at once.
  test('T02 — the number of traversal points on the fixed set is pinned by a reference', async () => {
    wrap(
      <>
        <button type="button">before</button>
        <Tree rows={guardRows()} {...NONE} />
        <button type="button">after</button>
      </>,
    );
    const user = userEvent.setup();
    const after = screen.getByRole('button', { name: 'after' });
    screen.getByRole('button', { name: 'before' }).focus();

    const stops: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      await user.tab();
      const el = document.activeElement as HTMLElement;
      if (el === after) break;
      stops.push(describeStop(el));
    }

    // The reference: the active row (the first, which is also the blocked one) plus
    // the visible focusable elements of ITS sub-row. The other rows of the
    // tree are not traversal points: focus is held by the `treeitem`.
    expect(stops).toEqual(['row:sk-42.1', 'a-1', 'a-2', '+2']);
    expect(stops, 'the number of traversal points inside "Tree" changed').toHaveLength(4);
  });

  test('M-3 — an expanded "+N" adds no ROW traversal points', async () => {
    // The second half of finding F-03: before, the set was run only with a
    // CLOSED "+N", and the expanded list was never walked by a real `Tab`.
    // Expanding must add sub-row points and not a single row:
    // focus in "Tree" is held by the single active `treeitem`.
    const { container } = wrap(
      <>
        <button type="button">before</button>
        <Tree rows={guardRows()} {...NONE} />
        <button type="button">after</button>
      </>,
    );

    // "+2" is NOT unique in the set (rows sk-42.1 and sk-42.4 are both blocked
    // by five entries), so a search over the whole document is ambiguous.
    // We take the sub-row of the FIRST row: a click on its element also makes
    // it active, and the active row is the very subject of the check.
    const items = Array.from(container.querySelectorAll<HTMLElement>('[role="treeitem"]'));
    const line = items[0].querySelector('.epic-child-blockers-line')!;
    const more = Array.from(line.querySelectorAll('button')).find((b) => b.textContent === '+2')!;
    expect(more, 'the first row has no "+N", the check degenerated').toBeTruthy();
    fireEvent.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');

    const user = userEvent.setup();
    const after = screen.getByRole('button', { name: 'after' });
    screen.getByRole('button', { name: 'before' }).focus();

    const stops: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      await user.tab();
      const el = document.activeElement as HTMLElement;
      if (el === after) break;
      stops.push(describeStop(el));
    }

    // Expanding really gave something, otherwise the check below would have passed
    // on a closed list and said nothing.
    expect(stops.length, 'expanding "+N" added no points').toBeGreaterThan(4);
    // ...and the ROW point is still exactly one.
    expect(
      stops.filter((s) => s.startsWith('row:')),
      'expanding "+N" made one more row a traversal point',
    ).toEqual(['row:sk-42.1']);
  });
});

// ───────── sk-421.2.8 line 36 — the sub-row is the same in the modes and at any depth ─────────
//
// The same child with five entries: in "List", in "Tree" at depth 1
// and at depth 3 (through `layeredToFlatRows` inside the tree). Together with
// line 27 it closes FOR-PLAN m-7 by an end-to-end path: a field that did not reach the
// "Tree" row would give a row without a sub-row.

describe('EpicChildrenTree — line 36, the sub-row is the same in the modes and at depth', () => {
  const SUBJECT = 'sk-42.7';

  function subject(depth: number, parent: string): IssueTreeNode {
    return n(
      SUBJECT,
      depth,
      { isBlocked: true },
      { blockers: fiveBlockers('s'), parentRef: { id: parent, edgeType: 'parent-child' } },
    );
  }

  /** A child's sub-row: the text, the set of entry elements and the expanded list. */
  function snapshot(container: HTMLElement) {
    const title = Array.from(container.querySelectorAll('.epic-child-title')).find(
      (el) => el.textContent === SUBJECT,
    );
    const row = title?.closest('li, [role="treeitem"]') as HTMLElement | null;
    const subline = row?.querySelector<HTMLElement>('.epic-child-blockers') ?? null;
    expect(subline, 'the child has no sub-row').not.toBeNull();
    const line = subline!.querySelector('.epic-child-blockers-line')!;
    const collapsed = {
      text: line.textContent,
      elements: Array.from(line.querySelectorAll('[data-epic-blocker-el]')).map((el) =>
        el.getAttribute('data-epic-blocker-el'),
      ),
      hidden: line.querySelectorAll('.dep-chip--redacted').length,
    };
    fireEvent.click(
      Array.from(line.querySelectorAll('button')).find((b) => b.textContent === '+2')!,
    );
    const list = subline!.querySelector('.epic-child-blockers-list')!;
    const expanded = {
      // Direct `li`s are taken as the list's children, not by `:scope > li`: jsdom
      // rewrites `:scope` through the list id, and the id has dots from the task id.
      entries: Array.from(list.children)
        .filter((el) => el.tagName === 'LI')
        .map((li) => li.textContent),
      elements: Array.from(list.querySelectorAll('[data-epic-blocker-el]')).map((el) =>
        el.getAttribute('data-epic-blocker-el'),
      ),
    };
    return { row, collapsed, expanded };
  }

  test('"List", "Tree" at depth 1 and at depth 3 give the same sub-row', () => {
    const inList = wrap(
      <EpicChildrenList rows={[subject(1, 'sk-42')]} {...NONE} epicId="sk-42" />,
    );
    const list = snapshot(inList.container);
    expect(list.row?.tagName).toBe('LI');
    inList.unmount();

    const inTree1 = wrap(<Tree rows={[n('sk-42', 0), subject(1, 'sk-42')]} {...NONE} />);
    const tree1 = snapshot(inTree1.container);
    expect(tree1.row?.getAttribute('aria-level')).toBe('1');
    inTree1.unmount();

    const inTree3 = wrap(
      <Tree
        rows={[
          n('sk-42', 0),
          n('sk-42.3', 1),
          n('sk-42.3.1', 2, {}, { parentRef: { id: 'sk-42.3', edgeType: 'parent-child' } }),
          subject(3, 'sk-42.3.1'),
        ]}
        {...NONE}
      />,
    );
    const tree3 = snapshot(inTree3.container);
    expect(tree3.row?.getAttribute('aria-level')).toBe('3');

    // The reference is "List"; the text and the set of elements are compared, not just presence.
    expect(list.collapsed.text).toBe('blocked: s-1 · open, unavailable, s-2 · open +2');
    expect(list.collapsed.hidden).toBe(1);
    expect(list.expanded.entries).toHaveLength(5);
    for (const tree of [tree1, tree3]) {
      expect(tree.collapsed).toEqual(list.collapsed);
      expect(tree.expanded).toEqual(list.expanded);
    }
  });
});

// ───────── sk-421.2.8 line 44 — "Tree": the Tab and Shift+Tab path (R-12, UD-K) ─────────
//
// The Tab model relies on the DOM order: the sub-row is rendered inside the
// `treeitem` of the active row after the row, its elements are traversal points only
// for the active row. Tab from the active row passes the sub-row and leaves the
// tree; Shift+Tab from behind the tree arrives at the last element of the sub-row.

describe('EpicChildrenTree — line 44, the Tab and Shift+Tab path', () => {
  function hidden(id: string): TreeBlockerRef {
    return { id, redacted: true };
  }

  /** The stand: a button before the tree, the tree (the first row A is active), a button after. */
  function mountWith(blockers: TreeBlockerRef[] | undefined) {
    const rows: IssueTreeNode[] = [
      n('sk-42', 0),
      n('sk-42.1', 1, { isBlocked: blockers !== undefined }, blockers ? { blockers } : {}),
      n('sk-42.2', 1),
    ];
    const view = wrap(
      <>
        <button type="button">before</button>
        <Tree rows={rows} {...NONE} />
        <button type="button">after</button>
      </>,
    );
    const items = () => Array.from(view.container.querySelectorAll<HTMLElement>('[role="treeitem"]'));
    return { ...view, items, user: userEvent.setup() };
  }

  function current(): string {
    return describeStop(document.activeElement as HTMLElement);
  }

  async function tabWalk(
    user: ReturnType<typeof userEvent.setup>,
    steps: number,
    shift = false,
    sink?: HTMLElement[],
  ) {
    const walk: string[] = [];
    for (let i = 0; i < steps; i += 1) {
      await user.tab({ shift });
      walk.push(current());
      sink?.push(document.activeElement as HTMLElement);
    }
    return walk;
  }

  /**
   * R-12 — the sub-row traversal points lie INSIDE the `treeitem` of the active row.
   * The Tab order alone does not prove this: a sub-row rendered
   * as a neighbour right after the `treeitem` would give the same sequence.
   */
  function expectInsideRow(stops: HTMLElement[], row: HTMLElement) {
    for (const stop of stops) {
      if (stop.textContent === 'after' || stop === row) continue;
      expect(stop.closest('[role="treeitem"]'), `"${stop.textContent}" is outside the treeitem of the active row`).toBe(row);
    }
  }

  function moreOf(container: HTMLElement): HTMLButtonElement {
    const more = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.epic-child-blockers-line button'),
    ).find((b) => /^\+\d+$/.test(b.textContent ?? ''));
    expect(more, 'no "+N"').toBeDefined();
    return more!;
  }

  test('collapsed: Tab from the active row → the sub-row visible links → "+N" → the element after the tree', async () => {
    const { items, user } = mountWith(fiveBlockers('a'));
    act(() => items()[0].focus());
    const stops: HTMLElement[] = [];
    expect(await tabWalk(user, 4, false, stops)).toEqual(['a-1', 'a-2', '+2', 'after']);
    expectInsideRow(stops, items()[0]);
  });

  test('expanded: Tab → "+N" → the visible entries of the expanded list (sub-row entries 1–3 are skipped) → exit; Shift+Tab from behind the tree → the last visible entry', async () => {
    const { container, items, user } = mountWith(fiveBlockers('a'));
    fireEvent.click(moreOf(container));
    expect(moreOf(container).getAttribute('aria-expanded')).toBe('true');

    act(() => items()[0].focus());
    const stops: HTMLElement[] = [];
    expect(await tabWalk(user, 6, false, stops)).toEqual(['+2', 'a-1', 'a-2', 'a-3', 'a-4', 'after']);
    expectInsideRow(stops, items()[0]);

    // Shift+Tab from the element after the tree.
    screen.getByRole('button', { name: 'after' }).focus();
    expect(await tabWalk(user, 1, true)).toEqual(['a-4']);
  });

  test('a sub-row of three hidden entries (nothing focusable) → Shift+Tab from behind the tree goes to the row itself', async () => {
    const { user } = mountWith([hidden('h-1'), hidden('h-2'), hidden('h-3')]);
    screen.getByRole('button', { name: 'after' }).focus();
    expect(await tabWalk(user, 1, true)).toEqual(['row:sk-42.1']);
  });

  test('five hidden entries → Shift+Tab from behind the tree goes to "+N", both collapsed and expanded', async () => {
    const five = [hidden('h-1'), hidden('h-2'), hidden('h-3'), hidden('h-4'), hidden('h-5')];
    const { container, user } = mountWith(five);
    screen.getByRole('button', { name: 'after' }).focus();
    expect(await tabWalk(user, 1, true)).toEqual(['+2']);

    // Expanded: the entries of the expanded list are hidden and not focusable, so "+N" again
    // (spec US-6, changelog 2026-09-15).
    fireEvent.click(moreOf(container));
    expect(moreOf(container).getAttribute('aria-expanded')).toBe('true');
    screen.getByRole('button', { name: 'after' }).focus();
    expect(await tabWalk(user, 1, true)).toEqual(['+2']);
  });

  test('visible links with "+N" collapsed → Shift+Tab from behind the tree goes to "+N" (the last sub-row element)', async () => {
    const { user } = mountWith(fiveBlockers('a'));
    screen.getByRole('button', { name: 'after' }).focus();
    expect(await tabWalk(user, 1, true)).toEqual(['+2']);
  });

  test('without a sub-row → Shift+Tab from behind the tree goes to the row', async () => {
    const { user } = mountWith(undefined);
    screen.getByRole('button', { name: 'after' }).focus();
    expect(await tabWalk(user, 1, true)).toEqual(['row:sk-42.1']);
  });
});

// ───────── sk-421.2.8 line 45 — keys from a sub-row element and activation isolation (R-13) ─────────
//
// From a sub-row element the arrows, Home, End and `*` act as from the row
// that owns the element, and move focus only to the target ROW;
// collapse, expand, `*` and keys with no target leave focus on the element.
// Enter and space are performed by the sub-row button itself, the child card does not
// open. Each key is checked from three sources: a link, "+N",
// an entry of the expanded list.

describe('EpicChildrenTree — line 45, keys from a sub-row element', () => {
  type Source = 'link' | 'more' | 'expanded';
  const SOURCES: Source[] = ['link', 'more', 'expanded'];

  /**
   * The shown rows: A (0, five entries, has a child), A.1 (1),
   * B (2, five entries), C (3, has a child), C.1 (4).
   */
  function keyRows(): IssueTreeNode[] {
    return [
      n('sk-42', 0),
      n('sk-42.1', 1, { isBlocked: true }, { blockers: fiveBlockers('a') }),
      n('sk-42.1.1', 2, {}, { parentRef: { id: 'sk-42.1', edgeType: 'parent-child' } }),
      n('sk-42.2', 1, { isBlocked: true }, { blockers: fiveBlockers('b') }),
      n('sk-42.3', 1),
      n('sk-42.3.1', 2, {}, { parentRef: { id: 'sk-42.3', edgeType: 'parent-child' } }),
    ];
  }

  function mountKeys() {
    const onOpen = vi.fn();
    const view = wrap(<Tree rows={keyRows()} {...NONE} onOpen={onOpen} />);
    const items = () => Array.from(view.container.querySelectorAll<HTMLElement>('[role="treeitem"]'));
    const rowByTitle = (title: string) =>
      items().find((el) => el.querySelector('.epic-child-title')?.textContent === title)!;
    return { ...view, onOpen, items, rowByTitle, user: userEvent.setup() };
  }

  /** The source element in a row's sub-row; "expanded" expands "+N". */
  function sourceIn(row: HTMLElement, prefix: string, kind: Source): HTMLElement {
    const line = row.querySelector('.epic-child-blockers-line')!;
    const more = Array.from(line.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent === '+2',
    )!;
    if (kind === 'more') return more;
    if (kind === 'link') {
      return Array.from(line.querySelectorAll<HTMLButtonElement>('button')).find(
        (b) => b.textContent === `${prefix}-1`,
      )!;
    }
    if (more.getAttribute('aria-expanded') !== 'true') fireEvent.click(more);
    return Array.from(
      row.querySelectorAll<HTMLButtonElement>('.epic-child-blockers-list button'),
    ).find((b) => b.textContent === `${prefix}-3`)!;
  }

  /** Focus on the source; returns its R-15 key for the "focus stayed" comparison. */
  function focusSource(el: HTMLElement): string {
    act(() => el.focus());
    expect(document.activeElement).toBe(el);
    return el.getAttribute('data-epic-blocker-el')!;
  }

  function press(key: string) {
    fireEvent.keyDown(document.activeElement as HTMLElement, { key });
  }

  function focusedKey(): string | null {
    return (document.activeElement as HTMLElement).getAttribute('data-epic-blocker-el');
  }

  test.each(SOURCES)('source "%s" in row B: ↓ → next row, Home → first, End → last', (kind) => {
    const { items, rowByTitle } = mountKeys();
    focusSource(sourceIn(rowByTitle('sk-42.2'), 'b', kind));
    press('ArrowDown');
    expect(document.activeElement).toBe(items()[3]);

    focusSource(sourceIn(rowByTitle('sk-42.2'), 'b', kind));
    press('Home');
    expect(document.activeElement).toBe(items()[0]);

    focusSource(sourceIn(rowByTitle('sk-42.2'), 'b', kind));
    press('End');
    expect(document.activeElement).toBe(items()[items().length - 1]);
  });

  test.each(SOURCES)('source "%s" in row B: `*` expands the siblings, focus stays on the element', (kind) => {
    const { container, rowByTitle } = mountKeys();
    // We collapse sibling C with the chevron: a click on the chevron does not change the active row.
    const cChevron = rowByTitle('sk-42.3').querySelector<HTMLButtonElement>('.epic-tree-chevron')!;
    fireEvent.click(cChevron);
    expect(screen.queryByText('sk-42.3.1')).toBeNull();

    const key = focusSource(sourceIn(rowByTitle('sk-42.2'), 'b', kind));
    press('*');
    expect(screen.getByText('sk-42.3.1')).toBeTruthy();
    expect(focusedKey()).toBe(key);
    expect(container.contains(document.activeElement)).toBe(true);
  });

  test.each(SOURCES)('source "%s" in the first row A: ↑ with no target, ← collapses, → expands — focus stays', (kind) => {
    const { rowByTitle } = mountKeys();
    const key = focusSource(sourceIn(rowByTitle('sk-42.1'), 'a', kind));

    press('ArrowUp');
    expect(focusedKey()).toBe(key);

    press('ArrowLeft');
    expect(screen.queryByText('sk-42.1.1')).toBeNull();
    expect(focusedKey()).toBe(key);

    press('ArrowRight');
    expect(screen.getByText('sk-42.1.1')).toBeTruthy();
    expect(focusedKey()).toBe(key);
  });

  test.each(SOURCES)('source "%s": Home in the first row and End in the last visible one with no target — focus stays', (kind) => {
    const { rowByTitle, unmount } = mountKeys();
    const key = focusSource(sourceIn(rowByTitle('sk-42.1'), 'a', kind));
    press('Home');
    expect(focusedKey()).toBe(key);
    unmount();

    // Review skein-frontend/4 MINOR-5 — End on the last visible row: the
    // last row of the stand above has no sub-row, hence a separate stand where the
    // last row is a blocked one with five entries.
    const last = wrap(
      <Tree
        rows={[
          n('sk-42', 0),
          n('sk-42.1', 1),
          n('sk-42.9', 1, { isBlocked: true }, { blockers: fiveBlockers('z') }),
        ]}
        {...NONE}
      />,
    );
    const lastRow = Array.from(last.container.querySelectorAll<HTMLElement>('[role="treeitem"]')).find(
      (el) => el.querySelector('.epic-child-title')?.textContent === 'sk-42.9',
    )!;
    const lastKey = focusSource(sourceIn(lastRow, 'z', kind));
    press('End');
    expect(focusedKey()).toBe(lastKey);
    expect(document.activeElement?.closest('[role="treeitem"]')).toBe(lastRow);
  });

  test('Enter and space on a link → navigates to the blocker only; onOpen is not called, the active row and the collapse state are unchanged', async () => {
    const { onOpen, items, rowByTitle, user } = mountKeys();
    const link = sourceIn(rowByTitle('sk-42.2'), 'b', 'link');
    focusSource(link);
    await user.keyboard('{Enter}');
    expect(router.navigate).toHaveBeenLastCalledWith('/projects/proj-b/issues/b-1');

    focusSource(sourceIn(rowByTitle('sk-42.2'), 'b', 'link'));
    await user.keyboard(' ');
    expect(router.navigate).toHaveBeenCalledTimes(2);

    expect(onOpen).not.toHaveBeenCalled();
    expect(items()[2].getAttribute('tabindex')).toBe('0');
    expect(screen.getByText('sk-42.1.1')).toBeTruthy();
    expect(screen.getByText('sk-42.3.1')).toBeTruthy();
  });

  test('Enter on "+N" → expansion, onOpen is not called', async () => {
    const { onOpen, rowByTitle, user } = mountKeys();
    const more = sourceIn(rowByTitle('sk-42.2'), 'b', 'more');
    focusSource(more);
    await user.keyboard('{Enter}');
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(onOpen).not.toHaveBeenCalled();
  });

  test('focus without a click: .focus() on a link of a NON-active row makes its row active', () => {
    const { items, rowByTitle } = mountKeys();
    expect(items()[0].getAttribute('tabindex')).toBe('0');
    focusSource(sourceIn(rowByTitle('sk-42.2'), 'b', 'link'));
    expect(items()[2].getAttribute('tabindex')).toBe('0');
    expect(items()[0].getAttribute('tabindex')).toBe('-1');
  });

  test('the row is taken by the element with focus, not by the index of the active row', () => {
    const { items, rowByTitle } = mountKeys();
    // Focus on the link of B, then a mouse click on "+N" of row A: A becomes
    // active (onActivate), while focus stays on the link of B.
    focusSource(sourceIn(rowByTitle('sk-42.2'), 'b', 'link'));
    fireEvent.click(sourceIn(rowByTitle('sk-42.1'), 'a', 'more'));
    expect(items()[0].getAttribute('tabindex')).toBe('0');
    expect((document.activeElement as HTMLElement).textContent).toBe('b-1');

    press('ArrowDown');
    // The one after B (C), not the one after the active A (A.1).
    expect(document.activeElement).toBe(items()[3]);
  });

  test('Enter from an entry of the expanded list → navigates to the blocker only, onOpen is not called', async () => {
    // Review skein-frontend/4 MINOR-5 — Enter was checked only on a link and "+N".
    const { onOpen, rowByTitle, user } = mountKeys();
    focusSource(sourceIn(rowByTitle('sk-42.2'), 'b', 'expanded'));
    await user.keyboard('{Enter}');
    expect(router.navigate).toHaveBeenLastCalledWith('/projects/proj-b/issues/b-3');
    expect(onOpen).not.toHaveBeenCalled();
  });

  test.each(['ArrowUp', 'Home'])(
    'target row equals the active one: %s from the link of B with A active (a click on "+N") → focus on row A',
    (key) => {
      // Review skein-frontend/4 MINOR-1 — the "index does not change" branch: a mouse click on
      // "+N" of row A makes it active (focusIndex = A), while focus stays on
      // the link of B. The key's target is row A, that is the same index: changing
      // `focusIndex` to the same value does not rerun the effect, and the handler itself
      // must move focus.
      const { items, rowByTitle } = mountKeys();
      focusSource(sourceIn(rowByTitle('sk-42.2'), 'b', 'link'));
      fireEvent.click(sourceIn(rowByTitle('sk-42.1'), 'a', 'more'));
      expect(items()[0].getAttribute('tabindex')).toBe('0');
      expect((document.activeElement as HTMLElement).textContent).toBe('b-1');

      // ↑ from row B: the previous shown one is A.1; Home is the first, A. For ↑
      // we take a link in the row whose previous row is A itself.
      if (key === 'ArrowUp') {
        // We collapse A with the chevron (it does not change the active row): then B has
        // A right above it.
        fireEvent.click(rowByTitle('sk-42.1').querySelector<HTMLButtonElement>('.epic-tree-chevron')!);
        expect(screen.queryByText('sk-42.1.1')).toBeNull();
        expect((document.activeElement as HTMLElement).textContent).toBe('b-1');
      }

      press(key);
      expect(document.activeElement).toBe(rowByTitle('sk-42.1'));
    },
  );
});

// ───────── sk-421.2.8 line 46 — "Tree": the active row by click and the "+N" focus ─────────
//
// The active row is not only by focus: activating a sub-row element with the mouse
// makes its row active, even if the browser does not move focus to the button
// on click, and keyboard focus is deliberately not moved in this case.
// A click on the chevron does not change the active row.

describe('EpicChildrenTree — line 46, the active row by click and the "+N" focus', () => {
  /** The shown rows: A (0, five entries), B (1, five entries), C (2, has a child), C.1 (3). */
  function mountClicks() {
    const view = wrap(
      <Tree
        rows={[
          n('sk-42', 0),
          n('sk-42.1', 1, { isBlocked: true }, { blockers: fiveBlockers('a') }),
          n('sk-42.2', 1, { isBlocked: true }, { blockers: fiveBlockers('b') }),
          n('sk-42.3', 1),
          n('sk-42.3.1', 2, {}, { parentRef: { id: 'sk-42.3', edgeType: 'parent-child' } }),
        ]}
        {...NONE}
      />,
    );
    const items = () => Array.from(view.container.querySelectorAll<HTMLElement>('[role="treeitem"]'));
    const moreIn = (row: HTMLElement) =>
      Array.from(row.querySelectorAll<HTMLButtonElement>('.epic-child-blockers-line button')).find(
        (b) => b.textContent === '+2',
      )!;
    return { ...view, items, moreIn, user: userEvent.setup() };
  }

  const activeRowIndex = (items: HTMLElement[]) =>
    items.findIndex((el) => el.getAttribute('tabindex') === '0');

  test('fireEvent.click on "+N" of a non-active row without focus → the row is active, focus is not moved', () => {
    const { items, moreIn } = mountClicks();
    expect(activeRowIndex(items())).toBe(0);
    expect(document.activeElement).toBe(document.body);

    fireEvent.click(moreIn(items()[1]));

    expect(activeRowIndex(items())).toBe(1);
    expect(moreIn(items()[1]).getAttribute('aria-expanded')).toBe('true');
    // Keyboard focus is deliberately not moved.
    expect(document.activeElement).toBe(document.body);
  });

  test('a click on the chevron does not change the active row', () => {
    const { items } = mountClicks();
    expect(activeRowIndex(items())).toBe(0);
    fireEvent.click(items()[2].querySelector<HTMLButtonElement>('.epic-tree-chevron')!);
    expect(screen.queryByText('sk-42.3.1')).toBeNull();
    expect(activeRowIndex(items())).toBe(0);
  });

  test('focus on an entry of the expanded list, "+N" collapsed by mouse → focus on "+N"', () => {
    const { items, moreIn } = mountClicks();
    fireEvent.click(moreIn(items()[1]));
    const record = Array.from(
      items()[1].querySelectorAll<HTMLButtonElement>('.epic-child-blockers-list button'),
    ).find((b) => b.textContent === 'b-3')!;
    act(() => record.focus());
    expect(document.activeElement).toBe(record);

    // A mouse click on "+N" does not move focus by itself (fireEvent.click), so the move
    // must be done by the component, otherwise focus would vanish along with the list.
    fireEvent.click(moreIn(items()[1]));

    expect(moreIn(items()[1]).getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(moreIn(items()[1]));
  });

  test('keyboard activation of "+N" and a click with focus already on "+N" → focus stays on "+N"', async () => {
    const { items, moreIn, user } = mountClicks();
    const more = moreIn(items()[1]);
    act(() => more.focus());

    await user.keyboard('{Enter}');
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(more);

    fireEvent.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(more);
  });
});

// ───────── sk-421.2.8 line 47 — focus memory and sub-row element identification (R-14, R-15) ─────────
//
// A re-read after which the focused sub-row element remained
// leaves focus on it; "the same element" is an entry of the same blocker by the same
// link (the ordinal number among duplicates) in the same place (the sub-row or the
// expanded list). A vanished element gives focus to the child row, and without
// it, to `resolveEpicFocusTarget`. Focus that left on its own is not moved.

describe('EpicChildrenTree — line 47, sub-row focus memory', () => {
  /** A stand with re-rendering: `rerender` keeps the provider, the tree is not remounted. */
  function ui(rows: IssueTreeNode[]) {
    return (
      <MantineProvider>
        <Tree rows={rows} {...NONE} />
      </MantineProvider>
    );
  }

  const items = (container: HTMLElement) =>
    Array.from(container.querySelectorAll<HTMLElement>('[role="treeitem"]'));

  const rowOf = (container: HTMLElement, title: string) =>
    items(container).find((el) => el.querySelector('.epic-child-title')?.textContent === title) ?? null;

  function buttonIn(scope: Element, text: string, place: 'line' | 'list' = 'line'): HTMLButtonElement {
    const selector = place === 'line' ? '.epic-child-blockers-line button' : '.epic-child-blockers-list button';
    const found = Array.from(scope.querySelectorAll<HTMLButtonElement>(selector)).filter(
      (b) => b.textContent === text,
    );
    expect(found.length, `no "${text}" in ${place}`).toBeGreaterThan(0);
    return found[0];
  }

  function focusEl(el: HTMLElement) {
    act(() => el.focus());
    expect(document.activeElement).toBe(el);
  }

  const blocked = (id: string, blockers: TreeBlockerRef[], over: Partial<IssueTreeNode> = {}) =>
    n(id, 1, { isBlocked: true }, { blockers, ...over });

  test('(a) focus on "+N", a re-read with ≤3 entries at the same row index → focus on the child row', () => {
    const view = render(ui([n('sk-42', 0), blocked('sk-42.1', fiveBlockers('a')), n('sk-42.2', 1)]));
    focusEl(buttonIn(rowOf(view.container, 'sk-42.1')!, '+2'));

    view.rerender(ui([n('sk-42', 0), blocked('sk-42.1', fiveBlockers('a').slice(0, 3)), n('sk-42.2', 1)]));

    expect(document.activeElement).toBe(rowOf(view.container, 'sk-42.1'));
  });

  test('(b) focus on a link, a re-read with a row index shift (a new neighbour above) → focus on the same link', () => {
    const view = render(ui([n('sk-42', 0), blocked('sk-42.2', fiveBlockers('b'))]));
    const link = buttonIn(rowOf(view.container, 'sk-42.2')!, 'b-2');
    focusEl(link);

    view.rerender(ui([n('sk-42', 0), n('sk-42.1', 1), blocked('sk-42.2', fiveBlockers('b'))]));

    expect(items(view.container)[1]).toBe(rowOf(view.container, 'sk-42.2'));
    expect(document.activeElement).toBe(link);
    expect(document.activeElement?.getAttribute('role')).not.toBe('treeitem');
  });

  test('(c) focus on a link of a depth-2 row, the ancestor is collapsed → focus per resolveEpicFocusTarget (the ancestor row)', () => {
    const view = render(
      ui([
        n('sk-42', 0),
        n('sk-42.1', 1),
        n('sk-42.1.1', 2, { isBlocked: true }, {
          blockers: fiveBlockers('c'),
          parentRef: { id: 'sk-42.1', edgeType: 'parent-child' },
        }),
      ]),
    );
    focusEl(buttonIn(rowOf(view.container, 'sk-42.1.1')!, 'c-1'));

    fireEvent.click(rowOf(view.container, 'sk-42.1')!.querySelector<HTMLButtonElement>('.epic-tree-chevron')!);

    expect(rowOf(view.container, 'sk-42.1.1')).toBeNull();
    expect(document.activeElement).toBe(rowOf(view.container, 'sk-42.1'));
  });

  test('(d) the blocking display is removed → focus on the child row', () => {
    const view = render(ui([n('sk-42', 0), blocked('sk-42.1', fiveBlockers('a'))]));
    focusEl(buttonIn(rowOf(view.container, 'sk-42.1')!, 'a-1'));

    view.rerender(ui([n('sk-42', 0), n('sk-42.1', 1, { isBlocked: false }, { blockers: fiveBlockers('a') })]));

    expect(rowOf(view.container, 'sk-42.1')!.querySelector('.epic-child-blockers')).toBeNull();
    expect(document.activeElement).toBe(rowOf(view.container, 'sk-42.1'));
  });

  test('(e) focus went to body, then the element disappeared → focus is not moved', async () => {
    const view = render(ui([n('sk-42', 0), blocked('sk-42.1', fiveBlockers('a'))]));
    const more = buttonIn(rowOf(view.container, 'sk-42.1')!, '+2');
    focusEl(more);
    // A click inside the treeitem would give focus to the treeitem itself (a focusable
    // ancestor), so "went to body" means leaving the tree: blur and the deferred
    // focusout check.
    act(() => more.blur());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    expect(document.activeElement).toBe(document.body);

    view.rerender(ui([n('sk-42', 0), blocked('sk-42.1', fiveBlockers('a').slice(0, 3))]));

    expect(document.activeElement).toBe(document.body);
  });

  test('(f) focus on the SECOND of the blocks/waits-for duplicates, a re-read of the same → focus on the second', () => {
    const dup = (): TreeBlockerRef[] => [blocker('p-1'), blocker('p-1'), blocker('p-2')];
    const view = render(ui([n('sk-42', 0), blocked('sk-42.1', dup())]));
    const line = rowOf(view.container, 'sk-42.1')!.querySelector('.epic-child-blockers-line')!;
    const [, second] = Array.from(line.querySelectorAll<HTMLButtonElement>('button')).filter(
      (b) => b.textContent === 'p-1',
    );
    focusEl(second);
    const key = second.getAttribute('data-epic-blocker-el');

    view.rerender(ui([n('sk-42', 0), blocked('sk-42.1', dup())]));

    const again = Array.from(
      rowOf(view.container, 'sk-42.1')!.querySelectorAll<HTMLButtonElement>('.epic-child-blockers-line button'),
    ).filter((b) => b.textContent === 'p-1');
    expect(document.activeElement).toBe(again[1]);
    expect(document.activeElement?.getAttribute('data-epic-blocker-el')).toBe(key);
  });

  test('(g) sub-row entry 2 and an entry of the same blocker in the expanded list are different elements (the place is in the key)', () => {
    const view = render(ui([n('sk-42', 0), blocked('sk-42.1', fiveBlockers('a'))]));
    const row = rowOf(view.container, 'sk-42.1')!;
    fireEvent.click(buttonIn(row, '+2'));
    const inline = buttonIn(row, 'a-2', 'line');
    const expanded = buttonIn(row, 'a-2', 'list');
    expect(inline).not.toBe(expanded);
    expect(inline.getAttribute('data-epic-blocker-el')).not.toBe(expanded.getAttribute('data-epic-blocker-el'));

    focusEl(inline);
    view.rerender(ui([n('sk-42', 0), blocked('sk-42.1', fiveBlockers('a'))]));
    expect(document.activeElement).toBe(buttonIn(rowOf(view.container, 'sk-42.1')!, 'a-2', 'line'));
  });

  test('(h) A, X, B: focus went from the link of A to row B (↓↓); a re-read removes the sub-row of A and row B → focus on X', () => {
    const view = render(
      ui([n('sk-42', 0), blocked('sk-42.1', [blocker('a-1')]), n('sk-42.5', 1), n('sk-42.2', 1)]),
    );
    focusEl(buttonIn(rowOf(view.container, 'sk-42.1')!, 'a-1'));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rowOf(view.container, 'sk-42.5'));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rowOf(view.container, 'sk-42.2'));

    view.rerender(ui([n('sk-42', 0), n('sk-42.1', 1, { isBlocked: false }), n('sk-42.5', 1)]));

    const active = document.activeElement;
    expect(active).not.toBe(rowOf(view.container, 'sk-42.1'));
    expect((active as HTMLElement | null)?.closest('.epic-child-blockers')).toBeFalsy();
    // sk-444 — the row with focus (B) disappeared: the sk-421.2 US-2 fallback target,
    // the nearest row above is X.
    expect(active).toBe(rowOf(view.container, 'sk-42.5'));
  });

  test('(i) a render with blocks/waits-for duplicates writes no duplicate-key warning to the console', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const view = render(
      ui([n('sk-42', 0), blocked('sk-42.1', [blocker('p-1'), blocker('p-1'), blocker('p-2'), blocker('p-1')])]),
    );
    fireEvent.click(buttonIn(rowOf(view.container, 'sk-42.1')!, '+1'));
    const keyWarnings = errors.mock.calls.filter((call) =>
      call.some((arg) => typeof arg === 'string' && /same key|unique "key"/i.test(arg)),
    );
    errors.mockRestore();
    expect(keyWarnings).toEqual([]);
  });
});

// ───────── sk-421.2.8 line 48 — "Tree": screen reader, treeitem accessible names, id references ─────────
//
// The `treeitem` name does not change because of the sub-row (sk-421.2 SC-013): R-16 hangs on the
// row an `aria-labelledby` to TODAY's name sources, the chevron label
// and the content of the child row, while the sub-row is announced as a description.
//
// The name references are built BY HAND from today's labels (the chevron,
// `epic.openChild`, the label of the status and of the blocked status, the progress,
// the placeholder), and NOT taken by the Testing Library computer: when walking
// the content it ignores the `aria-label` of the row button and would give a reference
// that goes red on a correct R-16 implementation (checked on this stand:
// "Collapse sk-42. 1 sk-42.1 open" instead of the button label). The actual name
// is computed below by the same rule as the reference: `aria-labelledby` → the text
// alternatives of the referenced nodes, for a node its `aria-label`, otherwise the text of
// its descendants; hidden (`aria-hidden`) ones do not take part. A browser check of the
// accessibility tree is outside this feature (sk-443).

/** The text alternative of a node by the accname rule for the `aria-labelledby` walk. */
function textAlternative(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (!(node instanceof Element)) return '';
  if (node.getAttribute('aria-hidden') === 'true') return '';
  const label = node.getAttribute('aria-label');
  if (label && label.trim() !== '') return label;
  return Array.from(node.childNodes)
    .map((child) => textAlternative(child))
    .filter((part) => part.trim() !== '')
    .join(' ');
}

/** The accessible name of a `treeitem` from its `aria-labelledby` (R-16). */
function treeitemName(item: Element): string {
  const ids = (item.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
  expect(ids.length, 'the treeitem has no aria-labelledby').toBeGreaterThan(0);
  return ids
    .map((id) => {
      const target = document.getElementById(id);
      expect(target, `dangling id in aria-labelledby: ${id}`).not.toBeNull();
      return textAlternative(target!);
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every id in aria-labelledby / aria-describedby / aria-controls resolves. */
function expectNoDanglingIds(container: HTMLElement) {
  const dangling: string[] = [];
  for (const el of container.querySelectorAll('[aria-labelledby], [aria-describedby], [aria-controls]')) {
    for (const attr of ['aria-labelledby', 'aria-describedby', 'aria-controls']) {
      for (const id of (el.getAttribute(attr) ?? '').split(/\s+/).filter(Boolean)) {
        if (!document.getElementById(id)) dangling.push(`${attr}=${id}`);
      }
    }
  }
  expect(dangling).toEqual([]);
}

describe('EpicChildrenTree — line 48, screen reader, treeitem names and id references', () => {
  const RECORDS: TreeBlockerRef[] = [
    { id: 'p-2', title: 'Title p-2', status: 'open', projectId: 'proj-b' },
    { id: 'q-1', redacted: true },
    { id: 'p-9', title: 'Title p-9', status: 'in_progress', projectId: 'proj-b' },
    { id: 'p-10', title: 'Title p-10', status: 'open', projectId: 'proj-b' },
    { id: 'p-11', title: 'Title p-11', status: 'deferred', projectId: 'proj-b' },
  ];

  function HarnessWithCollapsed({ rows }: { rows: IssueTreeNode[] }) {
    // Parent sk-42.4 is collapsed from the first render: a row with the "Expand" chevron.
    const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set(['sk-42.4']));
    return (
      <EpicChildrenTree
        rows={rows}
        {...NONE}
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
        epicId="sk-42"
      />
    );
  }

  function mountNames() {
    const rows: IssueTreeNode[] = [
      n('sk-42', 0),
      // A parent with a chevron, expanded.
      n('sk-42.1', 1),
      // A leaf, not blocked.
      n('sk-42.1.1', 2, {}, { parentRef: { id: 'sk-42.1', edgeType: 'parent-child' } }),
      // A blocked leaf with a sub-row of five entries.
      n('sk-42.2', 1, { isBlocked: true }, { blockers: RECORDS }),
      // A "no access" placeholder.
      n('hidden-1', 1, { status: '', type: '' }, { isReference: true }),
      // A parent with a chevron, collapsed.
      n('sk-42.4', 1),
      n('sk-42.4.1', 2, {}, { parentRef: { id: 'sk-42.4', edgeType: 'parent-child' } }),
      // A nested epic with progress.
      n('sk-42.5', 1, {
        type: 'epic',
        // sk-489 T016 — the summary of a new server: the accessible name of the row
        // follows the branch label and says "done".
        epicProgress: { closed: 1, total: 2, done: 1, counted: 2, noWork: 0 },
      } as Partial<IssueTreeRowItem>),
    ];
    const view = wrap(<HarnessWithCollapsed rows={rows} />);
    const items = () => Array.from(view.container.querySelectorAll<HTMLElement>('[role="treeitem"]'));
    return { ...view, items };
  }

  test('the accessible name of EVERY treeitem equals the reference built from today\'s labels', () => {
    const { items } = mountNames();
    expect(items().map(treeitemName)).toEqual([
      // sk-460.13 — the type chip is printed in "Tree" too, so the type word
      // entered the row name: the name is assembled from its content.
      'Collapse Open child issue sk-42.1: sk-42.1 open task',
      'Open child issue sk-42.1.1: sk-42.1.1 open task',
      'Open child issue sk-42.2: sk-42.2 Status: open (blocked by dependencies) task',
      'no access',
      'Expand Open child issue sk-42.4: sk-42.4 open task',
      // sk-460.5 — the branch label took the design form ("a pair of numbers, then
      // words") instead of the former `(1/2 closed)` in parentheses. The name
      // reference follows it: the label lies in the row and gets into the name.
      //
      // sk-489 T016 (US-6) — and the word in it changed to "done":
      // the row's progress label speaks of done out of counted, not
      // of closed out of all. The accessible name changes with it,
      // because it is assembled from the row content.
      'Open child issue sk-42.5: sk-42.5 open epic 1/2 children done',
    ]);
    // The sub-row text does not get into the name.
    for (const item of items()) expect(treeitemName(item)).not.toContain('blocked:');
  });

  test('aria-describedby — three entries and "2 more" collapsed, all five expanded; "+N" aria-expanded and aria-controls', () => {
    const { container, items } = mountNames();
    const blockedRow = items()[2];
    const described = () =>
      (blockedRow.getAttribute('aria-describedby') ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ');

    expect(described()).toBe('blocked: p-2 · open, unavailable, p-9 · in progress, 2 more');
    const more = Array.from(blockedRow.querySelectorAll<HTMLButtonElement>('.epic-child-blockers-line button')).find(
      (b) => b.textContent === '+2',
    )!;
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expectNoDanglingIds(container);

    fireEvent.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    const controls = more.getAttribute('aria-controls');
    expect(controls, '"+N" has no aria-controls with the list expanded').toBeTruthy();
    expect(document.getElementById(controls!)?.classList.contains('epic-child-blockers-list')).toBe(true);
    expect(described()).toBe(
      'blocked: p-2 · Title p-2 · open, unavailable, p-9 · Title p-9 · in progress, p-10 · Title p-10 · open, p-11 · Title p-11 · deferred',
    );
    expectNoDanglingIds(container);

    // The row name with "+N" expanded is the former one, that is the sub-row text still
    // does not get into it. The type word is in the name since sk-460.13:
    // this is the SECOND copy of the name reference (the first is in the test above), and it
    // must move together with the first.
    expect(treeitemName(blockedRow)).toBe(
      'Open child issue sk-42.2: sk-42.2 Status: open (blocked by dependencies) task',
    );
  });
});

// ───────── sk-444 — the ROW with focus disappeared (sk-421.2 US-2 "Focus fallback target", SC-013) ─────────
//
// By the time of the effect the unmounted `treeitem` has already given focus to `body`, and
// `document.activeElement` does not show the disappearance, which is exactly where
// the former condition "focus inside the tree" silently broke. There is one target rule
// for both modes: the nearest surviving shown row that stood ABOVE
// in the former display order, otherwise the first shown, otherwise the switch
// (it is performed by the section via `onFocusFallback`). Focus that left the tree
// on its own is not taken away by the rule.

describe('sk-444 — "Tree": the row with focus disappeared', () => {
  function ui(rows: IssueTreeNode[], onFocusFallback?: () => void) {
    return (
      <MantineProvider>
        <Tree rows={rows} {...NONE} onFocusFallback={onFocusFallback} />
      </MantineProvider>
    );
  }

  const rowOf = (container: HTMLElement, title: string) =>
    Array.from(container.querySelectorAll<HTMLElement>('[role="treeitem"]')).find(
      (el) => el.querySelector('.epic-child-title')?.textContent === title,
    ) ?? null;

  function focusRow(container: HTMLElement, title: string) {
    const el = rowOf(container, title)!;
    act(() => el.focus());
    expect(document.activeElement).toBe(el);
  }

  const AXB = [n('sk-42', 0), n('sk-42.1', 1), n('sk-42.5', 1), n('sk-42.2', 1)];

  test('the row with focus disappeared → focus on the nearest row above', () => {
    const view = render(ui(AXB));
    focusRow(view.container, 'sk-42.2');

    view.rerender(ui([n('sk-42', 0), n('sk-42.1', 1), n('sk-42.5', 1)]));

    expect(rowOf(view.container, 'sk-42.2')).toBeNull();
    expect(document.activeElement).toBe(rowOf(view.container, 'sk-42.5'));
    expect(rowOf(view.container, 'sk-42.5')!.tabIndex).toBe(0);
  });

  test('the first row disappeared → focus on the first shown one', () => {
    const view = render(ui(AXB));
    focusRow(view.container, 'sk-42.1');

    view.rerender(ui([n('sk-42', 0), n('sk-42.5', 1), n('sk-42.2', 1)]));

    expect(document.activeElement).toBe(rowOf(view.container, 'sk-42.5'));
  });

  test('a reorder with a disappearance: the target is the neighbour above in the FORMER order, not the row at the former place', () => {
    const view = render(ui(AXB));
    focusRow(view.container, 'sk-42.2');

    // B disappeared, X and A swapped places: at B's former index there is now
    // nobody, and a positional choice "the row above by the new order" would give A.
    view.rerender(ui([n('sk-42', 0), n('sk-42.5', 1), n('sk-42.1', 1)]));

    expect(document.activeElement).toBe(rowOf(view.container, 'sk-42.5'));
  });

  test('a reorder without a disappearance → focus stays on the same row', () => {
    const view = render(ui(AXB));
    focusRow(view.container, 'sk-42.5');

    view.rerender(ui([n('sk-42', 0), n('sk-42.2', 1), n('sk-42.1', 1), n('sk-42.5', 1)]));

    expect(document.activeElement).toBe(rowOf(view.container, 'sk-42.5'));
  });

  test('the ancestor of the row with focus was collapsed (chevron by mouse) → focus on the ancestor', () => {
    const view = render(ui(FULL));
    focusRow(view.container, 'sk-42.1.1');

    fireEvent.click(rowOf(view.container, 'sk-42.1')!.querySelector<HTMLButtonElement>('.epic-tree-chevron')!);

    expect(rowOf(view.container, 'sk-42.1.1')).toBeNull();
    expect(document.activeElement).toBe(rowOf(view.container, 'sk-42.1'));
  });

  test('a "no access" row with focus survived a re-read with a synthetic id change → focus on the same row', () => {
    const view = render(
      ui([n('sk-42', 0), n('sk-42.1', 1), n('hidden-1', 1, { status: '', type: '' }, { isReference: true })]),
    );
    const stubRow = () =>
      view.container.querySelector<HTMLElement>('.epic-child-no-access')!.closest<HTMLElement>('[role="treeitem"]')!;
    act(() => stubRow().focus());

    view.rerender(
      ui([n('sk-42', 0), n('sk-42.1', 1), n('hidden-2', 1, { status: '', type: '' }, { isReference: true })]),
    );

    expect(document.activeElement).toBe(stubRow());
  });

  test('no rows left → the fallback target is requested from the section', () => {
    const fallback = vi.fn();
    const view = render(ui(AXB, fallback));
    focusRow(view.container, 'sk-42.5');

    view.rerender(ui([n('sk-42', 0)], fallback));

    expect(fallback).toHaveBeenCalledTimes(1);
  });

  test('focus left the tree on its own, then the row disappeared → focus is not moved', async () => {
    const fallback = vi.fn();
    const view = render(ui(AXB, fallback));
    focusRow(view.container, 'sk-42.2');
    act(() => (document.activeElement as HTMLElement).blur());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    expect(document.activeElement).toBe(document.body);

    view.rerender(ui([n('sk-42', 0), n('sk-42.1', 1), n('sk-42.5', 1)]));

    expect(document.activeElement).toBe(document.body);
    expect(fallback).not.toHaveBeenCalled();
  });
});

// ───────── sk-489 T017 — "Tree": the row accessible name names the outcome (US-7, line 63) ─────────
//
// The half of US-7 that no text guard sees: "with an accessible
// name naming the outcome". The `treeitem` name is assembled not from what
// lies in the document, but from what `aria-labelledby` points to
// (R-16), and is computed by the same accname rule that computes the reference of
// the names above (`#treeitemName`). A mark shown to the eye but
// left outside the name sources, or hidden from the screen reader with
// `aria-hidden` as the branch segment next to it is hidden, makes THIS test go red and
// no text one.

describe('EpicChildrenTree — the outcome in the row accessible name (sk-489 T017)', () => {
  const closedTree = (closeOutcome?: string) =>
    wrap(
      <Tree
        rows={[
          n('sk-42.9', 1, {
            status: 'closed',
            ...(closeOutcome === undefined ? {} : { closeOutcome }),
          } as Partial<IssueTreeRowItem>),
        ]}
        {...NONE}
      />,
    );

  const nameOfOnlyRow = (container: HTMLElement) => {
    const items = Array.from(container.querySelectorAll('[role="treeitem"]'));
    expect(items).toHaveLength(1);
    return treeitemName(items[0]);
  };

  test('dropped: the row name names the outcome', () => {
    expect(nameOfOnlyRow(closedTree('wont_do').container)).toBe(
      "Open child issue sk-42.9: sk-42.9 closed won't do task",
    );
  });

  test('done: the name is the former one, with no extra word in it', () => {
    // A reference without the mark, which is also a guard that the row name was not
    // rebuilt for the feature entirely: the order and composition of its parts
    // are the former.
    expect(nameOfOnlyRow(closedTree('done').container)).toBe(
      'Open child issue sk-42.9: sk-42.9 closed task',
    );
  });

  test('the field did not come (US-10): the name as for a done one', () => {
    expect(nameOfOnlyRow(closedTree().container)).toBe(
      'Open child issue sk-42.9: sk-42.9 closed task',
    );
  });

  test('an unfamiliar value gets into the name AS IS (INV-2)', () => {
    expect(nameOfOnlyRow(closedTree('flattened_into_epic').container)).toBe(
      'Open child issue sk-42.9: sk-42.9 closed flattened_into_epic task',
    );
  });
});
