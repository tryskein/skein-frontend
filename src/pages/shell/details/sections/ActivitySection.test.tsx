/**
 * The issue card's Activity feed, at the two points where the pure
 * helpers underneath it stop being enough.
 *
 * `activityFeedFilter.test.ts` proves the PREDICATE. This file proves
 * the WIRING and the clock — neither of which a pure-function test can
 * see, and both of which were the actual defect:
 *
 *   sk-285.6.6 — the section really does drop comment rows (a filter
 *   written and then not called is exactly the shape of the original
 *   bug, four comments listed twice);
 *   sk-285.6.7 — the feed reads its day buckets and row times off the
 *   UTC clock, so the card does not run two clocks at once.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ActivityEntry } from '../../../../api/activity';
import { ActivitySection } from './ActivitySection';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

let nextId = 1;
function entry(
  type: string,
  occurredAt: string,
  entityType: ActivityEntry['entity']['type'] = 'issue',
): ActivityEntry {
  return {
    id: nextId++,
    occurredAt,
    type,
    actor: { userId: 'u-1', username: 'reviewer', type: 'human' },
    entity: { type: entityType, id: 'shop-9', title: 'a task' },
    oldValue: 'open',
    newValue: 'in_progress',
  };
}

function renderFeed(activity: ActivityEntry[]) {
  return render(
    <ActivitySection
      activity={activity}
      createdAt="2026-08-31T09:00:00Z"
      createdByUsername="reviewer"
    />,
  );
}

describe('sk-285.6.6 — the section drops what Comments already shows', () => {
  test('a comment event contributes no row to the feed', () => {
    const { container } = renderFeed([
      entry('issue.status_changed', '2026-08-31T10:20:00Z'),
      entry('comment.created', '2026-08-31T10:17:00Z', 'comment'),
    ]);

    // Row count, not "the word 'commented' is absent": the duplicate was
    // a whole ROW, and a feed that kept the row while relabelling it
    // would still be showing the same event twice.
    const rows = container.querySelectorAll('.activity-row');
    // One surviving event + the synthetic "created" footer.
    expect(rows.length).toBe(2);
    expect(container.textContent).not.toContain('10:17');
  });

  test('and the status change beside it survives', () => {
    // The half that stops the fix from becoming the deletion the ticket
    // rejected: a status transition appears NOWHERE else on the card.
    const { container } = renderFeed([
      entry('issue.status_changed', '2026-08-31T10:20:00Z'),
      entry('comment.created', '2026-08-31T10:17:00Z', 'comment'),
    ]);
    expect(container.textContent).toContain('10:20');
  });

  test('a feed of nothing but comments falls back to the created footer', () => {
    // The card must not render an Activity section that is visibly empty
    // where four rows used to be — the "task born at" anchor is always
    // there, and it is what the reader lands on instead.
    const { container } = renderFeed([
      entry('comment.created', '2026-08-31T10:17:00Z', 'comment'),
      entry('comment.created', '2026-08-31T10:18:00Z', 'comment'),
    ]);
    const rows = container.querySelectorAll('.activity-row');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('reviewer');
  });
});

describe('sk-285.6.7 — the feed runs on the card’s clock', () => {
  // The CI runner and the dev container both sit on UTC, where "local"
  // and "UTC" are the same string and an assertion about the clock
  // cannot fail no matter what the code does. So the block pins a zone
  // with a non-zero, DST-free offset for the duration: +09:00 turns
  // 22:45Z into 07:45 the NEXT day, which separates the two readings in
  // both the row time and the day bucket. Node re-reads `process.env.TZ`
  // on assignment (verified on v22), so this really does move the clock
  // the component sees.
  // `process` is typed here as the narrow Vite shim (`{ cwd() }`), so
  // the env bag is reached through a local widening rather than by
  // loosening the project's node typings for one test file.
  const env = (globalThis as { process?: { env: Record<string, string | undefined> } })
    .process!.env;
  const realTz = env.TZ;
  beforeAll(() => {
    env.TZ = 'Asia/Tokyo';
  });
  afterAll(() => {
    env.TZ = realTz;
  });

  test('row times are UTC, not the browser’s zone', () => {
    // The comment stamps two sections above say `… UTC`. A row time read
    // off `getHours()` agrees with them only for a reader sitting on the
    // meridian; under +09:00 it would print 07:45.
    const { container } = renderFeed([
      entry('issue.status_changed', '2026-08-31T22:45:00Z'),
    ]);
    expect(container.textContent).toContain('22:45');
    expect(container.textContent).not.toContain('07:45');
  });

  test('and so does the day bucket the row is filed under', () => {
    // 22:45Z is the 31st in UTC and the 1st in Tokyo. A feed grouping on
    // the local day would file this row under tomorrow — and label it
    // with a date the card's own stamps never mention.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-10T12:00:00Z'));
    renderFeed([entry('issue.status_changed', '2026-08-31T22:45:00Z')]);
    // `getAllBy`: the synthetic "created" footer is filed under the same
    // UTC day, so the label legitimately appears twice.
    expect(screen.getAllByText('2026-08-31 UTC').length).toBeGreaterThan(0);
    expect(screen.queryByText(/2026-09-01/)).toBeNull();
  });

  test('the exact instant is on hover, like every other time in the app', () => {
    const { container } = renderFeed([
      entry('issue.status_changed', '2026-08-31T22:45:00Z'),
    ]);
    const time = container.querySelector('.activity-row-time');
    expect(time?.getAttribute('title')).toBe('2026-08-31 22:45 UTC');
  });

  test('a bucket older than the shared threshold is an absolute UTC day', () => {
    // Seven days is `RELATIVE_UNTIL_MS`, the constant the whole product
    // switches on; the feed must not carry a threshold of its own.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-31T12:00:00Z'));
    renderFeed([entry('issue.status_changed', '2026-08-20T10:00:00Z')]);
    expect(screen.getByText('2026-08-20 UTC')).toBeTruthy();
  });

  test('a bucket inside the threshold still counts days', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-31T12:00:00Z'));
    renderFeed([entry('issue.status_changed', '2026-08-28T10:00:00Z')]);
    expect(screen.getByText('3 days ago UTC')).toBeTruthy();
  });

  test('EVERY day bucket names the clock it is on, word buckets included', () => {
    // The half-fix this guards against: the feed moved onto the UTC
    // clock and only the absolute buckets said `UTC`. For a reader in
    // UTC+3 that is the wrong half — a 01:45 local event prints `22:45`
    // and files itself under `Yesterday`, and `Yesterday` was the label
    // with nothing on it. The row hours are deliberately bare (the
    // bucket above them establishes the zone), so the bucket is the one
    // place the marker cannot be missing.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-31T12:00:00Z'));
    const { container } = renderFeed([
      entry('issue.status_changed', '2026-08-31T10:00:00Z'),
      entry('issue.status_changed', '2026-08-30T10:00:00Z'),
      entry('issue.status_changed', '2026-08-28T10:00:00Z'),
      entry('issue.status_changed', '2026-08-20T10:00:00Z'),
    ]);

    const labels = [...container.querySelectorAll('.activity-day-label')].map(
      (el) => el.textContent ?? '',
    );
    expect(labels.length).toBeGreaterThanOrEqual(4);
    for (const label of labels) {
      expect(label.endsWith(' UTC'), label).toBe(true);
    }
    expect(labels).toContain('Today UTC');
    expect(labels).toContain('Yesterday UTC');
    expect(labels).toContain('3 days ago UTC');
    expect(labels).toContain('2026-08-20 UTC');
  });
});

// ───────── sk-489 T018 — an outcome change REACHES the history feed (US-3, row 64) ─────────
//
// A guard of the SEAM, not of the form. The form of the row is proved by the helper suite
// (`lib/formatActivityDetail.test.ts`); here it is checked that the section
// draws this row — i.e. that an event of the new type is not filtered out on
// the way. The section does have a filter and it is real: it drops comments
// on purpose (sk-285.6.6), and rows declared contentless — by
// the `detailless` flag. A helper that returned "contentless" for the new type
// would leave the helper suite green and the history
// without the event that US-3 requires.

describe('sk-489 T018 — the outcome change row in the history feed', () => {
  test('an event of the new type gives a row, and it has both sides of the transition', () => {
    const row: ActivityEntry = {
      ...entry('issue.outcome_changed', '2026-08-31T10:20:00Z'),
      field: 'closeOutcome',
      oldValue: 'done',
      newValue: 'wont_do',
    };
    const { container } = renderFeed([row]);

    // The row exists (plus the synthetic "created" in the footer).
    expect(container.querySelectorAll('.activity-row').length).toBe(2);
    const line = container.querySelector('.activity-row-summary')!;
    expect(line.textContent).toContain('changed outcome');
    expect(line.querySelector('.activity-old')?.textContent).toBe('done');
    expect(line.querySelector('.activity-new')?.textContent).toBe('wont_do');
    // The arrow is hidden from the screen reader, so both sides are named
    // by the accessible name of the transition too — otherwise the row would read as
    // «changed outcome done wont_do».
    expect(line.querySelector('.activity-transition')?.getAttribute('aria-label')).toBe(
      'from done to wont_do',
    );
  });
});
