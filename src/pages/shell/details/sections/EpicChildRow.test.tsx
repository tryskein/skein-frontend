/**
 * sk-421.2 T018 — epic section child row (SC-016, R-8, F-1, F-20).
 *
 * Covers:
 *   - the task's own status as a chip, WITHOUT replacing it with the word `blocked`;
 *   - a deferred child with a blocker: the `deferred` status is visible AND a
 *     separate blocked marker (the central SC-016 case);
 *   - closed and standing tasks do not light the marker even with a blocker
 *     (the row asks the general rule instead of rewriting it);
 *   - "no access": focusable, named, NOT announced as a button;
 *   - the placeholder predicate is reference-ness plus empty status and type, NOT
 *     the title: a visible child titled `<hidden>` stays an ordinary
 *     row (R-4, F-6, INV-8);
 *   - opening the card by the project of the row ITSELF, not the one selected in
 *     the shell (F-1).
 *
 * The test holds on to BEHAVIOUR and roles, not class names: the class
 * `is-blocked` is a styling detail, and the SC-016 promise is that a screen
 * reader learns both the status and the blocker.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import type { ReactNode } from 'react';
import { EpicChildRow } from './EpicChildRow';
import { isUnavailableChild } from '../../../../lib/epicChildCategories';
import type { EpicProgress, IssueTreeRowItem } from '../../../../api/issues';

function wrap(node: ReactNode) {
  return render(<MantineProvider>{node}</MantineProvider>);
}

function item(over: Partial<IssueTreeRowItem> = {}): IssueTreeRowItem {
  return {
    id: 'sk-42.1',
    projectId: 'proj-child',
    version: 1,
    title: 'child task',
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
    ...over,
  } as IssueTreeRowItem;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('EpicChildRow — row view (SC-016)', () => {
  test('the chip prints the OWN status instead of being replaced with the word blocked', () => {
    wrap(
      <EpicChildRow
        item={item({ status: 'in_progress', isBlocked: true })}
        isReference={false}
        onOpen={() => {}}
      />,
    );
    // The shared chip can replace the status with the word `blocked` if it is
    // given isBlocked. Here it does not get it: under the "in progress A" tail
    // there must be a row with the "in progress" status.
    expect(screen.getByText(/in progress/i)).toBeTruthy();
    expect(screen.queryByText(/^blocked$/i)).toBeNull();
  });

  test('deferred with a blocker: the deferred status AND the blocked marker are visible', () => {
    const { container } = wrap(
      <EpicChildRow
        item={item({ status: 'deferred', isBlocked: true })}
        isReference={false}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText(/deferred/i)).toBeTruthy();
    // The marker is exposed to a screen reader under a separate name, not by replacing the value.
    //
    // The selection is targeted, not "any element with aria-label": the row has
    // several of them: the open button carries its own name, and the status chip
    // also renders an aria-label (`Attribute.tsx#aria-label={chip.ariaLabel}`).
    // A generic selector would catch the
    // first one it met and would check the wrong element.
    const marked = container.querySelector('.epic-child-status');
    expect(marked, 'the status wrapper must exist').not.toBeNull();
    expect(marked!.getAttribute('aria-label')).toMatch(/deferred/);
    expect(marked!.getAttribute('aria-label')).toMatch(/block/i);
  });

  test('a blocked row lights the marker, and the status stays its OWN (sk-466)', () => {
    // A direct guard of the VISIBLE channel, introduced together with it.
    //
    // The neighbouring test below ("closed and standing do not light the marker")
    // requires the class to be ABSENT and therefore stays green under ANY
    // painting: it is not a guard of the marker itself. This was
    // said aloud when the maintainers decided, and here is the guard that was
    // missing: the class must reach the carrier.
    const { container, unmount } = wrap(
      <EpicChildRow
        item={item({ status: 'in_progress', isBlocked: true })}
        isReference={false}
        onOpen={() => {}}
      />,
    );
    const marked = container.querySelector('.epic-child-status');
    expect(marked, 'the status wrapper must exist').not.toBeNull();
    expect(
      marked!.classList.contains('is-blocked'),
      'the blocked row did not get a carrier of the visible marker',
    ).toBe(true);
    // ...and the marker stands NEXT TO the value, not instead of it (F-20): under the
    // "in progress A" summary tail there must be a row with the "in progress"
    // status, not a row whose status is replaced with the word blocked.
    expect(screen.getByText(/in progress/i)).toBeTruthy();
    expect(screen.queryByText(/^blocked$/i)).toBeNull();
    unmount();

    // Differential: without it "the class is there" would also be true on a row
    // where it is handed out to everyone.
    const clean = wrap(
      <EpicChildRow
        item={item({ status: 'in_progress', isBlocked: false })}
        isReference={false}
        onOpen={() => {}}
      />,
    );
    expect(
      clean.container.querySelector('.epic-child-status')!.classList.contains('is-blocked'),
      'the unblocked row lit the blocked marker',
    ).toBe(false);
  });

  test('closed and standing do not light the marker even with a blocker', () => {
    // The row ASKS the general rule isDerivedBlocked instead of rewriting
    // it: a terminal status beats a stale blocking edge.
    for (const status of ['closed', 'standing'] as const) {
      const { container, unmount } = wrap(
        <EpicChildRow
          item={item({ status, isBlocked: true })}
          isReference={false}
          onOpen={() => {}}
        />,
      );
      expect(container.querySelector('.is-blocked')).toBeNull();
      unmount();
    }
  });

  test('"no access": focusable, named and NOT announced as a button', () => {
    const onOpen = vi.fn();
    const { container } = wrap(
      <EpicChildRow
        item={item({ status: '', type: '', title: '<hidden>' })}
        isReference
        onOpen={onOpen}
      />,
    );
    const row = container.querySelector('[role="group"]')!;
    expect(row).not.toBeNull();
    expect(row.getAttribute('tabindex')).toBe('0');
    expect(row.getAttribute('aria-label')).toBe('no access');
    // Promising an action that does not exist is worse than silence: neither a button nor a link.
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(onOpen).not.toHaveBeenCalled();
  });

  // ─────── sk-421.2.8 line 42 — tree mode (sk-441, UD-T) ───────
  //
  // Paired tests to "no access: focusable..." above: that one stays the
  // default "List" mode, these are the "Tree" mode, where there is a single
  // traversal point: `treeitem` (R-12).

  test('"Tree": the "no access" placeholder has no tabindex, but is named and carries an id', () => {
    const onOpen = vi.fn();
    const { container } = wrap(
      <EpicChildRow
        item={item({ status: '', type: '', title: '<hidden>' })}
        isReference
        onOpen={onOpen}
        treeMode
        id="epic-row-hidden-1"
      />,
    );
    const row = container.querySelector('[role="group"]')!;
    expect(row).not.toBeNull();
    expect(row.hasAttribute('tabindex')).toBe(false);
    expect(row.getAttribute('aria-label')).toBe('no access');
    expect(row.getAttribute('id')).toBe('epic-row-hidden-1');
    expect(container.querySelector('button')).toBeNull();
    expect(onOpen).not.toHaveBeenCalled();
  });

  test('"Tree": the row button is tabindex="-1", the id is on the row root', () => {
    const { container } = wrap(
      <EpicChildRow
        item={item()}
        isReference={false}
        onOpen={() => {}}
        treeMode
        id="epic-row-sk-42.1"
      />,
    );
    const open = container.querySelector('.epic-child-open')!;
    expect(open).not.toBeNull();
    expect(open.getAttribute('tabindex')).toBe('-1');
    const root = container.querySelector('.epic-children-row')!;
    expect(root.getAttribute('id')).toBe('epic-row-sk-42.1');
    // The root is the row itself, not a wrapper outside it: the row's flex layout
    // relies on `.epic-children-row`.
    // (MantineProvider also puts a `<style>` into the container, so
    // the root's parent is compared, not the container's first child.)
    expect(root.parentElement).toBe(container);
  });

  test('"List" by default: the row button is in the tab order (no tabindex), the id is on the row root', () => {
    const { container } = wrap(
      <EpicChildRow
        item={item()}
        isReference={false}
        onOpen={() => {}}
        id="epic-row-sk-42.1"
      />,
    );
    const open = container.querySelector('.epic-child-open')!;
    expect(open.hasAttribute('tabindex')).toBe(false);
    expect((open as HTMLButtonElement).tabIndex).toBe(0);
    expect(container.querySelector('.epic-children-row')!.getAttribute('id')).toBe(
      'epic-row-sk-42.1',
    );
  });

  test('a visible child titled "<hidden>" stays an ordinary row', () => {
    // The placeholder predicate is membership in the unavailable set
    // (reference-ness + empty status and type), NOT the title (R-4, F-6).
    const { container } = wrap(
      <EpicChildRow
        item={item({ title: '<hidden>', status: 'open', type: 'task' })}
        isReference={false}
        onOpen={() => {}}
      />,
    );
    expect(container.querySelector('[role="group"]')).toBeNull();
    expect(container.querySelector('button')).not.toBeNull();
  });

  test('opens the card by the project of the row ITSELF, not the one selected in the shell', () => {
    const onOpen = vi.fn();
    const { container } = wrap(
      <EpicChildRow
        item={item({ id: 'other-7', projectId: 'proj-other' })}
        isReference={false}
        onOpen={onOpen}
      />,
    );
    (container.querySelector('button') as HTMLButtonElement).click();
    expect(onOpen).toHaveBeenCalledWith('other-7', 'proj-other');
  });

  test('showType — the type is printed by default and switched off by the prop', () => {
    // A differential pair: one half MUST be non-empty, so the
    // assertion cannot pass vacuously, unlike a lone
    // check "there is no type chip", which is green also when there never is one.
    // The text is taken from the ROW, not the container: MantineProvider
    // injects its own <style> into the container, and `container.textContent`
    // carries the stylesheet mixed with the markup.
    const rowText = (c: HTMLElement) =>
      c.querySelector('.epic-children-row')?.textContent ?? '';

    const { container, unmount } = wrap(
      <EpicChildRow item={item({ type: 'bug' })} isReference={false} onOpen={() => {}} />,
    );
    expect(rowText(container)).toMatch(/bug/);
    unmount();

    const off = wrap(
      <EpicChildRow
        item={item({ type: 'bug' })}
        isReference={false}
        onOpen={() => {}}
        showType={false}
      />,
    );
    expect(rowText(off.container)).not.toMatch(/bug/);
    // ...and the title and status are in place: it is the type that is switched off, not the row.
    expect(rowText(off.container)).toMatch(/child task/);
    expect(rowText(off.container)).toMatch(/open/);
  });

  test('a nested epic prints its own progress X/Y', () => {
    wrap(
      <EpicChildRow
        item={item({ type: 'epic', epicProgress: { closed: 3, total: 8 } })}
        isReference={false}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText(/3\/8/)).toBeTruthy();
  });
});

// ───────── sk-421.3 T14 — branch progress indicator (US-5, SC-008) ─────────
//
// The numbers on a nested epic row were printed before this task too; what is new is
// ONE segment, the share of closed out of the node summary's total, in BOTH modes
// (deviation 14: the design draws it only in "Tree").
//
// Finding F-06 of the test plan defines the shape of the checks: comparing the numbers
// alone is not enough: "a bar that is always filled to 100 % with a correct label
// would pass". So below the SEGMENT'S SIZE and its
// UNIQUENESS are checked, not only that it is drawn.

describe('sk-421.3 T14 — branch progress indicator', () => {
  const bars = (c: HTMLElement) => Array.from(c.querySelectorAll('.epic-child-branch'));
  const fills = (c: HTMLElement) =>
    Array.from(c.querySelectorAll<HTMLElement>('.epic-child-branch-fill'));

  /**
   * The fill width as a NUMBER of percent.
   *
   * sk-421.3 T14a — the share is exact (PL-6a), and comparing it with a string
   * is not allowed: `77.77777777777779%` is the right answer, which any entry
   * like `'78%'` would declare wrong, and any entry like `'78%'`
   * that turned out right would mean rounding came back.
   */
  const widthOf = (el: HTMLElement): number => {
    const raw = el.style.width;
    expect(raw, 'the fill has no width').toMatch(/%$/);
    return Number.parseFloat(raw);
  };

  /** A nested epic row with a node summary. */
  const nested = (closed: number, total: number, over: Partial<IssueTreeRowItem> = {}) =>
    item({ type: 'epic', epicProgress: { closed, total }, ...over } as Partial<IssueTreeRowItem>);

  test('P-41 — the indicator is shown, the numbers equal the node summary numbers', () => {
    const { container } = wrap(
      <EpicChildRow item={nested(3, 8)} isReference={false} onOpen={() => {}} />,
    );
    expect(bars(container)).toHaveLength(1);
    expect(screen.getByText(/3\/8/)).toBeTruthy();
  });

  test('P-41 (deviation 14) — the indicator in BOTH modes', () => {
    // The design draws the segment only in "Tree"; we have it in both modes,
    // and this is a recorded deviation, not a coincidence. The row mode
    // is set by `treeMode`, so both values are checked.
    for (const treeMode of [false, true]) {
      const view = wrap(
        <EpicChildRow
          item={nested(1, 2)}
          isReference={false}
          onOpen={() => {}}
          treeMode={treeMode}
        />,
      );
      expect(bars(view.container), `mode treeMode=${treeMode} is left without a segment`).toHaveLength(
        1,
      );
      view.unmount();
    }
  });

  /**
   * P-42 — REWRITTEN to the maintainers' decision of 2026-09-18 (sk-481): the branch
   * indicator stands at ANY parent that has a summary
   * (`item.epicProgress`); the row type does not matter.
   *
   * The earlier form ("a non-epic parent has no indicator") fed a
   * fixture WITHOUT a summary and was therefore green under any behaviour: the corruption
   * "indicator only for `type === 'epic'`" passed the whole suite. The guard
   * is cut into two halves, and each has its own corruption on which it
   * goes red:
   *   - "with a summary" — on "epics only" (no non-epic would get
   *     a segment);
   *   - "without a summary" — on "indicator without a summary" (a segment or label
   *     drawn empty), including on an epic: the type neither gives the right to an
   *     indicator nor takes it away.
   */
  const PARENT_TYPES = ['task', 'feature', 'bug', 'epic'] as const;

  test.each(PARENT_TYPES)(
    'P-42 — a parent of type %s WITH a summary: the indicator is there, numbers and share come from the summary',
    (type) => {
      const { container } = wrap(
        <EpicChildRow
          item={item({ type, epicProgress: { closed: 1, total: 4 } } as Partial<IssueTreeRowItem>)}
          isReference={false}
          onOpen={() => {}}
        />,
      );
      expect(bars(container), `the parent of type ${type} has no segment`).toHaveLength(1);
      expect(widthOf(fills(container)[0])).toBe(25);
      expect(container.querySelector('.epic-child-progress')?.textContent).toMatch(/1\/4/);
    },
  );

  test.each(PARENT_TYPES)(
    'P-42 — a parent of type %s WITHOUT a summary: no indicator and no empty space is left',
    (type) => {
      const { container } = wrap(
        <EpicChildRow item={item({ type })} isReference={false} onOpen={() => {}} />,
      );
      // Precisely the ABSENCE of the element, not an element of zero width: empty
      // space in its place is exactly what the acceptance forbids.
      expect(bars(container)).toHaveLength(0);
      expect(fills(container)).toHaveLength(0);
      expect(container.querySelector('.epic-child-progress')).toBeNull();
      // The title column carries one title: there is no empty carrier under it
      // under any class name.
      const col = container.querySelector('.epic-child-titlecol');
      expect(col, 'no title column: the probe sees nothing').not.toBeNull();
      expect(col!.children).toHaveLength(1);
    },
  );

  test('P-43 — the numbers are the progress of DIRECT children: "1/1" with an open grandchild', () => {
    // The node summary speaks about direct children. An open grandchild is not in it,
    // and nothing on the screen claims the branch is complete: the segment
    // is filled fully, but it has no "done" label: the text prints
    // exactly the two numbers that came.
    const { container } = wrap(
      <EpicChildRow item={nested(1, 1)} isReference={false} onOpen={() => {}} />,
    );
    expect(screen.getByText(/1\/1/)).toBeTruthy();
    expect(fills(container)[0].style.width).toBe('100%');
    expect(container.textContent).not.toMatch(/done|complete|готов|заверш/i);
  });

  test('P-44 — the numbers may differ from the number of shown rows', () => {
    // Unavailable ones ARE IN `total` and absent from `closed`; visible
    // standing ones are taken out of the total. The label must stay correct under
    // such a mismatch: it speaks about the node's direct children, not about how
    // many rows are visible under it.
    const { container } = wrap(
      <EpicChildRow
        item={nested(1, 4, { epicProgress: { closed: 1, total: 4, unavailable: 2 } } as Partial<IssueTreeRowItem>)}
        isReference={false}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText(/1\/4/)).toBeTruthy();
    // Unavailable ones are neither subtracted nor added: the share is computed from the
    // total as is.
    expect(fills(container)[0].style.width).toBe('25%');
  });

  test('P-45 — zero total: no segment, BOTH numbers stay', () => {
    const { container } = wrap(
      <EpicChildRow item={nested(0, 0)} isReference={false} onOpen={() => {}} />,
    );
    expect(bars(container)).toHaveLength(0);
    // ...and the numbers are in place, in the former form.
    expect(screen.getByText(/0\/0/)).toBeTruthy();
  });

  test('P-46 — the frontend computes nothing: the numbers come only from epicProgress', () => {
    // The node summary is deliberately "implausible" against any rows:
    // more closed than could be derived from anything on the screen.
    // The row must print exactly what came.
    const { container } = wrap(
      <EpicChildRow item={nested(7, 9)} isReference={false} onOpen={() => {}} />,
    );
    expect(screen.getByText(/7\/9/)).toBeTruthy();
    // sk-421.3 T14a — the share is EXACT, not rounded to whole percent
    // (PL-6a), so the width is read as a number. Before, here stood
    // `'78%'` — the very entry that let rounding reach
    // the screen as a value.
    expect(widthOf(fills(container)[0])).toBeCloseTo((7 / 9) * 100, 6);
  });

  test('F-06 — the segment size is PROPORTIONAL, and it is the ONLY one', () => {
    // Half of finding F-06: a bar always filled to 100 % with a correct
    // label would pass a check of the numbers alone. So the size
    // is compared on an input where 100 % is a deliberately wrong answer.
    const { container } = wrap(
      <EpicChildRow item={nested(1, 4)} isReference={false} onOpen={() => {}} />,
    );
    const fill = fills(container);
    expect(fill).toHaveLength(1);
    expect(fill[0].style.width).toBe('25%');
    expect(fill[0].style.width, 'the segment is fully filled at a share of 1/4').not.toBe('100%');

    // The second half: the segment is ONE. The spec requires one segment:
    // there is no "in progress" counter in the node summary, and a second segment has nothing to be
    // filled with except invention.
    expect(bars(container)).toHaveLength(1);
  });

  test('T14a — 199 of 200: the segment is NOT fully filled (US-5, edges do not lie)', () => {
    // An earlier defect visible to the user: `Math.round(199/200*100)` =
    // 100, and the bar was filled COMPLETELY for an epic with a live unclosed
    // child; the styling claimed completeness of a branch that
    // the acceptance "meaning of the numbers" forbids in so many words.
    //
    // The corruption proves two things, and the first is that the input DISCRIMINATES: naive
    // rounding really lies on it. Without this half the check
    // would pass also on an input where rounding does not err.
    expect(Math.round((199 / 200) * 100), 'the input does not discriminate').toBe(100);

    const { container } = wrap(
      <EpicChildRow item={nested(199, 200)} isReference={false} onOpen={() => {}} />,
    );
    expect(screen.getByText(/199\/200/)).toBeTruthy();
    const width = widthOf(fills(container)[0]);
    expect(width, 'the bar is fully filled for a branch with an unclosed child').toBeLessThan(100);
    expect(width).toBeCloseTo(99.5, 6);
  });

  test('T14a — 1 of 1000: the segment is visible, not empty (US-5, edges do not lie)', () => {
    // The other side of the same defect: `Math.round(1/1000*100)` = 0, and
    // done work was shown as an empty bar.
    expect(Math.round((1 / 1000) * 100), 'the input does not discriminate').toBe(0);

    const { container } = wrap(
      <EpicChildRow item={nested(1, 1000)} isReference={false} onOpen={() => {}} />,
    );
    expect(widthOf(fills(container)[0]), 'done work is shown as an empty bar').toBeGreaterThan(
      0,
    );
  });

  test('T14a — full fill ONLY when all are closed (negative control)', () => {
    // Without this half "do not fill completely" could be satisfied
    // by NEVER filling, and the rule would become a lie from the other side.
    const { container } = wrap(
      <EpicChildRow item={nested(4, 4)} isReference={false} onOpen={() => {}} />,
    );
    expect(widthOf(fills(container)[0]), 'all are closed, yet the segment is not full').toBe(100);
  });

  test('the segment adds neither a tab stop nor a voice for the screen reader', () => {
    // SC-010: no tab stops were added inside the row. And the accessible name
    // of a "Tree" row is pinned by the reference in EpicChildrenTree.test.tsx:
    // text inside the segment would break it.
    const { container } = wrap(
      <EpicChildRow item={nested(3, 8)} isReference={false} onOpen={() => {}} />,
    );
    const bar = bars(container)[0];
    expect(bar.getAttribute('aria-hidden')).toBe('true');
    expect(bar.textContent).toBe('');
    expect(bar.querySelector('[tabindex]')).toBeNull();
  });
});

