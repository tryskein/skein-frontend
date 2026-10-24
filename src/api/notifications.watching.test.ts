/**
 * sk-303.13 (T028, test matrix row 42) — reading the Watching payload
 * when the three C3 totals are not there.
 *
 * The client and the server ship together, so this is not about a mixed
 * fleet in steady state; it is about what a degraded read is allowed to
 * invent. The tempting default — total 0 — would paint an empty column
 * next to a non-empty header badge, which is the exact class of silent
 * disagreement US-7 exists to remove. The honest degradation is to fall
 * back to what the column did before the totals existed (sum the cards)
 * and to raise the incompleteness flag exactly where that old sum was
 * already known to be wrong: on a page sitting at the cap.
 *
 * sk-622.21 (No. 85) — the wire of the historical card (US-5: empty
 * reasons, `since` = null), of «read card X» (US-7, T008 literal
 * `{"marked":2}`) and of the bulk answer with and without
 * `historicalRemoved` (US-6, T008 literal
 * `{"unwatched":3,"keptManual":1,"historicalRemoved":2}`).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  WATCHING_CARD_CAP,
  isHistoricalWatchingCard,
  markWatchingCardRead,
  normalizeWatchingResponse,
  watchingStateIncludes,
  type WatchingItem,
} from './notifications';
import { bulkUnwatch } from './watchers';

const sub = (id: string, unread: number): WatchingItem => ({
  item: { id, title: id, projectId: 'p1' } as never,
  reasons: [],
  unreadEventsCount: unread,
  recentEvents: [],
  since: '2026-01-01T00:00:00Z',
});

describe('row 42 — the watching payload is read defensively', () => {
  test('a full payload is passed through untouched', () => {
    const got = normalizeWatchingResponse({
      items: [sub('sk-1', 2)],
      unreadTotal: 137,
      subscriptionsTotal: 150,
      truncated: true,
    });
    expect(got.unreadTotal).toBe(137);
    expect(got.subscriptionsTotal).toBe(150);
    expect(got.truncated).toBe(true);
  });

  test('the total is NOT zero when the field is missing', () => {
    const got = normalizeWatchingResponse({ items: [sub('sk-1', 2), sub('sk-2', 3)] });
    expect(got.unreadTotal).toBe(5);
    expect(got.subscriptionsTotal).toBe(2);
    expect(got.truncated).toBe(false);
  });

  test('a degraded page sitting on the cap declares itself incomplete', () => {
    const items = Array.from({ length: WATCHING_CARD_CAP }, (_, i) => sub(`sk-${i}`, 1));
    expect(normalizeWatchingResponse({ items }).truncated).toBe(true);
  });

  test('junk in place of a payload yields an empty, well-formed answer', () => {
    for (const junk of [null, undefined, {}, { items: 'not an array' }]) {
      const got = normalizeWatchingResponse(junk);
      expect(got.items).toEqual([]);
      expect(got.unreadTotal).toBe(0);
      expect(got.subscriptionsTotal).toBe(0);
      expect(got.truncated).toBe(false);
    }
  });
});

// sk-551.10 — the Open / Closed / All filter.
describe('sk-551.10 — the filter totals', () => {
  const withStatus = (id: string, status: string): WatchingItem => ({
    ...sub(id, 0),
    item: { id, title: id, projectId: 'p1', status } as never,
  });

  test('a filtered payload keeps its own state and totals', () => {
    const got = normalizeWatchingResponse({
      items: [withStatus('sk-1', 'closed')],
      unreadTotal: 4,
      subscriptionsTotal: 30,
      truncated: false,
      state: 'closed',
      stateTotal: 1,
      openTotal: 29,
      closedTotal: 1,
    });
    expect(got.state).toBe('closed');
    expect(got.stateTotal).toBe(1);
    expect(got.openTotal).toBe(29);
    expect(got.closedTotal).toBe(1);
  });

  test('an API without the filter is read as «all», split from the cards', () => {
    const got = normalizeWatchingResponse({
      items: [withStatus('sk-1', 'closed'), withStatus('sk-2', 'open'), withStatus('sk-3', 'in_progress')],
      unreadTotal: 0,
      subscriptionsTotal: 3,
      truncated: false,
    });
    expect(got.state).toBe('all');
    expect(got.stateTotal).toBe(3);
    expect(got.openTotal).toBe(2);
    expect(got.closedTotal).toBe(1);
  });
});

describe('watchingStateIncludes', () => {
  test.each([
    ['open', 'open', true],
    ['open', 'in_progress', true],
    ['open', 'standing', true],
    ['open', 'closed', false],
    ['closed', 'closed', true],
    ['closed', 'deferred', false],
    ['all', 'closed', true],
    ['all', 'open', true],
  ] as const)('%s includes a %s task: %s', (state, status, want) => {
    expect(watchingStateIncludes(state, status)).toBe(want);
  });
});

// ── sk-622.21 (No. 85) ─────────────────────────────────────────────────

describe('No. 85 — a historical card on the wire', () => {
  const card = (reasons: string[], since: string | null): WatchingItem => ({
    ...sub('sk-9', 1),
    reasons,
    since,
  });

  test.each([
    ['no reasons, no subscription time', [], null, true],
    ['a subscription', ['creator'], '2026-01-01T00:00:00Z', false],
    ['reasons without a time', ['manual'], null, false],
    ['a time without reasons', [], '2026-01-01T00:00:00Z', false],
  ] as const)('%s → historical: %s', (_name, reasons, since, want) => {
    expect(isHistoricalWatchingCard(card([...reasons], since))).toBe(want);
  });

  test('the payload passes a historical card through as one', () => {
    const got = normalizeWatchingResponse({
      items: [card([], null)],
      unreadTotal: 1,
      subscriptionsTotal: 0,
      truncated: false,
      state: 'all',
      stateTotal: 1,
      openTotal: 1,
      closedTotal: 0,
      closedAutoTotal: 0,
    });
    expect(got.items).toHaveLength(1);
    expect(isHistoricalWatchingCard(got.items[0])).toBe(true);
    // A card that is not a subscription is not counted as one.
    expect(got.subscriptionsTotal).toBe(0);
    expect(got.stateTotal).toBe(1);
  });
});

describe('No. 85 — "read card X" and the bulk answer on the wire', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const answer = (body: unknown) =>
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('«read card» POSTs to the card route and reads `marked`', async () => {
    answer({ marked: 2 });
    expect(await markWatchingCardRead('sk-42.1')).toEqual({ marked: 2 });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/me/watching/sk-42.1/read');
    expect(init.method).toBe('POST');
  });

  test('«read card» without a numeric `marked` reads as 0', async () => {
    answer({});
    expect(await markWatchingCardRead('sk-42')).toEqual({ marked: 0 });
  });

  test('«read card» answered with no body at all reads as 0', async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }));
    expect(await markWatchingCardRead('sk-42')).toEqual({ marked: 0 });
  });

  test('the bulk answer with `historicalRemoved` is read whole', async () => {
    answer({ unwatched: 3, keptManual: 1, historicalRemoved: 2 });
    expect(await bulkUnwatch({ state: 'closed' })).toEqual({
      unwatched: 3,
      keptManual: 1,
      historicalRemoved: 2,
    });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/me/watching/unwatch');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ state: 'closed' });
  });

  test('the bulk answer without `historicalRemoved` reads it as 0', async () => {
    answer({ unwatched: 3, keptManual: 1 });
    expect(await bulkUnwatch({ issueIds: ['sk-1'] })).toEqual({
      unwatched: 3,
      keptManual: 1,
      historicalRemoved: 0,
    });
  });
});
