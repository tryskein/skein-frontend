/**
 * sk-285.7.2.45 — the Details panel's controls carry ICONS, measured by
 * counting `<svg>` on the mounted tree.
 *
 * ─── Why this measurement type, and not the ones we already had ──────
 *
 * The second fidelity audit's finding D2B-1 / A6 is that `.col-details`
 * held **zero** `<svg>` while the header held 15 and the three other
 * columns held 4, 6 and 7 — the four controls of the panel drew `→`,
 * `👁`, `↪` and `×` as literal characters, and `👁` came out of the
 * system's emoji font.
 *
 * Nothing in this repo could have caught that, and the reason is a
 * missing TYPE of question rather than inattention:
 *
 *   • `getComputedStyle` says nothing
 *     about what a node CONTAINS. A button drawn with a character and a
 *     button drawn with an icon compute the same box, the same colour
 *     and the same font. Every colour/geometry guard in the tree was
 *     green while the panel had no icons at all.
 *   • a scan of the SOURCE for `<IconFoo size={N}>` is a rule about
 *     icons that EXIST; an icon that was never written is not off the
 *     scale, it is absent, and a scan for present icons cannot see an
 *     absent one.
 *
 * So the question asked here is the one neither of those asks: **how
 * many `<svg>` are inside this zone, and inside each control of it.**
 * It is asked on a MOUNTED tree, over the whole state matrix, because
 * the panel's row is state-dependent — the shortcut button is `→ in
 * progress` on an open task, `✗ close` on one in progress, `↻ reopen`
 * on a closed one, and a check that rendered a single state would have
 * pinned one of the five and left four free to regress.
 *
 * ─── The second half: the glyphs are gone from the STRINGS ───────────
 *
 * Adding an icon does not remove a character: the audit's Q-2 is exactly
 * that failure on the Accept button of the Queues card, where a Tabler
 * `IconCheck` was added next to a `'✓ '` that stayed in the translation
 * and the button read `✓ ✓ Accept`. So the icon count is paired with a
 * scan of the rendered TEXT for the characters the icons replaced — on
 * the same mounted tree, so the two halves cannot disagree.
 */

import { ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../auth/AuthContext', async (importActual) => {
  const actual = await importActual<typeof import('../../../auth/AuthContext')>();
  return {
    ...actual,
    useAuth: () => ({
      user: {
        id: 'user-bob',
        username: 'bob',
        email: 'bob@example.com',
        name: 'Bob',
        role: 'user',
      },
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    }),
  };
});

import type { IssueDetail, IssueStatus } from '../../../api/issues';
import { LayoutProvider } from '../../../lib/useLayoutState';
import { DetailsHeader } from './DetailsHeader';
import { en } from '../../../i18n/locales/en';
import { ru } from '../../../i18n/locales/ru';

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return (
    <MantineProvider forceColorScheme="dark">
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <LayoutProvider>{children}</LayoutProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
}

interface Cell {
  status: IssueStatus;
  mine: boolean;
  accepted: boolean;
}

function makeIssue({ status, mine, accepted }: Cell): IssueDetail {
  return {
    id: 'sk-42',
    projectId: 'p1',
    version: 7,
    title: 't',
    description: '',
    type: 'task',
    priority: 2,
    status,
    pinned: false,
    source: 'human',
    design: '',
    acceptanceCriteria: '',
    notes: '',
    createdBy: 'user-alice',
    createdAt: '2026-05-15T10:00:00Z',
    updatedAt: '2026-05-15T10:00:00Z',
    acceptedAt: accepted ? '2026-05-15T11:00:00Z' : null,
    metadata: {},
    componentIds: [],
    labels: [],
    commentsCount: 0,
    commitRefs: [],
    mentions: [],
    isBlocked: false,
    blockers: [],
    assignee: mine ? 'bob' : 'charlie',
    previousAssignees: [],
    dismissedBy: [],
  } as unknown as IssueDetail;
}

const handlers = {
  onUpdateField: vi.fn(),
  onChangeStatus: vi.fn(),
  onAccept: vi.fn(),
  onWatchToggle: vi.fn(),
};

function renderHeader(cell: Cell, isWatching = false) {
  return render(
    <Wrapper>
      <DetailsHeader
        issue={makeIssue(cell)}
        isWatching={isWatching}
        watchToggling={false}
        {...handlers}
      />
    </Wrapper>,
  );
}

const STATUSES: IssueStatus[] = ['open', 'in_progress', 'deferred', 'standing', 'closed'];

