import { afterEach, describe, expect, test } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { TaskCard } from '../TaskCard';
import {
  LIST_DEFAULT_CARD_FIELDS,
  listCardFieldsMask,
  type ListCardField,
} from '../../../lib/listCardFields';

/** The card as a user who never opened the picker sees it. */
const DEFAULT_FIELDS = listCardFieldsMask(LIST_DEFAULT_CARD_FIELDS);
import { EMPTY_REMINDERS_LIST } from '../../../api/reminders';
import { remindersListKey } from '../../../lib/useReminders';
import type { IssueSummary } from '../../../api/issues';

function issue(over: Partial<IssueSummary> = {}): IssueSummary {
  return {
    id: 'sk-1',
    projectId: 'p',
    version: 1,
    title: 'hello world',
    type: 'task',
    priority: 3,
    status: 'open',
    pinned: false,
    componentIds: [],
    labels: [],
    isBlocked: false,
    updatedAt: '2026-05-01T10:00:00Z',
    createdAt: '2026-05-01T10:00:00Z',
    ...over,
  };
}

function renderCard(
  item: IssueSummary,
  isRinging = false,
  fields: number = DEFAULT_FIELDS,
) {
  // sk-194.5.2.8.5 — TaskCard itself no longer reads any query (the
  // ringing-reminder set is lifted to the list owner and arrives as the
  // `isRinging` boolean). The provider is kept because the card sits inside
  // the shell subtree in production and other descendants may need a client.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MantineProvider forceColorScheme="dark">
        <MemoryRouter>
          <TaskCard
            item={item}
            selected={false}
            searchQuery=""
            componentNames={new Map()}
            isRinging={isRinging}
            fields={fields}
            onSelect={() => {}}
          />
        </MemoryRouter>
      </MantineProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => cleanup());

describe('TaskCard — sk-53 relevance badge', () => {
  test('renders the relevance badge when score is present (search row)', () => {
    const { container } = renderCard(issue({ score: 0.03 }));
    const badge = container.querySelector('.task-card-relevance');
    expect(badge).not.toBeNull();
    expect(badge?.textContent ?? '').toMatch(/%/);
  });

  test('no badge when score is absent (plain list row)', () => {
    const { container } = renderCard(issue({ score: undefined }));
    expect(container.querySelector('.task-card-relevance')).toBeNull();
  });

  test('weak score does NOT render 100% (alpha-24 anti-regression)', () => {
    const { container } = renderCard(issue({ score: 0.015 }));
    const pct = container.querySelector('.task-card-relevance-pct')?.textContent ?? '';
    expect(pct).not.toBe('100%');
  });
});

/**
 * sk-62.2 behaviour, re-expressed on the sk-194.5.2.8.5 prop contract: the
 * ringing affordances are driven ENTIRELY by the `isRinging` boolean now, so
 * the highlight must appear/disappear with the prop and nothing else.
 */
describe('TaskCard — sk-62.2 ringing highlight via the isRinging prop', () => {
  test('isRinging=true paints the row and announces it', () => {
    const { container } = renderCard(issue(), true);
    expect(
      container.querySelector('.task-card.reminder-ringing'),
    ).not.toBeNull();
    expect(container.querySelector('.task-card-ringing-flag')).not.toBeNull();
    expect(
      container.querySelector('.task-card')?.getAttribute('aria-label') ?? '',
    ).toContain('reminder ringing');
  });

  test('isRinging=false leaves the row unpainted', () => {
    const { container } = renderCard(issue(), false);
    expect(container.querySelector('.task-card.reminder-ringing')).toBeNull();
    expect(container.querySelector('.task-card-ringing-flag')).toBeNull();
    expect(
      container.querySelector('.task-card')?.getAttribute('aria-label') ?? '',
    ).not.toContain('reminder ringing');
  });
});

/**
 * sk-194.5.2.8.5 — the regression guard for the fix itself.
 *
 * `TaskCard` used to call `useRingingIssueIds()`, i.e. `useQuery` on the
 * reminders key. TanStack Query dedupes the FETCH by key but NOT the
 * observers: every mounted card held its own `QueryObserver`, and each
 * observer re-installs both of its timers on every update of that query
 * (`QueryObserver.onQueryUpdate → #updateTimers`). On a loaded board that was
 * 474+ observers and thousands of timer installs.
 *
 * Asserting on `observers.length` pins the actual invariant — "a row does not
 * subscribe to the reminders query" — rather than on a render count, so it
 * stays honest if the highlight is restyled later.
 */
