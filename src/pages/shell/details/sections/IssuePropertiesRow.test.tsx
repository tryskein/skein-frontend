/**
 * sk-421.1 — render tests of the issue card's properties row
 * (`IssuePropertiesRow.tsx`, T014). One file for the render half of the
 * cases that land on the row: the estimate label, and the cases
 * that follow it in this group.
 *
 * Harness:
 *   - `useLayoutState` is mocked: the row only needs `setSelectedIssue`
 *     (parent navigation); `outboxMode` is exposed so a lens test can
 *     flip it.
 *   - `useProjectComponentNames` is mocked and records its arguments, so
 *     a test controls the directory state and can see which project was
 *     asked for.
 *   - i18n is the real bundled instance; tests that need Russian switch
 *     the language and the shared `afterEach` switches it back.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import type { DependencyEdge, DependencyList } from '../../../../api/dependencies';
import type { IssueDetail } from '../../../../api/issues';
import i18n, { DEFAULT_LANGUAGE } from '../../../../i18n/config';
import type { ComponentNameMap } from '../../../../lib/useProjectComponentNames';

const layout = vi.hoisted(() => ({
  setSelectedIssue: vi.fn(),
  outboxMode: false,
}));
vi.mock('../../../../lib/useLayoutState', () => ({
  useLayoutState: () => layout,
}));

// Review F-3 — the parent link navigates by path (`/projects/<pid>/issues/<id>`),
// so the navigation spy is `useNavigate`, not the layout helper.
const router = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('react-router-dom', async (importActual) => {
  const actual = await importActual<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => router.navigate };
});

const directory = vi.hoisted(() => ({
  calls: [] as Array<{ projectId: unknown; componentIds: unknown }>,
  state: { status: 'pending', data: undefined } as {
    status: 'pending' | 'error' | 'success';
    data: ComponentNameMap | undefined;
  },
}));
vi.mock('../../../../lib/useProjectComponentNames', () => ({
  useProjectComponentNames: (projectId: unknown, componentIds: unknown) => {
    directory.calls.push({ projectId, componentIds });
    return directory.state;
  },
}));

import { IssuePropertiesRow } from './IssuePropertiesRow';

// ───────────────────────── fixtures ─────────────────────────

/** An issue with no optional value set. */
function issue(over: Partial<IssueDetail> = {}): IssueDetail {
  return {
    id: 'sk-1',
    projectId: 'proj-b',
    version: 1,
    title: 'task',
    description: '',
    type: 'task',
    priority: 2,
    status: 'open',
    pinned: false,
    source: 'human',
    design: '',
    acceptanceCriteria: '',
    notes: '',
    createdBy: 'u-1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    metadata: {},
    componentIds: [],
    labels: [],
    commentsCount: 0,
    commitRefs: [],
    mentions: [],
    isBlocked: false,
    blockers: [],
    ...over,
  } as IssueDetail;
}

function mountRow(value: IssueDetail) {
  return render(
    <MantineProvider>
      <IssuePropertiesRow
        issue={value}
        projectId={value.projectId}
        dependencies={undefined}
        dependenciesStatus="pending"
      />
    </MantineProvider>,
  );
}

/** Text of one segment's value, found by the segment key. */
function segmentValue(container: HTMLElement, key: string): string | null {
  const seg = container.querySelector(`[data-segment="${key}"]`);
  return seg?.querySelector('.issue-props-value')?.textContent ?? null;
}

afterEach(async () => {
  cleanup();
  vi.clearAllMocks();
  directory.calls = [];
  directory.state = { status: 'pending', data: undefined };
  layout.outboxMode = false;
  if (i18n.language !== DEFAULT_LANGUAGE) {
    await i18n.changeLanguage(DEFAULT_LANGUAGE);
  }
});

// ─────────────── row 33 — estimate in hours and minutes ───────────────

describe('estimate segment — hours and minutes, no days (US-6, row 33)', () => {
  test.each([
    [0, '0 мин'],
    [45, '45 мин'],
    [60, '1 ч'],
    [90, '1 ч 30 мин'],
    [600, '10 ч'],
  ])('ru: %i minutes → «%s»', async (minutes, expected) => {
    await i18n.changeLanguage('ru');
    const { container } = mountRow(issue({ estimatedMinutes: minutes }));
    expect(segmentValue(container, 'estimate')).toBe(expected);
    expect(container.querySelector('[data-segment="estimate"]')?.textContent).toContain(
      'оценка',
    );
  });

  test.each([
    [90, '1 h 30 min'],
    [60, '1 h'],
    [45, '45 min'],
    [0, '0 min'],
    [600, '10 h'],
  ])('en: %i minutes → «%s»', (minutes, expected) => {
    const { container } = mountRow(issue({ estimatedMinutes: minutes }));
    expect(segmentValue(container, 'estimate')).toBe(expected);
  });
});

// ──────────── row 34 — external link: safe rendering (US-12) ────────────

describe('external link segment — safe rendering (US-12, INV-5, SC-008, row 34)', () => {
  function linkSegment(container: HTMLElement): Element | null {
    return container.querySelector('[data-segment="external-ref"]');
  }

  test.each(['http://example.com/a', 'https://example.com/b', 'HTTPS://EXAMPLE.COM/C'])(
    '%s → a link opening in a new tab without opener or referrer',
    (value) => {
      const { container } = mountRow(issue({ externalRef: value }));
      const anchor = linkSegment(container)?.querySelector('a');
      expect(anchor).not.toBeNull();
      expect(anchor!.getAttribute('href')).toBe(value);
      expect(anchor!.getAttribute('target')).toBe('_blank');
      const rel = (anchor!.getAttribute('rel') ?? '').split(/\s+/);
      expect(rel).toContain('noopener');
      expect(rel).toContain('noreferrer');
    },
  );

  test.each([
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'data:text/html,x',
    'mailto:someone@example.com',
    '/relative/path',
    'JIRA-1234',
  ])('%s → text in the segment, no <a> anywhere in the row', (value) => {
    const { container } = mountRow(issue({ externalRef: value }));
    const segment = linkSegment(container);
    expect(segment).not.toBeNull();
    expect(segment!.textContent).toContain(value);
    expect(container.querySelector('a')).toBeNull();
  });

  test.each([
    ['empty', ''],
    ['whitespace only', '    '],
    ['null', null],
  ])('%s → no link segment', (_name, value) => {
    const { container } = mountRow(issue({ externalRef: value }));
    expect(linkSegment(container)).toBeNull();
  });

  test('a long value is truncated, its tooltip carries the full text and the href stays full', () => {
    const long = `https://example.com/${'segment'.repeat(40)}`;
    const { container } = mountRow(issue({ externalRef: long }));
    const segment = linkSegment(container)!;
    const truncate = segment.querySelector('.issue-props-truncate');
    expect(truncate).not.toBeNull();
    const anchor = segment.querySelector('a')!;
    expect(anchor.classList.contains('issue-props-value')).toBe(true);
    expect(anchor.getAttribute('href')).toBe(long);

    // SkeinTooltip opens synchronously on hover and renders in a portal.
    fireEvent.mouseEnter(truncate!);
    const tooltip = document.body.querySelector('[role="tooltip"]');
    expect(tooltip?.textContent).toBe(long);
  });
});

