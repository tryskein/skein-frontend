/**
 * sk-62.2 — `RemindersSection` (card reminder block) tests.
 *
 * Mocks the FROZEN reminders REST client and asserts:
 *   - ALL reminders on the issue are listed (the block supports > 1);
 *   - a snooze chip maps to the correct API `by` payload (`+1d` → 1d);
 *   - the armed vs ringing rendering branch is driven off remindAt.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { Reminder, RemindersListResponse } from '../../../../api/reminders';
import { RemindersSection } from './RemindersSection';
import { en } from '../../../../i18n/locales/en';

const listSpy = vi.fn<() => Promise<RemindersListResponse>>();
const snoozeSpy = vi.fn();
const createSpy = vi.fn();

vi.mock('../../../../api/reminders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../api/reminders')>();
  return {
    ...actual,
    listReminders: () => listSpy(),
    snoozeReminder: (args: unknown) => {
      snoozeSpy(args);
      return Promise.resolve({});
    },
    createReminder: (args: unknown) => {
      createSpy(args);
      return Promise.resolve({});
    },
    dismissReminder: () => Promise.resolve(undefined),
  };
});

vi.mock('../../../../components/Toaster', () => ({
  useToaster: () => ({ error: vi.fn(), success: vi.fn() }),
}));

// Far-future remindAt → always armed regardless of when the test runs.
const FUTURE = '2099-01-01T00:00:00.000Z';
// Far-past remindAt → always ringing.
const PAST = '2000-01-01T00:00:00.000Z';

function reminder(over: Partial<Reminder> = {}): Reminder {
  return {
    id: 'rem-1',
    issueId: 'sk-1',
    issueTitle: 'title',
    issueStatus: 'open',
    projectId: 'p-uuid',
    issueType: 'task',
    issuePriority: 3,
    remindAt: FUTURE,
    snoozeCount: 0,
    state: 'armed',
    ...over,
  };
}

function renderSection() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <RemindersSection projectId="p-uuid" issueId="sk-1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  listSpy.mockReset();
  snoozeSpy.mockReset();
  createSpy.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('RemindersSection', () => {
  test('lists ALL reminders on the task (more than one)', async () => {
    listSpy.mockResolvedValue({
      reminders: [
        reminder({ id: 'a', remindAt: PAST, state: 'ringing' }),
        reminder({ id: 'b', remindAt: FUTURE, state: 'armed' }),
      ],
      ringingTaskCount: 1,
    });
    const { container } = renderSection();

    await waitFor(() =>
      expect(container.querySelectorAll('.reminder-row').length).toBe(2),
    );
    // One ringing, one armed — each row prints its own branch's copy,
    // taken from the dictionary key rather than pinned as a literal.
    const rows = container.querySelectorAll('.reminder-row');
    const ringingWord = en.details.reminders.ringing;
    const armedPrefix = en.details.reminders.armedIn.split('{{')[0];
    expect(rows[0].textContent).toContain(ringingWord);
    expect(rows[0].textContent).not.toContain(armedPrefix);
    expect(rows[1].textContent).toContain(armedPrefix);
    expect(rows[1].textContent).not.toContain(ringingWord);

    // a11y (audit sk-194, wave A): this section renders several reminders of
    // the SAME issue, so the row buttons repeat and their accessible names
    // must tell them apart. Assert UNIQUENESS, not just that the label carries
    // some context — the first attempt disambiguated by issueId, which is
    // identical on every row here and therefore fixed nothing.
    for (const verb of ['Snooze', 'Turn off']) {
      const names = screen
        // Anchor on the trailing space: the accessible name is the verb
        // plus the row's "when" text, so `^<verb> ` matches exactly the
        // per-row buttons and nothing else.
        .getAllByRole('button', { name: new RegExp(`^${verb} `) })
        .map((b) => b.getAttribute('aria-labelledby'))
        .map((ids) =>
          (ids ?? '')
            .split(' ')
            .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
            .join(' '),
        );
      expect(names.length).toBe(2); // one ringing + one armed, seeded above
      expect(new Set(names).size).toBe(names.length);
      // And the name must actually carry the row context, not just the verb.
      for (const n of names) expect(n.length).toBeGreaterThan(verb.length);
    }
  });

  test('snooze chip "+1 day" sends by="1d"', async () => {
    listSpy.mockResolvedValue({
      reminders: [reminder({ id: 'a', remindAt: PAST, state: 'ringing' })],
      ringingTaskCount: 1,
    });
    const user = userEvent.setup();
    const { container } = renderSection();

    await waitFor(() =>
      expect(container.querySelector('.reminder-row')).not.toBeNull(),
    );

    // Open the snooze panel.
    await user.click(screen.getByRole('button', { name: /Snooze/ }));
    // Click the "+1 day" chip.
    await user.click(screen.getByRole('button', { name: '+1 day' }));

    await waitFor(() => expect(snoozeSpy).toHaveBeenCalledTimes(1));
    const arg = snoozeSpy.mock.calls[0][0] as { reminderId: string; by?: string };
    expect(arg.reminderId).toBe('a');
    expect(arg.by).toBe('1d');
  });

  test('hourly snooze chip "+6h" sends by="6h"', async () => {
    listSpy.mockResolvedValue({
      reminders: [reminder({ id: 'a', remindAt: PAST, state: 'ringing' })],
      ringingTaskCount: 1,
    });
    const user = userEvent.setup();
    const { container } = renderSection();

    await waitFor(() =>
      expect(container.querySelector('.reminder-row')).not.toBeNull(),
    );

    await user.click(screen.getByRole('button', { name: /Snooze/ }));
    await user.click(screen.getByRole('button', { name: '+6h' }));

    await waitFor(() => expect(snoozeSpy).toHaveBeenCalledTimes(1));
    const arg = snoozeSpy.mock.calls[0][0] as { reminderId: string; by?: string };
    expect(arg.reminderId).toBe('a');
    expect(arg.by).toBe('6h');
  });

  test('snooze passes the optional reason through', async () => {
    listSpy.mockResolvedValue({
      reminders: [reminder({ id: 'a', remindAt: PAST, state: 'ringing' })],
      ringingTaskCount: 1,
    });
    const user = userEvent.setup();
    const { container } = renderSection();
    await waitFor(() =>
      expect(container.querySelector('.reminder-row')).not.toBeNull(),
    );

    await user.click(screen.getByRole('button', { name: /Snooze/ }));
    const row = container.querySelector('.reminder-row') as HTMLElement;
    const reasonInput = within(row).getByLabelText('Snooze reason');
    await user.type(reasonInput, 'later');
    await user.click(screen.getByRole('button', { name: '+1h' }));

    await waitFor(() => expect(snoozeSpy).toHaveBeenCalledTimes(1));
    const arg = snoozeSpy.mock.calls[0][0] as { by?: string; reason?: string };
    expect(arg.by).toBe('1h');
    expect(arg.reason).toBe('later');
  });

  // sk-285.6.2 / sk-285.6.8 — the empty block folded onto its heading
  // row and the private sentence ("No reminders on this task.") was
  // replaced by the card-wide empty word. The affordance is the point of
  // the assertion and did not move: it rides ON the collapsed row.
  test('empty state collapses to one row and keeps the "Add reminder" affordance', async () => {
    listSpy.mockResolvedValue({ reminders: [], ringingTaskCount: 0 });
    const { container } = renderSection();

    await waitFor(() =>
      expect(container.querySelector('.detail-section--empty')).not.toBeNull(),
    );
    expect(screen.getByText('none')).toBeTruthy();
    expect(screen.queryByText('No reminders on this task.')).toBeNull();
    // Folded means the body is not rendered at all — not hidden.
    expect(container.querySelector('.detail-section-body')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add reminder' })).toBeTruthy();
  });

  // sk-285.6.2 fallout: with the block collapsed this button is the ONLY
  // door into the section, and pressing it unmounts the button. Focus
  // has to land inside the form it opened — otherwise it falls to
  // <body> and a keyboard user re-tabs the whole card to reach what
  // they just asked for (WCAG 2.4.3).
  // sk-285.6.7 — the card runs ONE clock. The armed row's hover used to
  // hand back `DD.MM HH:MM` read off the browser's zone, with no year
  // and no zone marker, inside a card whose comment stamps, closed-at
  // row and activity feed all end in `UTC`. A reader in UTC+3 had every
  // reason to read it as UTC and set/read the alarm three hours wrong.
  test('the armed row hover is the product-wide absolute stamp, zone stated', async () => {
    listSpy.mockResolvedValue({
      reminders: [
        reminder({ id: 'a', remindAt: '2099-03-04T14:30:00.000Z', state: 'armed' }),
      ],
      ringingTaskCount: 0,
    });
    const { container } = renderSection();

    const armed = await waitFor(() => {
      const el = container.querySelector('.reminder-when-armed');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });

    const title = armed.getAttribute('title') ?? '';
    // The one absolute form: full date, minutes, zone. Asserting the
    // literal rather than a /UTC/ match is what catches a silent switch
    // back to a local reading — `04.03 17:30 UTC` would pass a loose
    // regex and still be three hours wrong.
    expect(title).toContain('2099-03-04 14:30 UTC');
    // …and the shape that used to be here must not come back.
    expect(title).not.toMatch(/\b\d{2}\.\d{2}\b/);
  });

  test('pressing "Add reminder" moves focus into the form it opens', async () => {
    const user = userEvent.setup();
    listSpy.mockResolvedValue({ reminders: [], ringingTaskCount: 0 });
    renderSection();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add reminder' })).toBeTruthy(),
    );
    await user.click(screen.getByRole('button', { name: 'Add reminder' }));

    const when = screen.getByLabelText('When it rings');
    await waitFor(() => expect(document.activeElement).toBe(when));
  });
});

// ───── sk-303.13 (T035, row 43) — the local clock rings on time ─────

describe('RemindersSection — armed → ringing on the local clock', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('an armed reminder starts ringing when its time passes, with no refetch and no frame', async () => {
    // The timely part of the alarm is local: nothing arrives from the
    // server at the moment the minute hand crosses `remindAt`. The live
    // envelope (T035) refreshes the LIST; this is what makes the card
    // itself flip on time, and it must keep working with the network
    // silent — no notification frame, no push, not even a poll.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T10:00:00.000Z'));
    listSpy.mockResolvedValue({
      reminders: [reminder({ remindAt: '2026-06-01T10:00:02.000Z', state: 'armed' })],
      ringingTaskCount: 0,
    });

    const { container } = renderSection();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(container.querySelector('.reminder-row.armed')).not.toBeNull();
    expect(container.querySelector('.reminder-row.ringing')).toBeNull();

    // Three seconds later the alarm time has passed.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(container.querySelector('.reminder-row.ringing')).not.toBeNull();
    expect(container.querySelector('.reminder-row.armed')).toBeNull();
    // The server was asked exactly once, on mount: the flip came from
    // the clock, not from a round-trip.
    expect(listSpy).toHaveBeenCalledTimes(1);
  });
});
