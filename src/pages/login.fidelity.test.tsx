/**
 * sk-285.6.14 · audit 2B, finding N-1 — the sign-in screen speaks the
 * product's language.
 *
 * `login.test.tsx` is the BEHAVIOUR contract (which affordance renders
 * per authMode, and what each error maps to). This file holds what the
 * rendered screen says: no terminal vocabulary in the page or in the
 * dictionary, the product's own mark, a real heading, and the behaviour
 * of the password eye.
 *
 * Paint, size and typography are not checked here (sk-540.11, owner
 * decision): what a person sees is not asserted from markup or from the
 * stylesheet.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';

import { skeinTheme } from '../theme';
import { en } from '../i18n/locales/en';

type AuthMode = 'local' | 'keycloak' | 'hybrid';

let mockAuthConfig: {
  data: { authMode: AuthMode } | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
} = {
  data: { authMode: 'local' },
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
};

vi.mock('../lib/useAuthConfig', () => ({ useAuthConfig: () => mockAuthConfig }));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: null, login: vi.fn(), logout: vi.fn(), isLoading: false }),
}));

import { LoginPage } from './login';

// sk-303.8 removed `isExternalHost` from `RuntimeAuthConfig`, so this
// helper takes the mode alone — a second argument here would still be
// accepted by the mock and would quietly assert a split the client no
// longer has.
function setAuth(authMode: AuthMode) {
  mockAuthConfig = {
    data: { authMode },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  };
}

function renderLogin() {
  render(
    <MantineProvider theme={skeinTheme} forceColorScheme="light">
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </MantineProvider>,
  );
}

/**
 * The vocabulary the product left behind in stages 1 and 2. Each entry
 * is something the page actually rendered, quoted from the audit's own
 * `innerText` capture — not a guess at what a terminal looks like.
 */
const TERMINAL = [
  ['box-drawing wordmark', /[═-╬▀-▓]/],
  ['the shading wings ░▒▓', /[░▒▓]/],
  ['a shell prompt', /\w+@\w+:~\$/],
  // Anchored on nothing: `innerText` is not implemented in jsdom, so
  // the render check falls back to `textContent`, where the labels of
  // sibling elements are concatenated WITHOUT the newlines a
  // start-of-line anchor would need. A first mutation — putting
  // `> sign in` back into the dictionary — survived an anchored pattern
  // for exactly that reason, which is what this comment is here to stop
  // being re-introduced. There is no legitimate `>` in this screen's
  // copy, so the unanchored form has nothing to false-positive on.
  ['a chevron-prefixed label', />\s*\w/],
  ['a block cursor', /▋/],
] as const;

describe('N-1 — the terminal language is gone', () => {
  afterEach(() => {
    cleanup();
  });

  test.each(TERMINAL)('the rendered page contains no %s', (_name, pattern) => {
    // Every render path, because the terminal props were spread across
    // them: the password form had `> sign in` and `> waiting for input`,
    // the SSO screens `> login via keycloak` and `> awaiting SSO
    // handshake`, and the banner was above all of them.
    //
    // Three, not four: `hybrid` used to be two paths, split by
    // `isExternalHost`. sk-303.8 removed that field, so hybrid renders one
    // page — both affordances — and the second row would have re-run the
    // first rather than covering anything.
    for (const mode of ['local', 'keycloak', 'hybrid'] as const) {
      setAuth(mode);
      renderLogin();
      expect(document.body.innerText ?? document.body.textContent ?? '').not.toMatch(pattern);
      cleanup();
    }
  });

  test.each(TERMINAL)('the dictionary contains no %s either', (_name, pattern) => {
    // The words moved into `en.ts`, so a guard that only read the render
    // would go green on a page whose copy came back through i18n.
    expect(JSON.stringify(en.auth)).not.toMatch(pattern);
  });
});

describe('N-1 — the brand is the product’s own', () => {
  afterEach(() => {
    cleanup();
  });

  test('the mark is the header’s component, not a second drawing', () => {
    setAuth('local');
    renderLogin();
    const mark = document.querySelector('.login-brand svg.header-logo-mark');
    expect(mark, 'the login page renders no mark').toBeTruthy();
    // Decorative — the wordmark beside it is the text.
    expect(mark!.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByText('SKEIN')).toBeTruthy();
  });

  test('the page has a heading', () => {
    // It had none: the ASCII banner was a `<pre>`, so the screen offered
    // no heading to navigate to.
    setAuth('local');
    renderLogin();
    const h1 = document.querySelector('h1');
    expect(h1?.textContent).toBe(en.auth.title);
    expect(document.querySelector('main')?.getAttribute('aria-labelledby')).toBe(h1?.id);
  });
});

describe('N-1 — the eye, which nobody had checked', () => {
  afterEach(() => {
    cleanup();
  });

  function eye(): HTMLButtonElement {
    const el = document.querySelector('.mantine-PasswordInput-visibilityToggle');
    expect(el, 'no visibility toggle rendered').toBeTruthy();
    return el as HTMLButtonElement;
  }

  test('it is in the tab order — Mantine defaults it OUT of one', () => {
    setAuth('local');
    renderLogin();
    // `tabIndex: -1` is Mantine's default for this control, and it is
    // the only way to reveal what you typed.
    expect(eye().getAttribute('tabindex')).toBe('0');
    // Passing any props also clears Mantine's `aria-hidden`, which would
    // hide the control from a screen reader even once it is reachable.
    expect(eye().getAttribute('aria-hidden')).toBe('false');
  });

  test('its name says what the press will do, and flips with the state', () => {
    setAuth('local');
    renderLogin();
    expect(eye().getAttribute('aria-label')).toBe(en.auth.showPassword);
    expect(eye().getAttribute('aria-pressed')).toBe('false');

    // Mantine toggles on mousedown (it preventDefaults so the field
    // keeps focus), not on click — measured on the running page, where a
    // real mouse press flips it exactly once.
    fireEvent.mouseDown(eye());
    expect(eye().getAttribute('aria-label')).toBe(en.auth.hidePassword);
    expect(eye().getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('.mantine-PasswordInput-innerInput')?.getAttribute('type')).toBe(
      'text',
    );
  });

  test('Enter toggles it — a <button> that answers only Space reads as broken', () => {
    setAuth('local');
    renderLogin();
    fireEvent.keyDown(eye(), { key: 'Enter' });
    expect(eye().getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(eye(), { key: 'Enter' });
    expect(eye().getAttribute('aria-pressed')).toBe('false');
  });

  test('a key that is neither Enter nor Space does nothing', () => {
    // Guards the handler against being a blanket toggle: measured live,
    // Enter, Space and a mouse press each fire exactly once, and nothing
    // else fires at all.
    setAuth('local');
    renderLogin();
    fireEvent.keyDown(eye(), { key: 'a' });
    expect(eye().getAttribute('aria-pressed')).toBe('false');
  });
});
