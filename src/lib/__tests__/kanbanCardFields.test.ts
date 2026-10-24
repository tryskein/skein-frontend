/**
 * sk-285.2.5 — the display-properties model.
 *
 * Three promises are asserted here, because each of them is the kind of
 * thing that breaks quietly:
 *
 *   1. the defaults ARE the board as it shipped — turning the setting on
 *      redraws nobody's board;
 *   2. the axis still hides the one field its column states, and hides
 *      exactly that one;
 *   3. an EMPTY selection survives a reload (it is a choice, not an
 *      absence of one).
 */

import { describe, expect, test } from 'vitest';
import {
  KANBAN_AXIS_SUPPRESSED,
  KANBAN_CARD_FIELDS,
  KANBAN_DEFAULT_CARD_FIELDS,
  cardFieldsMask,
  hasCardField,
  parseCardFields,
  serializeCardFields,
  visibleCardFieldsMask,
  type KanbanCardField,
} from '../kanbanCardFields';
import { KANBAN_AXES } from '../kanbanBoard';

describe('the default set is the board as it shipped', () => {
  test('exactly the properties sk-285.2.3/2.4 painted, and no more', () => {
    expect([...KANBAN_DEFAULT_CARD_FIELDS].sort()).toEqual(
      ['assignee', 'blocked', 'id', 'priority', 'status', 'type'].sort(),
    );
  });

  test('on the status axis the default still hides the status chip', () => {
    // The shipped card printed the status everywhere EXCEPT the status
    // board, where the column head already says it.
    const mask = visibleCardFieldsMask(KANBAN_DEFAULT_CARD_FIELDS, 'status');
    expect(hasCardField(mask, 'status')).toBe(false);
    expect(hasCardField(mask, 'blocked')).toBe(true);
    expect(hasCardField(mask, 'assignee')).toBe(true);
  });

  test('and on every other axis it shows it', () => {
    for (const axis of KANBAN_AXES) {
      if (axis === 'status') continue;
      expect(
        hasCardField(visibleCardFieldsMask(KANBAN_DEFAULT_CARD_FIELDS, axis), 'status'),
      ).toBe(true);
    }
  });

  test('nothing outside the default set is on by default', () => {
    const mask = visibleCardFieldsMask(KANBAN_DEFAULT_CARD_FIELDS, 'priority');
    for (const f of ['components', 'labels', 'updated', 'created', 'delegated'] as const) {
      expect(hasCardField(mask, f)).toBe(false);
    }
  });
});

describe('the axis hides exactly the field its column states', () => {
  const everything = KANBAN_CARD_FIELDS;

  test.each(Object.entries(KANBAN_AXIS_SUPPRESSED))(
    'the %s axis hides %s and nothing else',
    (axis, field) => {
      const mask = visibleCardFieldsMask(
        everything,
        axis as (typeof KANBAN_AXES)[number],
      );
      for (const f of everything) {
        expect(hasCardField(mask, f)).toBe(f !== field);
      }
    },
  );

  test('an axis with nothing to suppress leaves the set whole', () => {
    // `priority` / `type` deliberately keep their chip — the user turns
    // it off with the switch if they do not want it (see the module doc).
    for (const axis of ['priority', 'type', 'project'] as const) {
      expect(visibleCardFieldsMask(everything, axis)).toBe(cardFieldsMask(everything));
    }
  });

  test('the switch can turn a field OFF but the axis cannot turn one ON', () => {
    const onlyTitle = visibleCardFieldsMask([], 'priority');
    for (const f of KANBAN_CARD_FIELDS) {
      expect(hasCardField(onlyTitle, f)).toBe(false);
    }
  });
});

describe('the mask is a faithful packing', () => {
  test('every field has its own bit', () => {
    const bits = KANBAN_CARD_FIELDS.map((f) => cardFieldsMask([f]));
    expect(new Set(bits).size).toBe(KANBAN_CARD_FIELDS.length);
  });

  test('round-trips a set of any shape', () => {
    const picked: KanbanCardField[] = ['labels', 'created', 'delegated'];
    const mask = cardFieldsMask(picked);
    for (const f of KANBAN_CARD_FIELDS) {
      expect(hasCardField(mask, f)).toBe(picked.includes(f));
    }
  });
});

describe('persistence', () => {
  test('a stored set round-trips, order-independently', () => {
    const raw = serializeCardFields(['delegated', 'id', 'labels']);
    const back = parseCardFields(raw)!;
    expect([...back].sort()).toEqual(['delegated', 'id', 'labels']);
  });

  test('an EMPTY selection round-trips as empty, not as the defaults', () => {
    const raw = serializeCardFields([]);
    const back = parseCardFields(raw);
    expect(back).not.toBeNull();
    expect(back!.size).toBe(0);
  });

  test('a missing key is the ONLY thing that means "use the defaults"', () => {
    expect(parseCardFields(null)).toBeNull();
    expect(parseCardFields(undefined)).toBeNull();
  });

  test('a field this build does not know is dropped, not fatal', () => {
    // A value written by a newer build must still load, minus the field
    // this build cannot render.
    const back = parseCardFields('id, estimate ,labels')!;
    expect([...back].sort()).toEqual(['id', 'labels']);
  });
});