describe('isUnavailableChild — placeholder predicate', () => {
  test('reference-ness together with empty status and type', () => {
    expect(isUnavailableChild(item({ status: '', type: '' }), true)).toBe(true);
  });

  test('reference-ness alone is not enough: it is also a repeated occurrence of the node', () => {
    expect(isUnavailableChild(item({ status: 'open', type: 'task' }), true)).toBe(
      false,
    );
  });

  test('empty values without reference-ness do not count as enough', () => {
    expect(isUnavailableChild(item({ status: '', type: '' }), false)).toBe(false);
  });

  test('the title is not part of the predicate', () => {
    expect(
      isUnavailableChild(item({ title: '<hidden>', status: 'open', type: 'task' }), false),
    ).toBe(false);
  });
});

// ───────── sk-421.3 T09 — visual language of the row (US-3, P-23...P-26) ─────────
//
// Checked by rendering: the state's class reaches the element. What the
// class paints is seen in a browser.

function rowTitle(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('.epic-child-title');
  expect(el, 'the row has no title').not.toBeNull();
  return el!;
}

describe('EpicChildRow — visual language of the row (US-3)', () => {
  test('P-23 — five statuses and unavailable: each row gets the styling of its own state', () => {
    const expected: Array<
      [string, { struck: boolean; dimmed: boolean; faded: boolean }]
    > = [
      ['open', { struck: false, dimmed: false, faded: false }],
      ['in_progress', { struck: false, dimmed: false, faded: false }],
      ['deferred', { struck: false, dimmed: true, faded: false }],
      // sk-460.11 — a closed one carries BOTH channels: shape and tone.
      ['closed', { struck: true, dimmed: false, faded: true }],
      ['standing', { struck: false, dimmed: false, faded: false }],
    ];

    for (const [status, want] of expected) {
      const { container, unmount } = wrap(
        <EpicChildRow
          item={item({ status } as Partial<IssueTreeRowItem>)}
          isReference={false}
          onOpen={() => {}}
        />,
      );
      const title = rowTitle(container);
      expect(title.classList.contains('epic-child-struck'), `${status}: strikethrough`).toBe(
        want.struck,
      );
      expect(title.classList.contains('epic-child-dimmed'), `${status}: dimming`).toBe(
        want.dimmed,
      );
      expect(
        title.classList.contains('epic-child-faded'),
        `${status}: dimming of a closed one (sk-460.11)`,
      ).toBe(want.faded);
      unmount();
    }

    // An unavailable one is not this path at all: it has its own class and no title.
    const { container } = wrap(
      <EpicChildRow
        item={item({ status: '', type: '', title: '<hidden>' })}
        isReference
        onOpen={() => {}}
      />,
    );
    expect(container.querySelector('.epic-child-no-access')).not.toBeNull();
    expect(container.querySelector('.epic-child-title')).toBeNull();
  });

  test('P-26 — the row of an unavailable task gets no styling of any status (INV-10, SC-014)', () => {
    const { container } = wrap(
      <EpicChildRow
        item={item({ status: '', type: '', title: '<hidden>' })}
        isReference
        onOpen={() => {}}
      />,
    );
    expect(container.querySelector('.epic-child-struck')).toBeNull();
    expect(container.querySelector('.epic-child-dimmed')).toBeNull();
    // Neither a status chip nor its wrapper: it has no status.
    expect(container.querySelector('.epic-child-status')).toBeNull();
    // The placeholder's own styling is in place, though.
    expect(container.querySelector('.epic-child-no-access')).not.toBeNull();
  });

});

