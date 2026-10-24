/**
 * sk-285.7.2.40 — audit finding A4: "selected" must be readable without
 * seeing the colour, and the two rows of ONE tree must say it the same
 * way.
 *
 * Handoff §7: "Focus-state is visible on all interactive elements …
 * `aria-pressed` on toggle lenses, `aria-checked` on radio chips". A
 * project row and the component rows nested under it are the same
 * gesture over the same list, drawn with the same paint (`--primary-t`
 * plus a 3px `--primary` stripe on the shell). Before this task the
 * component row carried `aria-pressed` and the project row carried
 * nothing at all — the audit's keyboard walk found 12 stops with the
 * attribute and 6 without, the SELECTED pseudo-row among the six.
 *
 * ── Why the claim is made on a RENDERED node ──────────────────────
 *
 * The attribute is written by a JSX expression, so «the source contains
 * `aria-pressed`» and «the button in the document carries it, with the
 * right value» are two different statements: `aria-pressed={selected}`
 * on a component whose `selected` prop never arrives renders NOTHING
 * (React drops `undefined` attributes silently), and a grep would be
 * green for both. So both rows are rendered, in both states, and the
 * attribute is read off the mounted element.
 *
 * ── The label is not a substitute, and that is checked too ─────────
 *
 * Both rows already flip their `aria-label` between "select X" and
 * "deselect X". That is the NEXT ACTION, not the current state: a
 * screen reader announcing "deselect Catalog, button" has told the user
 * what pressing does, not that the row is on. The pairing test below
 * pins label and state together so a future edit cannot drop the state
 * and point at the label as cover.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import type { ProjectListItem } from '../../../api/projects';
import type { Component } from '../../../api/components';
import { ProjectRow } from '../ProjectRow';
import { ComponentRow } from '../ComponentRow';

const layoutState = { outboxMode: false, onMeMode: false };
vi.mock('../../../lib/useLayoutState', () => ({
  useLayoutState: () => layoutState,
}));

function project(over: Partial<ProjectListItem> = {}): ProjectListItem {
  return {
    id: 'proj-1',
    name: 'Shop storefront',
    idPrefix: 'shop',
    defaultIdMode: 'counter',
    description: '',
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    openCount: 3,
    inProgressCount: 1,
    blockedCount: 0,
    standingCount: 0,
    myOutboxStandingCount: 0,
    myOutboxOpenCount: 3,
    myOutboxInProgressCount: 1,
    myOutboxBlockedCount: 0,
    ...over,
  };
}

function component(over: Partial<Component> = {}): Component {
  return {
    id: 'comp-1',
    projectId: 'proj-1',
    name: 'Catalog',
    description: '',
    paths: [],
    createdBy: 'u-1',
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    openCount: 2,
    inProgressCount: 0,
    blockedCount: 0,
    standingCount: 0,
    myOutboxStandingCount: 0,
    myOutboxOpenCount: 2,
    myOutboxInProgressCount: 0,
    myOutboxBlockedCount: 0,
    ...over,
  };
}

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MantineProvider forceColorScheme="light">
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </MantineProvider>
  );
}

/** The row's own <button>, off the rendered tree. */
function rowButton(container: HTMLElement, cls: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`.${cls}`);
  expect(el, `no .${cls} in the rendered output`).not.toBeNull();
  return el!;
}

beforeEach(() => {
  layoutState.outboxMode = false;
  layoutState.onMeMode = false;
});
afterEach(() => cleanup());

/**
 * Every row of the Projects column, as `[name, class, render(selected)]`.
 *
 * The pseudo-row is a separate entry rather than a variation of the
 * project row: it is a DIFFERENT branch of `ProjectRow` (`project ===
 * null`), it is the row that is pressed whenever no project is picked,
 * and it is the one the audit caught selected-and-silent.
 */
const ROWS: ReadonlyArray<
  readonly [string, string, (selected: boolean) => HTMLElement]
> = [
  [
    'project row',
    'project-row-body',
    (selected) =>
      render(
        <Wrapper>
          <ProjectRow
            project={project()}
            selected={selected}
            searchQuery=""
            onSelect={() => {}}
          />
        </Wrapper>,
      ).container,
  ],
  [
    'the "All projects" pseudo-row',
    'project-row-body',
    (selected) =>
      render(
        <Wrapper>
          <ProjectRow project={null} selected={selected} searchQuery="" onSelect={() => {}} />
        </Wrapper>,
      ).container,
  ],
  [
    'component row',
    'component-row-body',
    (selected) =>
      render(
        <Wrapper>
          <ComponentRow component={component()} selected={selected} onSelect={() => {}} />
        </Wrapper>,
      ).container,
  ],
];

