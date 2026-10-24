/**
 * sk-421.3 T15a (PK-3, INV-12, SC-016) — resetting the collapsed state on a
 * card change leaves NOT A SINGLE frame of another card's collapsed state.
 *
 * ─── Why this could not be checked on the section ───────────────────
 *
 * P-96 (`EpicProgressSection.test.tsx`) checks the RESULT of a card
 * change: the new card's tree is fully expanded. It does not see the intermediate frame
 * by construction — `render`/`rerender` in RTL run effects
 * inside `act`, and by the time of the first assertion the passive effect has already
 * run. So an implementation with the reset in `useEffect` passed P-96
 * while drawing one frame of the new rows against the PREVIOUS set
 * of collapsed ones.
 *
 * Here the subject is different: not "what is left on the screen afterwards", but "which
 * values the hook returned OVER ALL THE TIME". The probe records the value on EVERY
 * render — the component body runs on each of them — so
 * the intermediate frame, invisible to P-96, becomes an ordinary list
 * element.
 *
 * ─── The negative control is doubly necessary here ────────────────
 *
 * "No recorded value was foreign" is an assertion that is
 * green both for a probe that RECORDS NOTHING and for a probe that
 * writes only the last frame. So the former implementation (reset in a
 * passive effect) is run alongside, and the same probe must catch the foreign frame on it.
 * The corruption proves two things at once: that the probe
 * distinguishes the subject and that the fix really changed it.
 */

import type { Dispatch, SetStateAction } from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useCardScopedCollapse } from '../useCardScopedCollapse';

afterEach(() => cleanup());

type Collapsed = ReadonlySet<string>;
type Setter = Dispatch<SetStateAction<Collapsed>>;
type Hook = (cardId: string) => readonly [Collapsed, Setter];

interface ProbeProps {
  cardId: string;
  use: Hook;
  /** The value the hook returned on EVERY render, in order. */
  seen: Collapsed[];
  /** A box for the installer: there is no other way to reach it from outside. */
  api: { set?: Setter };
}

function Probe({ cardId, use, seen, api }: ProbeProps) {
  const [collapsed, setCollapsed] = use(cardId);
  seen.push(collapsed);
  api.set = setCollapsed;
  return <span data-testid="size">{collapsed.size}</span>;
}

/** Open card `first` and collapse one node on it. */
function openAndCollapse(use: Hook, first: string) {
  const seen: Collapsed[] = [];
  const api: { set?: Setter } = {};
  const view = render(<Probe cardId={first} use={use} seen={seen} api={api} />);
  act(() => api.set!(new Set(['node-1'])));

  // The probe really OBSERVES values: the collapsed node is recorded by it. Without
  // this, "no foreign frames recorded" would be green for a probe that
  // records nothing.
  expect(seen.at(-1)!.size, 'the probe does not see the hook values').toBe(1);

  const render2 = (next: string) => {
    seen.length = 0;
    view.rerender(<Probe cardId={next} use={use} seen={seen} api={api} />);
    expect(seen.length, 'the card change caused no render at all').toBeGreaterThan(0);
    return seen;
  };
  return { view, api, render2 };
}

describe('sk-421.3 T15a — a card change does not draw another card\'s collapsed state', () => {
  test('no frame of the new card carries the previous set', () => {
    const { render2 } = openAndCollapse(useCardScopedCollapse, 'demo-32');
    const frames = render2('demo-90');

    frames.forEach((set, i) => {
      expect(
        set.size,
        `frame ${i + 1} of ${frames.length} was drawn against another card's collapsed state`,
      ).toBe(0);
    });
  });

  test('the reset does not break the memory itself: on the new card nodes collapse', () => {
    // Otherwise "empty on every frame" could be satisfied by never returning
    // anything non-empty AT ALL — the rule would become a lie from the other
    // side.
    const { api, render2 } = openAndCollapse(useCardScopedCollapse, 'demo-32');
    const frames = render2('demo-90');
    expect(frames.at(-1)!.size).toBe(0);

    act(() => api.set!(new Set(['node-9'])));
    expect(frames.at(-1)!.size, 'after the reset the collapsed state stopped being remembered').toBe(1);
  });

  test('the card did not change — the collapsed state survives a redraw', () => {
    // PK-3 requires a reset on a card CHANGE, not on every render:
    // a redraw of the same card (live event, server response) does not
    // touch the memory.
    const seen: Collapsed[] = [];
    const api: { set?: Setter } = {};
    const view = render(
      <Probe cardId="demo-32" use={useCardScopedCollapse} seen={seen} api={api} />,
    );
    act(() => api.set!(new Set(['node-1'])));

    seen.length = 0;
    view.rerender(
      <Probe cardId="demo-32" use={useCardScopedCollapse} seen={seen} api={api} />,
    );

    for (const set of seen) {
      expect(set.size, 'a redraw of the same card erased the collapsed state').toBe(1);
    }
  });

  test('returning to the previous card does NOT resurrect its collapsed state', () => {
    // The memory belongs to the card but does not survive leaving it: otherwise
    // "fully expanded on open" would hold every other time.
    const { view, api } = openAndCollapse(useCardScopedCollapse, 'demo-32');
    const seen: Collapsed[] = [];
    view.rerender(<Probe cardId="demo-90" use={useCardScopedCollapse} seen={seen} api={api} />);
    seen.length = 0;
    view.rerender(<Probe cardId="demo-32" use={useCardScopedCollapse} seen={seen} api={api} />);

    for (const set of seen) {
      expect(set.size, 'the previous card\'s collapsed state was resurrected').toBe(0);
    }
  });
});
