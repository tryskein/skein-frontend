/**
 * sk-285.7.2.69 — audit 2B, finding R-8 (confirming AM6): the version
 * beside Logout in the account menu.
 *
 * `AppVersionBadge` reads `/version.json` — the file the image build
 * writes from `APP_VERSION` — and renders nothing when the read fails.
 * These tests hold both branches of that behaviour.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';

import { AppVersionBadge } from '../../../components/VersionCheck';

describe('R-8 — the badge renders what that file says', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
    cleanup();
  });

  test('a served version is printed as `v<version>`, with a spoken name', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ version: '0.52.0' }),
    })) as unknown as typeof fetch;

    render(<AppVersionBadge />);
    const badge = await screen.findByText('v0.52.0');
    // Sighted readers get the `v`; the accessible name says the word.
    expect(badge.getAttribute('aria-label')).toBe('Skein version 0.52.0');
  });

  test('a failed read still renders nothing — the fix is the file, not a fallback string', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;

    const { container } = render(<AppVersionBadge />);
    // The badge renders nothing BEFORE the read settles too, so the
    // assertion is only meaningful once the rejected fetch has been seen
    // and its handler has run.
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    await act(async () => {});
    expect(container.querySelector('.header-version-badge')).toBeNull();
    expect(container.textContent ?? '').not.toMatch(/v\S/);
    // Deliberate: inventing «vdev» when the read fails would print a
    // version the running bundle may not be.
  });
});
