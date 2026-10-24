import { useCallback, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';

/**
 * sk-491 — keyboard model of a radio-button group per WAI-ARIA APG
 * "Radio Group", shared by all `role="radiogroup"` of the shell.
 *
 * The model first appeared in sk-490 (the epic section's mode switch,
 * `EpicProgressSection.tsx#EPIC_SECTION_MODES`); when the same model
 * was needed for the filter chip rows (`TaskFilters.tsx#FilterChipRow`,
 * `TaskFilters.tsx#AssigneeChipRow`), it was moved here so that the group
 * has one implementation, not copies drifting apart one by one.
 *
 * What it gives:
 *  - one Tab stop per group — `tabIndex` 0 only on the selected
 *    item, −1 on the rest. If there is no selected item among the items
 *    (the filter value is outside the list of options), the stop becomes the
 *    first — otherwise the group would drop out of the Tab order entirely;
 *  - ←/→ and ↑/↓ select the neighbouring item cyclically and move
 *    focus to it; the neighbour is counted from the item that has focus, not from
 *    the selected one — in normal work it is the same item;
 *  - an arrow with Alt/Ctrl/Meta is not handled by the group (these are
 *    browser and OS shortcuts);
 *  - a handled arrow does not scroll the page (`preventDefault`);
 *  - `disabled` — the group is inert: arrows neither select nor move focus
 *    (mouse selection is also disabled for such a group by the caller itself), and
 *    the Tab stop stays — an inert group can still be reached
 *    and read to see why it is inert.
 *
 * The arrow order is the order of `values`, and the caller draws the items from the
 * same list, passing the index in `itemProps`: the on-screen order and the
 * "next in a circle" order come from one source.
 *
 * The choice is the arrow itself: `onChange` is called at once, focus moves to the
 * element of the new value in the same handler, so the group's items
 * must not unmount when the value changes.
 */
export interface RadioGroupKeysOptions<T> {
  /** Values in the order of the items on screen. */
  values: readonly T[];
  /** Current value of the group. */
  value: T;
  /** Choosing a new value by arrow. */
  onChange: (next: T) => void;
  /** The group is inert: arrows are not handled. */
  disabled?: boolean;
  /** Comparison of the current value with an option; `Object.is` by default. */
  isSelected?: (value: T, option: T) => boolean;
}

export interface RadioGroupKeys {
  /** Attached to the element with `role="radiogroup"`. */
  onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void;
  /** Props of the group item with index `index` in `values`. */
  itemProps: (index: number) => {
    ref: (el: HTMLElement | null) => void;
    tabIndex: 0 | -1;
  };
}

export function useRadioGroupKeys<T>({
  values,
  value,
  onChange,
  disabled = false,
  isSelected = Object.is,
}: RadioGroupKeysOptions<T>): RadioGroupKeys {
  const items = useRef<Array<HTMLElement | null>>([]);

  const selectedIndex = values.findIndex((v) => isSelected(value, v));
  const tabStop = selectedIndex >= 0 ? selectedIndex : 0;

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLElement>) => {
      if (disabled) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const step =
        e.key === 'ArrowRight' || e.key === 'ArrowDown'
          ? 1
          : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
            ? -1
            : 0;
      if (step === 0) return;
      const n = values.length;
      if (n === 0) return;
      e.preventDefault();
      const focused = items.current.findIndex(
        (el, i) => i < n && el !== null && el.contains(e.target as Node),
      );
      const at = focused >= 0 ? focused : selectedIndex;
      // Neither focus on an item nor a selected one: a step forward — the first,
      // a step back — the last.
      const next = at >= 0 ? (at + step + n) % n : step > 0 ? 0 : n - 1;
      onChange(values[next]);
      items.current[next]?.focus();
    },
    [disabled, values, selectedIndex, onChange],
  );

  const itemProps = (index: number) => ({
    ref: (el: HTMLElement | null) => {
      items.current[index] = el;
    },
    tabIndex: (index === tabStop ? 0 : -1) as 0 | -1,
  });

  return { onKeyDown, itemProps };
}
