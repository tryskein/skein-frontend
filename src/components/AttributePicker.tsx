/**
 * `AttributePicker` — the app's ONE multi-select vocabulary.
 *
 * sk-285.7.2.91 moved it here. It was written inside
 * `pages/shell/TaskFilters.tsx` (sk-285.7.2.70, extended by
 * sk-285.7.2.71) and could not be reached from anywhere else, which is
 * how a fourth surface — the `/legacy/watching` filter modal — went on
 * drawing four Mantine `MultiSelect`s with «Close» on every pill after
 * the shell had stopped. Nothing about the control changed in the move:
 * same code, same props, same five call sites. (sk-303.15 has since
 * deleted that modal along with the rest of the legacy interface, so
 * the shell's five are now all of them — the move still stands, and
 * `FilterPickerVocabulary.test.tsx` holds the tree to it.)
 *
 * `COMBOBOX_PROPS` and `OptionBody` came with it because the picker is
 * built out of them and `TaskFilters` uses them for its other controls —
 * so they are exported back rather than duplicated.
 */

import { useRef, useState, type ReactNode, type Ref } from 'react';
import { CloseButton, Combobox, Pill, PillsInput, useCombobox } from '@mantine/core';
import { IconCheck } from '@tabler/icons-react';

/**
 * Dropdown geometry, shared by every control in the panel. The selects
 * themselves are narrow (the Tasks column is resizable and holds up to
 * eight of them), but their options carry a second explanation line — so
 * the dropdown is deliberately WIDER than its target instead of wrapping
 * every description into three lines. `bottom-start` keeps it aligned to
 * the control it belongs to; Mantine flips/shifts it when the column sits
 * near a viewport edge.
 */
export const COMBOBOX_PROPS = {
  withinPortal: true,
  width: 250,
  position: 'bottom-start',
} as const;

/**
 * Shared option body. Mantine's `renderOption` REPLACES the whole option
 * content (check icon included), so the tick is rendered here — in a
 * fixed-width slot, so picking an option never shifts the label.
 */
export function OptionBody({
  checked,
  label,
  description,
  leading,
}: {
  checked: boolean;
  label: ReactNode;
  description?: string;
  leading?: ReactNode;
}) {
  return (
    <span className="task-filter-option">
      <span className="task-filter-option-check" aria-hidden>
        {checked ? <IconCheck size={16} stroke={2} /> : null}
      </span>
      <span className="task-filter-option-body">
        <span className="task-filter-option-label">
          {leading}
          {label}
        </span>
        {description ? (
          <span className="task-filter-option-desc">{description}</span>
        ) : null}
      </span>
    </span>
  );
}

/**
 * sk-285.7.2.70 — audit 2B, R-9. The attribute picker of the View
 * settings panel, built from Mantine's own parts instead of from
 * `MultiSelect`.
 *
 * ── Why the widget was taken apart ─────────────────────────────────
 *
 * Every chip in that panel carried a remove button labelled «Close»:
 * ten identical labels in one dialog, none of which closes it, while
 * the one control that does is «Close view settings». The artboard
 * writes the contract on the chip itself —
 * `aria-label="Remove {{ a }}"` on a focusable control — and §7 asks
 * popovers for meaningful semantics.
 *
 * The label came from our own theme: `components.CloseButton
 * .defaultProps['aria-label'] = 'Close'` is right for the ✕ of a Modal
 * or a Drawer, and Mantine builds a pill's remove button out of the
 * same `CloseButton`. It cannot be fixed where it is wrong, because
 * `MultiSelect` renders the pills itself and forwards nothing per pill
 * (checked in @mantine/core 7.17.8: `Pill` accepts `removeButtonProps`,
 * `MultiSelect` never passes them). Mantine also marks those buttons
 * `aria-hidden` + `tabIndex={-1}` — so the wrong label was not even
 * announced, and the pointer affordance had no keyboard equivalent of
 * its own.
 *
 * So the control is composed here from `Combobox` + `PillsInput` +
 * `Pill` — the documented composition `MultiSelect` is itself built
 * from — which is what makes each remove button nameable AND reachable.
 * Nothing else about the picker changes: same option rows with their
 * ticks and second lines, same disabled row, same dropdown geometry,
 * same `inputRef` contract for the «+ Add attribute» chip.
 *
 * ── sk-285.7.2.71 — and then the other two ──────────────────────────
 *
 * The note that used to stand here said the filter panel's other two
 * multi-selects (tree dep types, project focus) were still Mantine's
 * `MultiSelect` and still carried «Close» on their pills, and that
 * moving them was a second change with its own risk. That task is this
 * one: both are this picker now, so the app has ONE multi-select
 * vocabulary rather than two.
 *
 * Three capabilities came with them, and each is opt-in so the three
 * View-settings pickers are byte-identical to what they were:
 *
 *   `searchable` — project focus has to be typeable; a workspace with
 *     forty projects is not a list you scroll. The field stops being
 *     `readOnly` and becomes the search box, which is Mantine's own
 *     documented composition for a searchable multi-select.
 *   `onClear` — «back to all projects» has to be ONE gesture. It is a
 *     `CloseButton` and therefore carries the same factory
 *     `aria-label="Close"` this whole finding is about, so it is named
 *     explicitly at the call site, like the pills are.
 *   `leading` — the dep-type rows draw a colour dot before the label.
 *
 * `locked` is the second half of what `MultiSelect` gave a DISABLED
 * option and `AttributePicker` did not: no remove button on the pill,
 * and a toggle that refuses even if something reaches the handler
 * another way. It matters for `parent-child`, the tree spine — a spine
 * the user can drop from a chip is a tree that stops being a tree.
 *
 * It is a SEPARATE flag from `disabled` on purpose. The board's
 * card-field picker also disables a row (the field the current axis
 * already states) and its chip has always been removable; folding the
 * two meanings together would have quietly taken that away. So
 * `disabled` keeps meaning «this row cannot be picked from the
 * dropdown» and `locked` means «and it cannot be let go of either».
 */
