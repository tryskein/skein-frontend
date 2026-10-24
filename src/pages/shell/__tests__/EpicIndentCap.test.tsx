/**
 * The epic children tree does not clamp the LEVEL of a deep row in the
 * component (P-39): the accessibility tree and the keyboard count the
 * real depth. The visual indent cap is the stylesheet's business and is
 * not checked by tests (sk-540.11, owner decision).
 */

import { useState } from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { EpicChildrenTree } from '../details/sections/EpicChildrenTree';
import type { IssueTreeNode, IssueTreeRowItem } from '../../../api/issues';

afterEach(() => {
  cleanup();
});

function n(id: string, depth: number): IssueTreeNode {
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
    } as IssueTreeRowItem,
    depth,
    parentRef: depth === 0 ? null : { id: 'sk-42', edgeType: 'parent-child' },
    isReference: false,
    firstSeenAt: null,
  };
}

function Harness({ rows }: { rows: IssueTreeNode[] }) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set<string>());
  return (
    <MantineProvider>
      <MemoryRouter>
        <EpicChildrenTree
          rows={rows}
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

describe('indent cap — the level is not clamped in the component (P-39)', () => {
  const DEEPEST = 20;

  test('aria-level carries the REAL depth on every level', () => {
    const rows: IssueTreeNode[] = [n('sk-42', 0)];
    for (let depth = 1; depth <= DEEPEST; depth += 1) rows.push(n(`d-${depth}`, depth));
    const { container } = render(<Harness rows={rows} />);

    const items = Array.from(container.querySelectorAll('[role="treeitem"]'));
    expect(items, 'the deep chain is not rendered in full').toHaveLength(DEEPEST);
    const levels = items.map((el) => el.getAttribute('aria-level'));
    expect(levels).toEqual(Array.from({ length: DEEPEST }, (_, i) => String(i + 1)));
    // The deepest row did NOT get a truncated level.
    expect(levels[DEEPEST - 1]).toBe(String(DEEPEST));
  });
});
