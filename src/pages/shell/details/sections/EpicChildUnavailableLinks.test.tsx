/**
 * sk-479 (api contract sk-423) — the sub-row "linked to N tasks in
 * unavailable projects" under an epic section child row, in "List" and in
 * "Tree".
 *
 * Two forms of a tree node:
 *   - new api: there are no hidden entries in `blockers`, the link comes as the number
 *     `unavailableBlockingLinks` of the node (only when above zero);
 *   - old api: there is no number, a hidden blocker is an entry `{redacted: true}`,
 *     and it is included in `item.isBlocked`; the blockers sub-row draws it as
 *     before, and there is no links sub-row.
 */
import { useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import type { IssueTreeNode, IssueTreeRowItem } from '../../../../api/issues';
import i18n, { DEFAULT_LANGUAGE } from '../../../../i18n/config';

const router = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('react-router-dom', async (importActual) => {
  const actual = await importActual<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => router.navigate };
});

import { EpicChildrenList } from './EpicChildrenList';
import { EpicChildrenTree } from './EpicChildrenTree';

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

const NONE = { isLoading: false, tooLarge: false, error: null as unknown, onOpen: () => {} };

function Tree({ rows }: { rows: IssueTreeNode[] }) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set<string>());
  return (
    <EpicChildrenTree
      rows={rows}
      {...NONE}
      epicId="sk-42"
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
    />
  );
}

type Mode = 'list' | 'tree';

function mount(mode: Mode, rows: IssueTreeNode[]) {
  return render(
    <MantineProvider>
      {mode === 'list' ? (
        <EpicChildrenList rows={rows.filter((r) => r.depth > 0)} {...NONE} epicId="sk-42" />
      ) : (
        <Tree rows={rows} />
      )}
    </MantineProvider>,
  );
}

/** A child row by title (in the fixtures it equals the id) and its description carrier. */
function rowOf(container: HTMLElement, mode: Mode, id: string) {
  const title = Array.from(container.querySelectorAll('.epic-child-title')).find(
    (el) => el.textContent === id,
  );
  expect(title, `row ${id} is rendered`).toBeTruthy();
  const row =
    mode === 'list'
      ? (title!.closest('li') as HTMLElement)
      : (title!.closest('[role="treeitem"]') as HTMLElement);
  const describedHost =
    mode === 'list' ? row.querySelector('[aria-describedby], button') : row;
  return { row, describedBy: describedHost?.getAttribute('aria-describedby') ?? null };
}

afterEach(async () => {
  cleanup();
  vi.clearAllMocks();
  if (i18n.language !== DEFAULT_LANGUAGE) await i18n.changeLanguage(DEFAULT_LANGUAGE);
});

describe.each(['list', 'tree'] as const)('mode %s', (mode) => {
  test('new api: blocked only by an unavailable one — the row is not highlighted, no blockers sub-row, a link sub-row is there', () => {
    const rows = [
      n('sk-42', 0),
      n('sk-42.1', 1, { isBlocked: false }, { unavailableBlockingLinks: 2 }),
    ];
    const { container } = mount(mode, rows);
    const { row, describedBy } = rowOf(container, mode, 'sk-42.1');
    expect(row.querySelector('.epic-child-blockers')).toBeNull();
    const links = row.querySelector('.epic-child-unavailable-links');
    expect(links?.textContent).toBe('linked to 2 tasks in projects you cannot access');
    expect(links!.closest('.epic-child-blockers')).toBeNull();
    // Not a button and not in the focus order.
    expect(links!.querySelector('button, [tabindex]')).toBeNull();
    // The screen reader gets it as the row description.
    expect(describedBy).toBe(links!.id);
    expect(row.textContent).not.toContain('blocked:');
  });

  test('new api: a visible blocker and a link — two sub-rows, the description references both', () => {
    const rows = [
      n('sk-42', 0),
      n(
        'sk-42.1',
        1,
        { isBlocked: true },
        {
          blockers: [{ id: 'sk-7', title: 'T7', status: 'open', projectId: 'proj-b' }],
          unavailableBlockingLinks: 1,
        },
      ),
    ];
    const { container } = mount(mode, rows);
    const { row, describedBy } = rowOf(container, mode, 'sk-42.1');
    const blockers = row.querySelector('.epic-child-blockers')!;
    const links = row.querySelector('.epic-child-unavailable-links')!;
    expect(blockers).not.toBeNull();
    expect(blockers.textContent).not.toContain('unavailable');
    expect(links.textContent).toBe('linked to 1 task in projects you cannot access');
    expect(blockers.compareDocumentPosition(links) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(describedBy?.split(' ')).toEqual([
      'epic-child-blockers-desc-sk-42.1',
      links.id,
    ]);
  });

  test('the field is absent (0 for the new api, or the old api) — no sub-row, no description', () => {
    const rows = [n('sk-42', 0), n('sk-42.1', 1)];
    const { container } = mount(mode, rows);
    const { row, describedBy } = rowOf(container, mode, 'sk-42.1');
    expect(row.querySelector('.epic-child-unavailable-links')).toBeNull();
    expect(describedBy).toBeNull();
  });

  test('a closed child — no sub-row', () => {
    const rows = [
      n('sk-42', 0),
      n('sk-42.1', 1, { status: 'closed' }, { unavailableBlockingLinks: 3 }),
    ];
    const { container } = mount(mode, rows);
    expect(
      rowOf(container, mode, 'sk-42.1').row.querySelector('.epic-child-unavailable-links'),
    ).toBeNull();
  });

  test('old api: a hidden entry in isBlocked — the blockers sub-row as before, no link sub-row', () => {
    const rows = [
      n('sk-42', 0),
      n('sk-42.1', 1, { isBlocked: true }, { blockers: [{ redacted: true, id: 'hid-1' }] }),
    ];
    const { container } = mount(mode, rows);
    const { row } = rowOf(container, mode, 'sk-42.1');
    expect(row.querySelector('.epic-child-blockers-line')?.textContent).toBe(
      'blocked: unavailable',
    );
    expect(row.querySelector('.epic-child-unavailable-links')).toBeNull();
    expect(container.innerHTML).not.toContain('hid-1');
  });

  test('ru: pluralization of the sub-row', async () => {
    await i18n.changeLanguage('ru');
    const rows = [
      n('sk-42', 0),
      n('sk-42.1', 1, {}, { unavailableBlockingLinks: 1 }),
      n('sk-42.2', 1, {}, { unavailableBlockingLinks: 3 }),
      n('sk-42.3', 1, {}, { unavailableBlockingLinks: 11 }),
    ];
    const { container } = mount(mode, rows);
    const text = (id: string) =>
      rowOf(container, mode, id).row.querySelector('.epic-child-unavailable-links')?.textContent;
    expect(text('sk-42.1')).toBe('связь с 1 задачей из недоступных проектов');
    expect(text('sk-42.2')).toBe('связь с 3 задачами из недоступных проектов');
    expect(text('sk-42.3')).toBe('связь с 11 задачами из недоступных проектов');
  });
});
