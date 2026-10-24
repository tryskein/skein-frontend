/**
 * sk-551.8 F9 — the drag axis of `ResizeHandle` (plan P8).
 *
 * Reference: US-4 (a horizontal handle between two sections: ↑/↓ change
 * the upper body by 16 px, Home/End go to the live bounds, a double click
 * sets equal bodies), US-5 / SC-006 (keyboard and accessible semantics),
 * FOR-PLAN "handle axis" (the horizontal handle moves along the vertical
 * axis, with its own keys and `aria-orientation`), and P8's promise that
 * the defaults keep every existing handle as it was.
 *
 * The handle reads the layout state only for the column-width fallback;
 * that boundary is stubbed. jsdom has no `PointerEvent` — a MouseEvent
 * subclass stands in (the handle reads only coordinates and the button),
 * as in `WorkspaceSplit.test.tsx`.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../lib/useLayoutState', () => ({
  useLayoutState: () => ({ setColWidth: vi.fn() }),
}));

import { ResizeHandle } from '../ResizeHandle';

class TestPointerEvent extends MouseEvent {}
const hadPointerEvent = 'PointerEvent' in window;
beforeAll(() => {
  if (!hadPointerEvent) {
    (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = TestPointerEvent;
  }
});
afterAll(() => {
  if (!hadPointerEvent) delete (window as unknown as { PointerEvent?: unknown }).PointerEvent;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * The live measurement differs from every static prop (`min`/`max`/`width`
 * below), so a test passes only if the handle reads the live bounds.
 */
const LIVE = { start: 250, min: 210, max: 390 };

function horizontal() {
  const onResize = vi.fn();
  const onReset = vi.fn();
  render(
    <ResizeHandle
      orientation="horizontal"
      label="Resize sections"
      variant="plain"
      min={100}
      max={900}
      width={300}
      onResize={onResize}
      onReset={onReset}
      liveBounds={() => LIVE}
    />,
  );
  return { handle: screen.getByRole('separator', { name: 'Resize sections' }), onResize, onReset };
}

describe('the horizontal handle — keyboard, reset, semantics', () => {
  it.each([
    ['ArrowUp', 234],
    ['ArrowDown', 266],
    ['Home', 210],
    ['End', 390],
  ])('%s commits %d through onResize', (key, expected) => {
    const { handle, onResize } = horizontal();
    fireEvent.keyDown(handle, { key });
    expect(onResize).toHaveBeenCalledWith(expected);
  });

  it.each([['ArrowLeft'], ['ArrowRight']])('%s does nothing on a horizontal handle', (key) => {
    const { handle, onResize } = horizontal();
    fireEvent.keyDown(handle, { key });
    expect(onResize).not.toHaveBeenCalled();
  });

  it('a double click calls onReset', () => {
    const { handle, onReset } = horizontal();
    fireEvent.doubleClick(handle);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('is announced as a horizontal separator with its value and live bounds', () => {
    const { handle } = horizontal();
    expect(handle.getAttribute('aria-orientation')).toBe('horizontal');
    expect(handle.getAttribute('aria-valuenow')).toBe('250');
    expect(handle.getAttribute('aria-valuemin')).toBe('210');
    expect(handle.getAttribute('aria-valuemax')).toBe('390');
  });
});

describe('the horizontal handle — the pointer axis', () => {
  /** Press, move — the frame runs at once, as a browser would run it — and read. */
  function dragTo(handle: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }) {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    fireEvent.pointerDown(handle, { clientX: from.x, clientY: from.y, button: 0 });
    act(() => {
      window.dispatchEvent(new TestPointerEvent('pointermove', { clientX: to.x, clientY: to.y }));
    });
  }

  it('a vertical pointer move of +40 commits the live start + 40 on the frame', () => {
    const { handle, onResize } = horizontal();
    dragTo(handle, { x: 100, y: 100 }, { x: 100, y: 140 });
    expect(onResize).toHaveBeenLastCalledWith(290);
  });

  it('a horizontal pointer move leaves the value at the live start', () => {
    const { handle, onResize } = horizontal();
    dragTo(handle, { x: 100, y: 100 }, { x: 160, y: 100 });
    expect(onResize).toHaveBeenLastCalledWith(250);
  });
});

describe('the defaults keep the existing handles', () => {
  it('a vertical handle with onResize and no new props keeps --workspace, the vertical axis and ←/→', () => {
    const onResize = vi.fn();
    render(<ResizeHandle col="workspace" min={200} max={400} width={300} onResize={onResize} />);
    const handle = screen.getByRole('separator');
    expect(handle.classList.contains('resize-handle--workspace')).toBe(true);
    expect(handle.classList.contains('resize-handle--horizontal')).toBe(false);
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(onResize).toHaveBeenLastCalledWith(316);
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(onResize).toHaveBeenCalledTimes(1);
  });

  it('variant plain drops --workspace even with onResize', () => {
    render(<ResizeHandle variant="plain" label="w" min={200} max={480} width={300} onResize={vi.fn()} />);
    expect(screen.getByRole('separator').classList.contains('resize-handle--workspace')).toBe(false);
  });
});