// ── sk-514 (7) — the status carrier shape is ONE for both modes (cancels sk-460.10) ──
//
// The design splits the shapes across boards: "List" prints the status as a pill
//, "Tree" as a plain coloured
// word without a pill.
//
// All assertions below are DIFFERENTIAL: each compares the two shapes
// with each other instead of checking one alone. The reason is the same as everywhere in this
// file: "there is no pill" is green also on a row that has nothing at all, and such a
// check would not tell reconciling with the design from tearing the carrier down.
describe('sk-514 (7) — the status is printed as a pill in both modes (cancels sk-460.10)', () => {
  /** The status carrier and its inline styling in the given mode. */
  function carrierOf(status: string, treeMode: boolean) {
    const { container } = wrap(
      <EpicChildRow
        // Double cast: `IssueStatus` is closed, but the wire may carry anything.
        item={item({ status } as unknown as Partial<IssueTreeRowItem>)}
        isReference={false}
        onOpen={() => {}}
        treeMode={treeMode}
      />,
    );
    const area = container.querySelector<HTMLElement>('.epic-child-status');
    expect(area, `${status}: no status wrapper`).not.toBeNull();
    const styled = area!.querySelector<HTMLElement>('[style]');
    return {
      area: area!,
      word: area!.querySelector<HTMLElement>('.epic-child-statusword'),
      background: styled?.style.background ?? null,
      radius: styled?.style.borderRadius ?? null,
      text: area!.textContent ?? '',
    };
  }

  test('P-1 [sk-514 (7)] — a pill in BOTH modes, and it is one shape, not two similar ones', () => {
    const tree = carrierOf('open', true);
    const list = carrierOf('open', false);

    // The former rule was the opposite: "List" printed a pill, "Tree" a
    // coloured word without it (design sk-460.10). The maintainers cancelled the
    // distinction, and the test is rewritten for the new rule rather than weakened:
    // it asserts the presence of a pill WHERE there was none before.
    for (const [mode, carrier] of [['List', list], ['Tree', tree]] as const) {
      expect(carrier.background, `${mode}: the status has no pill plate`).not.toBe('');
      expect(carrier.radius, `${mode}: the status has no pill rounding`).toContain(
        '--radius-pill',
      );
    }

    // The word carrier of a KNOWN value disappears altogether: two shapes
    // of one entity were the subject of the complaint. The word stays only for
    // a foreign value.
    expect(tree.word, 'a known value in "Tree" still has a word carrier').toBeNull();

    // The text is the same: the shape changed, not the value.
    expect(tree.text.trim()).toBe('open');
    expect(list.text.trim()).toBe('open');
  });

  test('P-4 — the standing task markers are present in "Tree" too', () => {
    // [sk-514 (7)] The test name used to be "the pill goes away, the markers stay" —
    // it described the former rule, under which "Tree" had no
    // pill. The pill no longer goes away; the requirement did not change and
    // stays: "∞" and the labels are channels ON TOP of colour, and under
    // forced-colors they are the only thing that survives. Their presence is checked, not
    // anyone's absence.
    const tree = carrierOf('standing', true);
    expect(tree.text, 'in "Tree" the standing task lost its ∞ sign').toContain('∞');
    expect(tree.area.getAttribute('aria-label'), 'the standing task lost its name').toMatch(/Standing/i);
    expect(tree.area.getAttribute('title'), 'the standing task lost its label').toMatch(/Standing/i);

    // Differential: an ordinary status has no such labels, otherwise the check
    // would be green on a row where the label stands on everyone.
    const open = carrierOf('open', true);
    expect(open.area.getAttribute('aria-label')).toBeNull();
    expect(open.text).not.toContain('∞');
  });

});

