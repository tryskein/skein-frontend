/**
 * sk-522 — the one-time secret reveal modal speaks the dictionary's language.
 *
 * ─── Why the test must switch the locale ───────────────────────────
 *
 * The English dictionary values coincide with the literals that stood in
 * `SecretReveal.tsx` before the change, byte for byte: the SOURCE of the string changed, not
 * the text. So any run on the default locale would pass on
 * untranslated code too. To tell "the string came from the dictionary" from "the string
 * is hard-wired in JSX" one needs a second language, so everything here is rendered
 * under `ru`.
 *
 * The Russian strings are taken FROM THE DICTIONARY ITSELF and are not rewritten into the test
 * a second time: a test repeating the translation would guard the agreement of two copies
 * of one text, not that the dictionary reached the markup.
 *
 * ─── What exactly is asserted ──────────────────────────────────────
 *
 *  1. All nine strings reach the DOM in Russian. Nine, not the six from
 *     the card: three lines of the live region `role="status"` get into the
 *     markup by the same path as the visible text.
 *  2. The `copyFailed` branch — it is not drawn without a clipboard failure, so
 *     the fixture must arrange this failure, otherwise the test never sees two of
 *     the nine strings.
 *  3. The warning default is resolved IN THE COMPONENT BODY: the language
 *     changes on a mounted node, without remounting, and the text
 *     must follow. A module constant fails this step —
 *     it freezes at the language that was active when the module loaded.
 *  4. An explicit `warning` prop still outranks the dictionary: the translation must not
 *     overwrite what the caller passed.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

import i18n, { DEFAULT_LANGUAGE } from '../i18n/config';
import { ru } from '../i18n/locales/ru';
import { SecretReveal } from './SecretReveal';

const DICT = ru.secretReveal;

/** The clipboard, which jsdom does not have at all: replaced entirely. */
function installClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
}

function renderModal(props: Partial<React.ComponentProps<typeof SecretReveal>> = {}) {
  return render(
    <MantineProvider>
      <SecretReveal
        opened
        onDismiss={() => {}}
        title="heading"
        value="ska_secret_value"
        {...props}
      />
    </MantineProvider>,
  );
}

beforeEach(async () => {
  await act(async () => {
    await i18n.changeLanguage('ru');
  });
});

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  if (i18n.language !== DEFAULT_LANGUAGE) {
    await act(async () => {
      await i18n.changeLanguage(DEFAULT_LANGUAGE);
    });
  }
});

describe('SecretReveal — dictionary', () => {
  test('the visible resting strings are read from the dictionary (ru)', () => {
    renderModal();

    // The value label, the copy button, the close button, the warning
    // default — four of the nine, those visible without a single click.
    expect(screen.getByText(DICT.valueLabel)).toBeTruthy();
    expect(screen.getByText(DICT.copy)).toBeTruthy();
    expect(screen.getByText(DICT.dismiss)).toBeTruthy();
    expect(screen.getByText(DICT.warningDefault)).toBeTruthy();
  });

  test('successful copy: "copied!" and the live region line', async () => {
    installClipboard(() => Promise.resolve());
    renderModal();

    fireEvent.click(screen.getByText(DICT.copy).closest('button')!);

    await waitFor(() => {
      expect(screen.getByText(DICT.copied)).toBeTruthy();
    });
    const live = document.querySelector('[role="status"]')!;
    expect(live.textContent).toBe(DICT.announce.copied);
  });

  test('clipboard failure: a hint, the manual copy button and both lines', async () => {
    installClipboard(() => Promise.reject(new Error('denied')));
    renderModal();

    fireEvent.click(screen.getByText(DICT.copy).closest('button')!);

    // The copyFailed branch is not drawn without a failure — without this click two
    // dictionary strings would stay unchecked.
    await waitFor(() => {
      expect(screen.getByText(DICT.clipboardUnavailable)).toBeTruthy();
    });
    const live = document.querySelector('[role="status"]')!;
    expect(live.textContent).toBe(DICT.announce.copyFailed);

    const manual = screen.getByText(DICT.acknowledgeManual);
    fireEvent.click(manual.closest('button')!);
    await waitFor(() => {
      expect(document.querySelector('[role="status"]')!.textContent).toBe(
        DICT.announce.manualAcknowledged,
      );
    });
  });

  test('the warning default is resolved in the body: a language change moves it without remounting', async () => {
    renderModal();
    const warning = screen.getByText(DICT.warningDefault);

    await act(async () => {
      await i18n.changeLanguage('en');
    });

    // The same node, other text. A module constant here would have stayed
    // Russian: it is computed once when the module loads.
    expect(warning.textContent).toContain(
      'this value is shown only once',
    );
    expect(screen.queryByText(DICT.warningDefault)).toBeNull();
  });

  test('an explicit warning prop outranks the dictionary', () => {
    renderModal({ warning: 'a line from the caller' });

    expect(screen.getByText('a line from the caller')).toBeTruthy();
    expect(screen.queryByText(DICT.warningDefault)).toBeNull();
  });
});
