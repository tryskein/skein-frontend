/**
 * sk-285.7.2.46 — the Queues card, measured on a mounted node.
 *
 * ─── Q-2 / A5: the check mark was drawn TWICE ────────────────────────
 *
 * `Sk Queues.dc.html` draws the Accept control as one `ti-check` in
 * `--ok` followed by the word `Accept`. The product drew both: a Tabler
 * `IconCheck` added by an earlier wave, AND the literal `'✓ '` still
 * sitting at the head of the translation string it was meant to
 * replace. Measured live at 1440×900: `.inbox-accept-btn` →
 * `innerText === "✓ Accept"` with `querySelectorAll('svg').length === 1`.
 * On screen: «✓ ✓ Accept».
 *
 * The lesson the guard is shaped around is that ADDING an icon is not
 * REMOVING a glyph, and a check that only counts icons cannot tell the
 * two apart — the count was already 1 while the defect was live. So the
 * assertion is a conjunction: exactly one `<svg>` AND no `✓` anywhere in
 * the rendered text. Either half alone passes on the defect.
 *
 * Both states of the same slot are covered, because the second one is
 * where a one-surface fix would have stopped: the card swaps the button
 * for a static `accepted` badge once the issue is accepted, and that
 * badge carried the identical literal in the identical position.
 */

import { ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { IssueSummary } from '../../../api/issues';
import { InboxCard } from '../InboxCard';
import { en } from '../../../i18n/locales/en';
import { ru } from '../../../i18n/locales/ru';

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return (
    <MantineProvider forceColorScheme="light">
      <QueryClientProvider client={qc}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
}

function makeItem(accepted: boolean): IssueSummary {
  return {
    id: 'shop-14',
    projectId: 'p1',
    version: 1,
    title: 'Promo code is not applied to discounted items',
    type: 'bug',
    priority: 1,
    status: 'open',
    pinned: false,
    assignee: 'bob',
    createdBy: 'user-alice',
    createdByUsername: 'reviewer',
    createdAt: '2026-08-31T10:00:00Z',
    updatedAt: '2026-08-31T10:00:00Z',
    acceptedAt: accepted ? '2026-08-31T11:00:00Z' : null,
    labels: [],
    componentIds: [],
    commentsCount: 0,
    isBlocked: false,
  } as unknown as IssueSummary;
}

function renderCard(accepted: boolean) {
  return render(
    <Wrapper>
      <InboxCard
        item={makeItem(accepted)}
        selected={false}
        onSelect={vi.fn()}
        projectHandle="shop"
        isRinging={false}
      />
    </Wrapper>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('sk-285.7.2.46 — one check mark on the Accept control, not two', () => {
  test('the unaccepted state: an icon, and no ✓ in the text', () => {
    const { container } = renderCard(false);
    const btn = container.querySelector('.inbox-accept-btn')!;
    expect(btn).not.toBeNull();
    // Half one — the icon is there. This half was ALREADY true while
    // the defect was live, which is why it cannot stand alone.
    expect(btn.querySelectorAll('svg')).toHaveLength(1);
    // Half two — and the literal it replaced is gone. This is the half
    // that was false.
    expect(btn.textContent ?? '').not.toContain('✓');
    expect((btn.textContent ?? '').trim()).toBe('Accept');
  });

  test('the accepted state: the same slot, the same rule', () => {
    // The button is swapped for a static badge once accepted. It
    // carried the identical `'✓ '` in the identical position, and a fix
    // that stopped at the button would have left it there — visible on
    // every card between the accept click and the next refetch.
    const { container } = renderCard(true);
    const badge = container.querySelector('.inbox-accepted-badge')!;
    expect(badge).not.toBeNull();
    expect(badge.querySelectorAll('svg')).toHaveLength(1);
    expect(badge.textContent ?? '').not.toContain('✓');
  });

  test('the whole card renders no ✓ in either state', () => {
    // The two assertions above name their element; this one does not,
    // so a third spelling of the same glyph appearing elsewhere on the
    // card is caught without anyone having to predict where.
    for (const accepted of [false, true]) {
      const { container } = renderCard(accepted);
      expect(container.textContent ?? '').not.toContain('✓');
      cleanup();
    }
  });

  test('the strings behind both states are clean, in both locales', () => {
    const offenders: string[] = [];
    for (const [locale, dict] of [
      ['en', en],
      ['ru', ru],
    ] as const) {
      const card = (dict.inbox as Record<string, unknown>).card as Record<string, string>;
      for (const key of ['accept', 'accepted'] as const) {
        // Tripwire: a renamed key must read as "not checked", not as
        // "clean".
        expect(typeof card[key], `${locale}.inbox.card.${key} is missing`).toBe('string');
        if (card[key].includes('✓')) offenders.push(`${locale}.inbox.card.${key} = ${card[key]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * ─── Q-3: the order of the card's rows ───────────────────────────────
 *
 * `Sk Queues.dc.html` lists the `<article>`'s children as: the
 * `project id` line, the title, the chip row, the footer. The product
 * had the handle alone on row 1, the id sharing row 2 with the chips,
 * and the title third — so one fact (which task, in which project) was
 * split across two rows, and the subject of the card was preceded by a
 * row of coloured pills.
 *
 * Asserted as a SEQUENCE rather than as four separate presence checks:
 * every element was present before too; it was the order that differed.
 */
describe('sk-285.7.2.47 — Q-3: the rows are in the artboard’s order', () => {
  test('project+id · title · chips · footer', () => {
    const { container } = renderCard(false);
    const card = container.querySelector('.inbox-card')!;
    const body = card.querySelector('.inbox-card-body')!;
    expect([...body.children].map((c) => c.className)).toEqual([
      'inbox-card-header',
      'inbox-card-title',
      'inbox-card-chips',
    ]);
    // The footer is the card's last child, outside the click target.
    expect([...card.children].map((c) => c.className)).toEqual([
      'inbox-card-body',
      'inbox-card-footer',
    ]);
  });

  test('the project handle and the id share ONE row', () => {
    const { container } = renderCard(false);
    const header = container.querySelector('.inbox-card-header')!;
    expect(header.querySelector('.inbox-card-project')?.textContent).toBe('shop');
    // The id badge renders its own markup; what matters is that it is
    // inside this row and not on one of its own.
    expect(header.textContent).toContain('shop-14');
    // And nothing else: the chips moved out.
    expect(header.textContent).not.toContain('P1');
    expect(header.textContent).not.toContain('bug');
  });

  test('the chips sit below the title, not above it', () => {
    const { container } = renderCard(false);
    const body = container.querySelector('.inbox-card-body')!;
    const kids = [...body.children];
    const title = kids.findIndex((c) => c.classList.contains('inbox-card-title'));
    const chips = kids.findIndex((c) => c.classList.contains('inbox-card-chips'));
    expect(title).toBeGreaterThan(-1);
    expect(chips).toBeGreaterThan(title);
  });
});
