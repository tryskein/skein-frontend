/**
 * sk-674.18 — `Turnstile`: a removed widget is dead.
 *
 * Turnstile keeps the callbacks a widget was rendered with and may call
 * them after `remove` — a token solved in the last moment, an expiry, an
 * error. None of them may reach the caller once the component is gone:
 * the caller has closed the form or left the page, and a token arriving
 * then would send a request without the person.
 *
 * The widget itself is `window.turnstile`, faked: the script is never
 * loaded.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { Turnstile } from './Turnstile';

type Options = {
  callback: (token: string) => void;
  'error-callback': () => void;
  'expired-callback': () => void;
};
let rendered: Options[] = [];

beforeEach(() => {
  rendered = [];
  (window as unknown as { turnstile?: unknown }).turnstile = {
    render: vi.fn((_el: HTMLElement, options: Options) => {
      rendered.push(options);
      return `w${rendered.length}`;
    }),
    remove: vi.fn(),
  };
});
afterEach(() => {
  cleanup();
  delete (window as unknown as { turnstile?: unknown }).turnstile;
});

describe('Turnstile — callbacks of a removed widget reach nobody', () => {
  test('while mounted the token and the expiry reach onToken; after unmount none of the three does', async () => {
    const onToken = vi.fn();
    const view = render(<Turnstile siteKey="site-key" onToken={onToken} />);
    await waitFor(() => expect(rendered).toHaveLength(1));
    const widget = rendered[0];

    // Positive control: the same callbacks work while the widget lives.
    widget.callback('token-live');
    widget['expired-callback']();
    expect(onToken.mock.calls).toEqual([['token-live'], [null]]);

    view.unmount();
    widget.callback('token-after-removal');
    widget['error-callback']();
    widget['expired-callback']();
    expect(onToken).toHaveBeenCalledTimes(2);
  });
});
