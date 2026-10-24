/**
 * sk-551.29 — the start and limits of the handle drag between the view and the task panel,
 * in the width of the PANEL.
 *
 * The reference is the maintainers' decision in sk-551.29 ("the card width is remembered,
 * the view is the remainder") and the sk-551.14 acceptance, which stays in force: "the drag
 * start is counted from the measured width, not the stored one; the upper bound does not
 * exceed the available width"; the task panel is not narrower than its floor, the view is not
 * narrower than `COL_BOUNDS.tasks.min`.
 */
import { describe, expect, test } from 'vitest';
import { detailsDragBounds, tasksDragBounds } from './workspaceResize';

const BASE = {
  detailsMinPx: 420,
  viewMinPx: 280,
  fallbackMax: 3840,
};

describe('detailsDragBounds', () => {
  test('the drag starts from the measured panel width, not the stored one', () => {
    const b = detailsDragBounds({ ...BASE, detailsPx: 500, viewPx: 600, fallbackStart: 900 });
    expect(b.start).toBe(500);
  });

  test('the lower bound is the panel floor; the upper is the panel plus what the view can give above its floor', () => {
    const b = detailsDragBounds({ ...BASE, detailsPx: 500, viewPx: 600, fallbackStart: 900 });
    expect(b).toEqual({ start: 500, min: 420, max: 820 });
  });

  test('the view at its floor: the upper bound equals the panel itself, the interval does not flip', () => {
    expect(
      detailsDragBounds({ ...BASE, detailsPx: 500, viewPx: 280, fallbackStart: 500 }).max,
    ).toBe(500);
  });

  test('the panel is squeezed narrower than its floor: the lower bound is itself, the start is in the interval', () => {
    // Tablet layout at the lower edge (sk-551.30): the row squeezes the panel
    // below 420, while the view stands at 280.
    const squeezed = detailsDragBounds({ ...BASE, detailsPx: 394, viewPx: 280, fallbackStart: 600 });
    expect(squeezed).toEqual({ start: 394, min: 394, max: 394 });
  });

  test('a zero measurement is not zero: the start from the stored one, the upper is the fallback', () => {
    expect(
      detailsDragBounds({ ...BASE, detailsPx: 0, viewPx: 0, fallbackStart: 560 }),
    ).toEqual({ start: 560, min: 420, max: 3840 });
    // A stored value below the floor is raised to the floor.
    expect(
      detailsDragBounds({ ...BASE, detailsPx: 0, viewPx: 0, fallbackStart: 300 }).start,
    ).toBe(420);
  });
});

/**
 * sk-551.43 — the same in "Cards", in the width of the TASKS COLUMN. The reference is
 * the sk-551.43 acceptance: "the upper bound of the tasks column drag in "Cards" = column +
 * panel − 420"; the task card can be narrowed to 420, as next to the
 * tree and the board.
 */
describe('tasksDragBounds', () => {
  const TASKS = {
    detailsMinPx: 420,
    tasksMinPx: 280,
    fallbackMax: 600,
    hardMax: 3840,
  };

  test('the upper bound is column plus panel minus the panel floor, not the former 600', () => {
    // 1440, navigation collapsed: column 468, panel 878.
    expect(
      tasksDragBounds({ ...TASKS, tasksPx: 468, detailsPx: 878, savedWidth: 468 }),
    ).toEqual({ start: 468, min: 280, max: 926 });
  });

  test('the start is the measured column, not the stored one', () => {
    expect(
      tasksDragBounds({ ...TASKS, tasksPx: 500, detailsPx: 420, savedWidth: 900 }).start,
    ).toBe(500);
  });

  test('the panel at its floor: the upper bound equals the column itself', () => {
    expect(
      tasksDragBounds({ ...TASKS, tasksPx: 500, detailsPx: 420, savedWidth: 900 }).max,
    ).toBe(500);
  });

  test('the panel is squeezed below the floor: the interval does not flip', () => {
    expect(
      tasksDragBounds({ ...TASKS, tasksPx: 282, detailsPx: 300, savedWidth: 468 }),
    ).toEqual({ start: 282, min: 280, max: 282 });
  });

  test('no panel or column measurement: the former upper bound, the start from the stored one', () => {
    expect(
      tasksDragBounds({ ...TASKS, tasksPx: 0, detailsPx: 0, savedWidth: 468 }),
    ).toEqual({ start: 468, min: 280, max: 600 });
    expect(
      tasksDragBounds({ ...TASKS, tasksPx: 468, detailsPx: 0, savedWidth: 468 }).max,
    ).toBe(600);
  });
});
