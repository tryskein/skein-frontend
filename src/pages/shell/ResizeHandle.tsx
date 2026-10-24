import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ColKey, useLayoutState } from '../../lib/useLayoutState';

/** Start of the travel and its limits, px. */
interface LiveBounds {
  start: number;
  min: number;
  max: number;
}

interface Props {
  /**
   * Which column the handle sizes — the persisted width it writes when no
   * `onResize` is given, and the name in the default accessible label.
   * A handle with its own `onResize` and `label` needs none.
   */
  col?: ColKey | 'workspace';
  min: number;
  max: number;
  /**
   * Current width of the column being resized (px).
   *
   * `null` — there is no value yet: the workspace (tree, board) lies in the
   * default layout until the user drags (sk-551.14).
   * Then both the drag start and what the screen reader hears are given by
   * {@link Props.liveBounds}.
   */
  width: number | null;
  /**
   * sk-514 (10, 11) — where to write the result if this is NOT one of the
   * columns with persisted width: the workspace width lives in its own
   * state cell (`useLayoutState#setWorkspaceDetailsWidth`).
   *
   * A separate prop, not a second component: all the drag mechanics —
   * frames, cancel on blur, cursor, keyboard — are one here, and a copy
   * would drift from the original on the first edit.
   */
  onResize?: (w: number) => void;
  /**
   * sk-551.14 — the start and limits of the travel, measured at the moment of the action.
   *
   * Without it the drag goes from `width` within `min`/`max` — as with the columns
   * of "Cards", where `width` is the actual width. For the workspace
   * the stored number and the actual width diverge (in a narrow window
   * the row squeezes the column below the stored one), and dragging from the stored one
   * gave idle cursor travel. Called on pointerdown and on every
   * key; the result clamps both the drag and the keyboard, and it is also what
   * `aria-valuenow` / `-valuemin` / `-valuemax` announce.
   */
  liveBounds?: (handle: HTMLDivElement) => LiveBounds;
  /**
   * sk-551.29 — whose width: the column to the left of the handle (`'before'`, all
   * columns of "Cards") or to the right (`'after'`, the task panel next to the
   * board/tree — its width is remembered, the view to the left is the remainder).
   *
   * The boundary always follows the cursor: to the right of the handle the column grows
   * when the handle is dragged LEFT, so the cursor shift and the arrows are taken
   * with the opposite sign. Home / End still go to the smallest / largest
   * column width: the handle's value is its width (APG window splitter,
   * «primary pane»).
   */
  sizes?: 'before' | 'after';
  /**
   * sk-551.8 (P8) — the axis of the drag. `vertical` (the default, every
   * existing handle): a vertical bar between two columns, dragged along X
   * with ←/→. `horizontal`: a horizontal bar between two stacked sections,
   * dragged along Y with ↑/↓, `aria-orientation="horizontal"`, an
   * `ns-resize` cursor. The value is then the height of the part ABOVE.
   */
  orientation?: 'vertical' | 'horizontal';
  /** sk-551.8 (P8) — the accessible name; default `resizeColumn` with `col`. */
  label?: string;
  /** sk-551.8 (P8) — a double click resets the size (the split: 0.5, US-4). */
  onReset?: () => void;
  /**
   * sk-551.8 (P8) — `plain`: no `resize-handle--workspace` class even with
   * `onResize`. Absent: the class follows `onResize`, as before.
   */
  variant?: 'plain';
}

/**
 * Vertical drag handle between two columns.
 *
 * Pointer-based — works with mouse, trackpad and pen. We use
 * `pointermove` over `mousemove` so a single set of listeners covers
 * all input devices. Drag updates are funnelled through
 * `requestAnimationFrame` to coalesce intra-frame moves.
 */