export interface AttributeOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  /** Picked and not releasable: no remove button, toggle refuses. */
  locked?: boolean;
  /** Rendered before the label in the option row (a colour dot, …). */
  leading?: ReactNode;
}

export function AttributePicker({
  className,
  label,
  description,
  placeholder,
  options,
  value,
  onChange,
  inputRef,
  removeLabel,
  searchable = false,
  nothingFoundMessage,
  onClear,
  clearLabel,
  disabled = false,
  busy = false,
}: {
  /**
   * Optional since sk-285.7.2.91: the shell's five call sites all pass
   * `task-filter-select`, while the `/legacy/watching` modal (deleted by
   * sk-303.15) had no such panel to belong to. Required would have meant
   * inventing a class for it or handing it one that means «I am in the
   * filter panel» — kept optional, because the next caller outside the
   * panel will be in the same position.
   */
  className?: string;
  label: string;
  description?: string;
  placeholder?: string;
  options: ReadonlyArray<AttributeOption>;
  value: ReadonlySet<string>;
  onChange: (next: string[]) => void;
  inputRef?: Ref<HTMLInputElement>;
  /** «Remove <attribute>» — the artboard's own wording, per chip. */
  removeLabel: (attribute: string) => string;
  /** Type to narrow the option list. Off by default. */
  searchable?: boolean;
  /** Shown in place of the rows when a search matches nothing. */
  nothingFoundMessage?: string;
  /** Supplying it draws the one-gesture reset. */
  onClear?: () => void;
  /**
   * Accessible name of that reset. Required beside `onClear` and not
   * defaulted: it is a `CloseButton`, so an unnamed one inherits the
   * factory «Close» — the very label this picker exists to stop.
   */
  clearLabel?: string;
  /**
   * sk-303.13 (T032) — the WHOLE control is out of service, not one of
   * its rows. `option.disabled` says «this value cannot be picked»;
   * this says «there is nothing to pick from yet, or the list could not
   * be read at all». The watching modal's event-type axis is the call
   * site: its options come from the server catalogue, and an EMPTY
   * picker there would read as «this build has no event types» rather
   * than as «the catalogue is unavailable».
   */
  disabled?: boolean;
  /**
   * Marks the field `aria-busy`. A disabled control is out of the tab
   * order, so «loading» shown only as a placeholder is easy to miss
   * entirely — this states it to assistive tech as well.
   */
  busy?: boolean;
}) {
  const combobox = useCombobox({
    onDropdownClose: () => combobox.resetSelectedOption(),
  });
  const [search, setSearch] = useState('');

  /**
   * Labels of every option this picker has been HANDED, kept for the
   * ones that later leave the list (sk-285.7.2.91 review, W1).
   *
   * Five of the six call sites pass a frozen enum, so nothing ever
   * leaves; the watching modal's components axis sources its list from
   * ONE project — the first selected one — so removing that project, or
   * picking another, changes the list under a selection already made.
   * Without a memory, a value picked a moment ago would redraw as a raw
   * uuid, which reads as a different value rather than as the same one
   * gone out of reach.
   *
   * A ref rather than state: it is written during render and read in the
   * same pass, never rendered from on its own, so a set of it must not
   * schedule one. Growth is bounded by the options the caller has shown.
   */
  const seenLabels = useRef(new Map<string, string>());
  for (const option of options) seenLabels.current.set(option.value, option.label);

  const byValue = new Map(options.map((o) => [o.value, o]));

  const toggle = (v: string) => {
    // A LOCKED option is not toggleable from anywhere: its dropdown row
    // is inert and its pill carries no remove button, but the handler is
    // the one place both paths meet, so the guard lives here too.
    if (byValue.get(v)?.locked) return;
    // Only `v` moves. Rebuilding the whole set out of `options` — which
    // is what this did until the review — silently dropped every picked
    // value the current option list happens not to carry, so editing a
    // second axis threw away the first one's answer.
    const next = new Set(value);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange([...next]);
  };

  /**
   * The pills, drawn from the VALUE and not from the options.
   *
   * A value the options no longer carry is still part of the filter the
   * form submits, so it has to be visible and it has to be releasable —
   * the state of the form and the state of the request are the same
   * statement or the control is lying. Available values keep their place
   * in the option order (which is what the ticks in the dropdown read
   * in); the rest follow, in the order they were picked.
   */
  const picked: AttributeOption[] = [
    ...options.filter((o) => value.has(o.value)),
    ...[...value]
      .filter((v) => !byValue.has(v))
      .map((v) => ({ value: v, label: seenLabels.current.get(v) ?? v })),
  ];
  const term = search.trim().toLowerCase();
  const shown =
    searchable && term !== ''
      ? options.filter(
          (o) =>
            o.label.toLowerCase().includes(term) ||
            (o.description ?? '').toLowerCase().includes(term),
        )
      : options;

  return (
    <Combobox
      store={combobox}
      onOptionSubmit={(v) => {
        toggle(v);
        setSearch('');
      }}
      {...COMBOBOX_PROPS}
    >
      <Combobox.DropdownTarget>
        <PillsInput
          className={className}
          size="xs"
          label={label}
          description={description}
          pointer={!searchable && !disabled}
          onClick={disabled ? undefined : () => combobox.toggleDropdown()}
          rightSection={
            onClear && picked.length > 0 ? (
              <CloseButton
                size="sm"
                aria-label={clearLabel}
                // `onMouseDown` rather than `onClick` alone: the input
                // takes focus on mousedown and Mantine opens the
                // dropdown with it, so the reset would open the panel it
                // just emptied.
                onMouseDown={(event) => event.preventDefault()}
                onClick={(event) => {
                  event.stopPropagation();
                  setSearch('');
                  onClear();
                }}
              />
            ) : undefined
          }
        >
          <Pill.Group>
            {picked.map((option) => (
              <Pill
                key={option.value}
                withRemoveButton={!option.locked}
                onRemove={() => toggle(option.value)}
                removeButtonProps={{
                  // The two halves of R-9: a name that says what the
                  // button does to WHICH attribute, and a control the
                  // keyboard can reach — Mantine's default is an
                  // aria-hidden, untabbable button called «Close».
                  'aria-label': removeLabel(option.label),
                  'aria-hidden': false,
                  tabIndex: 0,
                }}
              >
                {option.label}
              </Pill>
            ))}
            <Combobox.EventsTarget>
              <PillsInput.Field
                ref={inputRef}
                type={picked.length === 0 || searchable ? 'visible' : 'hidden'}
                placeholder={picked.length === 0 ? placeholder : undefined}
                readOnly={!searchable}
                disabled={disabled}
                aria-busy={busy || undefined}
                pointer={!searchable && !disabled}
                value={searchable ? search : undefined}
                onChange={
                  searchable
                    ? (event) => {
                        combobox.openDropdown();
                        combobox.updateSelectedOptionIndex();
                        setSearch(event.currentTarget.value);
                      }
                    : undefined
                }
                onBlur={searchable ? () => setSearch('') : undefined}
                onKeyDown={(event) => {
                  // Backspace on an EMPTY field takes the last chip off.
                  // Guarded on the term so a searchable field's own
                  // backspace still edits the text it is holding.
                  if (event.key === 'Backspace' && search === '' && picked.length > 0) {
                    event.preventDefault();
                    toggle(picked[picked.length - 1].value);
                  }
                }}
              />
            </Combobox.EventsTarget>
          </Pill.Group>
        </PillsInput>
      </Combobox.DropdownTarget>
      <Combobox.Dropdown>
        <Combobox.Options mah={280} style={{ overflowY: 'auto' }}>
          {shown.map((option) => (
            <Combobox.Option
              key={option.value}
              value={option.value}
              active={value.has(option.value)}
              // The row's state for anything that is not an eye. `active`
              // is a MOD — Mantine turns it into `data-combobox-active`
              // and no more (@mantine/core 7.17.8, `ComboboxOption.mjs`)
              // — and the tick in `OptionBody` sits inside an
              // `aria-hidden` slot, so without this a picked row said
              // nothing at all. Mantine's own dropdown states it the same
              // way (`OptionsDropdown.mjs`: `aria-selected={checked}`),
              // which is what the migrated modal controls had while they
              // were still `MultiSelect`s.
              aria-selected={value.has(option.value)}
              disabled={option.disabled || option.locked}
            >
              <OptionBody
                checked={value.has(option.value)}
                label={option.label}
                description={option.description}
                leading={option.leading}
              />
            </Combobox.Option>
          ))}
          {shown.length === 0 && nothingFoundMessage ? (
            <Combobox.Empty>{nothingFoundMessage}</Combobox.Empty>
          ) : null}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}