// ───────────── row 35 — source segment (US-10) ─────────────

describe('source segment — labels, context tooltip, unknown value (US-10, row 35)', () => {
  function sourceSegment(container: HTMLElement): Element | null {
    return container.querySelector('[data-segment="source"]');
  }

  test.each([
    ['human', 'человек'],
    ['agent_directed', 'агент по поручению'],
    ['agent_autonomous', 'агент сам'],
  ])('ru: %s → «%s»', async (value, expected) => {
    await i18n.changeLanguage('ru');
    const { container } = mountRow(issue({ source: value as IssueDetail['source'] }));
    expect(segmentValue(container, 'source')).toBe(expected);
    expect(sourceSegment(container)?.textContent).toContain('источник');
  });

  test.each([
    ['human', 'human'],
    ['agent_directed', 'agent on request'],
    ['agent_autonomous', 'agent on its own'],
  ])('en: %s → «%s»', (value, expected) => {
    const { container } = mountRow(issue({ source: value as IssueDetail['source'] }));
    expect(segmentValue(container, 'source')).toBe(expected);
  });

  test('a source context is shown in a tooltip on the segment value', () => {
    const { container } = mountRow(
      issue({ source: 'agent_directed', sourceContext: 'triage sk-421.1 · stage 5' }),
    );
    const value = sourceSegment(container)!.querySelector('.issue-props-value')!;
    fireEvent.mouseEnter(value);
    const tooltip = document.body.querySelector('[role="tooltip"]');
    expect(tooltip?.textContent).toBe('triage sk-421.1 · stage 5');
  });

  test.each([
    ['absent', undefined],
    ['null', null],
    ['whitespace only', '   '],
  ])('no source context (%s) → no tooltip', (_name, context) => {
    const { container } = mountRow(issue({ source: 'human', sourceContext: context }));
    const value = sourceSegment(container)!.querySelector('.issue-props-value')!;
    fireEvent.mouseEnter(value);
    fireEvent.focus(value);
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
  });

  test('a value outside the known set → no segment, the row still renders, raw value not printed', () => {
    const { container } = mountRow(
      issue({ source: 'agent_supervised' as unknown as IssueDetail['source'] }),
    );
    expect(sourceSegment(container)).toBeNull();
    // The row is intact: «updated» is always there.
    expect(container.querySelector('[data-segment="updated"]')).not.toBeNull();
    expect(container.innerHTML).not.toContain('agent_supervised');
  });
});

// ──────── row 38 — accepted / started / updated tail (US-13) ────────

describe('tail segments accepted / started / updated (US-13, row 38)', () => {
  function tail(container: HTMLElement, key: string): HTMLElement | null {
    return container.querySelector(`[data-segment="${key}"]`);
  }

  /**
   * The exact moment is carried the way the close-reason time carries it
   * on the same card: a native `title` on a `<time>`, NOT a SkeinTooltip.
   */
  function expectNativeTimeTooltip(segment: HTMLElement, iso: string, full: string) {
    const time = segment.querySelector('time');
    expect(time).not.toBeNull();
    expect(time!.getAttribute('dateTime')).toBe(iso);
    expect(time!.getAttribute('title')).toBe(full);
    fireEvent.mouseEnter(time!);
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
  }

  test('accepted with the acceptor\'s name: «accepted <name> <time>», muted, native tooltip', async () => {
    await i18n.changeLanguage('ru');
    const { container } = mountRow(
      issue({
        acceptedAt: '2026-01-01T01:02:00Z',
        acceptedBy: 'u-bob',
        acceptedByUsername: 'bob',
      }),
    );
    const seg = tail(container, 'accepted')!;
    expect(seg).not.toBeNull();
    expect(seg.classList.contains('issue-props-seg--muted')).toBe(true);
    expect(seg.querySelector('.issue-props-label')?.textContent).toBe('принята');
    expect(seg.querySelector('.issue-props-value')?.textContent).toBe('bob');
    expectNativeTimeTooltip(seg, '2026-01-01T01:02:00Z', '1 января 2026, 01:02 UTC');
  });

  test('accepted without a known name: «accepted <time>», no name node', async () => {
    await i18n.changeLanguage('ru');
    const { container } = mountRow(
      issue({ acceptedAt: '2026-01-01T01:02:00Z', acceptedByUsername: null }),
    );
    const seg = tail(container, 'accepted')!;
    expect(seg).not.toBeNull();
    expect(seg.querySelector('.issue-props-value')).toBeNull();
    expect(seg.textContent?.startsWith('принята ')).toBe(true);
    expectNativeTimeTooltip(seg, '2026-01-01T01:02:00Z', '1 января 2026, 01:02 UTC');
  });

  test('an acceptance the server set automatically (self-assigned creator) is shown the same way', () => {
    const { container } = mountRow(
      issue({
        createdBy: 'u-self',
        assignee: 'self',
        acceptedAt: '2026-01-01T00:00:00Z',
        acceptedBy: 'u-self',
        acceptedByUsername: 'self',
      }),
    );
    const seg = tail(container, 'accepted')!;
    expect(seg).not.toBeNull();
    expect(seg.classList.contains('issue-props-seg--muted')).toBe(true);
    expect(seg.querySelector('.issue-props-value')?.textContent).toBe('self');
    // The only case in this block that does NOT switch the language:
    // it runs on the default locale, so the English stamp is right here.
    expectNativeTimeTooltip(seg, '2026-01-01T00:00:00Z', '2026-01-01 00:00 UTC');
  });

  test('no acceptance mark → no accepted segment', () => {
    const { container } = mountRow(issue({ acceptedAt: null }));
    expect(tail(container, 'accepted')).toBeNull();
  });

  test('started: «started <time>», muted, native tooltip; absent when not started', async () => {
    await i18n.changeLanguage('ru');
    const started = mountRow(issue({ startedAt: '2026-01-03T04:05:00Z' }));
    const seg = tail(started.container, 'started')!;
    expect(seg).not.toBeNull();
    expect(seg.classList.contains('issue-props-seg--muted')).toBe(true);
    expect(seg.querySelector('.issue-props-label')?.textContent).toBe('начата');
    expectNativeTimeTooltip(seg, '2026-01-03T04:05:00Z', '3 января 2026, 04:05 UTC');
    started.unmount();

    const notStarted = mountRow(issue({ startedAt: null }));
    expect(tail(notStarted.container, 'started')).toBeNull();
  });

  test('updated is always there: «updated <time>», muted, native tooltip, last in the row', async () => {
    await i18n.changeLanguage('ru');
    const { container } = mountRow(issue({ updatedAt: '2026-01-02T03:04:00Z' }));
    const seg = tail(container, 'updated')!;
    expect(seg).not.toBeNull();
    expect(seg.classList.contains('issue-props-seg--muted')).toBe(true);
    expect(seg.querySelector('.issue-props-label')?.textContent).toBe('изменена');
    expectNativeTimeTooltip(seg, '2026-01-02T03:04:00Z', '2 января 2026, 03:04 UTC');
    const items = container.querySelectorAll('[role="listitem"]');
    expect(items[items.length - 1]).toBe(seg);
  });

  test('only the three tail segments are muted', () => {
    const { container } = mountRow(
      issue({
        dueAt: '2030-01-01T12:00:00Z',
        acceptedAt: '2026-01-01T01:02:00Z',
        startedAt: '2026-01-01T02:00:00Z',
      }),
    );
    const muted = Array.from(container.querySelectorAll('.issue-props-seg--muted')).map((el) =>
      el.getAttribute('data-segment'),
    );
    expect(muted).toEqual(['accepted', 'started', 'updated']);
  });
});

