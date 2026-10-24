/**
 * sk-303.14 (T030, matrix rows 104 and 99) — the client form of contract C4.
 *
 *   - row 104: the form READS and SAVES all five settings — the master
 *     switch, the personal default of the per-issue flag, and the three
 *     schedule parameters.
 *   - row 99: a value outside the bounds shows the SERVER's refusal and is
 *     not quietly corrected (SC-022, SC-027).
 *
 * The five are asserted by name, one at a time, in both directions. A single
 * "the payload matches this object" check would look thorough and would pass
 * a form that renders a field it never sends: the payload is written by the
 * test either way.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { BusinessError } from '../../../api/client';
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

import { ReviewPrefsSection, isMalformed, toWire } from './ReviewPrefsSection';

/**
 * Server state. Note the deliberate spread of shapes: one schedule field is
 * an explicit number, one is empty/unset (null) and one is another number, so
 * "reads all five" has to survive both cases rather than one.
 */
function prefs(over: Partial<ReviewPrefs> = {}): ReviewPrefs {
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
    ...over,
  };
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <ReviewPrefsSection />
      </QueryClientProvider>
    </MantineProvider>,
  );
}

const field = (id: string) => screen.getByTestId(id) as HTMLInputElement;
const saveButton = () =>
  screen.getByRole('button', { name: 'Save review settings' });

beforeEach(() => {
  getSpy.mockReset();
  putSpy.mockReset();
  getSpy.mockResolvedValue(prefs());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('row 104 — the form reads and saves ALL FIVE settings', () => {
  test('reads: every one of the five arrives in its own control', async () => {
    mount();
    await screen.findByTestId('review-mechanic-enabled');

    expect(field('review-mechanic-enabled').checked).toBe(true);
    expect(field('review-required-default').checked).toBe(false);
    expect(field('review-burst-count').value).toBe('2');
    // Empty/unset is shown EMPTY, not filled with the built-in default the user
    // never typed — which is why the contract ships the stored value and the
    // effective one as separate fields.
    expect(field('review-unaccepted-interval').value).toBe('');
    expect(field('review-unreviewed-interval').value).toBe('720');
  });

  test('reads: bounds and factory values come from the SERVER, not from the form', async () => {
    // The server ships them precisely so the form does not transcribe
    // 0…6 and 15…527040 a third time. Feed it non-production numbers: a form
    // with the range hard-coded would print the real one and fail here.
    getSpy.mockResolvedValue(
      prefs({
        bounds: {
          burstCount: { min: 1, max: 4, factory: 2 },
          unacceptedIntervalMinutes: { min: 30, max: 900, factory: 60 },
          unreviewedIntervalMinutes: { min: 45, max: 800, factory: 90 },
        },
      }),
    );
    mount();

    expect(
      await screen.findByText('Allowed 1…4 items. Empty — built-in default: 2.'),
    ).toBeTruthy();
    expect(
      screen.getByText('Allowed 30…900 minutes. Empty — built-in default: 60.'),
    ).toBeTruthy();
    expect(
      screen.getByText('Allowed 45…800 minutes. Empty — built-in default: 90.'),
    ).toBeTruthy();
  });

  test('saves: each of the five travels, changed one at a time', async () => {
    putSpy.mockImplementation((input) =>
      Promise.resolve(prefs({ ...(input as Partial<ReviewPrefs>) })),
    );
    mount();
    await screen.findByTestId('review-mechanic-enabled');
    const user = userEvent.setup();

    // 1 — the master switch.
    await user.click(field('review-mechanic-enabled'));
    await user.click(saveButton());
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    expect(putSpy.mock.calls[0][0].mechanicEnabled).toBe(false);

    // 2 — the personal default of the per-issue flag.
    await user.click(field('review-required-default'));
    await user.click(saveButton());
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(2));
    expect(putSpy.mock.calls[1][0].reviewRequiredDefault).toBe(true);

    // 3 — burst count. Zero is a legitimate setting ("no burst") and has
    // to survive as 0 rather than collapsing into empty/unset.
    await user.clear(field('review-burst-count'));
    await user.type(field('review-burst-count'), '0');
    await user.click(saveButton());
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(3));
    expect(putSpy.mock.calls[2][0].burstCount).toBe(0);

    // 4 — the unaccepted interval, from empty/unset to a number.
    await user.type(field('review-unaccepted-interval'), '45');
    await user.click(saveButton());
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(4));
    expect(putSpy.mock.calls[3][0].unacceptedIntervalMinutes).toBe(45);

    // 5 — the unreviewed interval, cleared back to empty/unset. An emptied field
    // is an explicit null, not a 0 and not an omission.
    await user.clear(field('review-unreviewed-interval'));
    await user.click(saveButton());
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(5));
    expect(putSpy.mock.calls[4][0]).toHaveProperty('unreviewedIntervalMinutes');
    expect(putSpy.mock.calls[4][0].unreviewedIntervalMinutes).toBeNull();
  });

  test('saves: the form re-renders from the server answer, not from its own guess', async () => {
    // The server may normalise; the form has to show what was actually
    // stored. Answer with a value the form did not send.
    putSpy.mockResolvedValue(prefs({ burstCount: 1, mechanicEnabled: false }));
    mount();
    await screen.findByTestId('review-burst-count');
    const user = userEvent.setup();

    await user.clear(field('review-burst-count'));
    await user.type(field('review-burst-count'), '5');
    await user.click(saveButton());

    await waitFor(() => expect(field('review-burst-count').value).toBe('1'));
    expect(field('review-mechanic-enabled').checked).toBe(false);
    expect(screen.getByText('Review settings saved')).toBeTruthy();
  });
});

