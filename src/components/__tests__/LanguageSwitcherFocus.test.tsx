/**
 * sk-285.6.15 — choosing a language does not drop focus on the floor.
 *
 * The switcher became a popover in the header rail. Its rows live inside
 * the dropdown, so the element the user just pressed is REMOVED from the
 * document as part of pressing it, and `document.activeElement` falls
 * back to `<body>`: the next Tab restarts at the skip-link instead of
 * carrying on along the rail. Measured in Chromium at 1440×900 before
 * the repair — after clicking "English", `activeElement === body`.
 *
 * It is a regression of the move, not a pre-existing gap: while the
 * control was two labelled buttons inside the account menu, pressing one
 * left the menu open and focus on the button.
 *
 * Mantine's own `returnFocus` is deliberately NOT the fix — it fires on
 * every close (click-outside included) off a 10ms timer, so clicking a
 * different rail control would have focus yanked back here a frame
 * later. The switcher hands focus to its trigger on the one path that
 * loses it, and this test pins that path.
 *
 * Its own file, with one test: the click performs a REAL language
 * change, and i18next is a module-global — a second test in the same
 * file would run against whichever language this one left behind.
 */

import { afterEach, expect, test } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

import { LanguageSwitcher } from '../LanguageSwitcher';
import i18n, { DEFAULT_LANGUAGE } from '../../i18n/config';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  if (i18n.language !== DEFAULT_LANGUAGE) {
    void i18n.changeLanguage(DEFAULT_LANGUAGE);
  }
});

test('picking a language returns focus to the rail control', () => {
  render(
    <MantineProvider>
      <LanguageSwitcher />
    </MantineProvider>,
  );

  const trigger = screen.getByRole('button', { name: 'Language: English' });
  fireEvent.click(trigger);

  const row = screen.getByRole('menuitemradio', {
    name: 'Switch interface language to Русский',
  });
  /**
   * Put focus where the browser has it at this point, and where jsdom
   * does NOT put it by itself: neither `fireEvent.click` nor Mantine's
   * focus trap moves `activeElement` here (the trap only reroutes Tab,
   * and jsdom's synthetic click never focuses its target). Left alone,
   * focus would still be sitting on the trigger for the whole test and
   * the assertion below would hold whether the component returns focus
   * or not — the check has to start from the state it is about.
   */
  act(() => row.focus());
  expect(document.activeElement).toBe(row);

  // Pressing the row both applies the language AND unmounts the pressed
  // element, which is where the focus goes missing.
  fireEvent.click(row);

  // Back on the control the user opened, not in <body> — the rail is
  // where the next Tab has to continue from.
  expect(document.activeElement).toBe(trigger);
});
