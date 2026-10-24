/**
 * sk-460.7 — the title of a «Tree» row is clamped to three lines on
 * screen (owner decision, 2026-09-17). The clamp cuts what is SHOWN, not
 * what the row CARRIES: the full title stays in the DOM and in the row's
 * accessible name through `epic.openChild`.
 *
 * The quiet way to break that is to truncate the title in the component
 * (`title.slice(0, 60)`): nothing changes on screen, while the screen
 * reader and find-in-page lose the tail. So these tests render the row.
 * The clamp declarations themselves are not checked by tests (sk-540.11,
 * owner decision).
 */

import { useState } from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { EpicChildrenTree } from '../details/sections/EpicChildrenTree';
import type { IssueTreeNode, IssueTreeRowItem } from '../../../api/issues';

const LONG_TITLE =
  'Preparing the network perimeter and security policies of the payment gateway ' +
  'with egress traffic of workers and the API split across separate subnets';

function node(id: string, depth: number, title: string): IssueTreeNode {
  return {
    item: {
      id,
      projectId: 'proj-child',
      version: 1,
      title,
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
    } as IssueTreeRowItem,
    depth,
    parentRef: depth === 0 ? null : { id: 'sk-42', edgeType: 'parent-child' },
    isReference: false,
    firstSeenAt: null,
  };
}

function Harness() {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set<string>());
  return (
    <MantineProvider>
      <MemoryRouter>
        <EpicChildrenTree
          rows={[node('sk-42', 0, 'sk-42'), node('sk-42.1', 1, LONG_TITLE)]}
          isLoading={false}
          tooLarge={false}
          error={null}
          onOpen={() => {}}
          epicId="sk-42"
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
        />
      </MemoryRouter>
    </MantineProvider>
  );
}

afterEach(() => cleanup());

describe('sk-460.7 — the full title stays in the row details', () => {
  test('the title is in the DOM IN FULL: the clamp is visual, not string-based', () => {
    // The most likely way to "fix" the height without the task is to cut the text
    // in the component. On screen there would be no difference, but page
    // search and the screen reader would lose the tail of the title.
    const { container } = render(<Harness />);
    const title = container.querySelector('.epic-tree-row .epic-child-title');
    expect(title, 'the row has no title').not.toBeNull();
    expect(title!.textContent).toBe(LONG_TITLE);
  });

  test('the accessible name of the row carries the title IN FULL', () => {
    // The whole R-16 chain is checked, not one link: `treeitem`
    // refers by `aria-labelledby` to the row content, inside which
    // lies the open button labelled `epic.openChild`, and the label carries
    // the whole title.
    const { container } = render(<Harness />);
    const item = container.querySelector('[role="treeitem"]');
    expect(item, 'the row is not rendered as a treeitem').not.toBeNull();

    const ids = (item!.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
    expect(ids.length, 'the treeitem has no aria-labelledby').toBeGreaterThan(0);

    const named = ids.map((id) => document.getElementById(id));
    for (const el of named) expect(el, 'dangling id in aria-labelledby').not.toBeNull();

    const button = container.querySelector<HTMLElement>('.epic-child-open');
    expect(button, 'the row has no open button').not.toBeNull();
    const label = button!.getAttribute('aria-label') ?? '';
    expect(label).toContain(LONG_TITLE);
    expect(label).toBe(`Open child issue sk-42.1: ${LONG_TITLE}`);

    // …and the button really is inside the node named in `aria-labelledby`:
    // a label that does not reach the row name does not change the row name.
    expect(
      named.some((el) => el!.contains(button)),
      'the button with the title is not among the sources of the row name',
    ).toBe(true);
  });
});