describe('a selected row says so programmatically (A4)', () => {
  test('the harness renders the rows it claims to (guard against a vacuous pass)', () => {
    // Every assertion below reads an attribute off a node located by
    // class. A render that produced nothing would make `rowButton`
    // throw — but a render that produced the WRONG row would not, so
    // the identity of each is pinned once here.
    for (const [name, cls, renderRow] of ROWS) {
      const el = rowButton(renderRow(false), cls);
      expect(el.tagName, `${name} is not a button`).toBe('BUTTON');
      cleanup();
    }
    // …and the two classes really are different elements, i.e. the
    // table is not three copies of one row.
    const container = render(
      <Wrapper>
        <ProjectRow project={project()} selected searchQuery="" onSelect={() => {}} />
        <ComponentRow component={component()} selected={false} onSelect={() => {}} />
      </Wrapper>,
    ).container;
    expect(container.querySelectorAll('.project-row-body')).toHaveLength(1);
    expect(container.querySelectorAll('.component-row-body')).toHaveLength(1);
  });

  test.each(ROWS)('%s announces aria-pressed=true when selected', (_name, cls, renderRow) => {
    const el = rowButton(renderRow(true), cls);
    expect(el.getAttribute('aria-pressed')).toBe('true');
  });

  test.each(ROWS)('%s announces aria-pressed=false when not selected', (_name, cls, renderRow) => {
    const el = rowButton(renderRow(false), cls);
    // `false`, not absent: an absent attribute says "this is not a
    // toggle", which is a different (and wrong) statement about a row
    // that can be pressed.
    expect(el.getAttribute('aria-pressed')).toBe('false');
  });

  test.each(ROWS)('%s changes its programmatic state, not only its paint', (_name, cls, renderRow) => {
    const on = rowButton(renderRow(true), cls);
    const onPressed = on.getAttribute('aria-pressed');
    cleanup();
    const off = rowButton(renderRow(false), cls);
    expect(onPressed).not.toBe(off.getAttribute('aria-pressed'));
  });

  test('the label does not carry the state on a project row — which is why the attribute must', () => {
    // Measured, and it is sharper than the audit's line. The COMPONENT
    // row flips its label between "select X" and "deselect X", so
    // before this task it at least said something under a screen
    // reader; the PROJECT row's label is the same string in both
    // states. So on the row the audit caught, the paint really was the
    // only channel there was — nothing at all reached a user who could
    // not see the tint.
    //
    // It also means the fix cannot be "make the label flip instead":
    // a label is the next ACTION, and `aria-pressed` is the state. This
    // test pins the asymmetry so the next reader does not mistake the
    // component row's flipping label for the state channel.
    const on = rowButton(
      render(
        <Wrapper>
          <ProjectRow project={project()} selected searchQuery="" onSelect={() => {}} />
        </Wrapper>,
      ).container,
      'project-row-body',
    );
    const projectOnLabel = on.getAttribute('aria-label');
    cleanup();
    const off = rowButton(
      render(
        <Wrapper>
          <ProjectRow project={project()} selected={false} searchQuery="" onSelect={() => {}} />
        </Wrapper>,
      ).container,
      'project-row-body',
    );
    expect(projectOnLabel).toBe(off.getAttribute('aria-label'));

    // …while the component row's label does flip, and still is not the
    // state channel.
    cleanup();
    const compOn = rowButton(
      render(
        <Wrapper>
          <ComponentRow component={component()} selected onSelect={() => {}} />
        </Wrapper>,
      ).container,
      'component-row-body',
    );
    const compOnLabel = compOn.getAttribute('aria-label');
    cleanup();
    const compOff = rowButton(
      render(
        <Wrapper>
          <ComponentRow component={component()} selected={false} onSelect={() => {}} />
        </Wrapper>,
      ).container,
      'component-row-body',
    );
    expect(compOnLabel).not.toBe(compOff.getAttribute('aria-label'));
  });

  test('the whole column speaks ONE dialect', () => {
    // The finding was not "an attribute is missing" but "two rows of
    // one tree say the same thing two different ways". So the claim is
    // stated as a set: every pressable row of the column uses the same
    // attribute name, and none of them reaches for a second spelling.
    const container = render(
      <Wrapper>
        <ProjectRow project={null} selected searchQuery="" onSelect={() => {}} />
        <ProjectRow project={project()} selected={false} searchQuery="" onSelect={() => {}} />
        <ComponentRow component={component()} selected={false} onSelect={() => {}} />
      </Wrapper>,
    ).container;

    const rows = [
      ...container.querySelectorAll<HTMLElement>('.project-row-body, .component-row-body'),
    ];
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.hasAttribute('aria-pressed'), row.className).toBe(true);
      // A row that ALSO claimed `aria-current` / `aria-selected` would
      // announce twice, in two vocabularies.
      expect(row.hasAttribute('aria-current'), row.className).toBe(false);
      expect(row.hasAttribute('aria-selected'), row.className).toBe(false);
    }
    expect(rows.map((r) => r.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
  });
});

/*
 * ── The other half of A4 — "queue badges" — is NOT changed here ──
 *
 * The audit reported all four queue badges carrying neither
 * `aria-pressed` nor `aria-current`. Measured on the same HEAD in a
 * live Chromium, on the same selector the audit names
 * (`.header-badge.header-badge-clickable`): the ACTIVE badge carries
 * `aria-current="true"`, the other three carry nothing. That is not an
 * omission but the canonical ARIA shape for «the current item of a
 * set» — the attribute marks the one, its absence IS the negative — and
 * `aria-current` rather than `aria-pressed` is right for what the
 * control is: a queue badge does not turn something on and off, it
 * selects which of four queues the Queues column shows, the way a tab
 * does. `HeaderBar.tsx` says so in a comment beside the attribute.
 *
 * It is already pinned, on the rendered header, by
 * `HeaderBar.test.tsx` → «the badge of the queue on screen is marked as
 * current» and «no badge is marked current off the shell». Re-asserting
 * it here would be a second statement of one fact in a file that cannot
 * render the header without duplicating a hundred lines of that file's
 * mocks — so the finding is answered with a measurement and a pointer,
 * not with a change.
 */