export function ResizeHandle({
  col,
  min,
  max,
  width,
  onResize,
  liveBounds,
  sizes = 'before',
  orientation = 'vertical',
  label,
  onReset,
  variant,
}: Props) {
  const horizontal = orientation === 'horizontal';
  /** The pointer coordinate along the drag axis. */
  const axisOf = horizontal
    ? (e: { clientX: number; clientY: number }) => e.clientY
    : (e: { clientX: number; clientY: number }) => e.clientX;
  const axisRef = useRef(axisOf);
  axisRef.current = axisOf;
  const { t } = useTranslation('shell');
  const { setColWidth } = useLayoutState();
  // Its own write — if given; otherwise persisted column width, as before.
  const commitRef = useRef<(w: number) => void>(() => {});
  commitRef.current =
    onResize ??
    ((w: number) => {
      if (col !== undefined && col !== 'workspace') setColWidth(col, w);
    });
  const commit = useCallback((w: number) => commitRef.current(w), []);
  const [dragging, setDragging] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  /** For the "Cards" columns — their width; `max` — if there is none at all. */
  const current = width ?? max;

  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  /** +1 — the left column grows to the right; −1 — the right column grows to the left. */
  const sign = sizes === 'after' ? -1 : 1;
  const signRef = useRef(sign);
  signRef.current = sign;
  // Limits of the CURRENT drag: from props or from the `liveBounds` measurement at
  // pointerdown. A ref, not effect deps — otherwise a per-frame measurement
  // would resubscribe the listeners in the middle of a drag.
  const dragBoundsRef = useRef({ min, max });
  const liveBoundsRef = useRef(liveBounds);
  liveBoundsRef.current = liveBounds;

  /** Start and limits of the action beginning now. */
  const boundsNow = (): LiveBounds => {
    const live = liveBoundsRef.current;
    if (live && rootRef.current) return live(rootRef.current);
    return { start: widthRef.current, min, max };
  };

  /**
   * sk-551.14 — what the handle announces to the screen reader when its travel is measured
   * live: THE SAME measurement that the drag and the keys go from. The stored
   * width is the layout's intention, not the boundary position: on a window narrower
   * it the view is squeezed, and "900 of 3840" with an actual 600 of 600 would promise
   * a travel that does not exist. `null` — the handle has no `liveBounds`, the
   * props are announced.
   *
   * Re-measured after every render (width commit, collapsing of
   * neighbours — all of these re-render the row), on focus and when the
   * size of the row or of the column to the left changes (window). An equal measurement does not touch
   * the state, so render after render does not loop.
   */
  const [liveAria, setLiveAria] = useState<LiveBounds | null>(null);
  const hasLive = liveBounds !== undefined;
  const refreshLiveAria = useCallback(() => {
    const live = liveBoundsRef.current;
    const el = rootRef.current;
    if (!live || !el) return;
    const b = live(el);
    setLiveAria((prev) =>
      prev !== null && prev.start === b.start && prev.min === b.min && prev.max === b.max
        ? prev
        : b,
    );
  }, []);
  useLayoutEffect(() => {
    refreshLiveAria();
  });
  useEffect(() => {
    if (!hasLive) return;
    const el = rootRef.current;
    const watched = [el?.parentElement, el?.previousElementSibling].filter(
      (n): n is Element => n != null,
    );
    const observer = new ResizeObserver(() => refreshLiveAria());
    watched.forEach((n) => observer.observe(n));
    window.addEventListener('resize', refreshLiveAria);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', refreshLiveAria);
    };
  }, [hasLive, refreshLiveAria]);
  const aria = liveAria ?? { start: current, min, max };
  const pendingWidthRef = useRef<number | null>(null);
  const rafIdRef = useRef<number | null>(null);

  // Latest width is read inside pointerdown to capture the live value
  // without re-attaching listeners on every parent re-render.
  const widthRef = useRef(current);
  widthRef.current = current;

  useEffect(() => {
    if (!dragging) return;

    const flush = () => {
      rafIdRef.current = null;
      if (pendingWidthRef.current !== null) {
        commit(pendingWidthRef.current);
        pendingWidthRef.current = null;
      }
    };

    const onMove = (e: PointerEvent) => {
      const delta = (axisRef.current(e) - startXRef.current) * signRef.current;
      const { min: lo, max: hi } = dragBoundsRef.current;
      const next = Math.max(lo, Math.min(hi, startWidthRef.current + delta));
      pendingWidthRef.current = next;
      if (rafIdRef.current === null) {
        rafIdRef.current = window.requestAnimationFrame(flush);
      }
    };

    const onUp = () => {
      setDragging(false);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    // Safety net: if focus leaves the window mid-drag, the browser
    // typically also fires pointerup, but some environments swallow it
    // (drag-past-window-edge on Linux/Wayland, devtool overlay grabs).
    // `visibilitychange` and `blur` are the last-resort terminators —
    // they end the drag deterministically so we never leak the drag
    // state into the next user interaction.
    const cancelOnBlur = () => setDragging(false);
    window.addEventListener('blur', cancelOnBlur);
    document.addEventListener('visibilitychange', cancelOnBlur);

    // Cursor on body for the duration of the drag. We deliberately do
    // NOT touch `document.body.style.userSelect` — earlier we set it to
    // 'none' to suppress text selection during drag, but if the cleanup
    // ever missed (pointerup lost, etc.) the rule stuck globally and
    // killed text selection in every input on the page (search boxes,
    // inline-edit fields, …). The handle has its own `user-select: none`
    // in CSS and we call `preventDefault()` on pointerdown — that's
    // enough to keep the drag clean without a global flag.
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = cursorRef.current;

    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('blur', cancelOnBlur);
      document.removeEventListener('visibilitychange', cancelOnBlur);
      document.body.style.cursor = prevCursor;
      // Every end of a drag lands here — pointerup, pointercancel, blur,
      // visibilitychange, unmount — and the last move may still be waiting
      // for its frame: a hidden tab runs no frames, and a release can beat
      // the frame to this cleanup. Commit it BEFORE cancelling the frame,
      // or the width the pointer was released at is lost (review grok ts).
      // The commit lands in the layout state, which outlives the handle.
      if (pendingWidthRef.current !== null) {
        commit(pendingWidthRef.current);
        pendingWidthRef.current = null;
      }
      if (rafIdRef.current !== null) {
        window.cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [dragging, commit]);

  const cursorRef = useRef(horizontal ? 'ns-resize' : 'ew-resize');
  cursorRef.current = horizontal ? 'ns-resize' : 'ew-resize';

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only accept primary button / pen / touch
    if (e.button !== 0) return;
    e.preventDefault();
    const b = boundsNow();
    startXRef.current = axisOf(e);
    startWidthRef.current = b.start;
    dragBoundsRef.current = { min: b.min, max: b.max };
    setDragging(true);
  };

  // Keyboard nudge — Arrow keys move 16px, Home/End snap to bounds.
  // Required for ARIA APG separator-with-resize semantics; mouse-only
  // resize previously locked out keyboard users entirely.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const STEP = 16;
    let target: ((b: LiveBounds) => number) | null = null;
    // An arrow moves the BOUNDARY in its direction; the width of the column to the right of
    // the handle changes with the opposite sign (`sizes`).
    const back = horizontal ? 'ArrowUp' : 'ArrowLeft';
    const forward = horizontal ? 'ArrowDown' : 'ArrowRight';
    if (e.key === back) target = (b) => b.start - STEP * sign;
    else if (e.key === forward) target = (b) => b.start + STEP * sign;
    else if (e.key === 'Home') target = (b) => b.min;
    else if (e.key === 'End') target = (b) => b.max;
    if (target === null) return;
    e.preventDefault();
    const b = boundsNow();
    commit(Math.max(b.min, Math.min(b.max, target(b))));
  };

  return (
    <div
      ref={rootRef}
      className={`resize-handle${dragging ? ' dragging' : ''}${
        onResize && variant !== 'plain' ? ' resize-handle--workspace' : ''
      }${horizontal ? ' resize-handle--horizontal' : ''}`}
      role="separator"
      aria-orientation={orientation}
      aria-label={label ?? t('resizeColumn', { col })}
      aria-valuenow={aria.start}
      aria-valuemin={aria.min}
      aria-valuemax={aria.max}
      tabIndex={0}
      onFocus={refreshLiveAria}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
    />
  );
}
