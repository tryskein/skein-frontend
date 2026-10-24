/**
 * sk-285.2.6 — the project-focus rules.
 *
 * Two things are pinned here, and both are about the promise the setting
 * makes rather than about its plumbing:
 *
 *   1. the focus and the Projects column never contradict each other —
 *      an open project PAUSES the focus instead of intersecting with it,
 *      which is what stops "focused on mob+pay, opened shop" from
 *      producing a blank board that neither control admits to;
 *   2. the focus reports its own cost. `hidden` is what the board prints,
 *      so a narrowed board can never pass for a small one.
 */

import { describe, expect, test } from 'vitest';

import {
  applyProjectFocus,
  focusWithinSpace,
  parseProjectFocus,
  projectFocusOnPlace,
  projectFocusState,
  replaceFocusWithinSpace,
  serializeProjectFocus,
} from '../kanbanProjectFocus';

const MOB = '01930000-0000-7000-8000-00000000mob0';
const PAY = '01930000-0000-7000-8000-00000000pay0';
const SHOP = '01930000-0000-7000-8000-0000000shop0';

function row(projectId: string, id: string) {
  return { id, projectId };
}

describe('project focus — storage round-trip', () => {
  test('an absent or empty value is "all projects", not a focus of nothing', () => {
    expect(parseProjectFocus(null).size).toBe(0);
    expect(parseProjectFocus('').size).toBe(0);
    expect(projectFocusState(parseProjectFocus(null), null)).toBe('off');
  });

  test('a picked set survives the round-trip', () => {
    const focus = new Set([MOB, PAY]);
    expect([...parseProjectFocus(serializeProjectFocus(focus))].sort()).toEqual(
      [MOB, PAY].sort(),
    );
  });

  test('stray whitespace / empty segments in stored text are ignored', () => {
    expect([...parseProjectFocus(` ${MOB} , , ${PAY} `)].sort()).toEqual(
      [MOB, PAY].sort(),
    );
  });
});

describe('project focus vs the Projects column', () => {
  const focus = new Set([MOB, PAY]);

  test('applies on the cross-project surface', () => {
    expect(projectFocusState(focus, null)).toBe('active');
  });

  test('PAUSES — not intersects — while a single project is open', () => {
    // The killer case: the open project is not in the focus set. An
    // intersection would empty the board while both controls claim to
    // be on; pausing lets the explicit click govern.
    expect(projectFocusState(focus, 'shop')).toBe('paused');
  });

  test('pauses even when the open project IS focused (one rule, no exceptions)', () => {
    expect(projectFocusState(focus, 'mob')).toBe('paused');
  });

  test('an empty focus is off on every surface', () => {
    expect(projectFocusState(new Set(), null)).toBe('off');
    expect(projectFocusState(new Set(), 'mob')).toBe('off');
  });
});

describe('project focus — the rows it keeps and the ones it charges for', () => {
  const items = [row(MOB, 'a-1'), row(PAY, 'b-1'), row(SHOP, 'c-1'), row(SHOP, 'c-2')];
  const focus = new Set([MOB, PAY]);

  test('keeps only the focused projects and reports what it took', () => {
    const out = applyProjectFocus(items, focus, 'active');
    expect(out.items.map((i) => i.id)).toEqual(['a-1', 'b-1']);
    expect(out.hidden).toBe(2);
  });

  test('a paused focus hides nothing — and hands back the very same array', () => {
    const out = applyProjectFocus(items, focus, 'paused');
    expect(out.items).toBe(items);
    expect(out.hidden).toBe(0);
  });

  test('no focus hides nothing', () => {
    const out = applyProjectFocus(items, new Set(), 'off');
    expect(out.items).toBe(items);
    expect(out.hidden).toBe(0);
  });

  test('a focus that matches nothing loaded empties the board honestly', () => {
    const out = applyProjectFocus(items, new Set(['nope']), 'active');
    expect(out.items).toHaveLength(0);
    expect(out.hidden).toBe(4);
  });
});

// ──────── sk-674.18 T052, matrix row 238 — the focus on the place «space» ────────
//
// Reference: spec US-3 "Kanban" (decision of stage 1): on the place
// "space" the project focus acts INSIDE the space, the picker offers only
// its projects, and with no project of the space in the saved focus the
// focus is "paused". MOB and PAY live in one space, SHOP in another.

describe('project focus on a space place (row 238)', () => {
  const SPACE = new Set([MOB, PAY]);
  const rows = [row(MOB, 'mob-1'), row(PAY, 'pay-1')];

  test('acts inside the space: the board keeps only the focused projects of THIS space', () => {
    const r = projectFocusOnPlace(new Set([MOB, SHOP]), null, SPACE);
    expect(r.state).toBe('active');
    expect(r.pausedBySpace).toBe(false);
    // SHOP is not part of what the board applies or prints here.
    expect([...r.focus]).toEqual([MOB]);
    const out = applyProjectFocus(rows, r.focus, r.state);
    expect(out.items.map((i) => i.id)).toEqual(['mob-1']);
    expect(out.hidden).toBe(1);
  });

  test('none of the saved focus is in the space → paused by the space, nothing hidden', () => {
    const saved = new Set([SHOP]);
    const r = projectFocusOnPlace(saved, null, SPACE);
    expect(r.state).toBe('paused');
    expect(r.pausedBySpace).toBe(true);
    const out = applyProjectFocus(rows, r.focus, r.state);
    expect(out.items).toBe(rows);
    expect(out.hidden).toBe(0);
  });

  test('an empty focus is off on a space place too', () => {
    expect(projectFocusOnPlace(new Set(), null, SPACE)).toMatchObject({ state: 'off', pausedBySpace: false });
  });

  test('an open project still pauses it, whatever the space', () => {
    expect(projectFocusOnPlace(new Set([MOB]), 'mob', SPACE)).toMatchObject({
      state: 'paused',
      pausedBySpace: false,
    });
  });

  test('«All projects» (no space) applies the saved set as before', () => {
    const saved = new Set([MOB, SHOP]);
    const r = projectFocusOnPlace(saved, null, null);
    expect(r.state).toBe('active');
    expect(r.focus).toBe(saved);
  });

  test('the picker shows only the space part of the saved focus', () => {
    expect([...focusWithinSpace(new Set([MOB, SHOP]), SPACE)]).toEqual([MOB]);
    expect(focusWithinSpace(new Set([SHOP]), SPACE).size).toBe(0);
  });

  test('a pick inside the space replaces only its part; other spaces keep their choice', () => {
    const saved = new Set([MOB, SHOP]);
    expect([...replaceFocusWithinSpace(saved, SPACE, new Set([PAY]))].sort()).toEqual([PAY, SHOP].sort());
    // Clearing inside the space empties only the space part.
    expect([...replaceFocusWithinSpace(saved, SPACE, new Set())]).toEqual([SHOP]);
    // A project from outside the space cannot be smuggled in by the picker.
    expect([...replaceFocusWithinSpace(new Set(), SPACE, new Set([SHOP]))]).toEqual([]);
  });
});
