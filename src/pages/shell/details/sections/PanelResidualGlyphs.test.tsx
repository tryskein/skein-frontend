/**
 * sk-285.7.2.57 — the residue D2B-1's fix did not reach.
 *
 * sk-285.7.2.45 closed four controls of the description panel's header
 * and pinned them with `DetailsPanelIcons.test.tsx`. That guard's DOM
 * scan mounts `DetailsHeader` and nothing else, and its string scan
 * enumerates the header's OWN keys — so two zones of the same panel,
 * both drawn by the same §8 and neither drawn by any artboard (§9),
 * kept their stand-ins:
 *
 *   details.closedReason.label  '✓ Closed'  / '✓ Закрыто'
 *   details.reminders.add       '+ Add reminder'
 *   details.reminders.ringing   '🔔 ringing'
 *   details.reminders.ringingSince
 *   details.reminders.armedIn   '⏰ rings in {{countdown}}'
 *
 * ── Two kinds of wrong, not one ─────────────────────────────────────
 *
 * `✓` and `+` are characters standing in for `check` and `plus`: a face
 * the system picks draws them, so neither the 1.75 stroke nor the
 * 16/20/24 scale reaches them.
 *
 * `🔔` and `⏰` are worse and differently worse. U+1F514 and U+23F0
 * resolve to the platform's EMOJI face, which paints its own colours
 * and ignores `currentColor` outright — a bell rendered in Noto Color
 * Emoji is the same yellow on `--warn` text and on `--ink` text, so the
 * ringing/armed distinction the row makes in colour is not made by the
 * glyph beside it. It cannot be put on §8's scale at all, because it
 * has no stroke to set.
 *
 * ── Why the assertion is the mounted tree ───────────────────────────
 *
 * Same reason `DetailsPanelIcons.test.tsx` gives: `getComputedStyle`
 * says nothing about what a node CONTAINS, and a source scan sees only
 * icons that EXIST. An absent icon is invisible to both. So
 * the question here is the svg count inside each control, asked on a
 * mounted tree, paired with a scan of the rendered TEXT — because
 * adding an icon does not remove a character (audit Q-2: `✓ ✓ Accept`).
 *
 * The string scan beside it covers the locale the DOM scan does not
 * mount, and the surfaces the DOM scan does not reach: a glyph re-added
 * to `ru` would otherwise be invisible here.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { IssueDetail } from '../../../../api/issues';
import type { Reminder, RemindersListResponse } from '../../../../api/reminders';
import { en } from '../../../../i18n/locales/en';
import { ru } from '../../../../i18n/locales/ru';
import { ClosedReasonSection } from './ClosedReasonSection';
import { RemindersSection } from './RemindersSection';

/**
 * Characters that have stood in for icons on this shell, plus the two
 * emoji this task is about. The emoji are listed by CODE POINT rather
 * than pasted, so a reviewer can see which ones without trusting their
 * own terminal's font to distinguish them.
 */
const STAND_IN_GLYPHS = [
  '→',
  '←',
  '↑',
  '↓',
  '↪',
  '↻',
  '✓',
  '✗',
  '×',
  '+',
  '\u{1F441}', // 👁 eye
  '\u{1F514}', // 🔔 bell
  '\u{23F0}', // ⏰ alarm clock
];

const listSpy = vi.fn<() => Promise<RemindersListResponse>>();

vi.mock('../../../../api/reminders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../api/reminders')>();
  return {
    ...actual,
    listReminders: () => listSpy(),
    snoozeReminder: () => Promise.resolve({}),
    createReminder: () => Promise.resolve({}),
    dismissReminder: () => Promise.resolve(undefined),
  };
});

vi.mock('../../../../components/Toaster', () => ({
  useToaster: () => ({ error: vi.fn(), success: vi.fn() }),
}));

/** Far future → always armed; far past → always ringing, whenever this runs. */
const FUTURE = '2099-01-01T00:00:00.000Z';
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

function renderReminders() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <RemindersSection projectId="p-uuid" issueId="sk-1" />
    </QueryClientProvider>,
  );
}

function closedIssue(): IssueDetail {
  return {
    id: 'sk-42',
    projectId: 'p1',
    version: 7,
    title: 't',
    description: '',
    type: 'task',
    priority: 2,
    status: 'closed',
    closedReason: 'shipped in 0.9.0',
    closedAt: '2026-05-15T11:00:00Z',
    pinned: false,
    source: 'human',
    design: '',
    acceptanceCriteria: '',
    notes: '',
    createdBy: 'user-alice',
    createdAt: '2026-05-15T10:00:00Z',
    updatedAt: '2026-05-15T10:00:00Z',
    metadata: {},
    componentIds: [],
    labels: [],
    commentsCount: 0,
    commitRefs: [],
    mentions: [],
    isBlocked: false,
    blockers: [],
    assignee: 'bob',
  } as unknown as IssueDetail;
}

