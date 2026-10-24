/**
 * sk-398 — both surfaces of the reviewed flag read the DICTIONARY.
 *
 * ─── Why the other tests do not show this ──────────────────────────
 *
 * The English dictionary string matches the literal that stood in the code before the
 * fix — and that is right (the text did not change, the source did). But it
 * means that `ReviewPrefsSection.test.tsx` and `reviewOnCard.test.tsx`
 * would pass on untranslated code too: they run on the default locale,
 * where both versions match byte for byte. The only way to tell
 * "the string is taken from the dictionary" from "the string is hard-coded" is to demand a SECOND language.
 *
 * So here the panel and the section are rendered for real, under `ru`:
 * the label must reach the markup through `useTranslation`, not through a
 * literal. The fix holds on this seam.
 *
 * The Russian strings are taken from the dictionary itself, not rewritten into the test
 * a second time: a test that repeats the translation guards the agreement of two copies
 * of one text, not that the dictionary reached the screen.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import i18n, { DEFAULT_LANGUAGE } from '../../../i18n/config';
import { ru } from '../../../i18n/locales/ru';
import type { IssueDetail } from '../../../api/issues';
import type { ReviewPrefs, UpdateReviewPrefsInput } from '../../../api/review-prefs';

const getSpy = vi.fn<() => Promise<ReviewPrefs>>();
const putSpy = vi.fn<(input: UpdateReviewPrefsInput) => Promise<ReviewPrefs>>();

vi.mock('../../../api/review-prefs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/review-prefs')>();
  return {
    ...actual,
    getReviewPrefs: () => getSpy(),
    updateReviewPrefs: (input: UpdateReviewPrefsInput) => putSpy(input),
  };
});

import { ReviewPrefsSection } from './ReviewPrefsSection';
import { ReviewFlagSection } from '../../shell/details/sections/ReviewFlagSection';
import { ClosedReasonSection } from '../../shell/details/sections/ClosedReasonSection';

const DICT = ru.review;
const CLOSED = ru.details.closedReason;

function prefs(): ReviewPrefs {
  return {
    mechanicEnabled: true,
    reviewRequiredDefault: false,
    burstCount: 2,
    unacceptedIntervalMinutes: null,
    unreviewedIntervalMinutes: 720,
    effective: {
      burstCount: 2,
      unacceptedIntervalMinutes: 180,
      unreviewedIntervalMinutes: 720,
    },
    bounds: {
      burstCount: { min: 0, max: 6, factory: 3 },
      unacceptedIntervalMinutes: { min: 15, max: 527040, factory: 180 },
      unreviewedIntervalMinutes: { min: 15, max: 527040, factory: 720 },
    },
  };
}

function issue(over: Partial<IssueDetail> = {}): IssueDetail {
  return {
    id: 'sk-1',
    projectId: 'p-1',
    version: 1,
    title: 'task',
    description: '',
    type: 'task',
    priority: 2,
    status: 'closed',
    pinned: false,
    assignee: 'someone',
    componentIds: [],
    labels: [],
    isBlocked: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    reviewRequired: true,
    ...over,
  } as IssueDetail;
}

function mountPrefs() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <ReviewPrefsSection />
      </QueryClientProvider>
    </MantineProvider>,
  );
}

beforeEach(async () => {
  getSpy.mockReset();
  putSpy.mockReset();
  getSpy.mockResolvedValue(prefs());
  await i18n.changeLanguage('ru');
});

afterEach(async () => {
  cleanup();
  vi.clearAllMocks();
  if (i18n.language !== DEFAULT_LANGUAGE) await i18n.changeLanguage(DEFAULT_LANGUAGE);
});

describe('sk-398 — the "Review of results" panel under the Russian language', () => {
  test('the heading, both switches and three fields are named in Russian', async () => {
    mountPrefs();
    await waitFor(() => expect(screen.getByTestId('review-burst-count')).toBeTruthy());

    for (const text of [
      DICT.prefs.title,
      DICT.prefs.mechanic.label,
      DICT.prefs.requiredDefault.label,
      DICT.prefs.fields.burstCount,
      DICT.prefs.fields.unacceptedInterval,
      DICT.prefs.fields.unreviewedInterval,
    ]) {
      expect(screen.getAllByText(text).length, text).toBeGreaterThan(0);
    }
  });

  test('the label under a field with known bounds is assembled from the dictionary, with the server numbers', async () => {
    // The substitutions must arrive: a label without them would name neither
    // the bounds nor the factory value — and that is exactly why it exists.
    mountPrefs();
    await waitFor(() => expect(screen.getByTestId('review-burst-count')).toBeTruthy());
    const caption = DICT.prefs.bounds.known
      .replace('{{min}}', '0')
      .replace('{{max}}', '6')
      .replace('{{unit}}', DICT.prefs.bounds.units.items)
      .replace('{{factory}}', '3');
    expect(screen.getAllByText(caption).length).toBeGreaterThan(0);
  });

  test('the save button is called in Russian both by its visible word and by its accessible name', async () => {
    mountPrefs();
    await waitFor(() => expect(screen.getByTestId('review-burst-count')).toBeTruthy());
    const button = screen.getByRole('button', { name: DICT.prefs.saveAria });
    expect(button.textContent).toBe(DICT.prefs.save);
  });
});

describe('sk-398 — the flag section on the card under the Russian language', () => {
  const wrap = (node: React.ReactNode) => render(<MantineProvider>{node}</MantineProvider>);

  test('the heading, the switch label and the "flag is set" explanation — from the dictionary', () => {
    wrap(<ReviewFlagSection issue={issue()} isAuthor onChange={vi.fn()} />);
    expect(screen.getAllByText(DICT.flag.title).length).toBeGreaterThan(0);
    expect(screen.getAllByText(DICT.flag.label).length).toBeGreaterThan(0);
    expect(screen.getAllByText(DICT.flag.onDescription).length).toBeGreaterThan(0);
  });

  test('a cleared flag is explained by a DIFFERENT sentence, also from the dictionary', () => {
    // The two branches of the explanation are different claims, and are translated separately:
    // one substitution for both would pass the first case and lie in the second.
    wrap(
      <ReviewFlagSection
        issue={issue({ reviewRequired: false })}
        isAuthor
        onChange={vi.fn()}
      />,
    );
    expect(screen.getAllByText(DICT.flag.offDescription).length).toBeGreaterThan(0);
    expect(screen.queryByText(DICT.flag.onDescription)).toBeNull();
  });
});

/**
 * sk-514 (3) — the review MARK in the closing block, not the flag section.
 *
 * The complaint "the review block in the card is not translated" points at both halves
 * of one mechanism, while the sk-398 guard above judges only one: the flag
 * section. The mark lives in the closing block, in another dictionary
 * namespace (`details.closedReason`), and nobody checked its Russian —
 * `reviewOnCard.test.tsx` next door runs on the default locale, where the
 * English string and the hard-coded literal match byte for byte. That is,
 * English could be returned here silently.
 *
 * The labels are taken from the dictionary, not rewritten into the test: a test repeating
 * a translation guards the agreement of two copies of one text, not that the
 * dictionary reached the screen.
 */