describe('row 99 — a value outside the bounds shows the server refusal, unedited', () => {
  test('the 422 text is displayed and the offending value stays in the field', async () => {
    putSpy.mockRejectedValue(
      new BusinessError(
        422,
        'burstCount must be between 0 and 6',
        'invalid_schedule_setting',
      ),
    );
    mount();
    await screen.findByTestId('review-burst-count');
    const user = userEvent.setup();

    // 9 is above the max the server declared (6). It must reach the wire —
    // a form that clamped it here would leave the reader looking at a page
    // that agreed with them while the system stored something else.
    await user.clear(field('review-burst-count'));
    await user.type(field('review-burst-count'), '9');
    expect(field('review-burst-count').value).toBe('9');

    await user.click(saveButton());
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    expect(putSpy.mock.calls[0][0].burstCount).toBe(9);

    // The refusal is shown, in the server's own words — the form does not
    // paraphrase it, and it names WHICH panel refused.
    await waitFor(() =>
      expect(screen.getByText('burstCount must be between 0 and 6')).toBeTruthy(),
    );
    expect(screen.getByText('Review settings error')).toBeTruthy();

    // …and nothing was corrected: the value the reader typed is still there,
    // ready to be fixed. Nothing was written server-side either.
    expect(field('review-burst-count').value).toBe('9');
    expect(screen.queryByText('Review settings saved')).toBeNull();
  });

  test('an interval below the minimum is refused the same way (SC-027)', async () => {
    putSpy.mockRejectedValue(
      new BusinessError(
        422,
        'unacceptedIntervalMinutes must be at least 15',
        'invalid_schedule_setting',
      ),
    );
    mount();
    await screen.findByTestId('review-unaccepted-interval');
    const user = userEvent.setup();

    await user.type(field('review-unaccepted-interval'), '5');
    await user.click(saveButton());

    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    expect(putSpy.mock.calls[0][0].unacceptedIntervalMinutes).toBe(5);
    await waitFor(() =>
      expect(
        screen.getByText('unacceptedIntervalMinutes must be at least 15'),
      ).toBeTruthy(),
    );
    expect(field('review-unaccepted-interval').value).toBe('5');
  });

});

