/**
 * sk-118 — the retire-vs-done close dialog. Closing a standing task is a
 * retire, not a normal close; the dialog reframes the verb/placeholder and
 * surfaces the `standing_has_open_children` guard (with the offending
 * child ids) when the backend rejects the retire.
 */

import { ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { StatusChangeReasonModal } from './StatusChangeReasonModal';

function Wrapper({ children }: { children: ReactNode }) {
  return <MantineProvider forceColorScheme="dark">{children}</MantineProvider>;
}

afterEach(() => cleanup());

const noop = vi.fn();

describe('StatusChangeReasonModal — sk-118 retire framing', () => {
  test('retire reframes the title + verb to «Retire»', () => {
    render(
      <Wrapper>
        <StatusChangeReasonModal
          opened
          issueId="sk-42"
          next="closed"
          isRetire
          onSubmit={noop}
          onClose={noop}
        />
      </Wrapper>,
    );
    expect(screen.getByText(/Retire standing task sk-42/i)).toBeTruthy();
    // The primary button reads "Retire", not "OK".
    expect(screen.getByRole('button', { name: 'Retire' })).toBeTruthy();
    expect(screen.getByLabelText('Reason for retiring')).toBeTruthy();
    expect(screen.getByPlaceholderText(/Why retire it\?/i)).toBeTruthy();
  });

  test('a normal (non-retire) close keeps the "Close" framing', () => {
    render(
      <Wrapper>
        <StatusChangeReasonModal
          opened
          issueId="sk-7"
          next="closed"
          onSubmit={noop}
          onClose={noop}
        />
      </Wrapper>,
    );
    expect(screen.getByText(/Close issue sk-7/i)).toBeTruthy();
    // Retire vocabulary must not leak onto a normal close.
    expect(screen.queryByText(/Retire standing task/i)).toBeNull();
    expect(screen.queryByText(/Reason \(retire\)/i)).toBeNull();
    expect(screen.queryByPlaceholderText(/Why retire\?/i)).toBeNull();
  });

  test('surfaces standing_has_open_children with the offending child ids', () => {
    render(
      <Wrapper>
        <StatusChangeReasonModal
          opened
          issueId="sk-42"
          next="closed"
          isRetire
          error="cannot retire (close) a standing task while it still has non-closed children"
          standingChildIds={['sk-42.3', 'sk-42.5']}
          onSubmit={noop}
          onClose={noop}
        />
      </Wrapper>,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/non-closed children/i);
    expect(screen.getByText('sk-42.3')).toBeTruthy();
    expect(screen.getByText('sk-42.5')).toBeTruthy();
  });

  test('without child ids, the plain error message is shown', () => {
    render(
      <Wrapper>
        <StatusChangeReasonModal
          opened
          issueId="sk-42"
          next="closed"
          isRetire
          error="cannot retire (close) a standing task while it still has non-closed children — close or retire the children first"
          onSubmit={noop}
          onClose={noop}
        />
      </Wrapper>,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/cannot retire/i);
  });
});
