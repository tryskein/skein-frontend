/**
 * Phase 2 — the open card (spec sk-622.21 US-15 "Row fields … updates
 * the open card by substitution; any other event … re-reads
 * the open card"; plan T049). Test-plan row No. 90.
 *
 * The provider runs on a fake hub; the open card is what `useIssueDetail`
 * reads — `['issues','detail',id]` (`useIssueDetail.ts#issueDetailKey`) and
 * the card's links `['deps',P,id]` — held by mounted observers whose reads
 * are counted. The expected card after a row-only event is the card as it
 * was plus the row fields of the event, written out by hand.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import * as signalr from '@microsoft/signalr';
import { LiveEventsProvider } from '../../hooks/useLiveEvents';
import { useDeclareProjects } from '../liveProjectDeclaration';
import { LIVE_INVALIDATION_WINDOW_MS } from '../liveInvalidationBatcher';
import { issueDetailKey, issueDependenciesKey } from '../useIssueDetail';
import type { EventEnvelope } from '../eventEnvelope';
import type { IssueDetail } from '../../api/issues';

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u-1', username: 'ann', role: 'user' }, logout: () => Promise.resolve() }),
}));

vi.mock('@microsoft/signalr', () => {
  const HubConnectionState = {
    Disconnected: 'Disconnected',
    Connecting: 'Connecting',
    Connected: 'Connected',
    Reconnecting: 'Reconnecting',
  } as const;
  const LogLevel = { Trace: 0, Debug: 1, Information: 2, Warning: 3, Error: 4, Critical: 5, None: 6 } as const;
  const registry: { handlers: Map<string, (payload: unknown) => void> } = { handlers: new Map() };
  class FakeConn {
    state: string = HubConnectionState.Disconnected;
    on = vi.fn((method: string, cb: (payload: unknown) => void) => {
      registry.handlers.set(method, cb);
    });
    onclose = vi.fn();
    onreconnecting = vi.fn();
    onreconnected = vi.fn();
    invoke = vi.fn((_m: string, ids: unknown) =>
      Promise.resolve({ accepted: Array.isArray(ids) ? ids : [], rejected: [] }));
    stop = vi.fn(() => { this.state = HubConnectionState.Disconnected; return Promise.resolve(); });
    start = vi.fn(() => { this.state = HubConnectionState.Connected; return Promise.resolve(); });
  }
  class HubConnectionBuilder {
    withUrl() { return this; }
    withAutomaticReconnect() { return this; }
    configureLogging() { return this; }
    build() { return new FakeConn(); }
  }
  return { HubConnectionBuilder, HubConnectionState, LogLevel, __mock: registry };
});

const hub = (signalr as unknown as { __mock: { handlers: Map<string, (payload: unknown) => void> } }).__mock;

const PA = 'aaaaaaaa-0000-0000-0000-000000000001';
const PB = 'bbbbbbbb-0000-0000-0000-000000000002';

function ts(n: number): string {
  return `2026-10-01T10:00:${String(n).padStart(2, '0')}.000001Z`;
}

/** The card of issue `id` as REST returns it. */
function card(id: string, projectId: string, over: Partial<IssueDetail> = {}): IssueDetail {
  return {
    id,
    projectId,
    version: 3,
    title: id,
    description: 'long text',
    type: 'task',
    priority: 2,
    status: 'open',
    pinned: false,
    source: 'human',
    design: '',
    acceptanceCriteria: '',
    notes: '',
    dueAt: '2026-11-01T00:00:00Z',
    createdBy: 'u-2',
    createdAt: ts(0),
    updatedAt: ts(1),
    rowSeq: 40,
    metadata: {},
    componentIds: [],
    labels: [],
    commentsCount: 2,
    commitRefs: [],
    mentions: [],
    isBlocked: false,
    blockers: [],
    ...over,
  } as IssueDetail;
}

function eventRow(id: string, projectId: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    projectId,
    version: 4,
    title: id,
    type: 'task',
    priority: 2,
    status: 'open',
    pinned: false,
    createdBy: 'u-2',
    componentIds: [],
    labels: [],
    updatedAt: ts(5),
    createdAt: ts(0),
    rowSeq: 41,
    ...over,
  };
}

let nextEnvelopeId = 1;
function envelope(eventType: string, entityId: string, projectId: string, extra: Partial<EventEnvelope>): EventEnvelope {
  return {
    id: nextEnvelopeId++,
    occurredAt: '2026-10-01T10:01:00Z',
    eventType,
    entityType: 'issue',
    entityId,
    projectId,
    actor: 'bob',
    actorType: 'human',
    actorUserId: 'u-2',
    entityTitle: entityId,
    projectIdPrefix: 'sk',
    ...extra,
  };
}

let qc: QueryClient;
let reads: Map<string, number>;
let unsubscribers: Array<() => void>;

function readsOf(name: string): number {
  return reads.get(name) ?? 0;
}

function openReader(name: string, key: readonly unknown[], data: unknown): void {
  qc.setQueryData(key, data);
  const observer = new QueryObserver(qc, {
    queryKey: key,
    queryFn: () => {
      reads.set(name, readsOf(name) + 1);
      return Promise.resolve(data);
    },
    staleTime: Infinity,
  });
  unsubscribers.push(observer.subscribe(() => {}));
}

