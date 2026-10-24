/**
 * sk-285.2.19 (step 4) — the column headings as a sort control, and the
 * caption that admits what sorting a TREE costs.
 *
 * `lib/__tests__/taskSort.test.ts` pins the model (what a click should
 * mean, what the resulting order is). This file pins the half only the
 * rendered header can answer:
 *
 *   - which headings are controls at all, and which are just words;
 *   - what a heading ANNOUNCES — `aria-sort`, the one attribute a
 *     screen-reader user has to tell a sorted column from a sortable
 *     one, and the composite key that must not claim a column;
 *   - that a click reports the right next sort, in both cases (a new
 *     column, and reversing the current one);
 *   - that the caveat about branch-local order is on screen, in the
 *     reader's language, tied to the controls that cause it.
 *
 * The last one is the requirement that the price of decision A is
 * VISIBLE. A test for it looks like a test for a string, and it is not:
 * without it the feature degrades into a table whose order looks global
 * and is not, which is the failure mode the decision was accepted with.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import i18n, { DEFAULT_LANGUAGE } from '../../../i18n/config';
import { TaskTreeVirtualList } from '../TaskTreeVirtualList';
import { TREE_OPTIONAL_COLUMNS } from '../../../lib/treeColumns';
import type { TasksSortDirection, TasksSortPref } from '../../../lib/taskSort';
import type { FlatTreeRow } from '../../../lib/flattenTree';
import type { IssueSummary, TasksSortKey } from '../../../api/issues';

function item(id: string, status: IssueSummary['status'] = 'open'): IssueSummary {
  return {
    id,
    projectId: 'proj-1',
    version: 1,
    title: id,
    type: 'task',
    priority: 2,
    status,
    pinned: false,
    assignee: null,
    componentIds: [],
    labels: [],
    isBlocked: false,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
  };
}

function row(it: IssueSummary, depth = 0): FlatTreeRow {
  return {
    item: it,
    depth,
    edgeType: depth === 0 ? null : 'parent-child',
    isReference: false,
    firstSeenAt: null,
    isContext: false,
    hasChildren: false,
  };
}

const ROWS: FlatTreeRow[] = [row(item('demo-1'))];

/**
 * sk-135's mandatory band, as the table receives it: a standing root
 * ahead of an ordinary one, which is what `partitionStandingTreeRows`
 * produces AFTER the sort has run.
 */
const ROWS_WITH_STANDING: FlatTreeRow[] = [
  row(item('demo-9', 'standing')),
  row(item('demo-1')),
];

/** Columns whose heading IS a sort control, and columns whose is not. */
const SORTABLE = ['id', 'priority', 'updated', 'created'] as const;
const NOT_SORTABLE = [
  'title',
  'status',
  'blocked',
  'type',
  'assignee',
  'components',
  'labels',
  'progress',
] as const;

function renderHeader({
  sort = 'updated' as TasksSortKey,
  sortDir = 'desc' as TasksSortDirection,
  onSortChange = () => {},
  rows = ROWS,
}: {
  sort?: TasksSortKey;
  sortDir?: TasksSortDirection;
  onSortChange?: (next: TasksSortPref) => void;
  rows?: FlatTreeRow[];
} = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MantineProvider forceColorScheme="dark">
        <MemoryRouter>
          <TaskTreeVirtualList
            rows={rows}
            hasMoreRows={false}
            selectedId={null}
            expanded={new Set()}
            searchQuery=""
            componentNames={new Map()}
            // Every switchable column is on, so the file can ask about
            // the ones that are off by default (`created`, `labels`) as
            // well as the ones that are not.
            treeColumns={new Set(TREE_OPTIONAL_COLUMNS)}
            sort={sort}
            sortDir={sortDir}
            onSortChange={onSortChange}
            onSelect={() => {}}
            onToggle={() => {}}
          />
        </MemoryRouter>
      </MantineProvider>
    </QueryClientProvider>,
  );
}

function head(container: HTMLElement, column: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(
    `.task-tree-head-cell--${column}`,
  );
  if (!el) throw new Error(`no heading for column ${column}`);
  return el;
}

function note(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('.task-tree-sort-note');
  if (!el) throw new Error('the sort caption is not rendered');
  return el;
}

afterEach(async () => {
  cleanup();
  if (i18n.language !== DEFAULT_LANGUAGE) {
    await i18n.changeLanguage(DEFAULT_LANGUAGE);
  }
});