// ──────── row 39 — components: names, archive, partial data (US-3) ────────

describe('components segment — names from the issue project directory (US-3, INV-4, row 39)', () => {
  const ID_API = 'cmp-0001-api';
  const ID_WEB = 'cmp-0002-web';
  const ID_OLD = 'cmp-0003-old';
  const ID_GONE = 'cmp-0004-gone';

  function directoryOf(
    entries: Array<[string, string, boolean]>,
  ): ComponentNameMap {
    return new Map(entries.map(([id, name, archived]) => [id, { name, archived }]));
  }

  function componentsSegment(container: HTMLElement): HTMLElement | null {
    return container.querySelector('[data-segment="components"]');
  }

  /** Open every tooltip the row offers, then return the whole document. */
  function bodyWithTooltipsOpen(container: HTMLElement): string {
    container.querySelectorAll('.issue-props-truncate, .issue-props-value').forEach((el) => {
      fireEvent.mouseEnter(el);
      fireEvent.focus(el);
    });
    return document.body.innerHTML;
  }

  function expectNoComponentIds(html: string) {
    for (const id of [ID_API, ID_WEB, ID_OLD, ID_GONE]) {
      expect(html).not.toContain(id);
    }
  }

  test('the directory is asked for the project passed in (the issue\'s own, not the tree\'s)', () => {
    directory.state = { status: 'success', data: directoryOf([[ID_API, 'api', false]]) };
    mountRow(issue({ projectId: 'proj-b', componentIds: [ID_API] }));
    expect(directory.calls.length).toBeGreaterThan(0);
    for (const call of directory.calls) {
      expect(call.projectId).toBe('proj-b');
      expect(call.componentIds).toEqual([ID_API]);
    }
  });

  test('names in the issue\'s order, comma-separated, not clickable', async () => {
    await i18n.changeLanguage('ru');
    directory.state = {
      status: 'success',
      data: directoryOf([
        [ID_API, 'api', false],
        [ID_WEB, 'web', false],
      ]),
    };
    const { container } = mountRow(issue({ componentIds: [ID_WEB, ID_API] }));
    const seg = componentsSegment(container)!;
    expect(seg).not.toBeNull();
    expect(seg.querySelector('.issue-props-label')?.textContent).toBe('компоненты');
    expect(seg.querySelector('.issue-props-value')?.textContent).toBe('web, api');
    expect(seg.querySelector('button, a')).toBeNull();

    fireEvent.click(seg);
    expect(router.navigate).not.toHaveBeenCalled();
    expectNoComponentIds(bodyWithTooltipsOpen(container));
  });

  test('an archived component keeps its name with a muted «archived» mark', async () => {
    await i18n.changeLanguage('ru');
    directory.state = {
      status: 'success',
      data: directoryOf([
        [ID_API, 'api', false],
        [ID_OLD, 'legacy', true],
      ]),
    };
    const { container } = mountRow(issue({ componentIds: [ID_API, ID_OLD] }));
    const seg = componentsSegment(container)!;
    expect(seg.querySelector('.issue-props-value')?.textContent).toBe('api, legacy архив');
    const mark = seg.querySelector('.issue-props-archived');
    expect(mark?.textContent?.trim()).toBe('архив');
    // One mark, one spelling: the full-text tooltip reads exactly like the row.
    fireEvent.mouseEnter(seg.querySelector('.issue-props-truncate')!);
    expect(document.body.querySelector('[role="tooltip"]')?.textContent).toBe(
      'api, legacy архив',
    );
    expectNoComponentIds(bodyWithTooltipsOpen(container));
  });

  test('directory not received yet → no segment, no ids anywhere', () => {
    directory.state = { status: 'pending', data: undefined };
    const { container } = mountRow(issue({ componentIds: [ID_API, ID_WEB] }));
    expect(componentsSegment(container)).toBeNull();
    expectNoComponentIds(bodyWithTooltipsOpen(container));
  });

  test('directory failed → «components: N», no names and no ids', async () => {
    await i18n.changeLanguage('ru');
    directory.state = { status: 'error', data: undefined };
    const { container } = mountRow(issue({ componentIds: [ID_API, ID_WEB, ID_OLD] }));
    const seg = componentsSegment(container)!;
    expect(seg).not.toBeNull();
    expect(seg.textContent).toBe('компоненты: 3');
    expectNoComponentIds(bodyWithTooltipsOpen(container));
  });

  test('an id missing from the directory → known names plus «+N», no ids', async () => {
    await i18n.changeLanguage('ru');
    directory.state = { status: 'success', data: directoryOf([[ID_API, 'api', false]]) };
    const { container } = mountRow(issue({ componentIds: [ID_API, ID_GONE] }));
    const seg = componentsSegment(container)!;
    expect(seg.querySelector('.issue-props-value')?.textContent).toBe('api, +1');
    expectNoComponentIds(bodyWithTooltipsOpen(container));
  });

  test('no components → no segment', () => {
    directory.state = { status: 'success', data: directoryOf([[ID_API, 'api', false]]) };
    const { container } = mountRow(issue({ componentIds: [] }));
    expect(componentsSegment(container)).toBeNull();
  });
});

// ──────── row 42 — parent segment in every dependency load state (US-4) ────────

