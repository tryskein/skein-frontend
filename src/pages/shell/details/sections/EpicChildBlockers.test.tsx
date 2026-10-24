/**
 * sk-421.2.8 — render tests of the blockers sub-line under a child row of
 * the epic section (`EpicChildBlockers.tsx`).
 *
 * T010 lands the smoke check of its gate here; the matrix rows that belong
 * to the component itself (32, 33, 34) extend this file.
 *
 * Harness: the real bundled i18n instance (English unless a test switches),
 * `useNavigate` spied — the component navigates by path (R-17).
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { IssueTreeRowItem, TreeBlockerRef } from '../../../../api/issues';
import i18n, { DEFAULT_LANGUAGE } from '../../../../i18n/config';

const router = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('react-router-dom', async (importActual) => {
  const actual = await importActual<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => router.navigate };
});

import { MantineProvider } from '@mantine/core';
import { EpicChildBlockers, epicChildBlockersDescriptionId } from './EpicChildBlockers';
import { EpicChildRow } from './EpicChildRow';

afterEach(async () => {
  cleanup();
  router.navigate.mockReset();
  if (i18n.language !== DEFAULT_LANGUAGE) await i18n.changeLanguage(DEFAULT_LANGUAGE);
});

// ───────────────────────── fixtures ─────────────────────────

function child(over: Partial<IssueTreeRowItem> = {}): IssueTreeRowItem {
  return {
    id: 'sk-42.1',
    projectId: 'proj-a',
    version: 1,
    title: 'child',
    type: 'task',
    priority: 2,
    status: 'open',
    pinned: false,
    componentIds: [],
    labels: [],
    isBlocked: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    ...over,
  };
}

function visible(id: string, status: TreeBlockerRef['status'] = 'open'): TreeBlockerRef {
  return { id, title: `Title of ${id}`, status: status ?? 'open', projectId: 'proj-a' };
}

function renderBlockers(blockers: TreeBlockerRef[] | undefined, item = child()) {
  return render(
    <MemoryRouter>
      <EpicChildBlockers item={item} isReference={false} blockers={blockers} tabbable />
    </MemoryRouter>,
  );
}

// ───────────────────────── T010 smoke ─────────────────────────

describe('EpicChildBlockers — T010 smoke', () => {
  test('five records, one hidden → three records and «+2»; expanding shows all five; no hidden id', () => {
    const blockers: TreeBlockerRef[] = [
      visible('p-1'),
      { id: 'q-1', redacted: true },
      visible('p-2', 'in_progress'),
      visible('p-3'),
      visible('p-4', 'deferred'),
    ];
    const { container } = renderBlockers(blockers);

    // Collapsed: two visible links among the first three records + «+2».
    expect(screen.getByRole('button', { name: 'p-1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'p-2' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'p-3' })).toBeNull();
    const more = screen.getByRole('button', { name: '+2' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(container.textContent).toContain('unavailable');

    fireEvent.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    const list = screen.getByRole('list', { name: 'All blockers' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);

    expect(container.innerHTML).not.toContain('q-1');
  });

  test('no field, or a closed child with the field → nothing rendered', () => {
    const { container: oldServer } = renderBlockers(undefined);
    expect(oldServer.innerHTML).toBe('');
    cleanup();
    const { container: closed } = renderBlockers(
      [visible('p-1')],
      child({ status: 'closed' }),
    );
    expect(closed.innerHTML).toBe('');
  });
});

// ──────────────── row 32 — the sub-row and "+N" (US-1, SC-001, UD-S) ────────────────

/** The text of the sub-row itself (without the expanded list and the screen reader description). */
function lineText(container: HTMLElement): string {
  return container.querySelector('.epic-child-blockers-line')?.textContent ?? '';
}

function five(): TreeBlockerRef[] {
  return [visible('p-1'), visible('p-2', 'in_progress'), visible('p-3'), visible('p-4'), visible('p-5')];
}

