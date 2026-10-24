/**
 * sk-551.49 — the Watching select-mode strip is one line at every column
 * width: the count lives in the main button, Cancel is an × icon, and a
 * strip narrower than the full-label line folds the main button to icon
 * + number while its accessible name stays whole.
 *
 * jsdom has no layout, so the two widths are stubbed on the prototype:
 * `clientWidth` is what the strip offers, `scrollWidth` is what the
 * hidden full-label copy needs (same technique as WatchingFilter.test).
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { WatchingSelectStrip } from '../WatchingSelectStrip';

function stubWidths(available: number, needed: number) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(available);
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(needed);
}

function mount(props: Partial<Parameters<typeof WatchingSelectStrip>[0]> = {}) {
  const onUnwatch = vi.fn();
  const onCancel = vi.fn();
  render(
    <MantineProvider>
      <WatchingSelectStrip
        count={2}
        disabled={false}
        onUnwatch={onUnwatch}
        onCancel={onCancel}
        {...props}
      />
    </MantineProvider>,
  );
  return { onUnwatch, onCancel };
}

/** The visible text of a button, without its (aria-hidden) icon. */
const visibleText = (el: HTMLElement) => el.textContent?.trim();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('sk-551.49 — the select strip on one line', () => {
  test('the count is in the main button, and pressing it stops the ticked cards', () => {
    stubWidths(400, 220);
    const { onUnwatch } = mount();
    const stop = screen.getByRole('button', { name: 'Stop watching · 2' });
    expect(visibleText(stop)).toBe('Stop watching · 2');
    fireEvent.click(stop);
    expect(onUnwatch).toHaveBeenCalledTimes(1);
  });

  test('Cancel is an icon button named «Cancel» that leaves the mode', () => {
    stubWidths(400, 220);
    const { onCancel } = mount();
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(visibleText(cancel)).toBe('');
    fireEvent.click(cancel);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test('a strip narrower than the full line folds the button to the number, name kept', () => {
    stubWidths(150, 220);
    mount();
    const stop = screen.getByRole('button', { name: 'Stop watching · 2' });
    expect(visibleText(stop)).toBe('2');
  });

  test('the tally is still announced, without a visible «Selected N» label', () => {
    stubWidths(400, 220);
    mount({ count: 3 });
    expect(screen.getByRole('status').textContent).toBe('Selected 3');
  });

  test('nothing ticked → the main button is disabled', () => {
    stubWidths(400, 220);
    mount({ count: 0, disabled: true });
    expect(screen.getByRole('button', { name: 'Stop watching · 0' })).toHaveProperty(
      'disabled',
      true,
    );
  });
});