describe('parent segment — every state of the dependency list (US-4, SC-014, row 42)', () => {
  const PARENT_ID = 'sk-900';
  const PARENT_TITLE = 'Parent epic';
  const PARENT_PROJECT = 'proj-parent';
  const OLD_PARENT_ID = 'sk-800';
  const OLD_PARENT_TITLE = 'Former parent';

  function parentEdge(
    toId: string,
    title: string,
    over: Partial<DependencyEdge> = {},
  ): DependencyEdge {
    return {
      type: 'parent-child',
      fromId: 'sk-1',
      toId,
      version: 1,
      createdAt: '2026-01-01T00:00:00Z',
      metadata: {},
      issue: {
        id: toId,
        projectId: PARENT_PROJECT,
        title,
        status: 'open',
        priority: 2,
        type: 'epic',
      },
      ...over,
    } as DependencyEdge;
  }

  function mountWithDeps(
    value: IssueDetail,
    dependencies: DependencyList | undefined,
    status: 'pending' | 'error' | 'success',
  ) {
    return render(
      <MantineProvider>
        <IssuePropertiesRow
          issue={value}
          projectId={value.projectId}
          dependencies={dependencies}
          dependenciesStatus={status}
        />
      </MantineProvider>,
    );
  }

  function parentSegment(container: HTMLElement): HTMLElement | null {
    return container.querySelector('[data-segment="parent"]');
  }

  /** Neither the id nor the title of the given parent is anywhere on the row. */
  function expectParentHidden(container: HTMLElement, id: string, title: string) {
    expect(container.innerHTML).not.toContain(id);
    expect(container.innerHTML).not.toContain(title);
  }

  test('visible parent → id and title; clicking opens the parent card in ITS project', async () => {
    await i18n.changeLanguage('ru');
    const { container } = mountWithDeps(
      issue({ parentIdCurrent: PARENT_ID }),
      { outgoing: [parentEdge(PARENT_ID, PARENT_TITLE)], incoming: [] },
      'success',
    );
    const seg = parentSegment(container)!;
    expect(seg).not.toBeNull();
    expect(seg.querySelector('.issue-props-label')?.textContent).toBe('родитель');
    const button = seg.querySelector('button')!;
    expect(button.textContent).toBe(`${PARENT_ID} ${PARENT_TITLE}`);
    fireEvent.click(button);
    expect(router.navigate).toHaveBeenCalledWith(`/projects/${PARENT_PROJECT}/issues/${PARENT_ID}`);
  });

  test('parent in a project the reader cannot see → lock and «unavailable», no id, no title, not clickable', async () => {
    await i18n.changeLanguage('ru');
    const { container } = mountWithDeps(
      issue({ parentIdCurrent: PARENT_ID }),
      {
        outgoing: [parentEdge(PARENT_ID, PARENT_TITLE, { redacted: true, issue: undefined })],
        incoming: [],
      },
      'success',
    );
    const seg = parentSegment(container)!;
    expect(seg).not.toBeNull();
    expect(seg.querySelector('svg')).not.toBeNull();
    expect(seg.querySelector('.issue-props-value')?.textContent).toBe('недоступно');
    expect(seg.querySelector('button, a')).toBeNull();
    expectParentHidden(container, PARENT_ID, PARENT_TITLE);
  });

  test('dependencies not received yet → no segment, no id or title', () => {
    const { container } = mountWithDeps(issue({ parentIdCurrent: PARENT_ID }), undefined, 'pending');
    expect(parentSegment(container)).toBeNull();
    expectParentHidden(container, PARENT_ID, PARENT_TITLE);
  });

  test('dependencies failed → «failed to load», no id or title (distinct from «not yet»)', async () => {
    await i18n.changeLanguage('ru');
    const { container } = mountWithDeps(issue({ parentIdCurrent: PARENT_ID }), undefined, 'error');
    const seg = parentSegment(container)!;
    expect(seg).not.toBeNull();
    expect(seg.querySelector('.issue-props-value')?.textContent).toBe('не загрузилось');
    expectParentHidden(container, PARENT_ID, PARENT_TITLE);
  });

  test('received, but no edge to the current parent → no segment (e.g. right after a re-parent)', () => {
    const { container } = mountWithDeps(
      issue({ parentIdCurrent: PARENT_ID }),
      { outgoing: [parentEdge(OLD_PARENT_ID, OLD_PARENT_TITLE)], incoming: [] },
      'success',
    );
    expect(parentSegment(container)).toBeNull();
    expectParentHidden(container, PARENT_ID, PARENT_TITLE);
    expectParentHidden(container, OLD_PARENT_ID, OLD_PARENT_TITLE);
  });

  test('two parent-child edges (previous and current parent) → the CURRENT one is shown', () => {
    const { container } = mountWithDeps(
      issue({ parentIdCurrent: PARENT_ID }),
      {
        // The stale edge comes FIRST: "the first parent-child edge" is wrong.
        outgoing: [
          parentEdge(OLD_PARENT_ID, OLD_PARENT_TITLE),
          parentEdge(PARENT_ID, PARENT_TITLE),
        ],
        incoming: [],
      },
      'success',
    );
    const seg = parentSegment(container)!;
    expect(seg.querySelector('button')?.textContent).toBe(`${PARENT_ID} ${PARENT_TITLE}`);
    expectParentHidden(container, OLD_PARENT_ID, OLD_PARENT_TITLE);
  });

  // sk-674.18 T055 — the lead's decision on T009 (the supplement to
  // sk-698.2): skein-api serves neither the real id of a hidden parent (the
  // hidden end of a redacted edge is a synthetic `hidden-<k>`) nor
  // `parentIdCurrent` for an unavailable parent. The lock follows the
  // presence of the redacted parent-child edge.
  test('hidden parent: no parentIdCurrent, a redacted parent-child edge to hidden-<k> → lock and «unavailable»', async () => {
    await i18n.changeLanguage('ru');
    const { container } = mountWithDeps(
      issue({ parentIdCurrent: undefined }),
      {
        outgoing: [parentEdge('hidden-1', '', { redacted: true, issue: undefined })],
        incoming: [],
      },
      'success',
    );
    // «Parent unavailable», with nothing to open and the synthetic id nowhere.
    expect(screen.getByText(i18n.t('details:properties.parentUnavailable'))).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(container.innerHTML).not.toContain('hidden-1');
  });

  test('a redacted edge of another type is no parent → no segment', () => {
    const { container } = mountWithDeps(
      issue({ parentIdCurrent: undefined }),
      {
        outgoing: [parentEdge('hidden-1', '', { type: 'blocks', redacted: true, issue: undefined })],
        incoming: [],
      },
      'success',
    );
    expect(parentSegment(container)).toBeNull();
  });

  test('no parent → no segment', () => {
    const { container } = mountWithDeps(
      issue({ parentIdCurrent: null }),
      { outgoing: [], incoming: [] },
      'success',
    );
    expect(parentSegment(container)).toBeNull();
  });
});

// ──────── rows 36–37 — composition, order, separators, empty values (US-1) ────────

