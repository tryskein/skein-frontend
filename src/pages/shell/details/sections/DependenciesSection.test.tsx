/**
 * sk-285.6.2 fallout — the collapsed section's ONE door.
 *
 * With no edges either way the section is a single row and its "+ Add
 * dependency" affordance is the only way in. Pressing it unmounts the
 * button itself, so unless focus is handed to the form it reveals it
 * falls to <body>: a keyboard user has to tab the entire card again to
 * reach the form they just asked for (WCAG 2.4.3).
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../../components/Toaster', () => ({
  useToaster: () => ({ error: vi.fn(), success: vi.fn() }),
}));

import type { DependencyEdge, DependencyList } from '../../../../api/dependencies';
import { DependenciesSection } from './DependenciesSection';

afterEach(cleanup);

/**
 * `undefined` is the query in flight — and it cannot be spelled as an
 * argument to `renderSection`, because a JS default parameter fires on
 * `undefined` and would silently render the EMPTY list instead. Hence a
 * second door rather than a flag.
 */
function renderLoadingSection() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <DependenciesSection
          projectId="p-uuid"
          issueId="sk-1"
          dependencies={undefined}
          isEpic={false}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function renderSection(
  dependencies: DependencyList = { outgoing: [], incoming: [] },
  // sk-421.2 T023 — NOT an epic by default: all the cases written before this
  // task stay on the old path, and this is exactly the baseline of INV-6.
  isEpic = false,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <DependenciesSection
          projectId="p-uuid"
          issueId="sk-1"
          dependencies={dependencies}
          isEpic={isEpic}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/**
 * One outgoing edge, spelled out so each case can bend the one field it
 * is about. `metadata` is where a `waits-for` gate lives on the wire.
 */
function edge(over: Partial<DependencyEdge> = {}): DependencyEdge {
  return {
    fromId: 'sk-1',
    toId: 'pay-3',
    type: 'blocks',
    version: 1,
    createdAt: '2026-09-01T10:00:00Z',
    metadata: {},
    issue: {
      id: 'pay-3',
      projectId: 'pay-uuid',
      title: 'Partial refund does not reduce the order total',
      status: 'in_progress',
      priority: 1,
      type: 'bug',
    },
    ...over,
  } as DependencyEdge;
}

describe('DependenciesSection — the collapsed row', () => {
  test('pressing the Add-dependency affordance moves focus into the form it opens', async () => {
    const user = userEvent.setup();
    const { container } = renderSection();

    expect(container.querySelector('.detail-section--empty')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add dependency' }));

    const idField = screen.getByLabelText('Issue id to depend on');
    await waitFor(() => expect(document.activeElement).toBe(idField));
  });
});

/**
 * sk-414.4 — artboard 4c: the four states of the section.
 *
 * What the rewrite has to be held to is not "does it look like the
 * canvas" — a jsdom test cannot see paint — but the three claims the
 * canvas makes that ARE structural:
 *
 *   1. DIRECTION IS THE GROUP'S. The rows lost their arrows, so if the
 *      headings ever stop being drawn the direction stops being stated
 *      at all — and an empty direction has to keep its heading for the
 *      same reason: «no incoming edges» and «this card does not show
 *      incoming edges» are different facts.
 *   2. ONLY OUTGOING EDGES ARE EDITABLE. An incoming edge belongs to the
 *      issue at the other end; a remove button on it would be an offer
 *      the API refuses.
 *   3. THE TYPE READS WITHOUT COLOUR. Glyph plus word in the chip, and
 *      the `waits-for` gate inside that same chip, because «waits for
 *      all children» is a different promise from «any child».
 */
describe('DependenciesSection — the two direction groups', () => {
  test('both directions are announced, and an empty one says so on its heading', () => {
    const { container } = renderSection({ outgoing: [edge()], incoming: [] });

    const heads = [...container.querySelectorAll('.detail-group-head')];
    // Two, even though only one direction has edges: the heading is the
    // only thing left that states the direction.
    expect(heads).toHaveLength(2);
    expect(heads[0].textContent).toContain('Depends on');
    expect(heads[1].textContent).toContain('Depended on by');

    // The filled direction carries its count…
    expect(heads[0].querySelector('.detail-group-count')?.textContent).toBe('1');
    // …and the empty one carries the shared empty word, ON the heading
    // row rather than as a line under it.
    expect(heads[1].querySelector('.detail-group-empty')?.textContent).toBe('none');
    // One list, not two: an empty direction draws no <ul> at all.
    expect(container.querySelectorAll('.detail-list')).toHaveLength(1);
  });

  test('the row is free of the arrow the heading now carries', () => {
    const { container } = renderSection({ outgoing: [edge()], incoming: [] });

    const row = container.querySelector('.detail-row--dep')!;
    // The two glyphs the row used to open with, one per direction.
    expect(row.textContent).not.toContain('→');
    expect(row.textContent).not.toContain('←');
    // What it says instead: the type by glyph AND word (colour is never
    // the only carrier), the id, the status and the priority.
    const chip = row.querySelector('.dep-chip')!;
    expect(chip.getAttribute('data-dep-type')).toBe('blocks');
    expect(chip.textContent).toContain('⊘');
    expect(chip.textContent).toContain('blocks');
    expect(row.querySelector('.detail-row-link')?.textContent).toBe('pay-3');
    expect(row.querySelector('.status-chip')?.getAttribute('data-status')).toBe(
      'in_progress',
    );
    // The wire spelling is retyped for the badge — the same transform
    // `Attribute` applies everywhere else.
    expect(row.querySelector('.status-chip')?.textContent).toContain('in progress');
    expect(row.querySelector('.detail-row-prio')?.textContent).toBe('P1');
    expect(row.querySelector('.detail-row-title')?.textContent).toBe(
      'Partial refund does not reduce the order total',
    );
  });

  test('a waits-for gate is written inside the type chip, not beside it', () => {
    const { container } = renderSection({
      outgoing: [
        edge({ type: 'waits-for', metadata: { gate: 'all-children' } }),
      ],
      incoming: [],
    });

    const chips = container.querySelectorAll('.dep-chip');
    // One chip on the row, carrying both facts: a second chip would read
    // as a second attribute of the issue rather than as part of what
    // this edge type promises.
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain('waits-for: all-children');
  });

  test('only the outgoing half can be cut', () => {
    renderSection({
      outgoing: [edge()],
      incoming: [edge({ fromId: 'pay-9', toId: 'sk-1', type: 'discovered-from' })],
    });

    // Exactly one remove control on the whole section, and it belongs to
    // the outgoing row. An incoming edge is owned by the issue at the
    // other end — offering to cut it here is offering what the API will
    // refuse.
    const removes = screen.getAllByRole('button', { name: /Remove link/ });
    expect(removes).toHaveLength(1);
    expect(removes[0].getAttribute('aria-label')).toBe('Remove link to pay-3');
  });

  test('an edge into an invisible project keeps its type and loses its issue', () => {
    const { container } = renderSection({
      outgoing: [edge({ redacted: true, issue: undefined })],
      incoming: [],
    });

    const row = container.querySelector('.detail-row--dep')!;
    // The edge is real and its type is known — this is not an error and
    // not "no data".
    expect(row.querySelector('.dep-chip[data-dep-type="blocks"]')).not.toBeNull();
    expect(row.querySelector('.dep-chip--redacted')?.textContent).toContain(
      'hidden · no access to project',
    );
    expect(row.querySelector('.detail-row-title')?.textContent).toContain(
      'only type and direction are visible',
    );
    // Nothing to click and nothing to cut: removing an edge whose far
    // end you cannot see is not a decision this UI can offer.
    expect(row.querySelector('.detail-row-link')).toBeNull();
    expect(row.querySelectorAll('button')).toHaveLength(0);
  });

  // sk-674.18 T055 — the lead's decision on T009 (the supplement to
  // sk-698.2): the hidden end of a redacted edge is a synthetic
  // `hidden-<k>`, not a real id. A row's key must not rest on that id being
  // unique: two hidden ends of one type are two rows, each without a remove
  // control.
  test('two redacted edges of one type with the same synthetic end → two rows, no duplicate key, nothing to cut', () => {
    renderSection({
      outgoing: [
        edge({ toId: 'hidden-1', redacted: true, issue: undefined }),
        edge({ toId: 'hidden-1', redacted: true, issue: undefined }),
      ],
      incoming: [],
    });
    // Two hidden ends, two rows — neither collapsed into the other.
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    // Nothing to cut on either of them: the section offers no remove.
    expect(screen.queryByRole('button', { name: /Remove link/ })).toBeNull();
  });

  test('an unanswered query is one wait for the section, not one per direction', () => {
    const { container } = renderLoadingSection();

    const plaque = screen.getByRole('status');
    expect(plaque.className).toContain('detail-status-plaque');
    // Nothing is known about EITHER half while the request is in flight,
    // and saying so twice reads as two separate waits.
    expect(container.querySelectorAll('.detail-status-plaque')).toHaveLength(1);
    expect(container.querySelector('.detail-group-head')).toBeNull();
  });
});

describe('DependenciesSection — the add form', () => {
  test('the form explains the type it has selected, in words', async () => {
    const user = userEvent.setup();
    const { container } = renderSection();

    await user.click(screen.getByRole('button', { name: 'Add dependency' }));

    // Seven types is more than a reader carries in their head, and a
    // tooltip answers only the one they happen to hover.
    const hint = container.querySelector('.detail-form-hint')!;
    expect(hint.textContent).toContain('blocks —');
    expect(hint.textContent).toContain('cannot close until it does');

    // Changing the type changes the sentence — the hint tracks the
    // SELECTION, it is not a caption on the field.
    await user.selectOptions(screen.getByLabelText('Link type'), 'supersedes');
    expect(container.querySelector('.detail-form-hint')!.textContent).toContain(
      'supersedes —',
    );
  });

  test('both fields are labelled on screen, not only to a screen reader', async () => {
    const user = userEvent.setup();
    const { container } = renderSection();

    await user.click(screen.getByRole('button', { name: 'Add dependency' }));

    const labels = [...container.querySelectorAll('.detail-form-label')].map((l) =>
      (l.textContent ?? '').trim(),
    );
    expect(labels[0]).toContain('Link type');
    expect(labels[1]).toContain('Issue ID');

    // …and the visible label is what NAMES the control (WCAG 2.5.3): an
    // `aria-label` on the select would replace «Link type» in the
    // accessible name rather than add to it, and a speech-input user
    // reading the screen would be saying a name nothing answers to.
    //
    // Asked through `getByRole`, not `getByLabelText`: the latter tries
    // several association strategies and a wrapping <label> satisfies it
    // even when an aria-label has overridden the name — so it cannot see
    // this defect at all (verified by mutation: adding the aria-label
    // left the `getByLabelText` form green). `getByRole` computes the
    // accessible NAME, which is the thing 2.5.3 is about.
    expect(
      screen.getByRole('combobox', { name: 'Link type' }).tagName,
    ).toBe('SELECT');
    // The id field's longer name is legal precisely because it CONTAINS
    // the visible one — the asymmetry is the rule, not an exception.
    expect(
      screen.getByRole('textbox', { name: 'Issue id to depend on' }).tagName,
    ).toBe('INPUT');
  });

  test('Esc closes the form from inside it — including from the select', async () => {
    const user = userEvent.setup();
    const { container } = renderSection();

    await user.click(screen.getByRole('button', { name: 'Add dependency' }));
    expect(container.querySelector('.detail-form')).not.toBeNull();

    // From the type field, where the browser's own Esc only dismisses
    // the dropdown — the form has to answer for the whole of itself.
    screen.getByLabelText('Link type').focus();
    await user.keyboard('{Escape}');

    expect(container.querySelector('.detail-form')).toBeNull();
    // …and the section is a collapsed row again, because the form was
    // the only content it had.
    expect(container.querySelector('.detail-section--empty')).not.toBeNull();
  });

  test('while the form is open a section with no edges stays expanded', async () => {
    const user = userEvent.setup();
    const { container } = renderSection();

    await user.click(screen.getByRole('button', { name: 'Add dependency' }));

    // The form IS content. Collapsing here would drop it from the tree
    // in the same flush that opened it.
    expect(container.querySelector('.detail-section--empty')).toBeNull();
    expect(container.querySelector('.detail-form')).not.toBeNull();
  });
});

// ───────────────────────── sk-421.2 T023 ─────────────────────────

/**
 * An incoming edge: the other side REFERS to this task. For
 * the hierarchy this is a child pointing at its parent, so
 * `fromId` is the child and `toId` is the open card.
 */
function incomingEdge(
  fromId: string,
  type: DependencyEdge['type'],
  title: string,
): DependencyEdge {
  return edge({
    fromId,
    toId: 'sk-1',
    type,
    issue: {
      id: fromId,
      projectId: 'p-uuid',
      title,
      status: 'open',
      priority: 2,
      type: 'task',
    },
  } as Partial<DependencyEdge>);
}

/** An epic with one child, one incoming blocker and one outgoing one. */
const MIXED: DependencyList = {
  outgoing: [edge()],
  incoming: [
    incomingEdge('sk-1.1', 'parent-child', 'Epic child task'),
    incomingEdge('ops-9', 'blocks', 'External blocker'),
  ],
};

describe('sk-421.2 T023 — epic dependencies without duplicate children', () => {
  test('US-4 / SC-006 — on an epic the incoming hierarchy edge is not shown', () => {
    renderSection(MIXED, true);
    // The child is gone: it is already shown in the child tasks section, with a status
    // and progress that a dependency row does not have.
    expect(screen.queryByText('Epic child task')).toBeNull();
    // The other links are intact — exactly one is cut out, not "the incoming ones".
    expect(screen.getByText('External blocker')).toBeTruthy();
  });

  test('SC-006 — both counters count what is SHOWN, not what arrived', () => {
    const { container } = renderSection(MIXED, true);
    // Three edges arrived, two are shown: one outgoing and one incoming
    // blocker. The section counter must speak about the rows under it.
    expect(
      container.querySelector('.detail-section-count')?.textContent,
    ).toBe('2');
    // And the incoming group counter too: otherwise a "1" over a single row in the
    // section would sit next to a "2" on its heading.
    const heads = container.querySelectorAll('.detail-group-head');
    expect(heads[1].querySelector('.detail-group-count')?.textContent).toBe('1');
  });

  test('INV-6 — on a non-epic the same data is unchanged', () => {
    const { container } = renderSection(MIXED, false);
    expect(screen.getByText('Epic child task')).toBeTruthy();
    expect(
      container.querySelector('.detail-section-count')?.textContent,
    ).toBe('3');
    const heads = container.querySelectorAll('.detail-group-head');
    expect(heads[1].querySelector('.detail-group-count')?.textContent).toBe('2');
  });

  test('an epic without other links behaves like an EMPTY section', () => {
    const { container } = renderSection(
      {
        outgoing: [],
        incoming: [incomingEdge('sk-1.1', 'parent-child', 'Only child')],
      },
      true,
    );
    // The section is folded into one line: there are no direction groups in the markup…
    expect(container.querySelectorAll('.detail-group-head')).toHaveLength(0);
    // …and there is no counter chip either — "Dependencies 1" over emptiness would be
    // worse than no number.
    expect(container.querySelector('.detail-section-count')).toBeNull();
  });

  test('R-9 — only the INCOMING half is cut: the epic keeps its own place in the hierarchy', () => {
    // An outgoing hierarchy edge is the epic's link to its OWN
    // parent. It is not in the children section, and a silent cut "by edge
    // type" would lose it for good.
    renderSection(
      {
        outgoing: [
          edge({
            toId: 'sk-9',
            type: 'parent-child',
            issue: {
              id: 'sk-9',
              projectId: 'p-uuid',
              title: 'Parent epic',
              status: 'open',
              priority: 2,
              type: 'epic',
            },
          } as Partial<DependencyEdge>),
        ],
        incoming: [],
      },
      true,
    );
    expect(screen.getByText('Parent epic')).toBeTruthy();
  });
});