describe('sk-285.2.19 (step 4) — which headings sort', () => {
  test('a heading with a sort key is a button; one without is plain text', () => {
    const { container } = renderHeader();
    for (const column of SORTABLE) {
      expect(head(container, column).querySelector('button'), column).not.toBeNull();
    }
    for (const column of NOT_SORTABLE) {
      // Not "a button that does nothing" — no control at all, so the
      // keyboard never lands on a heading that cannot answer.
      expect(head(container, column).querySelector('button'), column).toBeNull();
    }
  });

  test('only sortable headings carry aria-sort, and only one is sorted', () => {
    const { container } = renderHeader({ sort: 'updated', sortDir: 'desc' });
    expect(head(container, 'updated').getAttribute('aria-sort')).toBe('descending');
    for (const column of SORTABLE.filter((c) => c !== 'updated')) {
      expect(head(container, column).getAttribute('aria-sort'), column).toBe('none');
    }
    for (const column of NOT_SORTABLE) {
      // `none` on a heading that cannot be sorted advertises a control
      // that does not exist.
      expect(head(container, column).getAttribute('aria-sort'), column).toBeNull();
    }
  });

  test('the direction is announced, not just drawn', () => {
    const { container } = renderHeader({ sort: 'priority', sortDir: 'asc' });
    expect(head(container, 'priority').getAttribute('aria-sort')).toBe('ascending');
    cleanup();
    const second = renderHeader({ sort: 'priority', sortDir: 'desc' });
    expect(head(second.container, 'priority').getAttribute('aria-sort')).toBe(
      'descending',
    );
  });

  test('the composite default claims no column', () => {
    // `priority-updated` is two keys at once. An arrow on «Priority»
    // would tell the reader the table is ordered by priority alone.
    const { container } = renderHeader({ sort: 'priority-updated', sortDir: 'asc' });
    for (const column of SORTABLE) {
      expect(head(container, column).getAttribute('aria-sort'), column).toBe('none');
    }
    // It is not hidden either: the caption names the composite in full,
    // which is the one place two keys at once fit.
    const text = note(container).textContent ?? '';
    expect(text).toContain('Priority + Updated');
    expect(text).not.toContain('sort.priority-updated');
  });
});

describe('sk-285.2.19 (step 4) — what a click reports', () => {
  test('clicking another column asks for it at its natural direction', async () => {
    const onSortChange = vi.fn();
    const { container } = renderHeader({
      sort: 'updated',
      sortDir: 'asc',
      onSortChange,
    });
    await userEvent.click(head(container, 'created').querySelector('button')!);
    // Natural, NOT the current direction carried over: «Created» means
    // newest first, whichever way «Updated» happened to be reversed.
    expect(onSortChange).toHaveBeenCalledWith({ sort: 'created', direction: 'desc' });
  });

  test('clicking the sorted column reverses it', async () => {
    const onSortChange = vi.fn();
    const { container } = renderHeader({
      sort: 'updated',
      sortDir: 'desc',
      onSortChange,
    });
    await userEvent.click(head(container, 'updated').querySelector('button')!);
    expect(onSortChange).toHaveBeenCalledWith({ sort: 'updated', direction: 'asc' });
  });
});

describe('sk-285.2.19 (step 4) — the price of a branch-local order is on screen', () => {
  test('the caption names the order in force and says where it applies', () => {
    const { container } = renderHeader({ sort: 'updated', sortDir: 'desc' });
    const text = note(container).textContent ?? '';
    // The field, in the same words the «Sort by» combobox uses…
    expect(text).toContain('Updated');
    // …the direction…
    expect(text).toContain('descending');
    // …and the caveat itself: the order is per branch, so the top row is
    // not the top of the project.
    expect(text).toContain('branch');
    // A missing dictionary entry renders as the key and would satisfy a
    // check for "not empty".
    expect(text).not.toContain('tree.sortScope');
  });

  test('every sortable heading points at that caption', () => {
    // The caveat has to reach a reader who never sees the strip above the
    // table: `aria-describedby` reads it out with the control.
    const { container } = renderHeader();
    const id = note(container).id;
    expect(id).toBeTruthy();
    for (const column of SORTABLE) {
      const button = head(container, column).querySelector('button')!;
      expect(button.getAttribute('aria-describedby'), column).toBe(id);
    }
  });

  test('the caption is translated, not English-with-a-Russian-UI', async () => {
    const { container } = renderHeader({ sort: 'updated', sortDir: 'desc' });
    const english = note(container).textContent ?? '';
    await act(async () => {
      await i18n.changeLanguage('ru');
    });
    const russian = note(container).textContent ?? '';
    expect(russian).not.toBe(english);
    expect(russian).toContain('ветк');
    expect(russian).toContain('по убыванию');
    expect(russian).not.toContain('tree.sortScope');
  });

  test('the caption owns up to the standing band when it is displacing rows', () => {
    // sk-135 floats standing ROOTS above everything AFTER the sort ran,
    // so while that is happening the top of the table is not what the
    // first clause describes. A caption that promises an order the first
    // rows do not keep is worse than no caption.
    const { container } = renderHeader({
      sort: 'updated',
      sortDir: 'desc',
      rows: ROWS_WITH_STANDING,
    });
    const text = note(container).textContent ?? '';
    expect(text).toContain('Updated');
    expect(text).toContain('Standing');
    expect(text).not.toContain('tree.sortScopeStanding');
  });

  test('and stays quiet when no standing row is displacing anything', () => {
    // The caveat is about a band that is on screen, not about a rule
    // that exists. A permanent one is noise the reader learns to skip,
    // and it would be wrong here: with no standing root the table IS
    // ordered exactly as the first clause says.
    expect(note(renderHeader().container).textContent ?? '').not.toContain(
      'Standing',
    );
    cleanup();
    // Nothing but standing roots is the same case: the band displaces
    // nothing, and the rows are in the sorted order the caption names.
    const onlyStanding = renderHeader({
      rows: [row(item('demo-9', 'standing')), row(item('demo-8', 'standing'))],
    });
    expect(note(onlyStanding.container).textContent ?? '').not.toContain(
      'Standing',
    );
  });

  test('the standing clause is translated too', async () => {
    const { container } = renderHeader({ rows: ROWS_WITH_STANDING });
    await act(async () => {
      await i18n.changeLanguage('ru');
    });
    const russian = note(container).textContent ?? '';
    expect(russian).toContain('Постоянные задачи');
    expect(russian).not.toContain('tree.sortScopeStanding');
  });

  test('the caption sits OUTSIDE the scroll container', () => {
    // The virtualizer measures every row offset from the top of the
    // scroller, and accounts for the sticky header strip alone. Anything
    // else inside it above the rows shifts all of them.
    const { container } = renderHeader();
    const scroller = container.querySelector('.col-body')!;
    expect(scroller.contains(note(container))).toBe(false);
  });
});

