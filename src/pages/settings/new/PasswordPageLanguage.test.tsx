/**
 * sk-403 — the strength line entirely in the interface language.
 *
 * ─── What was broken ───────────────────────────────────────────────
 *
 * We write half of this line (the level name), the zxcvbn library writes the other half
 * (`feedback.warning` / `feedback.suggestions`). The library
 * half is chosen by the TRANSLATION PACKAGE at the moment the factory is built, not at the
 * moment of rendering, and English was hard-coded in the constructor. Under the Russian
 * interface the line read as "Very weak — This is a heavily used
 * password": `t()` does not fix that, because there is nothing to translate — the text
 * was born English.
 *
 * ─── Why the stand is exactly this ─────────────────────────────────
 *
 * zxcvbn here is REAL, and so is the page. The language must travel through the whole
 * wiring: `i18n.language` → the `scorePassword` call prop → package choice
 * in the factory constructor → text in the markup. A mocked core would prove
 * only that the mock returned a prepared string; the constructor's composition
 * is checked by `lib/passwordStrength.test.ts`, and HERE it is checked that the
 * page passes this language at all. Exactly this seam was torn.
 *
 * The password is taken from the head of the most frequent list: on it the library
 * is guaranteed to return a non-empty `warning`, otherwise the claim "there is no
 * English in the line" would pass on emptiness.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import i18n, { DEFAULT_LANGUAGE } from '../../../i18n/config';
import type { ChangePasswordPayload, PasswordPolicy } from '../../../api/users';

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u-1', username: 'caller', role: 'user' } }),
}));

vi.mock('./SettingsLayout', async (importActual) => {
  const actual = await importActual<typeof import('./SettingsLayout')>();
  return {
    ...actual,
    SettingsLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  };
});

const changeMyPasswordSpy = vi.fn<(payload: ChangePasswordPayload) => Promise<void>>();
const getPasswordPolicySpy = vi.fn<() => Promise<PasswordPolicy>>();

vi.mock('../../../api/users', () => ({
  changeMyPassword: (payload: ChangePasswordPayload) => changeMyPasswordSpy(payload),
  getPasswordPolicy: () => getPasswordPolicySpy(),
}));

import { NewPasswordPage } from './PasswordPage';

/** A password from the head of the frequency list — its `warning` is certainly non-empty. */
const COMMON_PASSWORD = 'password';

function mount() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MantineProvider>
        <MemoryRouter>
          <NewPasswordPage />
        </MemoryRouter>
      </MantineProvider>
    </QueryClientProvider>,
  );
}

/** The text of the strength block once it has appeared and carries more than the level name. */
async function strengthLine(): Promise<string> {
  const box = await screen.findByTestId('password-strength', undefined, { timeout: 5000 });
  await waitFor(
    () => {
      // The dash appears only together with the library's half: without it
      // the "no English" check would pass on our one word alone.
      expect(box.textContent ?? '').toContain('—');
    },
    { timeout: 5000 },
  );
  return box.textContent ?? '';
}

beforeEach(() => {
  getPasswordPolicySpy.mockResolvedValue({ pwnedCheckEnabled: false });
  changeMyPasswordSpy.mockResolvedValue(undefined);
});

afterEach(async () => {
  cleanup();
  vi.clearAllMocks();
  if (i18n.language !== DEFAULT_LANGUAGE) await i18n.changeLanguage(DEFAULT_LANGUAGE);
});

describe('sk-403 — the estimator feedback arrives in the interface language', () => {
  test('under Russian the strength line has no English text from the library', async () => {
    await i18n.changeLanguage('ru');
    mount();

    fireEvent.change(screen.getByLabelText(/^Новый пароль/), {
      target: { value: COMMON_PASSWORD },
    });

    const line = await strengthLine();
    // The level name is ours, from the dictionary.
    expect(line).toContain('Очень слабый');
    // The library half is in Russian. The threshold is four Latin letters
    // in a row: the Russian package itself quotes examples like "aaa" and "abcabcabc",
    // while any English sentence ("This is a heavily used password")
    // gives such a run from the first word.
    expect(line).not.toMatch(/[A-Za-z]{4,}/);
    // …and this is not an empty string where there was nothing to search.
    expect(line).toMatch(/[А-Яа-яЁё]{4,}/);
  });

  test('under English the line stays English', async () => {
    // The reverse side: the fix must not have made Russian
    // the only language. The product's default language is English.
    mount();

    fireEvent.change(screen.getByLabelText(/^New password/), {
      target: { value: COMMON_PASSWORD },
    });

    const line = await strengthLine();
    expect(line).toContain('Very weak');
    expect(line).toMatch(/[A-Za-z]{4,}/);
    expect(line).not.toMatch(/[А-Яа-яЁё]/);
  });

  test('changing the language with a password typed rewrites the line already shown', async () => {
    // The factory memoisation lived for the whole tab: the first run decided the
    // language of the feedback forever, and switching the language left an
    // English sentence on the screen under Russian labels.
    mount();

    fireEvent.change(screen.getByLabelText(/^New password/), {
      target: { value: COMMON_PASSWORD },
    });
    expect(await strengthLine()).toContain('Very weak');

    await i18n.changeLanguage('ru');

    await waitFor(
      async () => {
        expect(await strengthLine()).not.toMatch(/[A-Za-z]{4,}/);
      },
      { timeout: 5000 },
    );
  });
});
