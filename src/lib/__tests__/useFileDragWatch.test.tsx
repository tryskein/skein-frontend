/**
 * sk-285.6.9 — the drag observer that unfolds the card's upload zone.
 *
 * The card folds its dropzone to a single line at rest, so the ONLY
 * thing that makes a drag still work is this: notice the file on its
 * way in and unfold the target before the user lets go.
 *
 * Two behaviours are worth a test because both are the kind that looks
 * fine on the happy path and fails in use:
 *   - a drag that carries no files (a text selection, a link) must not
 *     open an uploader;
 *   - crossing into a child fires `dragleave` on the parent, so an
 *     uncounted implementation flickers the target shut the instant the
 *     pointer reaches anything inside it.
 */

import { describe, expect, test } from 'vitest';
import { act, render } from '@testing-library/react';

import { useFileDragWatch } from '../useFileDragWatch';

/** Minimal stand-in for the drag payload — `types` is all we read. */
function dragEvent(types: string[]) {
  return { dataTransfer: { types } } as unknown as React.DragEvent<HTMLElement>;
}

function harness() {
  let api: ReturnType<typeof useFileDragWatch> | null = null;
  function Probe() {
    api = useFileDragWatch();
    return null;
  }
  render(<Probe />);
  const current = () => {
    if (api === null) throw new Error('the probe never rendered');
    return api;
  };
  return {
    get active() {
      return current().active;
    },
    get dropCount() {
      return current().dropCount;
    },
    enter(types: string[]) {
      act(() => current().handlers.onDragEnter(dragEvent(types)));
    },
    leave() {
      act(() => current().handlers.onDragLeave());
    },
    drop() {
      act(() => current().handlers.onDrop());
    },
    end() {
      act(() => current().handlers.onDragEnd());
    },
  };
}

describe('useFileDragWatch', () => {
  test('a file dragged in raises the flag', () => {
    const h = harness();
    expect(h.active).toBe(false);
    h.enter(['Files']);
    expect(h.active).toBe(true);
  });

  test('a drag carrying no files is ignored', () => {
    const h = harness();
    h.enter(['text/plain']);
    expect(h.active).toBe(false);
  });

  test('crossing into a child does not flicker the target shut', () => {
    const h = harness();
    // enter the card, then enter a child: two enters, one leave.
    h.enter(['Files']);
    h.enter(['Files']);
    h.leave();
    expect(h.active).toBe(true);
    // leaving the card for good balances the last enter.
    h.leave();
    expect(h.active).toBe(false);
  });

  test('a drop ends the gesture outright — no dangling leave is owed', () => {
    const h = harness();
    h.enter(['Files']);
    h.enter(['Files']);
    h.drop();
    expect(h.active).toBe(false);
    // …and the counter is genuinely back at zero: one enter, one leave
    // closes the next gesture. A decrement-only reset would leave the
    // uploader stuck open here.
    h.enter(['Files']);
    h.leave();
    expect(h.active).toBe(false);
  });

  // The consumer that unfolds a drop target on the drag has to know
  // WHY the drag ended. Both endings clear `active`, and the wrong
  // reading of them unmounts the target on the flush its drop started
  // an upload — which aborts that upload without a word.
  test('only a drop is counted — a drag that wandered off is not', () => {
    const h = harness();
    expect(h.dropCount).toBe(0);

    h.enter(['Files']);
    h.leave();
    expect(h.active).toBe(false);
    expect(h.dropCount).toBe(0);

    h.enter(['Files']);
    h.drop();
    expect(h.active).toBe(false);
    expect(h.dropCount).toBe(1);

    // Monotonic: a second drop is distinguishable from the first, so a
    // consumer comparing against the value it last saw never mistakes
    // an old drop for a new one.
    h.enter(['Files']);
    h.drop();
    expect(h.dropCount).toBe(2);

    // An aborted drag is not a landing either.
    h.enter(['Files']);
    h.end();
    expect(h.dropCount).toBe(2);
  });

  test('an aborted drag ends it too', () => {
    const h = harness();
    h.enter(['Files']);
    h.end();
    expect(h.active).toBe(false);
  });
});