describe('row composition — order, boundaries, empty values (US-1, US-2, US-10, INV-6, SC-001, SC-002, rows 36–37)', () => {
  const ORDER = [
    'parent',
    'labels',
    'components',
    'due',
    'estimate',
    'defer-until',
    'source',
    'external-ref',
    'claim',
    'accepted',
    'started',
    'updated',
  ];
  const PARENT_ID = 'sk-700';
  const COMPONENT_ID = 'cmp-9000';
  /** A value outside the known source set: the source segment disappears. */
  const UNKNOWN_SOURCE = 'agent_future' as unknown as IssueDetail['source'];

  const parentDeps: DependencyList = {
    outgoing: [
      {
        type: 'parent-child',
        fromId: 'sk-1',
        toId: PARENT_ID,
        version: 1,
        createdAt: '2026-01-01T00:00:00Z',
        metadata: {},
        issue: {
          id: PARENT_ID,
          projectId: 'proj-b',
          title: 'Parent',
          status: 'open',
          priority: 2,
          type: 'epic',
        },
      } as DependencyEdge,
    ],
    incoming: [],
  };

  function mount(value: IssueDetail, deps: DependencyList | undefined = undefined) {
    return render(
      <MantineProvider>
        <IssuePropertiesRow
          issue={value}
          projectId={value.projectId}
          dependencies={deps}
          dependenciesStatus={deps ? 'success' : 'pending'}
        />
      </MantineProvider>,
    );
  }

  function segmentKeys(container: HTMLElement): string[] {
    return Array.from(container.querySelectorAll('[role="listitem"]')).map(
      (el) => el.getAttribute('data-segment') ?? '',
    );
  }

  function separatorCount(container: HTMLElement): number {
    return container.querySelectorAll('.issue-props-sep').length;
  }

  /** Every label printed has a value-bearing word — no empty caption. */
  function expectNoEmptyLabels(container: HTMLElement) {
    container.querySelectorAll('.issue-props-label').forEach((label) => {
      expect(label.textContent?.trim()).not.toBe('');
    });
  }

  const longLabel = 'x'.repeat(120);

  function everything(): IssueDetail {
    return issue({
      parentIdCurrent: PARENT_ID,
      labels: ['backend', longLabel],
      componentIds: [COMPONENT_ID],
      dueAt: '2030-01-10T12:00:00Z',
      estimatedMinutes: 90,
      deferUntil: '2030-01-05T12:00:00Z',
      source: 'agent_directed',
      sourceContext: 'context',
      externalRef: 'https://example.com/ticket/1',
      lockedBy: 'mcp-session-xyz',
      lockedByUsername: 'agent-a',
      lockedAt: '2026-01-02T10:00:00Z',
      acceptedAt: '2026-01-01T01:00:00Z',
      acceptedByUsername: 'bob',
      startedAt: '2026-01-01T02:00:00Z',
    });
  }

  // ── row 36 ──

  test('all values set → 12 segments in the spec order, each its own listitem, separators between them', () => {
    directory.state = {
      status: 'success',
      data: new Map([[COMPONENT_ID, { name: 'api', archived: false }]]),
    };
    const { container } = mount(everything(), parentDeps);

    expect(segmentKeys(container)).toEqual(ORDER);
    expect(separatorCount(container)).toBe(11);
    // The separators are the row's own nodes, never inside a segment.
    for (const seg of Array.from(container.querySelectorAll('[role="listitem"]'))) {
      expect(seg.textContent).not.toContain('·');
      expect(seg.querySelector('.issue-props-sep')).toBeNull();
    }
    expect(container.querySelector('[role="list"]')?.querySelectorAll(':scope > .issue-props-sep').length)
      .toBe(11);
    expectNoEmptyLabels(container);
  });

  test('labels: comma-separated in response order, not clickable; a value without spaces is truncated with a full-text tooltip', () => {
    const { container } = mount(issue({ labels: ['zeta', 'alpha', longLabel] }));
    const seg = container.querySelector('[data-segment="labels"]')!;
    const full = `zeta, alpha, ${longLabel}`;
    expect(seg.querySelector('.issue-props-value')?.textContent).toBe(full);
    expect(seg.querySelector('button, a')).toBeNull();

    const truncate = seg.querySelector('.issue-props-truncate');
    expect(truncate).not.toBeNull();
    fireEvent.mouseEnter(truncate!);
    expect(document.body.querySelector('[role="tooltip"]')?.textContent).toBe(full);
  });

  // ── row 37 ──

  test('no optional values, known source → exactly «source» and «updated», one separator, no empty label', () => {
    const { container } = mount(issue());
    expect(segmentKeys(container)).toEqual(['source', 'updated']);
    expect(separatorCount(container)).toBe(1);
    expectNoEmptyLabels(container);
  });

  test('no optional values, source outside the known set → exactly «updated», no separator', () => {
    const { container } = mount(issue({ source: UNKNOWN_SOURCE }));
    expect(segmentKeys(container)).toEqual(['updated']);
    expect(separatorCount(container)).toBe(0);
    expectNoEmptyLabels(container);
  });

  const exactlyOne: Array<[string, Partial<IssueDetail>, boolean]> = [
    ['parent', { parentIdCurrent: PARENT_ID }, true],
    ['labels', { labels: ['one'] }, false],
    ['components', { componentIds: [COMPONENT_ID] }, false],
    ['due', { dueAt: '2030-01-10T12:00:00Z' }, false],
    ['estimate', { estimatedMinutes: 0 }, false],
    ['defer-until', { deferUntil: '2030-01-05T12:00:00Z' }, false],
    ['external-ref', { externalRef: 'JIRA-1' }, false],
    ['claim', { lockedBy: 'mcp-session-1', lockedAt: '2026-01-02T10:00:00Z' }, false],
    ['accepted', { acceptedAt: '2026-01-01T01:00:00Z' }, false],
    ['started', { startedAt: '2026-01-01T02:00:00Z' }, false],
  ];

  test.each(exactlyOne)(
    'exactly one optional value set (%s), over an unknown source → that segment and «updated», one separator',
    (key, over, needsDeps) => {
      directory.state = {
        status: 'success',
        data: new Map([[COMPONENT_ID, { name: 'api', archived: false }]]),
      };
      const { container } = mount(
        issue({ source: UNKNOWN_SOURCE, ...over }),
        needsDeps ? parentDeps : undefined,
      );
      expect(segmentKeys(container)).toEqual([key, 'updated']);
      expect(separatorCount(container)).toBe(1);
      expectNoEmptyLabels(container);
    },
  );

  test.each([
    ['labels', { labels: [] }],
    ['components', { componentIds: [] }],
    ['due', { dueAt: null }],
    ['estimate', { estimatedMinutes: null }],
    ['defer-until', { deferUntil: null }],
    ['external-ref', { externalRef: '' }],
    ['claim', { lockedBy: null, lockedAt: null }],
    ['accepted', { acceptedAt: null }],
    ['started', { startedAt: null }],
  ] as Array<[string, Partial<IssueDetail>]>)(
    'an empty value (%s) draws no segment, no caption, no separator',
    (key, over) => {
      const { container } = mount(issue({ source: UNKNOWN_SOURCE, ...over }));
      expect(container.querySelector(`[data-segment="${key}"]`)).toBeNull();
      expect(segmentKeys(container)).toEqual(['updated']);
      expect(separatorCount(container)).toBe(0);
    },
  );
});

