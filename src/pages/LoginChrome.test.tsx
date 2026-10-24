/**
 * sk-514 (14) — the sign-in page: the brand at the top left, the language on the page,
 * "Sign in" in the centre.
 *
 * ─── What was asked and what of it is checkable ────────────────────
 *
 * The requester's request (2026-09-21): "I do not like that the logo is in the
 * login block, I would move it somewhere up and to the left; there is no language choice;
 * I would make Sign in centred".
 *
 * The claims are checked with whatever they can
 * be checked with:
 *
 *   • BRAND OUTSIDE THE CARD — by tree structure. "Top left" cannot be measured in jsdom
 *     (there is no layout), but "not inside the form" is measurable exactly, and
 *     it is exactly what was complained about: the brand took the first row of the
 *     card and pushed the heading down.
 *   • LANGUAGE IS PRESENT — by rendering the real control and by its work: a click
 *     changes the language of the whole interface.
 *
 * Centring of «Sign in» is visual and is not asserted (sk-540.11, owner
 * decision).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';

import i18n, { DEFAULT_LANGUAGE } from '../i18n/config';
import { LoginPage } from './login';

vi.mock('../lib/useAuthConfig', () => ({
  useAuthConfig: () => ({
    data: { mode: 'local' },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: null, isLoading: false, login: vi.fn(), logout: vi.fn() }),
}));

function renderLogin() {
  return render(
    <MantineProvider>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </MantineProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage(DEFAULT_LANGUAGE);
});

afterEach(async () => {
  cleanup();
  if (i18n.language !== DEFAULT_LANGUAGE) await i18n.changeLanguage(DEFAULT_LANGUAGE);
});

describe('sk-514 (14) — the brand left the card for the page', () => {
  test('the brand exists, and it is NOT inside the sign-in form', () => {
    const { container } = renderLogin();
    const brand = container.querySelector('.login-brand');
    const card = container.querySelector('.login-card');
    expect(brand, 'there is no brand on the page at all').not.toBeNull();
    expect(card, 'there is no sign-in card').not.toBeNull();
    // The gist of the complaint: the brand stood INSIDE the card.
    expect(card!.contains(brand!), 'the brand is inside the card again').toBe(false);
    // And it is in the page strip, not just somewhere else.
    expect(brand!.closest('.login-chrome'), 'the brand is outside the top strip').not.toBeNull();
  });

  test('in the strip the brand comes FIRST — that is, on the left in reading order', () => {
    // There is no layout in jsdom, so "on the left" is checked in the only
    // honest way: by tree order. It is also the keyboard traversal order, and
    // they cannot diverge (WCAG 1.3.2).
    const { container } = renderLogin();
    const chrome = container.querySelector('.login-chrome')!;
    expect(chrome.firstElementChild!.classList.contains('login-brand')).toBe(true);
  });
});

describe('sk-514 (14) — language choice on the sign-in page', () => {
  test('the control exists and it WORKS — it changes the interface language', () => {
    renderLogin();
    // The same control as in the app header: looked up by its accessible
    // name, not by class — the name is what the user sees.
    const button = screen.getByRole('button', { name: /язык|language/i });
    expect(button).not.toBeNull();
    fireEvent.click(button);
    return waitFor(async () => {
      const ru = screen.getByRole('menuitemradio', { name: /Русский/ });
      fireEvent.click(ru);
      await waitFor(() => expect(i18n.language).toBe('ru'));
    });
  });
});
