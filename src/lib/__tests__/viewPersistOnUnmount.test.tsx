/**
 * sk-285.6.17 — the chosen view survives the hop off a focus page.
 *
 * The header's view switcher now sets the view and, from a focus page
 * (/settings/*, /legacy/*, /activity), navigates to "/" in the SAME
 * click. Every surface mounts its own `TasksUiStateProvider`, so that
 * navigation unmounts the provider in the very commit that would have
 * run its write-through effect — React batches the two updates into one
 * render, and an unmounting provider never flushes its effects. The
 * value would be dropped and the freshly-mounted shell would read the
 * PREVIOUS view back out of storage: the button the user pressed is not
 * the view that comes up.
 *
 * `useLayoutState.setInboxTab` already carries the fix for the identical
 * queue-badge flow (write localStorage inside the setter, not only in
 * the effect); this pins the same property for `setView`.
 *
 * The mechanism is what makes this test non-vacuous: the click must
 * change state AND unmount the provider in ONE commit. Calling
 * `unmount()` from the test instead would let the effect flush first and
 * the assertion would pass with or without the fix.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { TasksUiStateProvider, useTasksUiState } from '../useTasksUiState';

const KEY = 'skein.tasks.view';

/** The control: picks a view and leaves the surface in one handler. */
function Switcher({ onLeave }: { onLeave: () => void }) {
  const ui = useTasksUiState();
  return (
    <button
      type="button"
      onClick={() => {
        ui.setView('tree');
        onLeave();
      }}
    >
      tree
    </button>
  );
}

/**
 * The focus page: it OWNS the provider, exactly as SettingsLayout and
 * AppChrome do, so "leaving" it takes the provider down with it.
 */
function FocusPage() {
  const [here, setHere] = useState(true);
  if (!here) return <span data-testid="left" />;
  return (
    <TasksUiStateProvider>
      <Switcher onLeave={() => setHere(false)} />
    </TasksUiStateProvider>
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('sk-285.6.17 — setView persists before its provider can unmount', () => {
  test('the view chosen on the way out of a focus page is the one stored', () => {
    window.localStorage.setItem(KEY, 'cards');
    render(<FocusPage />);

    fireEvent.click(screen.getByRole('button', { name: 'tree' }));

    // The provider is gone — this is the commit that would have skipped
    // the write-through effect.
    expect(screen.getByTestId('left')).toBeTruthy();
    expect(window.localStorage.getItem(KEY)).toBe('tree');
  });

  test('and the surface that mounts next reads that view back', () => {
    window.localStorage.setItem(KEY, 'cards');
    render(<FocusPage />);
    fireEvent.click(screen.getByRole('button', { name: 'tree' }));

    // A second, independent provider — the shell mounting after the
    // navigation. It reads storage on mount, so it sees `tree` only if
    // the value actually survived.
    let view: string | null = null;
    function Reader() {
      view = useTasksUiState().view;
      return null;
    }
    render(
      <TasksUiStateProvider>
        <Reader />
      </TasksUiStateProvider>,
    );
    expect(view).toBe('tree');
  });

  /**
   * The other half of "one writer": the setter is the ONLY thing that
   * may touch this key.
   *
   * A write-through `useEffect(… , [view])` used to sit beside it. It
   * looked like a harmless duplicate and was not: the effect closes over
   * the `view` of the render that scheduled it, so a mount-commit effect
   * that has not flushed yet still carries the PREVIOUS value, and React
   * flushes pending passive effects before rendering the next update —
   * i.e. after `setView` has already written the new one. The stale
   * effect then puts the old value back, which is exactly the defect
   * above wearing a different hat. Review saw this file fail on both
   * tests in one full suite run out of five with `expected 'cards' to
   * be 'tree'` — 'cards' being what a stale effect restores; that
   * intermittency was not reproduced afterwards, so the effect was
   * removed on the argument, and this test pins the part of it that IS
   * deterministic.
   *
   * Mount-writes-nothing is the observable shape of that invariant, and
   * the same property `treeColumns` / `listCardFields` already hold: a
   * provider that merely rendered stores nothing, so a missing key still
   * means "no preference" rather than "the defaults of whichever build
   * this user happened to open first".
   */
  test('merely mounting writes nothing — the setter is the only writer', () => {
    expect(window.localStorage.getItem(KEY)).toBeNull();

    function Probe() {
      useTasksUiState();
      return null;
    }
    render(
      <TasksUiStateProvider>
        <Probe />
      </TasksUiStateProvider>,
    );

    // No click, no choice — nothing to persist. A write-through effect
    // would have stamped this build's default ('cards') into a key the
    // user never touched, and would be back to racing the setter.
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
});