// ──────── row 43 — warning highlight by status (US-6, US-7) ────────
//
// Zone and "now": the zone is pinned for this block
// only (restored exactly afterwards — `delete` when there was none) with an
// offset self-check first; this is a RENDER row, so only the clock is faked
// (`toFake: ['Date']`) — full fake timers would stall Testing Library.
// Pacific/Honolulu (UTC−10, no DST) is the discriminating zone: a date that
// is still "today" locally is already "tomorrow" in UTC.

describe('warning highlight — overdue due date and passed defer-until by status (US-6, US-7, row 43)', () => {
  const env = (globalThis as { process?: { env: Record<string, string | undefined> } })
    .process!.env;
  const hadTz = Object.prototype.hasOwnProperty.call(env, 'TZ');
  const previousTz = env.TZ;

  beforeAll(() => {
    env.TZ = 'Pacific/Honolulu';
  });
  afterAll(() => {
    if (hadTz) env.TZ = previousTz;
    else delete env.TZ;
  });

  // now = 2026-03-09 23:59:30 in Honolulu; UTC is already 2026-03-10.
  const NOW = '2026-03-10T09:59:30Z';
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** 2026-03-08 23:00 local — yesterday's local day: over. */
  const YESTERDAY = '2026-03-09T09:00:00Z';
  /** 2026-03-09 10:00 local — today's local day: not over. */
  const TODAY = '2026-03-09T20:00:00Z';
  /** 2026-03-09 23:59 local — still today, though UTC says 2026-03-10. */
  const TODAY_2359_LOCAL = '2026-03-10T09:59:00Z';
  /** 2026-03-11 local — a future day. */
  const FUTURE = '2026-03-11T22:00:00Z';

  function warned(container: HTMLElement, key: string): boolean {
    const seg = container.querySelector(`[data-segment="${key}"]`);
    expect(seg, `segment ${key} is drawn`).not.toBeNull();
    return seg!.classList.contains('is-warn');
  }

  test('zone self-check — the block really runs in Honolulu', () => {
    expect(new Date('2026-01-15T12:00:00Z').getTimezoneOffset()).toBe(600);
    expect(new Date().toISOString()).toBe('2026-03-10T09:59:30.000Z');
  });

  test.each([
    ['open', YESTERDAY, true],
    ['in_progress', YESTERDAY, true],
    ['deferred', YESTERDAY, true],
    ['closed', YESTERDAY, false],
    ['standing', YESTERDAY, false],
    ['open', TODAY, false],
    ['in_progress', TODAY, false],
    ['deferred', TODAY, false],
    ['closed', TODAY, false],
    ['standing', TODAY, false],
    ['open', FUTURE, false],
  ] as Array<[IssueDetail['status'], string, boolean]>)(
    'due date: status %s, due %s → highlighted: %s',
    (status, dueAt, expected) => {
      const { container } = mountRow(issue({ status, dueAt }));
      expect(warned(container, 'due')).toBe(expected);
    },
  );

  test('a due date at 23:59 local today (already tomorrow in UTC) is not highlighted', () => {
    const { container } = mountRow(issue({ status: 'open', dueAt: TODAY_2359_LOCAL }));
    expect(segmentValue(container, 'due')).toBe('2026-03-09');
    expect(warned(container, 'due')).toBe(false);
  });

  test.each([
    ['deferred', YESTERDAY, true],
    ['open', YESTERDAY, false],
    ['in_progress', YESTERDAY, false],
    ['closed', YESTERDAY, false],
    ['standing', YESTERDAY, false],
    ['deferred', TODAY, false],
    ['deferred', TODAY_2359_LOCAL, false],
    ['deferred', FUTURE, false],
  ] as Array<[IssueDetail['status'], string, boolean]>)(
    'defer-until: status %s, date %s → highlighted: %s',
    (status, deferUntil, expected) => {
      const { container } = mountRow(issue({ status, deferUntil }));
      expect(warned(container, 'defer-until')).toBe(expected);
    },
  );
});

// ──────── row 44 — claim segment: holder's name, time, no session id (US-8) ────────
//
// Same zone/clock harness as row 43 (ZONE-FIX, render row → `toFake:
// ['Date']`). The time strings are EXACT for the pinned moment.
// sk-551.28 — the claim time is on the product clock (UTC, the zone
// stated), so the pinned zone must NOT show through: the moments are
// chosen where the reader's wall would say another hour or another day.

describe('claim segment — holder name, claim time, never the session id (US-8, INV-4, SC-012, row 44)', () => {
  const env = (globalThis as { process?: { env: Record<string, string | undefined> } })
    .process!.env;
  const hadTz = Object.prototype.hasOwnProperty.call(env, 'TZ');
  const previousTz = env.TZ;

  beforeAll(() => {
    env.TZ = 'Pacific/Honolulu';
  });
  afterAll(() => {
    if (hadTz) env.TZ = previousTz;
    else delete env.TZ;
  });

  // now = 2026-03-09 23:59:30 in Honolulu; UTC is already 2026-03-10.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-10T09:59:30Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const SESSION = 'mcp-session-7f3a9c01-dead-beef';
  /** Today in UTC (2026-03-09 14:30 local — yesterday on the wall). */
  const CLAIMED_TODAY = '2026-03-10T00:30:00Z';
  /** Yesterday in UTC (2026-03-09 00:30 local — today on the wall). */
  const CLAIMED_YESTERDAY = '2026-03-09T10:30:00Z';

  function claimSegment(container: HTMLElement): HTMLElement | null {
    return container.querySelector('[data-segment="claim"]');
  }

  /** Open every tooltip the row offers, then return the whole document. */
  function bodyWithTooltipsOpen(container: HTMLElement): string {
    container
      .querySelectorAll('.issue-props-truncate, .issue-props-value, time')
      .forEach((el) => {
        fireEvent.mouseEnter(el);
        fireEvent.focus(el);
      });
    return document.body.innerHTML;
  }

  test('zone self-check — the block really runs in Honolulu', () => {
    expect(new Date('2026-01-15T12:00:00Z').getTimezoneOffset()).toBe(600);
  });

  test('with the holder\'s name (ru): «claimed by agent <name> since <time>», the time in UTC with the zone said', async () => {
    await i18n.changeLanguage('ru');
    const { container } = mountRow(
      issue({ lockedBy: SESSION, lockedByUsername: 'worker', lockedAt: CLAIMED_TODAY }),
    );
    const seg = claimSegment(container)!;
    expect(seg).not.toBeNull();
    expect(seg.textContent).toBe('захвачена агентом worker с 00:30 UTC');
    expect(seg.textContent).not.toContain('·');
  });

  test('with the holder\'s name (en): «claimed by agent <name> since <time>»', () => {
    const { container } = mountRow(
      issue({ lockedBy: SESSION, lockedByUsername: 'worker', lockedAt: CLAIMED_TODAY }),
    );
    expect(claimSegment(container)!.textContent).toBe('claimed by agent worker since 00:30 UTC');
  });

  test('the time is its own element with the full UTC stamp as a native tooltip', () => {
    const { container } = mountRow(
      issue({ lockedBy: SESSION, lockedByUsername: 'worker', lockedAt: CLAIMED_TODAY }),
    );
    const time = claimSegment(container)!.querySelector('time')!;
    expect(time).not.toBeNull();
    expect(time.textContent).toBe('00:30 UTC');
    expect(time.getAttribute('dateTime')).toBe(CLAIMED_TODAY);
    expect(time.getAttribute('title')).toBe('2026-03-10 00:30 UTC');
  });

  test('claimed on an earlier UTC day → date and time in UTC', async () => {
    await i18n.changeLanguage('ru');
    const { container } = mountRow(
      issue({ lockedBy: SESSION, lockedByUsername: 'worker', lockedAt: CLAIMED_YESTERDAY }),
    );
    expect(claimSegment(container)!.textContent).toBe('захвачена агентом worker с 9 марта 2026, 10:30 UTC');
  });

  test('no holder name from the server → «claimed by agent since <time>», and the session id is nowhere (INV-4)', async () => {
    await i18n.changeLanguage('ru');
    const { container } = mountRow(
      issue({ lockedBy: SESSION, lockedByUsername: null, lockedAt: CLAIMED_TODAY }),
    );
    const seg = claimSegment(container)!;
    expect(seg.textContent).toBe('захвачена агентом с 00:30 UTC');
    expect(bodyWithTooltipsOpen(container)).not.toContain(SESSION);
  });

  test('with a name, the session id is also nowhere in text, attributes or open tooltips (INV-4)', () => {
    const { container } = mountRow(
      issue({ lockedBy: SESSION, lockedByUsername: 'worker', lockedAt: CLAIMED_TODAY }),
    );
    expect(bodyWithTooltipsOpen(container)).not.toContain(SESSION);
  });

  test('not claimed → no claim segment', () => {
    const { container } = mountRow(
      issue({ lockedBy: null, lockedByUsername: null, lockedAt: null }),
    );
    expect(claimSegment(container)).toBeNull();
  });
});