// ───────── sk-460.11 — a closed row is dimmed TOO ─────────
//
// The contrast of the two mutings and their order were measured at
// sk-460.11 and are seen in a browser. Here — that the class reaches the
// title.
describe('sk-460.11 — a closed one carries both shape and tone', () => {
  const classesOf = (status: string) => {
    const { container, unmount } = wrap(
      <EpicChildRow
        item={item({ status } as Partial<IssueTreeRowItem>)}
        isReference={false}
        onOpen={() => {}}
      />,
    );
    const cls = rowTitle(container).className;
    unmount();
    return cls;
  };

  test('P-1 — a closed one has BOTH channels, a deferred one only dimming', () => {
    const closed = classesOf('closed');
    expect(closed, 'the closed one lost its strikethrough').toContain('epic-child-struck');
    expect(closed, 'the closed one is not dimmed').toContain('epic-child-faded');

    // Differential: without it "a closed one has both" would be true also on a row
    // where both classes are handed out to everyone.
    const deferred = classesOf('deferred');
    expect(deferred).toContain('epic-child-dimmed');
    expect(deferred, 'the deferred one got the dimming of a closed one').not.toContain(
      'epic-child-faded',
    );
    expect(deferred).not.toContain('epic-child-struck');

    // ...and an open one gets none of the three.
    const open = classesOf('open');
    for (const cls of ['epic-child-struck', 'epic-child-faded', 'epic-child-dimmed']) {
      expect(open, `the open one got ${cls}`).not.toContain(cls);
    }
  });
});