describe('TaskCard — sk-194.5.2.8.5 holds no reminders subscription', () => {
  test('mounting many cards adds zero observers to the reminders query', () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    // Seed so the cache entry exists and `find` can be asserted against
    // (an absent entry would make the assertion vacuously true).
    client.setQueryData(remindersListKey, EMPTY_REMINDERS_LIST);

    const rows = Array.from({ length: 50 }, (_, i) =>
      issue({ id: `sk-${i + 1}` }),
    );

    render(
      <QueryClientProvider client={client}>
        <MantineProvider forceColorScheme="dark">
          <MemoryRouter>
            {rows.map((item) => (
              <TaskCard
                key={item.id}
                item={item}
                selected={false}
                searchQuery=""
                componentNames={new Map()}
                isRinging={false}
                fields={DEFAULT_FIELDS}
                onSelect={() => {}}
              />
            ))}
          </MemoryRouter>
        </MantineProvider>
      </QueryClientProvider>,
    );

    // All 50 rows rendered…
    expect(document.querySelectorAll('.task-card')).toHaveLength(50);
    // …and not one of them subscribed to the reminders query.
    const entry = client
      .getQueryCache()
      .find({ queryKey: remindersListKey });
    expect(entry).toBeDefined();
    expect(entry?.observers.length).toBe(0);
  });
});

/**
 * sk-362 / handoff §6 "Task list": "Title 16/500 on the left, mono ID 12
 * `--primary` on the right" — title and id share ONE line, title first, id
 * right-aligned. This block pins the DOM half of that; the sizes, the
 * tone and the right-alignment are declarations, seen in a browser.
 *
 * The id has stood in three places on this card and each move answered
 * the previous one — which is why the assertions below are about
 * position and not merely presence:
 *
 *   · INLINE BEFORE the title (the original). Every title then started
 *     at a different offset depending on how long the id happened to
 *     be, so a column of titles read ragged. That is the arrangement
 *     `id must not be inside the title block` still forbids;
 *   · a line of its OWN under the title — the slot the project handle
 *     vacated. Correct, and costing a whole line per card to print six
 *     characters;
 *   · §6's arrangement: back on the title's line, on the other side.
 *     The title still starts flush at the padding edge on every row, so
 *     the ragged-offset objection is answered rather than re-opened,
 *     and the ragged edge lands on the id column instead.
 *
 * The PROJECT HANDLE, separately, is gone from this card altogether: on
 * a single-project list it repeated, row after row, the very column the
 * reader was already looking at. sk-285.2.19 took the tree row off this
 * stack and onto a table, so the two surfaces are no longer asserted to
 * match — see the docblock in TaskTreeNode.layout.test.tsx.
 */
