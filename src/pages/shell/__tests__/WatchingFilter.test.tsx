/**
 * sk-551.10 — the filter falls back to a compact dropdown when the
 * Queues column is narrower than the segmented control needs.
 *
 * The decision is the column's width against the control's natural
 * width (plan: "ResizeObserver of the column, not of the window"). jsdom has no layout,
 * so the two widths are stubbed on the prototype: `clientWidth` is what
 * the column offers, `scrollWidth` is what the hidden measurer needs.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import i18n from '../../../i18n/config';
import { WatchingFilter, fitsContentBox } from '../WatchingFilter';

/** The filter's accessible name, by dictionary key (§5: copy is not a contract). */
const FILTER_NAME = i18n.t('inbox:watching.filter.aria');

function stubWidths(available: number, needed: number) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(available);
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(needed);
}

function mount() {
  return render(
    <MantineProvider>
      <WatchingFilter state="open" onChange={vi.fn()} stateTotal={3} shown={3} truncated={false} />
    </MantineProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('sk-551.10 — segmented control or compact dropdown, by the column width', () => {
  test('room enough → the segmented control', () => {
    stubWidths(248, 215);
    mount();
    expect(screen.getByRole('radio', { name: 'Open' })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: FILTER_NAME })).toBeNull();
  });

  test('narrower than the control → the same choice as a dropdown', () => {
    stubWidths(184, 215);
    mount();
    const select = screen.getByRole('textbox', {
      name: FILTER_NAME,
    }) as HTMLInputElement;
    expect(select.value).toBe('Open');
    // The real segmented control is gone; only the hidden measurer has
    // radios, and it is out of the accessibility tree.
    expect(screen.queryByRole('radio', { name: 'Open' })).toBeNull();
  });
});

// sk-551.10 review: the control sits in the CONTENT
// box; the filter block's padding is not room for it.
describe('sk-551.10 review — the threshold is the content box', () => {
  test.each([
    // clientWidth (padding box), padding L, padding R, needed, verdict
    [216, 8, 8, 210, false], // the reviewers' example: content 200 < 210 → dropdown
    [216, 8, 8, 200, true], // exactly fits the content box
    [216, 0, 0, 210, true], // no padding: the padding box IS the content box
    [0, 8, 8, 210, null], // not laid out: no verdict
  ] as const)('client %i, padding %i+%i, needed %i → %s', (client, l, r, needed, want) => {
    expect(fitsContentBox(client, l, r, needed)).toBe(want);
  });

  test('a 216px block with 8px padding and a 210px segment gets the dropdown', () => {
    stubWidths(216, 210);
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
      const style = real(el, pseudo);
      if (!(el as Element).classList?.contains('watching-filter')) return style;
      return new Proxy(style, {
        get(target, prop) {
          if (prop === 'paddingLeft' || prop === 'paddingRight') return '8px';
          const v = Reflect.get(target, prop);
          return typeof v === 'function' ? v.bind(target) : v;
        },
      });
    });
    mount();
    expect(screen.getByRole('textbox', { name: FILTER_NAME })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Open' })).toBeNull();
  });
});
