/**
 * sk-285.6.7 — one clock, one threshold, and the exact stamp always one
 * hover away.
 *
 * The defect was two dialects on one screen: the card printed
 * `2026-08-31 07:01 UTC` under a comment while the tree printed
 * "9 days ago" for the same task. Both are defensible; having both,
 * with no rule saying which applies where, is not.
 *
 * These tests fix the rule in place from two directions:
 *
 *   - the BOUNDARY is exactly `RELATIVE_UNTIL_MS`, asserted from the
 *     constant rather than from a copy of the number, so moving the
 *     threshold moves the tests with it and a threshold accidentally
 *     hard-coded somewhere else shows up as a disagreement;
 *   - the absolute form STATES its zone, because the product does not
 *     know the reader's (sk-340) and a bare `2026-08-31` is a date
 *     silently claiming to be local;
 *   - the short label never travels without the full one.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import i18n, { DEFAULT_LANGUAGE } from '../../i18n/config';
import {
  RELATIVE_UNTIL_MS,
  formatDateUtc,
  formatRelative,
  formatTimestamp,
} from '../format';
import { TimeLabel } from '../TimeLabel';

const NOW = new Date('2026-08-31T12:00:00.000Z');

/** An ISO string `ageMs` in the past relative to the frozen clock. */
function ago(ageMs: number): string {
  return new Date(NOW.getTime() - ageMs).toISOString();
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function freeze() {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
}

describe('the relative/absolute threshold', () => {
  test('one millisecond BEFORE the threshold is still relative', () => {
    freeze();
    // The last moment the reader is told "how long ago". Derived from
    // the constant: a test that spelled "6 days 23:59:59" would keep
    // passing while the constant moved out from under it.
    expect(formatRelative(ago(RELATIVE_UNTIL_MS - 1))).toBe('6 days ago');
  });

  test('exactly AT the threshold it flips to the absolute date', () => {
    freeze();
    // `>=`, not `>`. The boundary belongs to the absolute side, and
    // which side owns it is precisely the sort of thing that gets
    // flipped by accident during a refactor.
    expect(formatRelative(ago(RELATIVE_UNTIL_MS))).toBe(
      formatDateUtc(ago(RELATIVE_UNTIL_MS)),
    );
  });

  test('past the threshold the label is a UTC-marked calendar day', () => {
    freeze();
    expect(formatRelative('2024-03-04T05:06:07Z')).toBe('2024-03-04 UTC');
  });

  test('the ladder below the threshold reads in the units a human uses', () => {
    freeze();
    expect(formatRelative(ago(10 * 1000))).toBe('just now');
    expect(formatRelative(ago(45 * 1000))).toBe('45 sec ago');
    expect(formatRelative(ago(5 * 60 * 1000))).toBe('5 min ago');
    expect(formatRelative(ago(2 * 60 * 60 * 1000))).toBe('2 hours ago');
    expect(formatRelative(ago(60 * 60 * 1000))).toBe('1 hour ago');
    expect(formatRelative(ago(3 * 24 * 60 * 60 * 1000))).toBe('3 days ago');
    expect(formatRelative(ago(24 * 60 * 60 * 1000))).toBe('1 day ago');
  });

  test('a FUTURE instant clamps to "just now" rather than counting backwards', () => {
    freeze();
    // Clock skew and reminders both produce these. "in -3 days" is not
    // a thing anyone should ever read.
    expect(formatRelative(new Date(NOW.getTime() + 60_000).toISOString())).toBe(
      'just now',
    );
  });

  test('the absolute forms both name their zone', () => {
    // The one constraint the ticket states outright: until the profile
    // knows the reader's timezone, the zone is SAID, not implied.
    expect(formatTimestamp('2026-08-31T07:01:00Z')).toBe('2026-08-31 07:01 UTC');
    expect(formatDateUtc('2026-08-31T07:01:00Z')).toBe('2026-08-31 UTC');
  });

  test('a missing instant renders the shared em-dash, not "Invalid Date"', () => {
    expect(formatRelative(null)).toBe('—');
    expect(formatDateUtc(undefined)).toBe('—');
  });
});

describe('<TimeLabel> — the short label never travels alone', () => {
  test('shows the relative label and carries the full stamp as its title', () => {
    freeze();
    const { container } = render(<TimeLabel iso={ago(3 * 24 * 60 * 60 * 1000)} />);
    const el = container.querySelector('time');
    expect(el?.textContent).toBe('3 days ago');
    expect(el?.getAttribute('title')).toBe('2026-08-28 12:00 UTC');
  });

  test('the title is a title, NOT an aria-label', () => {
    freeze();
    // An aria-label would replace the announced text: a screen-reader
    // user would hear the raw stamp and lose the "is this fresh?"
    // reading the visible label exists to give. The title is announced
    // as a description, after the text — the right order.
    const { container } = render(<TimeLabel iso={ago(60 * 1000)} />);
    const el = container.querySelector('time');
    expect(el?.getAttribute('aria-label')).toBeNull();
    expect(el?.textContent).toBe('1 min ago');
  });

  test('emits the machine-readable instant on the element', () => {
    const { container } = render(<TimeLabel iso="2026-08-31T07:01:00Z" />);
    expect(container.querySelector('time')?.getAttribute('datetime')).toBe(
      '2026-08-31T07:01:00Z',
    );
  });

  test('a null instant emits no empty datetime attribute', () => {
    // `dateTime=""` is invalid HTML; absent is the correct encoding of
    // "there is no instant here".
    const { container } = render(<TimeLabel iso={null} />);
    const el = container.querySelector('time');
    expect(el?.hasAttribute('datetime')).toBe(false);
    expect(el?.textContent).toBe('—');
  });

  test('a prefix rides inside the same element as the label', () => {
    freeze();
    const { container } = render(
      <TimeLabel iso={ago(60 * 1000)} prefix="updated " />,
    );
    expect(container.querySelector('time')?.textContent).toBe('updated 1 min ago');
  });
});

/**
 * sk-514 (15) — the label is SUBSCRIBED to the language change.
 *
 * Both labels are built by `format.ts`, which lives outside React and knows nothing
 * about re-rendering. So translation alone is not enough:
 * without a subscription the already drawn labels would stay English until the
 * next unrelated update — and that is the whole visible part of the screen,
 * because time stands on almost every row.
 *
 * What is checked is exactly the RE-RENDER: the language changes AFTER mounting, and
 * the old tree must update itself, without a repeated render().
 */
describe('sk-514 (15) — a language change re-renders an already drawn label', () => {
  afterEach(async () => {
    if (i18n.language !== DEFAULT_LANGUAGE) await i18n.changeLanguage(DEFAULT_LANGUAGE);
  });

  test('the visible label and the full stamp in title catch up with the language', async () => {
    await i18n.changeLanguage('en');
    const { container } = render(<TimeLabel iso="2026-08-31T23:30:00Z" />);
    const el = () => container.querySelector('time')!;
    expect(el().textContent).toBe('2026-08-31 UTC');
    expect(el().getAttribute('title')).toBe('2026-08-31 23:30 UTC');

    await act(async () => {
      await i18n.changeLanguage('ru');
    });

    expect(el().textContent).toBe('31 августа 2026 UTC');
    expect(el().getAttribute('title')).toBe('31 августа 2026, 23:30 UTC');
  });
});
