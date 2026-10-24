/**
 * sk-285.2.19 — the column PICKER's seam: what the control hands back.
 *
 * `lib/__tests__/treeColumns*.test.*` pin the registry and what survives
 * a reload; `TasksTreeColumns.test.tsx` pins that the stored set reaches
 * the table. Between those two sits the one step nothing could see: the
 * `MultiSelect` speaks in `string[]`, the preference is a
 * `Set<TreeOptionalColumn>`, and `TreeColumnsSelect` is the only place
 * that conversion happens. Replacing its `onChange` with a no-op — a
 * picker where ticking a column does nothing at all — left every other
 * test in the suite green, which is exactly the hole these fill.
 *
 * Asserted at the control itself rather than through the header: the
 * question here is «does ticking a row produce the right SET», and the
 * shell around it cannot make that answer any truer.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

import { TreeColumnsSelect } from '../TaskFilters';
import {
  TREE_DEFAULT_COLUMNS,
  type TreeColumnSet,
  type TreeOptionalColumn,
} from '../../../lib/treeColumns';

function renderPicker(value: TreeColumnSet) {
  const onChange = vi.fn();
  render(
    <MantineProvider forceColorScheme="dark">
      <TreeColumnsSelect value={value} onChange={onChange} />
    </MantineProvider>,
  );
  return onChange;
}

/** Mantine 7 names both the input and the dropdown; target the input. */
const control = () => screen.getByRole('textbox', { name: 'Table columns' });

/** The set the picker handed back on its Nth call. */
function handedBack(
  onChange: ReturnType<typeof vi.fn>,
  call = 0,
): TreeColumnSet {
  return onChange.mock.calls[call][0] as TreeColumnSet;
}

afterEach(() => cleanup());

describe('sk-285.2.19 — TreeColumnsSelect hands back the picked SET', () => {
  test('ticking an unpicked column ADDS it to the set the caller stores', () => {
    // `labels` is off by default, so this cannot be confused with the
    // set that went in.
    const onChange = renderPicker(new Set(TREE_DEFAULT_COLUMNS));
    fireEvent.click(control());
    fireEvent.click(screen.getByRole('option', { name: /^Labels/ }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = handedBack(onChange);
    expect(next).toBeInstanceOf(Set);
    expect([...next].sort()).toEqual(
      [...TREE_DEFAULT_COLUMNS, 'labels'].sort(),
    );
  });

  test('un-ticking a picked column REMOVES only that one', () => {
    const onChange = renderPicker(
      new Set<TreeOptionalColumn>(['id', 'status', 'updated']),
    );
    fireEvent.click(control());
    fireEvent.click(screen.getByRole('option', { name: /^Status/ }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect([...handedBack(onChange)].sort()).toEqual(['id', 'updated']);
  });

  test('turning the last column off hands back an EMPTY set, not a fallback', () => {
    // The «titles only» choice is made HERE, and it has to leave the
    // control as an empty set — anything else (undefined, the defaults)
    // and the preference could never be emptied at all.
    const onChange = renderPicker(new Set<TreeOptionalColumn>(['id']));
    fireEvent.click(control());
    fireEvent.click(screen.getByRole('option', { name: /^ID/ }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = handedBack(onChange);
    expect(next).toBeInstanceOf(Set);
    expect(next.size).toBe(0);
  });

  test('the set that goes IN is the set the control shows', () => {
    // The other half of the same wire: a picker that reads its own state
    // instead of the stored preference would look right and save wrong.
    renderPicker(new Set<TreeOptionalColumn>(['id', 'created']));
    const field = control().closest('.task-filter-select') as HTMLElement;
    expect(field.textContent).toContain('ID');
    expect(field.textContent).toContain('Created');
    expect(field.textContent).not.toContain('Assignee');
  });

  test('the structural title column is not on offer', () => {
    // It is stated in the description line and never listed: a row for it
    // would invite the reader to try switching the tree off.
    renderPicker(new Set(TREE_DEFAULT_COLUMNS));
    fireEvent.click(control());
    const options = screen.getAllByRole('option').map((o) => o.textContent ?? '');
    expect(options).toHaveLength(11);
    expect(options.some((o) => o.startsWith('Task'))).toBe(false);
  });
});
