import { useEffect, type RefObject } from 'react';

/** What Tab can land on inside the dialog, in document order. */
const CANDIDATES =
  'a[href], area[href], button, input, select, textarea, iframe, summary, [contenteditable=""], [contenteditable="true"], [tabindex]';

function tabStops(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(CANDIDATES)].filter(
    (el) =>
      el.tabIndex >= 0 &&
      !(el as HTMLButtonElement).disabled &&
      !(el instanceof HTMLInputElement && el.type === 'hidden') &&
      el.closest('[inert], [hidden], [aria-hidden="true"]') === null,
  );
}

/**
 * sk-551.5 (review C2) — keep Tab inside a modal dialog, and start on the
 * dialog itself.
 *
 * The first cut used Mantine's `FocusTrap` with its initial-focus sentinel
 * (a visually hidden `tabIndex=-1` stop). Its `scopeTab` only wraps when
 * focus sits on the trap's root or on the first/last TABBABLE element; a
 * `-1` sentinel is neither, so Shift+Tab from the starting position walked
 * straight out of the window into the page behind. Putting the start on
 * the root instead cannot be expressed through that trap: it looks for
 * `[data-autofocus]` among DESCENDANTS only and otherwise focuses the first
 * tabbable control, which would also land the reader on «close issue»
 * rather than on the dialog's name.
 *
 * So the two halves are done here, in full:
 *
 *   - on activation focus moves to the dialog (`tabIndex=-1`), so a screen
 *     reader announces it by its accessible name — the issue title;
 *   - Tab on the last stop goes to the first, Shift+Tab on the first stop
 *     — or on the dialog itself — goes to the last. In between the browser
 *     does its own thing.
 *
 * Focus that leaves by a POINTER (the header stays live above the window)
 * is not pulled back: the page behind the window is `inert` (see `Shell`),
 * so the next Tab from the header comes back into the dialog by document
 * order on its own.
 */
export function useDialogFocusTrap(ref: RefObject<HTMLElement>, active: boolean): void {
  useEffect(() => {
    const root = ref.current;
    if (!active || root === null) return;
    root.focus({ preventScroll: true });
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focused = document.activeElement;
      if (!(focused instanceof Node) || !root.contains(focused)) return;
      const stops = tabStops(root);
      if (stops.length === 0) {
        e.preventDefault();
        root.focus({ preventScroll: true });
        return;
      }
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (e.shiftKey && (focused === first || focused === root)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && focused === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [ref, active]);
}