beforeEach(() => {
  listSpy.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('sk-285.7.2.57 — the close-reason callout', () => {
  test('its label carries a drawn tick, not the character U+2713', () => {
    const { container } = render(<ClosedReasonSection issue={closedIssue()} />);
    const label = container.querySelector('.closed-reason-label');
    // Tripwire: the section returns null unless the issue is closed AND
    // the reason is non-empty, and a null render would make every
    // assertion below vacuously true.
    expect(label, 'the callout did not render at all').not.toBeNull();
    expect(label!.querySelectorAll('svg')).toHaveLength(1);
    const svg = label!.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('16');
    expect(svg.getAttribute('stroke-width')).toBe('1.75');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
  });

  test('and no character survives beside it', () => {
    const { container } = render(<ClosedReasonSection issue={closedIssue()} />);
    const text = container.querySelector('.closed-reason-header')!.textContent ?? '';
    expect(STAND_IN_GLYPHS.filter((g) => text.includes(g))).toEqual([]);
    expect(text.trim().length).toBeGreaterThan(0);
  });
});

describe('sk-285.7.2.57 — the reminders block', () => {
  test('the add affordance carries a drawn plus', async () => {
    listSpy.mockResolvedValue({ reminders: [], ringingTaskCount: 0 });
    const { container } = renderReminders();
    const btn = await waitFor(() => {
      const b = container.querySelector('.reminder-add-btn');
      expect(b, 'no add affordance rendered').not.toBeNull();
      return b!;
    });
    expect(btn.querySelectorAll('svg')).toHaveLength(1);
    expect(btn.querySelector('svg')!.getAttribute('width')).toBe('16');
    expect(btn.querySelector('svg')!.getAttribute('stroke-width')).toBe('1.75');
    expect(STAND_IN_GLYPHS.filter((g) => (btn.textContent ?? '').includes(g))).toEqual([]);
    // The accessible name is the label alone — the icon is decoration.
    expect(btn.textContent?.trim()).toBe(en.details.reminders.add);
  });

  test.each([
    ['ringing', PAST, '.reminder-when-ringing'],
    ['armed', FUTURE, '.reminder-when-armed'],
  ])('the %s row draws an alarm instead of an emoji', async (_state, remindAt, selector) => {
    listSpy.mockResolvedValue({
      reminders: [reminder({ remindAt, state: remindAt === PAST ? 'ringing' : 'armed' })],
      ringingTaskCount: remindAt === PAST ? 1 : 0,
    });
    const { container } = renderReminders();
    const when = await waitFor(() => {
      const w = container.querySelector(selector);
      expect(w, `no ${selector} rendered`).not.toBeNull();
      return w!;
    });
    expect(when.querySelectorAll('svg')).toHaveLength(1);
    const svg = when.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('16');
    expect(svg.getAttribute('stroke-width')).toBe('1.75');
    // The one property an emoji can never have: it is painted in the
    // ink of the run it sits in. `stroke="currentColor"` is what Tabler
    // writes and what U+1F514 cannot be given.
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(STAND_IN_GLYPHS.filter((g) => (when.textContent ?? '').includes(g))).toEqual([]);
    expect((when.textContent ?? '').trim().length).toBeGreaterThan(0);
  });

  test('the whole block renders no stand-in character in any of its rows', async () => {
    // Not per-control: a glyph re-added to `snoozed`, `lastReason` or a
    // chip would be inside the block and outside every selector above.
    listSpy.mockResolvedValue({
      reminders: [
        reminder({ id: 'a', remindAt: PAST, state: 'ringing', snoozeCount: 2, lastReason: 'later' }),
        reminder({ id: 'b', remindAt: FUTURE, state: 'armed' }),
      ],
      ringingTaskCount: 1,
    });
    const { container } = renderReminders();
    await waitFor(() => expect(container.querySelectorAll('.reminder-row')).toHaveLength(2));
    const text = container.textContent ?? '';
    // `×` is exempt in ONE place and named: `reminders.snoozed` prints
    // «· snoozed 2×» where the multiplication sign is a unit, not an
    // icon standing in for `x`. Everything else must be clean.
    const exempt = en.details.reminders.snoozed.replace('{{count}}', '2');
    const scanned = text.split(exempt).join('');
    expect(STAND_IN_GLYPHS.filter((g) => scanned.includes(g))).toEqual([]);
  });
});

describe('sk-285.7.2.57 — the strings themselves, in both locales', () => {
  test('no stand-in character and no emoji in the keys this task named', () => {
    const offenders: string[] = [];
    for (const [locale, dict] of [
      ['en', en],
      ['ru', ru],
    ] as const) {
      const details = dict.details as Record<string, unknown>;
      const reminders = details.reminders as Record<string, string>;
      const closedReason = details.closedReason as Record<string, string>;
      const entries: Array<[string, string]> = [
        ['closedReason.label', closedReason.label],
        ['reminders.add', reminders.add],
        ['reminders.ringing', reminders.ringing],
        ['reminders.ringingSince', reminders.ringingSince],
        ['reminders.armedIn', reminders.armedIn],
        // Not named by the task, checked anyway: they sit in the same
        // block and are the keys a re-add would most plausibly land in.
        ['reminders.title', reminders.title],
        ['reminders.armedTitle', reminders.armedTitle],
        ['closedReason.aria', closedReason.aria],
      ];
      for (const [key, value] of entries) {
        // Tripwire: a key renamed out from under this list would read as
        // "clean" rather than as "not checked".
        expect(typeof value, `${locale}.details.${key} is missing`).toBe('string');
        for (const g of STAND_IN_GLYPHS) {
          if (value.includes(g)) offenders.push(`${locale}.details.${key} = ${value}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