describe('rows 99 + 104 — a value the form will not send is REFUSED, out loud', () => {
  /**
   * The pair of tests below is the one the module comment used to say could
   * not be written. It could: what killed it was a NumberInput that rewrote
   * the entry before the form ever saw it — `2.7` glued into `27` on the
   * keystroke, a lone `-` wiped to empty on blur. Both are gone, and with
   * them the difference between the two ways to submit: a click on
   * "Save" blurs the field first, Enter does not, and until now that
   * alone decided whether the guard fired.
   *
   * So each case is asserted on BOTH paths. A form that refuses only where
   * the reader pressed Enter refuses on the rarer one.
   */

  test('a fractional entry is refused, not rounded or glued — by click', async () => {
    mount();
    await screen.findByTestId('review-unaccepted-interval');
    const user = userEvent.setup();

    await user.clear(field('review-unaccepted-interval'));
    await user.type(field('review-unaccepted-interval'), '180.5');
    // What was typed is what is held: no digit gluing (`1805`), no rounding.
    expect(field('review-unaccepted-interval').value).toBe('180.5');

    await user.click(saveButton());

    // Nothing travelled. `1805` is INSIDE the server's range, so had the
    // separator been dropped the save would have succeeded and stored a
    // schedule an order of magnitude away from the one asked for — silently,
    // with a green "Saved" (SC-022).
    expect(putSpy).not.toHaveBeenCalled();
    expect(
      screen.getByText(/must be an integer/i).textContent,
    ).toContain('«Background interval, unaccepted (minutes)»');
    expect(screen.queryByText('Review settings saved')).toBeNull();
    // And the entry stays put, ready to be corrected.
    expect(field('review-unaccepted-interval').value).toBe('180.5');
  });

  test('a fractional entry is refused the same way — by Enter', async () => {
    mount();
    await screen.findByTestId('review-burst-count');
    const user = userEvent.setup();

    await user.clear(field('review-burst-count'));
    await user.type(field('review-burst-count'), '2.7{Enter}');

    expect(putSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/must be an integer/i)).toBeTruthy();
    expect(field('review-burst-count').value).toBe('2.7');
  });

  test('a half-typed "-" is refused, not silently reset to the factory — by click', async () => {
    mount();
    await screen.findByTestId('review-burst-count');
    const user = userEvent.setup();

    // The stored value is 2. Clearing the field and typing "-" is a
    // half-finished entry, and the click that follows is the ordinary way to
    // submit — it blurs the field on the way.
    await user.clear(field('review-burst-count'));
    await user.type(field('review-burst-count'), '-');
    await user.click(saveButton());

    // An empty field means "reset to factory" on this contract, so a form
    // that let the blur normalise "-" away would have PUT `burstCount: null`
    // and replaced the stored 2 with the factory 3 — reporting success.
    expect(putSpy).not.toHaveBeenCalled();
    expect(
      screen.getByText(/must be an integer/i).textContent,
    ).toContain('«Reminders in the first hour (unaccepted)»');
    expect(field('review-burst-count').value).toBe('-');
  });

  test('a half-typed "-" is refused the same way — by Enter', async () => {
    mount();
    await screen.findByTestId('review-burst-count');
    const user = userEvent.setup();

    await user.clear(field('review-burst-count'));
    await user.type(field('review-burst-count'), '-{Enter}');

    expect(putSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/must be an integer/i)).toBeTruthy();
  });

  test('the refusal names every offending field, and only those', async () => {
    mount();
    await screen.findByTestId('review-burst-count');
    const user = userEvent.setup();

    await user.clear(field('review-burst-count'));
    await user.type(field('review-burst-count'), '1.5');
    await user.clear(field('review-unreviewed-interval'));
    await user.type(field('review-unreviewed-interval'), 'x');
    await user.click(saveButton());

    const text = screen.getByText(/must be an integer/i).textContent ?? '';
    expect(text).toContain('«Reminders in the first hour (unaccepted)»');
    expect(text).toContain('«Background interval, unreviewed (minutes)»');
    // The interval left alone holds empty/unset, which is a value, not a fault.
    expect(text).not.toContain('«Background interval, unaccepted (minutes)»');
  });

  test('the refusal clears on the next edit and the corrected value saves', async () => {
    putSpy.mockImplementation((input) =>
      Promise.resolve(prefs({ ...(input as Partial<ReviewPrefs>) })),
    );
    mount();
    await screen.findByTestId('review-burst-count');
    const user = userEvent.setup();

    await user.clear(field('review-burst-count'));
    await user.type(field('review-burst-count'), '2.7');
    await user.click(saveButton());
    expect(screen.getByText(/must be an integer/i)).toBeTruthy();

    await user.clear(field('review-burst-count'));
    await user.type(field('review-burst-count'), '3');
    expect(screen.queryByText(/must be an integer/i)).toBeNull();

    await user.click(saveButton());
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    expect(putSpy.mock.calls[0][0].burstCount).toBe(3);
  });
});

describe('the empty/malformed guard — where a draft value becomes a wire value', () => {
  // Asserted at this level too, alongside the two UI paths above: this pair
  // of functions is where a silent "reset to factory" would be born, and
  // the cases below (`NaN`, a bare `0`) are cheaper to state here than to
  // stage through the form.

  test('empty is empty/unset — an explicit null, never 0', () => {
    expect(toWire('')).toBeNull();
    expect(isMalformed('')).toBe(false);
    // Whitespace is emptiness, not a malformed entry.
    expect(toWire('  ')).toBeNull();
    expect(isMalformed('  ')).toBe(false);
  });

  test('0 stays 0 — "no burst" is a setting, not an absence', () => {
    expect(toWire('0')).toBe(0);
    expect(isMalformed('0')).toBe(false);
  });

  test('a well-formed out-of-range number passes through untouched', () => {
    // Bounds are the server's to enforce; nothing is clamped on the way out.
    expect(toWire('9')).toBe(9);
    expect(toWire('-3')).toBe(-3);
    expect(isMalformed('9')).toBe(false);
    expect(isMalformed('-3')).toBe(false);
  });

  test('a fractional value is malformed — the error text promises integers', () => {
    expect(isMalformed('2.7')).toBe(true);
    expect(isMalformed('180.5')).toBe(true);
    expect(isMalformed('0.0')).toBe(true);
  });

  test('a half-typed value is flagged, so it never becomes NaN → null', () => {
    // `JSON.stringify(NaN)` is `null`, and null on this contract means
    // "reset the parameter to factory" — a value nobody asked for.
    expect(isMalformed('-')).toBe(true);
    expect(isMalformed('.')).toBe(true);
    expect(isMalformed('abc')).toBe(true);
    expect(Number.isNaN(toWire('-'))).toBe(true);
  });
});