describe('EpicChildBlockers — row 32', () => {
  test('one visible blocker → "blocked: <id> · <status>", no "+N"', () => {
    const { container } = renderBlockers([visible('p-1', 'deferred')]);
    expect(lineText(container)).toBe('blocked: p-1 · deferred');
    expect(container.querySelector('[aria-expanded]')).toBeNull();
  });

  test('five → three entries in the order of the answer and "+2"; a press expands to five, a second press folds', () => {
    const { container } = renderBlockers(five());
    // Separators: " · " inside an entry, ", " between entries.
    expect(lineText(container)).toBe('blocked: p-1 · open, p-2 · in progress, p-3 · open +2');

    const more = screen.getByRole('button', { name: '+2' });
    fireEvent.click(more);
    const list = screen.getByRole('list', { name: 'All blockers' });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'p-1 · Title of p-1 · open',
      'p-2 · Title of p-2 · in progress',
      'p-3 · Title of p-3 · open',
      'p-4 · Title of p-4 · open',
      'p-5 · Title of p-5 · open',
    ]);

    fireEvent.click(more);
    expect(screen.queryByRole('list', { name: 'All blockers' })).toBeNull();
    expect(more.getAttribute('aria-expanded')).toBe('false');
  });

  test('duplicate blocks + waits-for to one task → two entries, both counted in "+N"', () => {
    // The link type is not passed on the wire (contract US-4): a duplicate is two
    // identical entries in a row.
    const { container } = renderBlockers([
      visible('p-1'),
      visible('p-1'),
      visible('p-2'),
      visible('p-3'),
    ]);
    expect(lineText(container)).toBe('blocked: p-1 · open, p-1 · open, p-2 · open +1');
    fireEvent.click(screen.getByRole('button', { name: '+1' }));
    const list = screen.getByRole('list', { name: 'All blockers' });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'p-1 · Title of p-1 · open',
      'p-1 · Title of p-1 · open',
      'p-2 · Title of p-2 · open',
      'p-3 · Title of p-3 · open',
    ]);
  });

  test('UD-S — under ru the status is printed as the chip value without localization', async () => {
    await act(async () => {
      await i18n.changeLanguage('ru');
    });
    const { container } = renderBlockers([visible('p-2', 'in_progress')]);
    expect(lineText(container)).toBe('заблокирована: p-2 · in progress');
  });

  test('the expanded list title is full text, without truncation styles or attributes', () => {
    const longTitle =
      'A very long blocker title that must wrap in full and never be cut off with an ellipsis';
    const blockers = five();
    blockers[3] = { id: 'p-4', title: longTitle, status: 'open', projectId: 'proj-a' };
    const { container } = renderBlockers(blockers);
    fireEvent.click(screen.getByRole('button', { name: '+2' }));

    const entries = container.querySelectorAll('.epic-child-blockers-list > li');
    expect(entries.length).toBe(5);
    for (const entry of entries) {
      const title = entry.querySelector('.epic-child-blockers-title');
      expect(title, 'the entry has no title').not.toBeNull();
      // From the title up to the ROOT of the sub-line inclusive: an inline
      // `white-space: nowrap` is inherited, so one on a container would
      // cut the title just as one on the title itself.
      let reachedRoot = false;
      for (let el: Element | null = title; el; el = el.parentElement) {
        const style = (el as HTMLElement).style;
        expect(style.whiteSpace).toBe('');
        expect(style.textOverflow).toBe('');
        expect(style.getPropertyValue('-webkit-line-clamp')).toBe('');
        if (el.classList.contains('epic-child-blockers')) {
          reachedRoot = true;
          break;
        }
      }
      expect(reachedRoot, 'the walk did not reach the root of the sub-row').toBe(true);
    }
    expect(entries[3].querySelector('.epic-child-blockers-title')?.textContent).toBe(longTitle);
    // Mantine truncation attributes — on no element.
    expect(container.querySelector('[data-truncate], [data-line-clamp]')).toBeNull();
  });

  test('no tooltip: neither a native title nor role="tooltip" on hover', () => {
    const { container } = renderBlockers(five());
    // A native tooltip is the `title` attribute: hovering does not draw it in jsdom,
    // so a check by `role="tooltip"` does not see it (review
    // skein-frontend/2, MINOR-3). Folded and expanded state.
    expect(container.querySelectorAll('[title]')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '+2' }));
    expect(container.querySelector('.epic-child-blockers-list')).not.toBeNull();
    expect(container.querySelectorAll('[title]')).toHaveLength(0);
    for (const el of container.querySelectorAll('*')) {
      fireEvent.mouseEnter(el);
      fireEvent.pointerEnter(el);
      fireEvent.mouseOver(el);
    }
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
  });

  test('a rerender down to ≤3 entries → no "+N"; back up to five → the list is folded', () => {
    const item = child();
    const ui = (blockers: TreeBlockerRef[]) => (
      <MemoryRouter>
        <EpicChildBlockers item={item} isReference={false} blockers={blockers} tabbable />
      </MemoryRouter>
    );
    const { container, rerender } = render(ui(five()));
    fireEvent.click(screen.getByRole('button', { name: '+2' }));
    expect(screen.getByRole('list', { name: 'All blockers' })).toBeTruthy();

    rerender(ui(five().slice(0, 3)));
    expect(container.querySelector('[aria-expanded]')).toBeNull();
    expect(screen.queryByRole('list', { name: 'All blockers' })).toBeNull();

    rerender(ui(five()));
    expect(screen.getByRole('button', { name: '+2' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('list', { name: 'All blockers' })).toBeNull();
  });
});

