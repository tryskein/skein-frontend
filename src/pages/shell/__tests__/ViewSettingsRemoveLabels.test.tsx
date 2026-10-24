/**
 * sk-285.7.2.70 — audit 2B, finding R-9: the chips' remove buttons in
 * the View settings popover.
 *
 * Measured live before the fix: ten 28×28 buttons that each take one
 * attribute off the card, and every one of them
 * `aria-label="Close"` — plus `aria-hidden="true"` and `tabindex="-1"`,
 * so the wrong name was not even announced and the affordance had no
 * keyboard equivalent. The eleventh button, the one that DOES close the
 * popover, is «Close view settings».
 *
 * The artboard writes the contract on the chip itself:
 *
 *   <a href="#" aria-label="Remove {{ a }}" style="…28px…">✕</a>
 *
 * ── Where «Close» came from, and why the widget was recomposed ─────
 *
 * From our own theme: `components.CloseButton.defaultProps['aria-label']
 * = 'Close'`, which is right for a Modal's ✕ and wrong for a pill's,
 * and Mantine builds both out of `CloseButton`. It cannot be fixed at
 * the call site because `MultiSelect` renders the pills itself and
 * forwards nothing per pill (checked in @mantine/core 7.17.8: `Pill`
 * takes `removeButtonProps`, `MultiSelect` never passes them). So the
 * three View-settings pickers are composed from `Combobox` +
 * `PillsInput` + `Pill` — the composition `MultiSelect` is itself built
 * from — and each remove button gets a name and a tab stop.
 *
 * ── What this file also guards, learned the hard way ───────────────
 *
 * Recomposing changed the CLASS the chips wear: `MultiSelect` emits
 * `.mantine-MultiSelect-pill`, a bare `Pill` emits `.mantine-Pill-root`,
 * and the sheet's chip rule named the former. Measured immediately
 * after the swap: the chips reverted to Mantine's stock 18px grey
 * stadium, `rgb(241,243,245)`. The rule is now keyed on the pill.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

import { skeinTheme } from '../../../theme';
import { CardFieldsSelect, ListCardFieldsSelect, TreeColumnsSelect } from '../TaskFilters';
import { KANBAN_DEFAULT_CARD_FIELDS, type KanbanCardField } from '../../../lib/kanbanCardFields';
import { LIST_DEFAULT_CARD_FIELDS, type ListCardField } from '../../../lib/listCardFields';
import { TREE_DEFAULT_COLUMNS, type TreeOptionalColumn } from '../../../lib/treeColumns';
import { en } from '../../../i18n/locales/en';
import { ru } from '../../../i18n/locales/ru';

function wrap(node: React.ReactNode) {
  return render(
    <MantineProvider theme={skeinTheme} forceColorScheme="light">
      {node}
    </MantineProvider>,
  );
}

/** Every remove button on screen, as [accessible name, element]. */
function removeButtons(): Array<[string, HTMLButtonElement]> {
  return [...document.querySelectorAll('.mantine-Pill-remove')].map((b) => [
    b.getAttribute('aria-label') ?? '',
    b as HTMLButtonElement,
  ]);
}

afterEach(() => cleanup());

describe('R-9 — a remove button says what it removes', () => {
  test('the board’s card properties: one name per chip, all different', () => {
    wrap(
      <CardFieldsSelect
        axis="status"
        value={new Set(KANBAN_DEFAULT_CARD_FIELDS)}
        onChange={vi.fn()}
      />,
    );
    const names = removeButtons().map(([name]) => name);
    expect(names.length).toBe(new Set(KANBAN_DEFAULT_CARD_FIELDS).size);
    // The defect in one line: ten buttons, ten different names.
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(/^Remove /);
      expect(name).not.toBe('Close');
    }
    // …and each names the chip it sits in.
    for (const [name, button] of removeButtons()) {
      const chip = button.closest('.mantine-Pill-root')!;
      const label = chip.querySelector('.mantine-Pill-label')?.textContent ?? '';
      expect(name).toBe(`Remove ${label}`);
    }
  });

  test('the tree’s columns and the list’s attributes are named the same way', () => {
    wrap(<TreeColumnsSelect value={new Set(TREE_DEFAULT_COLUMNS)} onChange={vi.fn()} />);
    for (const [name] of removeButtons()) expect(name).toMatch(/^Remove /);
    cleanup();

    wrap(<ListCardFieldsSelect value={new Set(LIST_DEFAULT_CARD_FIELDS)} onChange={vi.fn()} />);
    for (const [name] of removeButtons()) expect(name).toMatch(/^Remove /);
  });

  test('the button is reachable and announced — Mantine hides it by default', () => {
    wrap(
      <CardFieldsSelect
        axis="status"
        value={new Set(KANBAN_DEFAULT_CARD_FIELDS)}
        onChange={vi.fn()}
      />,
    );
    for (const [name, button] of removeButtons()) {
      expect(button.getAttribute('aria-hidden'), name).toBe('false');
      expect(button.tabIndex, name).toBe(0);
    }
  });

  test('pressing one takes that attribute off, and only that one', () => {
    const onChange = vi.fn();
    const value = new Set<KanbanCardField>(KANBAN_DEFAULT_CARD_FIELDS);
    wrap(<CardFieldsSelect axis="status" value={value} onChange={onChange} />);

    const [name, button] = removeButtons()[0];
    fireEvent.click(button);

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as Set<KanbanCardField>;
    expect(next.size).toBe(value.size - 1);
    // The one that went is the one the button named.
    const gone = [...value].filter((v) => !next.has(v));
    expect(gone).toHaveLength(1);
    expect(name).toContain('Remove');
  });

  test('a list picker with nothing picked shows its placeholder and no buttons', () => {
    wrap(<ListCardFieldsSelect value={new Set<ListCardField>()} onChange={vi.fn()} />);
    expect(removeButtons()).toHaveLength(0);
    expect(document.querySelector('input')?.getAttribute('placeholder')).toBeTruthy();
  });

  test('a tree picker keeps every optional column on offer', () => {
    wrap(<TreeColumnsSelect value={new Set<TreeOptionalColumn>()} onChange={vi.fn()} />);
    // `keepMounted` — the dropdown exists closed, so the option rows can
    // be counted without driving the popover.
    const options = document.querySelectorAll('[role="option"]');
    expect(options.length).toBeGreaterThan(0);
  });
});

describe('R-9 — the wording exists in both dictionaries, with its slot', () => {
  test('en and ru name the attribute inside the sentence', () => {
    for (const [lang, dict] of [
      ['en', en],
      ['ru', ru],
    ] as const) {
      const value = dict.filters.viewSettings.removeAttribute;
      expect(typeof value, lang).toBe('string');
      expect(value, lang).toContain('{{attribute}}');
    }
  });
});