// ──────── row 43, second zone — Asia/Tokyo (ZONE-FIX item 3, item 4) ────────
//
// The positive-offset boundary: just after local midnight UTC is still the
// PREVIOUS day. A date at 23:59 local yesterday sits on the same UTC day as
// "now", so a day rule read in UTC would call it "today" and not highlight
// it. Render row → only the clock is faked (`toFake: ['Date']`, item 7).

describe('warning highlight — Asia/Tokyo boundary (US-6, US-7, row 43)', () => {
  const env = (globalThis as { process?: { env: Record<string, string | undefined> } })
    .process!.env;
  const hadTz = Object.prototype.hasOwnProperty.call(env, 'TZ');
  const previousTz = env.TZ;

  beforeAll(() => {
    env.TZ = 'Asia/Tokyo';
  });
  afterAll(() => {
    if (hadTz) env.TZ = previousTz;
    else delete env.TZ;
  });

  // now = 2026-03-10 00:45 in Tokyo; UTC is still 2026-03-09 15:45.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-09T15:45:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** 2026-03-09 23:59 local — yesterday locally, the SAME UTC day as now. */
  const YESTERDAY_LOCAL_SAME_UTC_DAY = '2026-03-09T14:59:00Z';
  /** 2026-03-10 00:30 local — today locally (UTC says the 9th). */
  const TODAY_LOCAL = '2026-03-09T15:30:00Z';

  function warned(container: HTMLElement, key: string): boolean {
    const seg = container.querySelector(`[data-segment="${key}"]`);
    expect(seg, `segment ${key} is drawn`).not.toBeNull();
    return seg!.classList.contains('is-warn');
  }

  test('zone self-check — the block really runs in Tokyo', () => {
    expect(new Date('2026-01-15T12:00:00Z').getTimezoneOffset()).toBe(-540);
    expect(new Date().toISOString()).toBe('2026-03-09T15:45:00.000Z');
  });

  test.each([
    ['open', YESTERDAY_LOCAL_SAME_UTC_DAY, true],
    ['closed', YESTERDAY_LOCAL_SAME_UTC_DAY, false],
    ['standing', YESTERDAY_LOCAL_SAME_UTC_DAY, false],
    ['open', TODAY_LOCAL, false],
  ] as Array<[IssueDetail['status'], string, boolean]>)(
    'due date: status %s, due %s → highlighted: %s',
    (status, dueAt, expected) => {
      const { container } = mountRow(issue({ status, dueAt }));
      expect(warned(container, 'due')).toBe(expected);
    },
  );

  test('the date shown is the local calendar day', () => {
    const { container } = mountRow(issue({ status: 'open', dueAt: YESTERDAY_LOCAL_SAME_UTC_DAY }));
    expect(segmentValue(container, 'due')).toBe('2026-03-09');
  });

  test.each([
    ['deferred', YESTERDAY_LOCAL_SAME_UTC_DAY, true],
    ['open', YESTERDAY_LOCAL_SAME_UTC_DAY, false],
    ['deferred', TODAY_LOCAL, false],
  ] as Array<[IssueDetail['status'], string, boolean]>)(
    'defer-until: status %s, date %s → highlighted: %s',
    (status, deferUntil, expected) => {
      const { container } = mountRow(issue({ status, deferUntil }));
      expect(warned(container, 'defer-until')).toBe(expected);
    },
  );
});

// ──────── row 44, second zone — Asia/Tokyo (ZONE-FIX item 3, item 4) ────────
//
// «Today» for the claim moment in a positive-offset zone: just after local
// midnight UTC is still the previous day. sk-551.28 — the claim is on the
// product clock (UTC, stated), so «today» is the UTC day: a claim at 23:59
// local yesterday is on the SAME UTC day as "now" and prints only the UTC
// time, where the old reader's-zone rule printed date and time. Exact
// strings for the pinned moment. Render row → `toFake: ['Date']` (item 7).

