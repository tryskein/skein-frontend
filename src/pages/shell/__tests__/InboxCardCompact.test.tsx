/**
 * sk-733.4 — the Accept control of a narrow Queues card.
 *
 * Maintainers' remark: in a narrow column the labelled «✓ Accept» button did
 * not fit beside «from … · date» and dropped to a row of its own, alone
 * at the bottom right. Decision: when it does not fit, the control is the
 * ✓ glyph alone with an instant tooltip; a wide card keeps the label.
 *
 * jsdom has no layout, so the two widths `useFitsWidth` compares are
 * stubbed on the prototype, as in `WatchingSelectStrip.test.tsx`:
 * `clientWidth` is what the footer offers, `scrollWidth` what the full
 * one-line row needs.
 */
import { ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { IssueSummary } from '../../../api/issues';
import { InboxCard } from '../InboxCard';
import i18n from '../../../i18n/config';

function widths(available: number, needed: number) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(available);
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(needed);
}

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const item = {
    id: 'shop-14',
    projectId: 'p1',
    version: 1,
    title: 'Promo code is not applied to discounted items',
    type: 'bug',
    priority: 1,
    status: 'open',
    createdByUsername: 'reviewer',
    createdAt: '2026-08-31T10:00:00Z',
    updatedAt: '2026-08-31T10:00:00Z',
    acceptedAt: null,
    labels: [],
    componentIds: [],
  } as unknown as IssueSummary;
  const wrap = ({ children }: { children: ReactNode }) => (
    <MantineProvider forceColorScheme="light">
      <QueryClientProvider client={qc}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
  return render(
    <InboxCard item={item} selected={false} onSelect={vi.fn()} projectHandle="shop" isRinging={false} />,
    { wrapper: wrap },
  );
}

const acceptName = () => i18n.t('inbox:card.acceptAria', { id: 'shop-14' });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('sk-733.4 — Accept on a narrow card', () => {
  test('the row does not fit: the button is the glyph alone, still named Accept', () => {
    widths(200, 320);
    renderCard();
    const btn = screen.getByRole('button', { name: acceptName() });
    expect((btn.textContent ?? '').trim()).toBe('');
    expect(btn.querySelectorAll('svg')).toHaveLength(1);
  });

  test('the glyph-only button says what it does on hover', async () => {
    widths(200, 320);
    renderCard();
    const btn = screen.getByRole('button', { name: acceptName() });
    await act(async () => {
      fireEvent.mouseEnter(btn);
      fireEvent.pointerEnter(btn);
    });
    expect((await screen.findByRole('tooltip')).textContent).toBe(i18n.t('inbox:card.acceptTitle'));
  });

  test('the row fits: the button keeps its label', () => {
    widths(400, 320);
    renderCard();
    const btn = screen.getByRole('button', { name: acceptName() });
    expect((btn.textContent ?? '').trim()).toBe(i18n.t('inbox:card.accept'));
  });
});