/**
 * sk-285.2.20 — the half of the sort state a SIGHTED reader gets.
 *
 * The describes above pin `aria-sort` in both directions, and that is
 * the whole announcement — but a screen reader is not who reads a table
 * header. What the eye reads is two things neither of them touches: the
 * direction MARK inside the button (up / down, and the neutral
 * both-ways mark when this column is not the one in force).
 *
 * sk-285.7.2.88 — that mark used to be the CHARACTERS `'\u2191'` /
 * `'\u2193'` / `'\u21c5'`, and this file read them with `textContent`.
 * §8 names all three (`arrow-up`, `arrow-down`, `arrows-sort`), so they
 * are drawn now. The CLAIM is unchanged and so are
 * the three cases — only the reader moved, from the node's text to the
 * Tabler icon it contains. Reading the icon by NAME rather than by
 * «there is an svg» is what keeps the original point: the header must
 * not announce «ascending» and draw the other arrow, and an svg-count
 * assertion could not tell those apart.
 *
 * Both were unasserted, so the header was free to announce «ascending»
 * and draw a downward arrow — the two halves of one fact disagreeing,
 * with nothing red. They are therefore asserted TOGETHER here, per
 * direction, rather than each on its own.
 */
describe('sk-285.2.20 — the sort as it is drawn, not as it is announced', () => {
  /**
   * The direction mark of a sortable heading, by the Tabler name it is
   * drawn with — `arrow-up`, `arrow-down` or `arrows-sort`.
   *
   * Also asserts, on every read, that the mark is ONE drawn icon and
   * that no character survives beside it:
   * audit Q-2's `✓ ✓ Accept` is the failure where an icon is ADDED and
   * the glyph it replaced stays put.
   */
  function arrow(container: HTMLElement, column: string): string {
    const el = head(container, column).querySelector(
      '.task-tree-head-sort-arrow',
    );
    if (el === null) throw new Error(`no direction mark on «${column}»`);
    expect((el.textContent ?? '').trim(), `a character survives on «${column}»`).toBe('');
    const svgs = el.querySelectorAll('svg');
    expect(svgs.length, `nothing drawn on «${column}»`).toBe(1);
    const svg = svgs[0];
    const name = /tabler-icon-([a-z-]+)/.exec(svg.getAttribute('class') ?? '');
    if (name === null) throw new Error(`unnamed icon on «${column}»`);
    return name[1];
  }

  test('the arrow points the way the heading says it does', () => {
    const asc = renderHeader({ sort: 'priority', sortDir: 'asc' });
    expect(head(asc.container, 'priority').getAttribute('aria-sort')).toBe(
      'ascending',
    );
    expect(arrow(asc.container, 'priority')).toBe('arrow-up');
    cleanup();

    const desc = renderHeader({ sort: 'priority', sortDir: 'desc' });
    expect(head(desc.container, 'priority').getAttribute('aria-sort')).toBe(
      'descending',
    );
    expect(arrow(desc.container, 'priority')).toBe('arrow-down');
  });

  test('a sortable heading that is NOT in force offers the neutral mark', () => {
    // `arrows-sort` is an invitation, not a state: it says "this column
    // can be ordered", which is the only thing true of a heading nothing
    // is sorted by. A one-way arrow would claim three orders at once.
    const { container } = renderHeader({ sort: 'updated', sortDir: 'desc' });
    for (const column of SORTABLE.filter((c) => c !== 'updated')) {
      expect(arrow(container, column), column).toBe('arrows-sort');
    }
  });

  test('the composite default points nowhere', () => {
    // Same reason `aria-sort` stays `none` for it: `priority-updated` is
    // two keys, and a heading with an arrow on it would say the table is
    // ordered by that column alone.
    const { container } = renderHeader({
      sort: 'priority-updated',
      sortDir: 'asc',
    });
    for (const column of SORTABLE) {
      expect(arrow(container, column), column).toBe('arrows-sort');
    }
  });
});