describe('claim segment — Asia/Tokyo boundary (US-8, row 44)', () => {
  const env = (globalThis as { process?: { env: Record<string, string | undefined> } })
    .process!.env;
  const hadTz = Object.prototype.hasOwnProperty.call(env, 'TZ');
  const previousTz = env.TZ;

  beforeAll(() => {
    env.TZ = 'Asia/Tokyo';
  });
  afterAll(() => {
    if (hadTz) env.TZ = previousTz;
    else delete env.TZ;
  });

  // now = 2026-03-10 00:45 in Tokyo; UTC is still 2026-03-09 15:45.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-09T15:45:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const SESSION = 'mcp-session-tokyo-0001';
  /** 2026-03-10 00:30 local — today locally, while UTC says the 9th. */
  const CLAIMED_TODAY_LOCAL = '2026-03-09T15:30:00Z';
  /** 2026-03-09 23:59 local — yesterday locally, the SAME UTC day as now. */
  const CLAIMED_YESTERDAY_LOCAL = '2026-03-09T14:59:00Z';

  function claimSegment(container: HTMLElement): HTMLElement | null {
    return container.querySelector('[data-segment="claim"]');
  }

  test('zone self-check — the block really runs in Tokyo', () => {
    expect(new Date('2026-01-15T12:00:00Z').getTimezoneOffset()).toBe(-540);
    expect(new Date().toISOString()).toBe('2026-03-09T15:45:00.000Z');
  });

  test('claimed just after local midnight → UTC time of day; full UTC stamp in the native tooltip', async () => {
    await i18n.changeLanguage('ru');
    const { container } = mountRow(
      issue({ lockedBy: SESSION, lockedByUsername: 'worker', lockedAt: CLAIMED_TODAY_LOCAL }),
    );
    const seg = claimSegment(container)!;
    expect(seg.textContent).toBe('захвачена агентом worker с 15:30 UTC');
    const time = seg.querySelector('time')!;
    expect(time.getAttribute('title')).toBe('9 марта 2026, 15:30 UTC');
    expect(container.innerHTML).not.toContain(SESSION);
  });

  test('claimed at 23:59 local yesterday (same UTC day as now) → UTC time of day only', async () => {
    await i18n.changeLanguage('ru');
    const { container } = mountRow(
      issue({ lockedBy: SESSION, lockedByUsername: 'worker', lockedAt: CLAIMED_YESTERDAY_LOCAL }),
    );
    expect(claimSegment(container)!.textContent).toBe('захвачена агентом worker с 14:59 UTC');
  });
});

// ──────── row 45 — the My-assigned lens does not change the row (INV-8) ────────
//
// `outboxMode` is a global lens over the shell (CLAUDE.md, «My-assigned mode»
// invariant), but the card's properties row states facts about ONE issue and
// must not move with it. The same issue is rendered with the lens off and on;
// the row's DOM must be byte-identical. The clock is pinned (date only — a
// render row) so the relative tail labels cannot tick between the two renders.

describe('properties row — identical with the My-assigned lens off and on (INV-8, row 45)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-10T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const COMPONENT_ID = 'cmp-lens-1';

  function everyValue(): IssueDetail {
    return issue({
      parentIdCurrent: 'sk-500',
      labels: ['backend', 'ui'],
      componentIds: [COMPONENT_ID],
      dueAt: '2026-03-01T12:00:00Z',
      estimatedMinutes: 90,
      deferUntil: '2026-03-20T12:00:00Z',
      source: 'agent_directed',
      sourceContext: 'context',
      externalRef: 'https://example.com/x',
      lockedBy: 'mcp-session-lens',
      lockedByUsername: 'agent-a',
      lockedAt: '2026-03-10T10:00:00Z',
      acceptedAt: '2026-03-09T01:00:00Z',
      acceptedByUsername: 'bob',
      startedAt: '2026-03-09T02:00:00Z',
      updatedAt: '2026-03-10T11:00:00Z',
    });
  }

  const deps: DependencyList = {
    outgoing: [
      {
        type: 'parent-child',
        fromId: 'sk-1',
        toId: 'sk-500',
        version: 1,
        createdAt: '2026-01-01T00:00:00Z',
        metadata: {},
        issue: {
          id: 'sk-500',
          projectId: 'proj-b',
          title: 'Parent',
          status: 'open',
          priority: 2,
          type: 'epic',
        },
      } as DependencyEdge,
    ],
    incoming: [],
  };

  function rowHtml(outboxMode: boolean): string {
    layout.outboxMode = outboxMode;
    directory.state = {
      status: 'success',
      data: new Map([[COMPONENT_ID, { name: 'api', archived: false }]]),
    };
    const value = everyValue();
    const { container, unmount } = render(
      <MantineProvider>
        <IssuePropertiesRow
          issue={value}
          projectId={value.projectId}
          dependencies={deps}
          dependenciesStatus="success"
        />
      </MantineProvider>,
    );
    const html = container.querySelector('.issue-props')!.outerHTML;
    unmount();
    return html;
  }

  test('lens off and lens on render the same row, segment for segment', () => {
    const off = rowHtml(false);
    const on = rowHtml(true);
    // Guard against a vacuous pass: the row really had all twelve segments.
    expect(off.match(/role="listitem"/g)?.length).toBe(12);
    expect(on).toBe(off);
  });
});

// ──────── row 46 — the row only shows, it never writes (INV-1) ────────
//
// The row takes no mutation callback and imports no write from the API
// layer; any write it could make would have to go over the network. So the
// check is on the wire: every segment and every control inside it is
// clicked, and `fetch` must not be called at all. The one allowed effect is
// navigation to the parent card (`setSelectedIssue`), which writes nothing.

describe('properties row — display only, no writes (INV-1, row 46)', () => {
  const COMPONENT_ID = 'cmp-ro-1';

  test('clicking every segment and every control in it sends no request; nothing is editable', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    directory.state = {
      status: 'success',
      data: new Map([[COMPONENT_ID, { name: 'api', archived: false }]]),
    };
    const value = issue({
      parentIdCurrent: 'sk-600',
      labels: ['backend'],
      componentIds: [COMPONENT_ID],
      dueAt: '2030-01-10T12:00:00Z',
      estimatedMinutes: 90,
      deferUntil: '2030-01-05T12:00:00Z',
      source: 'agent_directed',
      sourceContext: 'context',
      externalRef: 'JIRA-7',
      lockedBy: 'mcp-session-ro',
      lockedByUsername: 'agent-a',
      lockedAt: '2026-01-02T10:00:00Z',
      acceptedAt: '2026-01-01T01:00:00Z',
      acceptedByUsername: 'bob',
      startedAt: '2026-01-01T02:00:00Z',
    });
    const deps: DependencyList = {
      outgoing: [
        {
          type: 'parent-child',
          fromId: 'sk-1',
          toId: 'sk-600',
          version: 1,
          createdAt: '2026-01-01T00:00:00Z',
          metadata: {},
          issue: {
            id: 'sk-600',
            projectId: 'proj-b',
            title: 'Parent',
            status: 'open',
            priority: 2,
            type: 'epic',
          },
        } as DependencyEdge,
      ],
      incoming: [],
    };
    const { container } = render(
      <MantineProvider>
        <IssuePropertiesRow
          issue={value}
          projectId={value.projectId}
          dependencies={deps}
          dependenciesStatus="success"
        />
      </MantineProvider>,
    );
    const row = container.querySelector('.issue-props')!;
    const segments = Array.from(row.querySelectorAll('[role="listitem"]'));
    expect(segments.length).toBe(12);

    for (const seg of segments) {
      fireEvent.click(seg);
      seg.querySelectorAll('button, a, time, span').forEach((el) => {
        fireEvent.click(el);
        fireEvent.doubleClick(el);
      });
    }

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(row.querySelector('input, textarea, select, [contenteditable]')).toBeNull();
    // Opening the parent is navigation, not a write — and it is the only effect.
    expect(router.navigate).toHaveBeenCalledWith('/projects/proj-b/issues/sk-600');
    fetchSpy.mockRestore();
  });
});