// ──────────────── row 33 — the sub-row display predicate (table) ────────────────
//
// The child row and the sub-row are rendered side by side, as the modes lay them out: so
// the status highlight `.is-blocked` (the row rule) and the presence of the sub-row
// (the T010 rule) are compared on the very same input. The sub-row is mounted
// UNCONDITIONALLY — its own predicate is checked, not the rig's condition.

type Field = 'absent' | 'empty' | 'one';

function renderPair(
  over: Partial<IssueTreeRowItem>,
  field: Field,
  isReference = false,
) {
  const item = child(over);
  const blockers: TreeBlockerRef[] | undefined =
    field === 'absent' ? undefined : field === 'empty' ? [] : [visible('p-1')];
  return render(
    <MantineProvider>
      <MemoryRouter>
        <EpicChildRow item={item} isReference={isReference} onOpen={() => {}} />
        <EpicChildBlockers
          item={item}
          isReference={isReference}
          blockers={blockers}
          tabbable
        />
      </MemoryRouter>
    </MantineProvider>,
  );
}

function observe(container: HTMLElement) {
  return {
    highlighted: container.querySelector('.is-blocked') !== null,
    subline: container.querySelector('.epic-child-blockers') !== null,
  };
}

describe('EpicChildBlockers — row 33, the display predicate', () => {
  const STATUSES = ['open', 'in_progress', 'deferred', 'closed', 'standing'] as const;
  const FIELDS: Field[] = ['absent', 'empty', 'one'];

  test('the whole table: the sub-row exists ⇔ the row is .is-blocked AND the field is non-empty', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cells: string[] = [];
    for (const status of STATUSES) {
      for (const isBlocked of [true, false]) {
        for (const field of FIELDS) {
          const { container, unmount } = renderPair({ status, isBlocked }, field);
          const { highlighted, subline } = observe(container);
          const expected = highlighted && field === 'one';
          if (subline !== expected) {
            cells.push(`${status} × isBlocked=${isBlocked} × ${field}: subline=${subline}`);
          }
          unmount();
        }
      }
    }
    expect(cells).toEqual([]);
    // "No error" — no input of the table writes to the error console.
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  // Review skein-frontend/2, MINOR-1: the table above iterates only non-empty
  // statuses, and the "status is non-empty" check in the predicate had no witness.
  // An empty status on an ORDINARY (non-reference) row does not count as a stub —
  // exactly this check fires, not `isUnavailableChild`.
  test('an empty status on an ordinary row, isBlocked:true and a non-empty field → no sub-row', () => {
    const { container } = renderPair({ status: '', type: 'task', isBlocked: true }, 'one');
    expect(container.querySelector('[role="group"]')).toBeNull();
    expect(observe(container).subline).toBe(false);
  });

  test.each(['closed', 'standing'] as const)(
    '%s child with isBlocked:true and the field → neither highlight nor sub-row',
    (status) => {
      const { container } = renderPair({ status, isBlocked: true }, 'one');
      expect(observe(container)).toEqual({ highlighted: false, subline: false });
    },
  );

  test('a deferred child with a blocker → both the highlight and the sub-row', () => {
    const { container } = renderPair({ status: 'deferred', isBlocked: true }, 'one');
    expect(observe(container)).toEqual({ highlighted: true, subline: true });
  });

  test('a child without blockers → no sub-row', () => {
    const { container } = renderPair({ status: 'open', isBlocked: false }, 'absent');
    expect(observe(container)).toEqual({ highlighted: false, subline: false });
  });

  test('isBlocked:true without the field (old server) → highlight yes, sub-row no', () => {
    const { container } = renderPair({ status: 'open', isBlocked: true }, 'absent');
    expect(observe(container)).toEqual({ highlighted: true, subline: false });
  });

  test('isBlocked:true and [] → highlight yes, sub-row no', () => {
    const { container } = renderPair({ status: 'in_progress', isBlocked: true }, 'empty');
    expect(observe(container)).toEqual({ highlighted: true, subline: false });
  });

  test('isBlocked:false with the field → no sub-row', () => {
    const { container } = renderPair({ status: 'open', isBlocked: false }, 'one');
    expect(observe(container)).toEqual({ highlighted: false, subline: false });
  });

  test('an "no access" stub with the field → no sub-row', () => {
    const { container } = renderPair(
      { status: '', type: '', title: '<hidden>', isBlocked: true },
      'one',
      true,
    );
    expect(container.querySelector('[role="group"]')).not.toBeNull();
    expect(observe(container).subline).toBe(false);
  });
});

// ──────────── row 34 — an inaccessible entry gives away nothing (INV-6, SC-002) ────────────
//
// The fixture carries an INTERNAL hidden entry with a real id `q-1`: a form without an
// id would not discriminate — printing the id, `data-id` or an id in a DOM attribute
// go red only when the id is present in the input.

const HIDDEN_ID = 'q-1';

function mixed(): TreeBlockerRef[] {
  return [
    visible('p-2'),
    { id: HIDDEN_ID, redacted: true },
    { redacted: true },
    visible('p-3'),
    visible('p-4'),
  ];
}

/** Elements in sequential traversal, in DOM order. */
function tabStops(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('button, [tabindex], a[href], input, select, textarea'),
  ).filter((el) => el.tabIndex >= 0 && !el.hasAttribute('disabled'));
}