/**
 * sk-489 T016 (US-6, INV-5, SC-008, SC-010; test plan line 62) — the branch
 * of an epic section row: the label and the segment size.
 *
 * The third of three places of the label. Here, unlike the chip and the cell, the
 * number has two carriers, the text and the segment width, and they can diverge
 * from each other: a label from one denominator next to a segment from the total are two
 * contradicting statements about one row. So in each case
 * both are checked.
 */
describe('sk-489 T016 — branch: "done out of counted"', () => {
  const branch = (epicProgress: EpicProgress) => {
    const view = wrap(
      <EpicChildRow
        item={item({ type: 'epic', epicProgress } as Partial<IssueTreeRowItem>)}
        isReference={false}
        onOpen={() => {}}
      />,
    );
    const fill = view.container.querySelector<HTMLElement>('.epic-child-branch-fill');
    return {
      text: view.container.querySelector('.epic-child-progress')?.textContent ?? null,
      /** The fill width as a number of percent; `null` means there is no segment at all. */
      width: fill ? Number.parseFloat(fill.style.width) : null,
      bars: view.container.querySelectorAll('.epic-child-branch').length,
    };
  };

  test('3 done + 1 won\'t do -> "3/3 children done", the segment is full', () => {
    // The "closed / total" pair would give "4/4 children closed", the same 100 %
    // of width but a different statement in words.
    const { text, width } = branch({ closed: 4, total: 4, done: 3, counted: 3, noWork: 1 });
    expect(text).toBe('3/3 children done, excluded: 1');
    expect(width).toBe(100);
  });

  test('the label and the width take ONE denominator', () => {
    // 1 done + 1 in progress + 2 won't do: the denominator is 2. Direct division
    // `closed/total` would give 3/4, both the label "3/4" and a width of 75 %.
    const { text, width } = branch({ closed: 3, total: 4, done: 1, counted: 2, noWork: 2 });
    expect(text).toBe('1/2 children done, excluded: 2');
    expect(width).toBeCloseTo(50, 6);
    expect(width, 'the segment is computed from the total and the label from the denominator').not.toBeCloseTo(
      75,
      6,
    );
  });

  // sk-540.3 — replaces the sk-489 pin "there is NO tail "no work: N" on the branch,
  // it is only on the ring": the branch now carries the excluded count
  // (short tail, acceptance of sk-540.3 / sk-540.5), and hides it at zero.
  test('sk-540.3 — nothing excluded (noWork: 0) → no tail, the fill unchanged', () => {
    const { text, width } = branch({ closed: 1, total: 2, done: 1, counted: 2, noWork: 0 });
    expect(text).toBe('1/2 children done');
    expect(width).toBeCloseTo(50, 6);
  });

  test('all counted ones dropped out but children exist -> "excluded from scope: N" and no segment', () => {
    const { text, bars } = branch({ closed: 2, total: 2, done: 0, counted: 0, noWork: 2 });
    expect(text).toBe('excluded from scope: 2');
    // There is nothing to divide by, so there is nothing to draw an empty bar next to the word for.
    expect(bars).toBe(0);
  });

  test('a row without children — a pair of numbers, as today', () => {
    // Negative control: "no work" is not printed on every zero.
    const { text, bars } = branch({ closed: 0, total: 0, done: 0, counted: 0, noWork: 0 });
    expect(text).toBe('0/0 children done');
    expect(bars).toBe(0);
  });

  test('US-10, SC-010 — a response without the new fields: the former pair and the former width', () => {
    const { text, width } = branch({ closed: 1, total: 4 });
    expect(text).toBe('1/4 children closed');
    expect(width).toBeCloseTo(25, 6);
  });
});