function Declare({ projects }: { projects: string[] }) {
  useDeclareProjects('route', projects);
  return null;
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function mountTab(projects: string[]): Promise<void> {
  await act(async () => {
    render(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(LiveEventsProvider, null, createElement(Declare, { projects })),
      ),
    );
  });
  await advance(1_000);
  reads = new Map();
}

async function deliver(env: EventEnvelope): Promise<void> {
  act(() => hub.handlers.get('event')!(env));
  await advance(LIVE_INVALIDATION_WINDOW_MS + 200);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  hub.handlers.clear();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  reads = new Map();
  unsubscribers = [];
});

afterEach(() => {
  unsubscribers.forEach((u) => u());
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('No. 90 — the open card takes a row-only change, re-reads anything else', () => {
  test.each([
    ['title', 'issue.updated', ['title'], { title: 'renamed' }],
    ['priority', 'issue.updated', ['priority'], { priority: 0 }],
    ['type', 'issue.updated', ['type'], { type: 'bug' }],
    ['labels (added)', 'issue.label_added', undefined, { labels: ['x'] }],
    ['labels (removed)', 'issue.label_removed', undefined, { labels: [] }],
    ['priority (its own event)', 'issue.priority_changed', undefined, { priority: 1 }],
    ['pin removed', 'issue.unpinned', undefined, { pinned: false }],
    ['components', 'issue.components_changed', undefined, { componentIds: ['c-1'] }],
    ['pinned', 'issue.pinned', undefined, { pinned: true }],
  ] as const)('a %s change is laid onto the open card without a request', async (_f, type, changedFields, fields) => {
    const before = card('sk-1', PA);
    // Another card's data is in the cache before this one.
    openReader('other', issueDetailKey('sk-77'), card('sk-77', PA));
    openReader('card', issueDetailKey('sk-1'), before);
    await mountTab([PA]);

    await deliver(envelope(type, 'sk-1', PA, {
      changedFields: changedFields ? [...changedFields] : undefined,
      row: eventRow('sk-1', PA, { ...fields }),
    }));

    expect(readsOf('card')).toBe(0);
    expect(qc.getQueryData(issueDetailKey('sk-77'))).toEqual(card('sk-77', PA));
    expect(qc.getQueryData(issueDetailKey('sk-1'))).toEqual({
      ...before,
      ...fields,
      version: 4,
      updatedAt: ts(5),
      rowSeq: 41,
    });
  });

  test.each([
    ['the due date', 'issue.updated', ['dueAt']],
    ['the status', 'issue.status_changed', undefined],
    ['the description', 'issue.updated', ['description']],
    ['a title together with the due date', 'issue.updated', ['title', 'dueAt']],
    ['an edit naming no fields (an older writer)', 'issue.updated', undefined],
  ] as const)('a change of %s re-reads the open card and lays nothing on it', async (_f, type, changedFields) => {
    const before = card('sk-1', PA);
    openReader('card', issueDetailKey('sk-1'), before);
    await mountTab([PA]);

    await deliver(envelope(type, 'sk-1', PA, {
      changedFields: changedFields ? [...changedFields] : undefined,
      row: eventRow('sk-1', PA, { title: 'from the row', status: type === 'issue.status_changed' ? 'in_progress' : 'open' }),
    }));

    expect(readsOf('card')).toBe(1);
    // The re-read answers the card as REST has it; nothing from the row.
    expect((qc.getQueryData(issueDetailKey('sk-1')) as IssueDetail).title).toBe('sk-1');
  });

  test.each([
    ['title', 'issue.updated', ['title'], { title: 'B renamed' }],
    ['priority', 'issue.updated', ['priority'], { priority: 0 }],
    ['type', 'issue.updated', ['type'], { type: 'bug' }],
    ['status', 'issue.status_changed', undefined, { status: 'in_progress' }],
  ] as const)('an open card in A linking to B of a declared project: a %s edit of B re-reads its links', async (_f, type, changedFields, fields) => {
    openReader('cardA', issueDetailKey('aa-1'), card('aa-1', PA));
    openReader('depsA', issueDependenciesKey(PA, 'aa-1'), {
      outgoing: [{ fromId: 'aa-1', toId: 'bb-1', type: 'related', issue: { id: 'bb-1', title: 'bb-1' } }],
      incoming: [],
    });
    await mountTab([PA, PB]);

    await deliver(envelope(type, 'bb-1', PB, {
      changedFields: changedFields ? [...changedFields] : undefined,
      row: eventRow('bb-1', PB, { ...fields }),
    }));

    expect(readsOf('depsA')).toBe(1);
  });

  test('with B not declared no event arrives; the links of the open card are re-read on focus', async () => {
    openReader('cardA', issueDetailKey('aa-1'), card('aa-1', PA));
    openReader('depsA', issueDependenciesKey(PA, 'aa-1'), {
      outgoing: [{ fromId: 'aa-1', toId: 'bb-1', type: 'related', issue: { id: 'bb-1', title: 'bb-1' } }],
      incoming: [],
    });
    await mountTab([PA]);

    act(() => { window.dispatchEvent(new Event('focus')); });
    await advance(LIVE_INVALIDATION_WINDOW_MS + 200);

    expect(readsOf('depsA')).toBe(1);
  });
});