describe('EpicChildBlockers — row 34, the inaccessible entry', () => {
  test('hidden: a lock and a word, not a button, no tabindex, in the first three and in "+N" in answer order', () => {
    const { container } = renderBlockers(mixed());
    // Answer order: p-2, hidden, hidden — the first three; p-3 and p-4 go into "+2".
    expect(lineText(container)).toBe('blocked: p-2 · open, unavailable, unavailable +2');

    const chips = container.querySelectorAll('.epic-child-blockers-line .dep-chip--redacted');
    expect(chips).toHaveLength(2);
    for (const chip of chips) {
      expect(chip.textContent).toBe('unavailable');
      // The icon is there, but the word carries the meaning.
      expect(chip.querySelector('svg')).not.toBeNull();
      expect(chip.closest('button')).toBeNull();
      expect(chip.hasAttribute('tabindex')).toBe(false);
      for (const el of chip.querySelectorAll('*')) {
        expect(el.hasAttribute('tabindex')).toBe(false);
      }
    }
    // In focus order only the visible link and "+N".
    expect(tabStops(container).map((el) => el.textContent)).toEqual(['p-2', '+2']);
  });

  test('expanded list: hidden "unavailable" in their places, only the visible ones in the traversal', () => {
    const { container } = renderBlockers(mixed());
    fireEvent.click(screen.getByRole('button', { name: '+2' }));
    const list = screen.getByRole('list', { name: 'All blockers' });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'p-2 · Title of p-2 · open',
      'unavailable',
      'unavailable',
      'p-3 · Title of p-3 · open',
      'p-4 · Title of p-4 · open',
    ]);
    expect(within(list).queryAllByRole('button').map((b) => b.textContent)).toEqual([
      'p-2',
      'p-3',
      'p-4',
    ]);
    // On expanding, the sub-row entries leave the traversal; "+N" and
    // the links of the expanded list remain — not a single hidden one.
    expect(tabStops(container).map((el) => el.textContent)).toEqual(['+2', 'p-2', 'p-3', 'p-4']);
  });

  test('innerHTML folded and expanded, together with the description, does not contain the id of a hidden one', () => {
    const { container } = renderBlockers(mixed());
    const describedBy = epicChildBlockersDescriptionId(child().id);

    const collapsedHtml = container.innerHTML;
    expect(collapsedHtml).not.toContain(HIDDEN_ID);
    expect(document.getElementById(describedBy)?.textContent).toBe(
      'blocked: p-2 · open, unavailable, unavailable, 2 more',
    );

    fireEvent.click(screen.getByRole('button', { name: '+2' }));
    const expandedHtml = container.innerHTML;
    expect(expandedHtml).not.toContain(HIDDEN_ID);
    const description = document.getElementById(describedBy)?.textContent ?? '';
    expect(description).not.toContain(HIDDEN_ID);
    expect(description).toBe(
      'blocked: p-2 · Title of p-2 · open, unavailable, unavailable, p-3 · Title of p-3 · open, p-4 · Title of p-4 · open',
    );
    // Not a single attribute derived from the id: neither `data-*`, nor `id`, nor `aria-*`.
    for (const el of container.querySelectorAll('*')) {
      for (const attr of el.attributes) {
        expect(attr.value, `${el.tagName.toLowerCase()}[${attr.name}]`).not.toContain(HIDDEN_ID);
      }
    }
  });

  test('all entries hidden → the sub-row is made of "unavailable", the description "blocked: unavailable, unavailable"', () => {
    const { container } = renderBlockers([{ id: HIDDEN_ID, redacted: true }, { redacted: true }]);
    expect(lineText(container)).toBe('blocked: unavailable, unavailable');
    expect(document.getElementById(epicChildBlockersDescriptionId(child().id))?.textContent).toBe(
      'blocked: unavailable, unavailable',
    );
    expect(tabStops(container)).toEqual([]);
    expect(container.innerHTML).not.toContain(HIDDEN_ID);
  });

  test('all entries hidden under ru → the Russian "blocked: unavailable, unavailable" line', async () => {
    await act(async () => {
      await i18n.changeLanguage('ru');
    });
    const { container } = renderBlockers([{ id: HIDDEN_ID, redacted: true }, { redacted: true }]);
    expect(lineText(container)).toBe('заблокирована: недоступно, недоступно');
    expect(document.getElementById(epicChildBlockersDescriptionId(child().id))?.textContent).toBe(
      'заблокирована: недоступно, недоступно',
    );
  });
});