// ───────── sk-489 T017 — the outcome mark of a dropped child (US-7, INV-2, line 63) ─────────
//
// EXACTLY what US-7 promises is checked: a dropped child is distinguishable from a
// done one NOT ONLY BY COLOUR. So every assertion here is about
// TEXT, not about a class or a tone: an implementation that painted the row
// and stopped there must go red. The word is read from
// the DOCUMENT ITSELF (the row's `textContent`), not from a node by class:
// a guard asking for `.epic-child-outcome` would be green also for a mark
// hidden from the screen reader with `aria-hidden` and for a mark carried off
// beyond the row.
//
// Both modes run through ONE table (`test.each`). There is one row for
// "List" and "Tree" (R-8), and the table is the assertion "one", not a
// doubling for completeness: a `treeMode` branch that showed the mark in
// only one mode will not stay green.

describe('EpicChildRow — outcome mark (US-7, sk-489 T017)', () => {
  const MODES: Array<[string, boolean]> = [
    ['List', false],
    ['Tree', true],
  ];

  /** A row of the given status with the given outcome; `undefined` means the field did not come. */
  function rowOf(status: string, closeOutcome: string | undefined, treeMode: boolean) {
    const view = wrap(
      <EpicChildRow
        item={
          item({
            status,
            ...(closeOutcome === undefined ? {} : { closeOutcome }),
          } as Partial<IssueTreeRowItem>)
        }
        isReference={false}
        onOpen={() => {}}
        treeMode={treeMode}
      />,
    );
    const root = view.container.querySelector<HTMLElement>('.epic-children-row')!;
    return { ...view, root };
  }

  /** A closed row with the given outcome; `undefined` means the field did not come. */
  function closedRow(closeOutcome: string | undefined, treeMode: boolean) {
    return rowOf('closed', closeOutcome, treeMode);
  }

  test.each(MODES)(
    '%s — "won\'t do" is named by a WORD in the row text',
    (_mode, treeMode) => {
      const { root } = closedRow('wont_do', treeMode);
      expect(root.textContent).toContain("won't do");
    },
  );

  test.each(MODES)(
    '%s — the mark takes part in the accessible name: not hidden from the screen reader',
    (_mode, treeMode) => {
      // The second half of US-7 ("an accessible name naming the outcome") rests
      // on the word lying in the row content in the OPEN: the name
      // of a `treeitem` is assembled by walking the content, and `aria-hidden` on
      // the mark is exactly the way to show it to the eye and hide it from the
      // screen reader, which already hides the branch segment next to it. The whole
      // chain of ancestors up to the row root is checked, not one element: a
      // descendant of a hidden one counts as hidden too.
      const { root } = closedRow('wont_do', treeMode);
      const mark = Array.from(root.querySelectorAll<HTMLElement>('*')).find(
        (el) => el.textContent?.trim() === "won't do",
      );
      expect(mark, 'the outcome word is not printed as a separate element').toBeTruthy();
      for (let el: HTMLElement | null = mark!; el; el = el.parentElement) {
        expect(
          el.getAttribute('aria-hidden'),
          `the mark is hidden from the screen reader on "${el.className}"`,
        ).not.toBe('true');
        if (el === root) break;
      }
    },
  );

  test.each(MODES)('%s — "done" gives no extra text', (_mode, treeMode) => {
    // The word "closed" next to it already reads as done (US-7), and the label
    // would repeat the status. The negative control also catches an
    // implementation "always print the outcome".
    const { root } = closedRow('done', treeMode);
    expect(root.textContent).not.toContain('done');
  });

  test.each(MODES)('%s — the field did not come (US-10): no mark', (_mode, treeMode) => {
    // An api that does not know about the outcome does not send the field. Absence is not
    // replaced by a default in either direction: neither "done"
    // nor "no work".
    const { root } = closedRow(undefined, treeMode);
    expect(root.textContent).not.toContain("won't do");
    expect(root.textContent).not.toContain('excluded');
  });

  test.each(MODES)(
    '%s — an unfamiliar value is printed AS IS, without a foreign word',
    (_mode, treeMode) => {
      // INV-2 — the client is older than the server. The row is printed as it came and
      // counts neither as done nor as dropped: neither the label "no work"
      // nor any of the three labels of the known outcomes.
      const { root } = closedRow('flattened_into_epic', treeMode);
      expect(root.textContent).toContain('flattened_into_epic');
      expect(root.textContent).not.toContain('excluded');
      expect(root.textContent).not.toContain("won't do");
      expect(root.textContent).not.toContain('duplicate');
      expect(root.textContent).not.toContain('superseded');
    },
  );

  test.each(MODES)('%s — "duplicate" and "superseded" are named too', (_mode, treeMode) => {
    // There are three dropped outcomes, not one: an implementation that compared the value with
    // the literal `wont_do` is green on the first test and goes red here.
    expect(closedRow('duplicate', treeMode).root.textContent).toContain('duplicate');
    cleanup();
    expect(closedRow('superseded', treeMode).root.textContent).toContain('superseded');
  });

  test.each(MODES)(
    '%s — the outcome of a NOT closed row is shown: the row does not compute for the server',
    (_mode, treeMode) => {
      // The decision in `EpicChildRow.tsx#outcomeMark` is that a STATUS condition is
      // deliberately absent here, and it is a decision about OBSERVABILITY, not style.
      // An outcome exists if and only if the task is closed (INV-1), and the
      // server holds the invariant. If the row asked the status itself too, a
      // response in which the api VIOLATED the invariant it would hide silently:
      // the screen would show an ordinary open row, and the contract
      // mismatch would become invisible exactly where it must be noticed.
      // So the row prints WHAT CAME.
      //
      // A mutant adding the conjunct `status === 'closed'` to `outcomeMark`
      // goes red here and only here; on a clean tree the test is green,
      // because the status display rule is not involved.
      const { root } = rowOf('open', 'wont_do', treeMode);
      expect(root.textContent).toContain("won't do");
    },
  );

  test.each(MODES)(
    '%s — an empty string is not an outcome: there is no empty mark node',
    (_mode, treeMode) => {
      // The twin of this guard at the event-feed line formatter is checked by its own
      // test (`formatEventLine.test.ts#an empty string is not counted as an outcome`),
      // and the section row must have it just as explicit. The server does not send an
      // empty string, but the conjunct `item.closeOutcome !== ''`, which
      // nobody checks, will be removed by the next edit as superfluous.
      //
      // The assertion is about the DOCUMENT, not the text: with the conjunct removed, a
      // `<span class="epic-child-outcome">` WITHOUT text lands in the row, and
      // a check of `textContent` alone would stay green. The display rule
      // promised the opposite, that the mark appears exactly when there is something to
      // say, so the node itself is asked.
      const { root } = closedRow('', treeMode);
      expect(root.querySelector('.epic-child-outcome')).toBeNull();
    },
  );
});