describe('TaskCard — id on the title line, right', () => {
  test('renders the issue id', () => {
    const { container } = renderCard(issue(), false);
    const line = container.querySelector('.task-card-id-line');
    expect(line).not.toBeNull();
    expect(line?.textContent).toContain('sk-1');
  });

  test('the id shares the title row and follows the title in it', () => {
    const { container } = renderCard(issue(), false);
    const row = container.querySelector('.task-card-title-row')!;
    expect(row, 'no .task-card-title-row on the card').not.toBeNull();
    const title = container.querySelector('.task-card-title-block')!;
    const line = container.querySelector('.task-card-id-line')!;
    // Same row, so they lay out on one line…
    expect(title.parentElement).toBe(row);
    expect(line.parentElement).toBe(row);
    // …and the title is the first thing in it, so it starts flush at the
    // card's padding edge on every row whatever the id measures.
    expect(row.firstElementChild).toBe(title);
    expect(
      title.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The id must not be back INSIDE the title block: that block is the
    // 2-line clamp, so an id in it flows after however much title there
    // is and is the first thing the ellipsis eats.
    expect(title.querySelector('.issue-id-badge')).toBeNull();
  });

  test('with the id column switched off the title row still holds the title', () => {
    // Negative path for the wrapper: `fields` can drop the id entirely,
    // and the row must not become an empty box or swallow the title.
    const { container } = renderCard(issue(), false, listCardFieldsMask([]));
    const row = container.querySelector('.task-card-title-row')!;
    expect(row).not.toBeNull();
    expect(container.querySelector('.task-card-id-line')).toBeNull();
    expect(row.querySelector('.task-card-title-block')?.textContent).toContain(
      'hello',
    );
  });

  test('no project handle anywhere on the card', () => {
    const { container } = renderCard(issue(), false);
    expect(container.querySelector('.task-card-project-line')).toBeNull();
    expect(container.querySelector('.task-card-project-eyebrow')).toBeNull();
  });
});

/**
 * The list's «display properties» — the third surface to get the switch
 * list the board and the tree already had.
 *
 * Two things are pinned, and the first is the one that would be
 * invisible if it broke: the DEFAULT set has to reproduce the card as it
 * shipped, not one attribute more and not one less. A user who never
 * opens the picker must not be able to tell the feature was added.
 *
 * The second is that each switch actually governs the thing it names —
 * asserted by turning ONE attribute off (or on) against a card where
 * everything else is at its default, so a failure names the switch.
 */
describe('TaskCard — the list display properties', () => {
  const mask = (...f: ListCardField[]) => listCardFieldsMask(f);

  const rich = () =>
    issue({
      assignee: 'kim',
      labels: ['research', 'ui'],
      componentIds: ['c-1'],
      isBlocked: true,
      iAssigned: true,
      type: 'epic',
      // sk-489 T016 — summary of the NEW server: the pair is the same, the word differs
      // ("done", not "closed"). The previous form is checked by its own case
      // below — a guard of the rollout window (US-10), not the fixture default.
      epicProgress: { closed: 3, total: 9, done: 3, counted: 9, noWork: 0 },
    });

  test('the default set draws id, chips, assignee and the relative date', () => {
    const { container } = renderCard(rich());
    expect(container.querySelector('.task-card-id-line')).not.toBeNull();
    expect(container.querySelector('.task-card-meta-left')?.textContent).not.toBe(
      '',
    );
    const right = container.querySelector('.task-card-meta-right')!.textContent!;
    expect(right).toContain('kim');
    expect(right).toContain('3/9');
    expect(container.querySelector('.task-card-star')).not.toBeNull();
  });

  test('…and nothing the card never showed: no labels, no created date', () => {
    // The two attributes deliberately OFF in the default set. If either
    // ever ships on, a user who never opened the picker sees a card that
    // changed under them — the one thing the default set exists to
    // prevent.
    const { container } = renderCard(rich());
    const right = container.querySelector('.task-card-meta-right')!.textContent!;
    expect(right).not.toContain('research');
    expect(right).not.toContain('created');
  });

  test('turning the id off drops the id line and keeps the title', () => {
    const { container } = renderCard(
      rich(),
      false,
      mask(...LIST_DEFAULT_CARD_FIELDS.filter((f) => f !== 'id')),
    );
    expect(container.querySelector('.task-card-id-line')).toBeNull();
    expect(container.querySelector('.task-card-title-block')?.textContent).toContain(
      'hello world',
    );
  });

  test('turning the assignee off takes it out of the meta line — and the separator with it', () => {
    const { container } = renderCard(rich(), false, mask('updated'));
    const right = container.querySelector('.task-card-meta-right')!.textContent!;
    expect(right).not.toContain('kim');
    // One segment left, so the line must not open or close with a stray
    // separator: the `·` belongs to the JOIN, not to a segment.
    expect(right.trim().startsWith('·')).toBe(false);
    expect(right.trim().endsWith('·')).toBe(false);
  });

  test('labels and the created date appear only when switched on', () => {
    const { container } = renderCard(
      rich(),
      false,
      mask('labels', 'created'),
    );
    const right = container.querySelector('.task-card-meta-right')!.textContent!;
    expect(right).toContain('research, ui');
    expect(right).toContain('created');
  });

  test('the delegated switch governs the ★ AND the tint it comes with', () => {
    const on = renderCard(rich(), false, mask('delegated'));
    expect(on.container.querySelector('.task-card-star')).not.toBeNull();
    expect(
      on.container.querySelector('.task-card')?.className,
    ).toContain('assigned-by-me');
    cleanup();

    const off = renderCard(rich(), false, mask('id'));
    expect(off.container.querySelector('.task-card-star')).toBeNull();
    // The wash is the same mark as the glyph; keeping it would leave the
    // row claiming "delegated" with nothing to explain it.
    expect(
      off.container.querySelector('.task-card')?.className,
    ).not.toContain('assigned-by-me');
  });

  test('the blocked switch governs the ⊘ glyph, and the hierarchy mark ignores it', () => {
    const blocked = () => issue({ isBlocked: true, parentIdCurrent: 'sk-0' });

    const on = renderCard(blocked(), false, mask('blocked'));
    expect(
      on.container.querySelectorAll('.task-card-dep-icon'),
    ).toHaveLength(2);
    cleanup();

    // `blocked` off: the ⊘ goes, the subtask marker stays. It is
    // structural — it says WHERE the row is, not what state it is in —
    // and is deliberately not a switchable attribute.
    const off = renderCard(blocked(), false, mask('id'));
    expect(
      off.container.querySelectorAll('.task-card-dep-icon'),
    ).toHaveLength(1);
  });

  test('an empty set leaves a bare title card — a legal, deliberate choice', () => {
    const { container } = renderCard(rich(), false, mask());
    expect(container.querySelector('.task-card-id-line')).toBeNull();
    expect(container.querySelector('.task-card-star')).toBeNull();
    expect(container.querySelector('.task-card-meta-left')?.textContent).toBe('');
    expect(container.querySelector('.task-card-meta-right')?.textContent).toBe('');
    expect(container.querySelector('.task-card-title-block')?.textContent).toContain(
      'hello world',
    );
  });
});

/**
 * sk-285.7.2.51 (audit finding S-3) — the space BEFORE the `·`.
 *
 * The reference `1b` reads `1 component · admin · 3 days ago`. The
 * product read `1 component· admin· 6 days ago`, and the interesting
 * part is that the source said otherwise: the segments are written
 * `` ` · ${text}` `` and the leading space really is in the DOM —
 * measured live, `textContent` of the row was
 * «1 component · admin · 6 days ago» while `innerText` was
 * «1 component\n· admin\n· 6 days ago».
 *
 * The space was eaten by the LAYOUT. `.task-card-meta-right` is
 * `display: flex`, so each `<span>` is a flex item — a block-level box —
 * and white-space processing drops a leading space at the start of one.
 * A guard that read the JSX would have found the space and passed; a
 * guard that read the stylesheet for `gap` would have found `gap: 0` and
 * had nothing to say about it. Only the pair — the rendered DOM and the
 * value the cascade computes for this element — states the defect.
 *
 * jsdom lays nothing out, so the PIXEL distance is seen in the browser
 * (4px between consecutive segments, measured at sk-285.7.2.51). What is
 * pinned here is the DOM half: separate segments, each with its own `·`.
 */
describe('sk-285.7.2.51 — the meta row separates its segments visibly', () => {
  const metaRowOf = (item: IssueSummary): HTMLElement => {
    const { container } = renderCard(item);
    const row = container.querySelector('.task-card-meta-right') as HTMLElement | null;
    expect(row, 'the card rendered no meta row').not.toBeNull();
    return row!;
  };

  test('the segments are separate flex items, each carrying its own `·`', () => {
    const row = metaRowOf(issue({ assignee: 'admin' }));
    const kids = [...row.children];
    // Tripwire: one segment cannot be separated from anything, so the
    // assertions below would be vacuous.
    expect(kids.length).toBeGreaterThan(1);
    // Every segment after the first opens with the separator, and the
    // space in front of it IS in the text — which is exactly why reading
    // the text is not enough.
    for (const k of kids.slice(1)) {
      expect(k.textContent ?? '').toMatch(/^ · /);
    }
    expect(row.textContent ?? '').toContain(' · ');
  });
});

/**
 * sk-285.7.2.52 (audit finding S-4) — the subtask marker is an ICON.
 *
 * §6 "Task list" writes it "[↳ icon for subtasks]" and §8 names it:
 * `corner-down-right`. The product drew `↥` (U+21A5) — not an icon, and
 * pointing the other way: the reference `1b` marks a child row with a
 * stroke going down and to the right, parent above, child indented
 * under it. Measured live: five `.task-card-dep-icon`, each
 * `textContent === '↥'`, `svg === 0`.
 *
 * The strip is the surface the audit measured; the dep-type CHIP in the
 * Details panel draws the same marker from the same map and is covered
 * by `Attribute.test.tsx`. Both read `DEP_TYPE_ICONS`, so the two cannot
 * diverge without one of the two files going red.
 */
describe('sk-285.7.2.52 — the subtask marker on a card is an icon, not ↥', () => {
  test('the has-parent slot draws an svg and no character', () => {
    const { container } = renderCard(issue({ parentIdCurrent: 'sk-0' }));
    const marks = [...container.querySelectorAll('.task-card-dep-icon')];
    expect(marks).toHaveLength(1);
    expect(marks[0].querySelectorAll('svg')).toHaveLength(1);
    // The character is gone, not merely joined by an icon — the Q-2
    // failure mode, in this slot.
    expect(marks[0].textContent ?? '').toBe('');
    // The marker still names itself for assistive tech; the icon is
    // decorative inside a labelled `role="img"`.
    expect(marks[0].getAttribute('aria-label')).toMatch(/parent-child/);
  });

  test('the blocked marker beside it is still a character', () => {
    // Both markers in one strip: one icon, one glyph. If the icon branch
    // ever swallowed the other types this row would show two svgs.
    const { container } = renderCard(
      issue({ parentIdCurrent: 'sk-0', isBlocked: true }),
      false,
      DEFAULT_FIELDS,
    );
    const marks = [...container.querySelectorAll('.task-card-dep-icon')];
    expect(marks).toHaveLength(2);
    expect(marks[0].querySelectorAll('svg')).toHaveLength(1);
    expect(marks[1].querySelectorAll('svg')).toHaveLength(0);
    expect(marks[1].textContent).toBe('⊘');
  });
});

/**
 * sk-489 T016 (US-6, INV-5, SC-008, SC-010; test plan row 62) — the
 * progress chip of the list card.
 *
 * Why it is checked HERE, and not only at the helper: i18n params are not
 * typed, and a label built from the right numbers by the wrong key (or
 * from the wrong numbers by the right one) is green for the compiler. The
 * places can diverge too: the card chip, the tree cell and the section branch print one and the
 * same number with three calls, so each has its own case.
 */
describe('sk-489 T016 — progress chip: "done out of counted"', () => {
  const PROGRESS_ONLY = listCardFieldsMask(['progress']);

  const chip = (epicProgress: IssueSummary['epicProgress']): string | null => {
    const { container } = renderCard(
      issue({ type: 'epic', epicProgress }),
      false,
      PROGRESS_ONLY,
    );
    return container.querySelector('.task-card-epic-progress')?.textContent ?? null;
  };

  // sk-540.3 — the chip shows the excluded-from-scope count next to
  // "done / counted". This REPLACES the sk-489 pin "the 'no work' tail is
  // NOT on the chip — only on the ring" (`(3/3 done)` at `noWork: 1`): the
  // owner cancelled "tail only on the ring" on 2026-09-24, because an epic
  // of 1 done and 9 won't-do read as finished on the chip.
  //
  // Expected strings come from the acceptance of sk-540.3 / sk-540.5:
  // short tail "excluded: N", one empty-denominator caption "excluded from
  // scope: N", no tail at zero or when the api did not send the count.
  test.each([
    {
      name: '3 done + 1 won\'t do → the pair keeps the ring arithmetic, tail carries the 1',
      progress: { closed: 4, total: 4, done: 3, counted: 3, noWork: 1 },
      want: '(3/3 done, excluded: 1)',
    },
    {
      name: '1 done + 9 won\'t do → no longer reads as a bare finished pair',
      progress: { closed: 10, total: 10, done: 1, counted: 1, noWork: 9 },
      want: '(1/1 done, excluded: 9)',
    },
    {
      name: '2 done + 1 open + 1 duplicate → counted pair, not "(3/4 closed)"',
      progress: { closed: 3, total: 4, done: 2, counted: 3, noWork: 1 },
      want: '(2/3 done, excluded: 1)',
    },
    {
      name: 'unavailable children stay in the denominator, the excluded tail is visible ones only',
      progress: { closed: 2, total: 5, unavailable: 1, done: 0, counted: 3, noWork: 2 },
      want: '(0/3 done, excluded: 2)',
    },
    {
      name: 'nothing excluded (noWork: 0) → no tail',
      progress: { closed: 3, total: 9, done: 3, counted: 9, noWork: 0 },
      want: '(3/9 done)',
    },
    {
      name: 'every counted child excluded → the empty-denominator caption, not "0/0"',
      progress: { closed: 2, total: 2, done: 0, counted: 0, noWork: 2 },
      want: 'excluded from scope: 2',
    },
    {
      name: 'no children (or only standing ones, which the server keeps out of total) → the pair',
      progress: { closed: 0, total: 0, done: 0, counted: 0, noWork: 0 },
      want: '(0/0 done)',
    },
    {
      name: 'outcome legs without noWork → no tail, never a tail of 0',
      progress: { closed: 3, total: 4, done: 3, counted: 4 },
      want: '(3/4 done)',
    },
  ])('sk-540.3 — $name', ({ progress, want }) => {
    expect(chip(progress)).toBe(want);
  });

  test('US-10, SC-010 — a response without the new fields: the old pair in the old words', () => {
    expect(chip({ closed: 3, total: 4 })).toBe('(3/4 closed)');
  });
});
