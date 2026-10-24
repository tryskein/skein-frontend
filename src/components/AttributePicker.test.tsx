/**
 * `AttributePicker`, the app's one multi-select vocabulary — pinned at
 * the level of the component itself rather than through one of its six
 * call sites.
 *
 * ── Why this file exists ────────────────────────────────────────────
 *
 * The picker was written inside `pages/shell/TaskFilters.tsx` and was
 * tested through it; sk-285.7.2.91 moved it to `components/` and gave it
 * a sixth call site whose option lists are LOADED (projects, and then
 * the components of the first of them). That is the case the shell never
 * had: an option list that changes under a selection the user already
 * made. Two defects of the review that followed live exactly there, and
 * neither is reachable from a control whose options are a frozen enum.
 */

import { useState } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

import { skeinTheme } from '../theme';
import { AttributePicker, type AttributeOption } from './AttributePicker';

const CATALOG: AttributeOption[] = [
  { value: 'uuid-catalog', label: 'Catalog' },
  { value: 'uuid-checkout', label: 'Checkout flow' },
  // Third row on purpose: the keyboard cases below need one the arrow
  // keys never touch, because Mantine writes its own `aria-selected`
  // onto every row they do.
  { value: 'uuid-returns', label: 'Returns' },
];

const INFRA: AttributeOption[] = [
  { value: 'uuid-pipeline', label: 'Pipeline' },
];

/**
 * A controlled host, because both defects are about what the picker
 * hands BACK: the component owns no selection of its own, so a harness
 * that swallowed `onChange` would assert against a value the picker
 * never influenced.
 *
 * `swapTo` / `clearOptions` are buttons rather than a rerender from the
 * test body so the option list changes the way it does in the modal —
 * under a mounted control, without the selection being touched.
 */
function Harness({
  initial,
  options = CATALOG,
  onChange,
}: {
  initial: string[];
  options?: AttributeOption[];
  onChange?: (next: string[]) => void;
}) {
  const [value, setValue] = useState<string[]>(initial);
  const [opts, setOpts] = useState<AttributeOption[]>(options);
  return (
    <MantineProvider theme={skeinTheme} forceColorScheme="light">
      <button type="button" onClick={() => setOpts(INFRA)}>
        swap options
      </button>
      <button type="button" onClick={() => setOpts([])}>
        clear options
      </button>
      <AttributePicker
        label="components"
        options={opts}
        value={new Set(value)}
        onChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
        removeLabel={(attribute) => `Remove ${attribute}`}
      />
    </MantineProvider>
  );
}

function pills() {
  return [...document.querySelectorAll('.mantine-Pill-root')].map((p) => ({
    label: (p.querySelector('.mantine-Pill-label')?.textContent ?? '').trim(),
    remove: p.querySelector('.mantine-Pill-remove') as HTMLButtonElement | null,
  }));
}

function optionByValue(value: string): HTMLElement | null {
  return document.querySelector(`[role="option"][value="${value}"]`);
}

function open() {
  fireEvent.click(screen.getByRole('textbox', { name: 'components' }));
}

describe('sk-285.7.2.91 — a selection outlives the option list it was made from', () => {
  test('a picked value absent from the options still draws a removable pill', () => {
    const onChange = vi.fn();
    render(<Harness initial={['uuid-catalog']} options={[]} onChange={onChange} />);

    // The whole defect in one frame: the modal keeps sending
    // `filter.components = ['uuid-catalog']` while the form shows an
    // empty control, and there is no gesture that takes the value out.
    const rows = pills();
    expect(rows.map((r) => r.label)).toEqual(['uuid-catalog']);
    expect(rows[0].remove, 'the retained pill has no remove button').not.toBeNull();
    expect(rows[0].remove!.getAttribute('aria-label')).toBe('Remove uuid-catalog');

    fireEvent.click(rows[0].remove!);
    expect(onChange).toHaveBeenCalledWith([]);
    expect(pills()).toEqual([]);
  });

  test('picking another value does not discard the one the options no longer carry', () => {
    const onChange = vi.fn();
    render(<Harness initial={['uuid-catalog']} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'swap options' }));
    open();
    fireEvent.click(optionByValue('uuid-pipeline')!);

    // `uuid-catalog` belongs to a project that is no longer the one the
    // dropdown sources from. Rebuilding the selection out of the option
    // list drops it here — silently, with the pill already gone.
    expect(onChange).toHaveBeenLastCalledWith(['uuid-catalog', 'uuid-pipeline']);
    // Drawn in the order the control states it: what the dropdown
    // currently lists, then what it no longer does.
    expect(pills().map((r) => r.label)).toEqual(['Pipeline', 'Catalog']);
  });

  test('a label the picker has seen survives the option list changing', () => {
    render(<Harness initial={['uuid-catalog']} />);
    expect(pills().map((r) => r.label)).toEqual(['Catalog']);

    fireEvent.click(screen.getByRole('button', { name: 'clear options' }));
    // Not «uuid-catalog»: the name was on screen a moment ago, and a
    // pill that changes into a uuid reads as a different value rather
    // than as the same one going out of reach.
    expect(pills().map((r) => r.label)).toEqual(['Catalog']);
  });

  test('unpicking a value still leaves the rest of the selection alone', () => {
    const onChange = vi.fn();
    render(<Harness initial={['uuid-catalog', 'uuid-checkout']} onChange={onChange} />);

    open();
    fireEvent.click(optionByValue('uuid-catalog')!);
    expect(onChange).toHaveBeenLastCalledWith(['uuid-checkout']);
    expect(pills().map((r) => r.label)).toEqual(['Checkout flow']);
  });
});

