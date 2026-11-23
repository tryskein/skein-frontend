/**
 * sk-1048.22 — the link a toast offers (`ToastAction`).
 *
 * Contract (`Toaster.tsx#ToastAction`): with a router `navigate`, a plain
 * primary click moves inside the app and the toast goes away; a click that
 * asks for a new tab or window (another button, or Meta / Ctrl / Shift / Alt
 * held) keeps the link's native behaviour, so the app neither navigates nor
 * closes the toast. The link always carries the target as its `href`.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { Notifications, notifications } from '@mantine/notifications';

import { toaster } from './Toaster';

afterEach(() => {
  act(() => notifications.clean());
  cleanup();
});

function showToastWithLink(): { navigate: ReturnType<typeof vi.fn>; link: HTMLElement } {
  render(
    <MantineProvider>
      <Notifications />
    </MantineProvider>,
  );
  const navigate = vi.fn();
  act(() => {
    toaster.success('Joined the space', { action: { label: 'Open', to: '/spaces/acme', navigate } });
  });
  const link = screen.getByRole('link', { name: 'Open' });
  expect(link.getAttribute('href')).toBe('/spaces/acme');
  return { navigate, link };
}

describe('toast action link', () => {
  test('a plain click navigates inside the app, cancels the page load and closes the toast', async () => {
    const { navigate, link } = showToastWithLink();

    const notCancelled = fireEvent.click(link, { button: 0 });

    expect(notCancelled).toBe(false);
    expect(navigate).toHaveBeenCalledWith('/spaces/acme');
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Open' })).toBeNull());
  });

  test('without a router navigate a plain click is left to the browser', () => {
    render(
      <MantineProvider>
        <Notifications />
      </MantineProvider>,
    );
    act(() => {
      toaster.info('Exported', { action: { label: 'Download', to: '/exports/1' } });
    });
    const link = screen.getByRole('link', { name: 'Download' });

    expect(fireEvent.click(link, { button: 0 })).toBe(true);
    expect(screen.getByRole('link', { name: 'Download' })).toBe(link);
  });

  test.each([
    { name: 'Meta', init: { button: 0, metaKey: true } },
    { name: 'Ctrl', init: { button: 0, ctrlKey: true } },
    { name: 'Shift', init: { button: 0, shiftKey: true } },
    { name: 'Alt', init: { button: 0, altKey: true } },
    { name: 'the middle button', init: { button: 1 } },
  ])('a click with $name keeps the native link and the toast', ({ init }) => {
    const { navigate, link } = showToastWithLink();

    const notCancelled = fireEvent.click(link, init);

    expect(notCancelled).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Open' })).toBe(link);
  });
});