describe('sk-514 (3) — the review mark in the closing block under the Russian language', () => {
  const wrap = (node: React.ReactNode) => render(<MantineProvider>{node}</MantineProvider>);

  test('the mark button and its explanation — from the dictionary', () => {
    wrap(
      <ClosedReasonSection issue={issue()} isAuthor onMarkReviewed={vi.fn()} />,
    );
    const button = screen.getByTestId('mark-reviewed');
    expect(button.textContent).toContain(CLOSED.markAction);
    expect(button.getAttribute('title')).toBe(CLOSED.markTitle);
  });

  test('an already marked result is labelled in Russian', () => {
    // Another branch of the same block: there is no button at all, and the label is taken
    // by a different key. One check for both branches would pass the first and
    // say nothing about this one.
    wrap(
      <ClosedReasonSection
        issue={issue({ reviewedAt: '2026-01-02T00:00:00Z' })}
        isAuthor
        onMarkReviewed={vi.fn()}
      />,
    );
    expect(screen.getByTestId('review-mark-done').textContent).toContain(CLOSED.reviewed);
    expect(screen.queryByTestId('mark-reviewed')).toBeNull();
  });

  test('the closing block heading and its accessible name — also from the dictionary', () => {
    const { container } = wrap(<ClosedReasonSection issue={issue()} isAuthor />);
    const callout = container.querySelector('.closed-reason-callout');
    expect(callout?.getAttribute('aria-label')).toBe(CLOSED.aria);
    expect(container.querySelector('.closed-reason-label')?.textContent).toContain(CLOSED.label);
  });
});