/**
 * ── The dropdown's accessible state (review W1 of the html/css pass) ──
 *
 * `Combobox.Option` got `active`, and `active` is a MOD: Mantine writes
 * `data-combobox-active` from it and nothing else (read in the installed
 * @mantine/core 7.17.8, `ComboboxOption.mjs` — every other prop goes out
 * through `...others`). The tick in `OptionBody` lives inside an
 * `aria-hidden` slot, so a row that was picked said so to the eye and to
 * nothing else. Mantine's own dropdown does state it —
 * `OptionsDropdown.mjs:46` passes `aria-selected={checked}` — which is
 * what the four migrated modal controls had while they were still
 * `MultiSelect`s and lost in the move.
 *
 * KEYBOARD NAVIGATION IS MANTINE'S, AND IT IS IMPERATIVE. `selectOption`
 * writes `aria-selected="true"` straight onto the DOM node the arrow keys
 * land on and `clearSelectedItem` REMOVES the attribute when they leave —
 * a highlight, using the same attribute as the selection. Measured on a
 * plain Mantine `MultiSelect` (data bug/task/epic, value ['bug']): after
 * two ArrowDowns the picked row reported `null`, and reopening the
 * dropdown did not restore it. That is upstream behaviour shared by both
 * compositions, so what is pinned below is the state THIS component
 * owns — what a row reports when it is rendered, and that a highlight
 * never becomes a selection.
 */
describe('sk-285.7.2.91 — a picked row states it, not only draws a tick', () => {
  test('an open dropdown reports which rows are picked and which are not', () => {
    render(<Harness initial={['uuid-catalog']} />);
    open();

    expect(optionByValue('uuid-catalog')!.getAttribute('aria-selected')).toBe('true');
    expect(optionByValue('uuid-checkout')!.getAttribute('aria-selected')).toBe('false');
  });

  test('the report follows the selection in both directions', () => {
    render(<Harness initial={[]} />);
    open();

    fireEvent.click(optionByValue('uuid-checkout')!);
    expect(optionByValue('uuid-checkout')!.getAttribute('aria-selected')).toBe('true');

    fireEvent.click(optionByValue('uuid-checkout')!);
    expect(optionByValue('uuid-checkout')!.getAttribute('aria-selected')).toBe('false');
  });

  test('closing and reopening with the mouse still reports the stored selection', () => {
    render(<Harness initial={[]} />);
    open();
    fireEvent.click(optionByValue('uuid-catalog')!);
    open(); // the field toggles: this closes it
    open(); // …and this is the reopen the reviewer's scenario describes

    expect(optionByValue('uuid-catalog')!.getAttribute('aria-selected')).toBe('true');
    expect(optionByValue('uuid-checkout')!.getAttribute('aria-selected')).toBe('false');
  });

  test('a value picked with the keyboard reports itself picked', () => {
    render(<Harness initial={[]} />);
    const field = screen.getByRole('textbox', { name: 'components' });

    // The first ArrowDown opens the list and lands on the first row; the
    // second moves past it, so this picks the SECOND — the path where
    // Mantine has written its own `aria-selected` onto the row on the
    // way through.
    fireEvent.keyDown(field, { key: 'ArrowDown', code: 'ArrowDown' });
    fireEvent.keyDown(field, { key: 'ArrowDown', code: 'ArrowDown' });
    fireEvent.keyDown(field, { key: 'Enter', code: 'Enter' });

    expect(pills().map((r) => r.label)).toEqual(['Checkout flow']);
    expect(optionByValue('uuid-checkout')!.getAttribute('aria-selected')).toBe('true');
    // The row the arrows never reached: its `false` can only have been
    // rendered, which is what makes this an assertion about the picker
    // and not about Mantine's highlight.
    expect(optionByValue('uuid-returns')!.getAttribute('aria-selected')).toBe('false');
  });

  test('arrowing over a row does not pick it', () => {
    render(<Harness initial={['uuid-catalog']} />);
    const field = screen.getByRole('textbox', { name: 'components' });

    open();
    fireEvent.keyDown(field, { key: 'ArrowDown', code: 'ArrowDown' });
    fireEvent.keyDown(field, { key: 'ArrowDown', code: 'ArrowDown' });

    // The highlight is not an answer: what the form holds is unchanged,
    // and the pill is the visible proof of it.
    expect(pills().map((r) => r.label)).toEqual(['Catalog']);
  });
});