/** Every cell of the matrix the panel's row is drawn from. */
function everyCell(): Array<{ cell: Cell; watching: boolean }> {
  const out: Array<{ cell: Cell; watching: boolean }> = [];
  for (const status of STATUSES) {
    for (const mine of [true, false]) {
      for (const accepted of [true, false]) {
        for (const watching of [true, false]) {
          out.push({ cell: { status, mine, accepted }, watching });
        }
      }
    }
  }
  return out;
}

const label = (c: { cell: Cell; watching: boolean }) =>
  `${c.cell.status} · ${c.cell.mine ? 'mine' : "someone else's"} · ${
    c.cell.accepted ? 'accepted' : 'unaccepted'
  } · ${c.watching ? 'watching' : 'not watching'}`;

/**
 * The characters that were standing in for icons on this surface,
 * exactly as the audit found them. `👁` is the one that is not merely a
 * wrong drawing: U+1F441 resolves to the system's emoji face, so it
 * arrives at its own colour and weight and cannot be put on §8's scale.
 */
const STAND_IN_GLYPHS = ['→', '←', '↑', '↓', '↪', '↻', '✓', '✗', '×', '\u{1F441}'];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('sk-285.7.2.45 — svg count, by zone, on a mounted tree', () => {
  test('the panel header is not an icon desert', () => {
    // The reported measurement, restated: `.col-details` → 0. One
    // assertion for the zone as a whole, so a regression that removes
    // every icon at once is caught even if the per-control loop below
    // were ever narrowed.
    const { container } = renderHeader({ status: 'open', mine: true, accepted: true });
    expect(container.querySelectorAll('svg').length).toBeGreaterThan(0);
  });

  for (const c of everyCell()) {
    test(`every labelled control carries an icon — ${label(c)}`, () => {
      const { container } = renderHeader(c.cell, c.watching);
      const buttons = [...container.querySelectorAll('.action-button')];
      // Tripwire: a matrix cell that renders no action button would
      // pass the loop below vacuously. Every state has at least the
      // watch toggle.
      expect(buttons.length).toBeGreaterThan(0);
      const bare = buttons
        .filter((b) => b.querySelectorAll('svg').length === 0)
        .map((b) => (b.textContent ?? '').trim());
      expect(bare).toEqual([]);
    });
  }

  test('the close ✕ is an icon, not the character U+00D7', () => {
    const { container } = renderHeader({ status: 'open', mine: true, accepted: true });
    const close = container.querySelector('.details-header-close')!;
    expect(close.querySelectorAll('svg')).toHaveLength(1);
    // The button is icon-only, so its accessible name has to come from
    // the label rather than from content — and the content must not
    // re-announce anything.
    expect(close.getAttribute('aria-label')).toBeTruthy();
    expect((close.textContent ?? '').trim()).toBe('');
  });
});

describe('sk-285.7.2.45 — and the characters they replaced are gone', () => {
  for (const c of everyCell()) {
    test(`no stand-in glyph is rendered — ${label(c)}`, () => {
      const { container } = renderHeader(c.cell, c.watching);
      // `textContent` of the container, not of each button: an icon
      // added BESIDE a surviving character (the Q-2 failure mode) shows
      // up here and would not show up in the svg count.
      const text = container.textContent ?? '';
      const found = STAND_IN_GLYPHS.filter((g) => text.includes(g));
      expect(found).toEqual([]);
    });
  }

  test('the translation strings themselves are clean, in both locales', () => {
    // The svg count is about the DOM; this is about the source the DOM
    // is built from. Both are needed: a glyph re-added to a string that
    // no current matrix cell renders would slip past the DOM scan.
    const offenders: string[] = [];
    for (const [locale, dict] of [
      ['en', en],
      ['ru', ru],
    ] as const) {
      const details = dict.details as Record<string, unknown>;
      const header = details.header as Record<string, unknown>;
      const shortcuts = header.shortcuts as Record<string, string>;
      const move = details.move as Record<string, string>;
      const subtask = details.subtask as Record<string, string>;
      const entries: Array<[string, string]> = [
        ...Object.entries(shortcuts).map(([k, v]) => [`header.shortcuts.${k}`, v] as [string, string]),
        ['header.accept', header.accept as string],
        ['header.watch', header.watch as string],
        ['header.watching', header.watching as string],
        ['header.readyToClose', header.readyToClose as string],
        ['header.dropFromDelegated', header.dropFromDelegated as string],
        ['header.resumeTracking', header.resumeTracking as string],
        ['move.button', move.button],
        ['subtask.button', subtask.button],
      ];
      for (const [key, value] of entries) {
        // Tripwire: a key renamed out from under this list would read
        // as "clean" rather than as "not checked".
        expect(typeof value, `${locale}.details.${key} is missing`).toBe('string');
        for (const g of STAND_IN_GLYPHS) {
          if (value.includes(g)) offenders.push(`${locale}.details.${key} = ${value}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
