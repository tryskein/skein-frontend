/**
 * Inspect mode — sk-10.3 hand-off helper.
 *
 * Drives the IconCrosshair button in the header. When `enabled`, the
 * hook arms a global capture-phase click listener: the next click
 * anywhere in the shell is consumed (preventDefault + stopImmediate),
 * its target's class-chain selector is computed, its parent chain is
 * walked (up to 5 levels), and the result is POSTed to
 * `/api/v1/me/theme/inspect` for the MCP agent to read.
 *
 * Why capture phase?
 *   The user is pointing at a card, button, or chip to tell the agent
 *   "edit this". A normal click handler on the underlying control
 *   (e.g. "open issue", "toggle filter") would fire first and navigate
 *   away or mutate state. Registering on the capture phase + calling
 *   stopImmediatePropagation means the click never reaches the
 *   underlying control.
 *
 * Visual:
 *   - body cursor → crosshair
 *   - `<html data-inspect-mode="active">` so CSS can opt to hide
 *     interactions or paint additional affordances
 *   - hovered element gets a 1px dashed red outline; previous element's
 *     inline outline is restored when the mouse moves on
 *
 * Lifecycle:
 *   - Click → POST → auto-disable
 *   - Esc → auto-disable (no POST)
 *
 * The hook owns its own state; no provider, no global store. The
 * crosshair button is the only consumer, so co-locating the API + state
 * keeps the surface minimal.
 */

import { useCallback, useEffect, useState } from 'react';

export interface InspectModeApi {
  enabled: boolean;
  enable: () => void;
  disable: () => void;
  toggle: () => void;
}

/**
 * Compute a class-based selector for an element. Returns the tag name
 * (lowercased) when the element has no classes — handy for `<body>` /
 * `<html>` / unstyled wrappers that have nothing more identifying.
 */
function computeSelector(el: HTMLElement): string {
  if (el.classList.length === 0) return el.tagName.toLowerCase();
  return '.' + Array.from(el.classList).join('.');
}

export function useInspectMode(): InspectModeApi {
  const [enabled, setEnabled] = useState(false);

  const enable = useCallback(() => setEnabled(true), []);
  const disable = useCallback(() => setEnabled(false), []);
  const toggle = useCallback(() => setEnabled((v) => !v), []);

  useEffect(() => {
    if (!enabled) return;

    // Arm visual state on body / html.
    document.body.style.cursor = 'crosshair';
    document.documentElement.setAttribute('data-inspect-mode', 'active');

    // We MUTATE the hovered element's inline outline to paint the
    // highlight ring, and restore it when the cursor moves on. Tracking
    // the previous element's pre-mutation state per-element prevents a
    // stale outline lingering after Inspect exits.
    let lastHover: HTMLElement | null = null;
    let lastOutline = '';
    let lastOutlineOffset = '';

    const onMove = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target || target === lastHover) return;
      if (lastHover) {
        lastHover.style.outline = lastOutline;
        lastHover.style.outlineOffset = lastOutlineOffset;
      }
      lastHover = target;
      lastOutline = target.style.outline;
      lastOutlineOffset = target.style.outlineOffset;
      // Cyan (not red) so the inspect ring is visually distinct from
      // the theme-highlight section ring (also #E53935, 1px solid
      // !important) when they overlap — a dashed red ring on top of a
      // solid red ring is invisible.
      target.style.outline = '1px dashed #00D7B0';
      target.style.outlineOffset = '-1px';
    };

    const onClick = (e: MouseEvent) => {
      // Capture phase: run BEFORE any underlying handler and swallow the
      // click so the user can point at clickable controls (cards, links,
      // buttons) without triggering their default behaviour.
      const target = e.target as HTMLElement | null;
      if (!target) {
        setEnabled(false);
        return;
      }

      // If the user clicked the Inspect toggle button itself, let React
      // handle it normally (disable inspect mode via the onClick
      // handler). Without this, stopImmediatePropagation swallows the
      // click and the user can only exit via Esc — a footgun for anyone
      // expecting the button to be a toggle.
      //
      // Matched on `data-inspect-toggle`, NOT on the aria-label: the
      // label is user-facing copy that has already moved once (the
      // control went from a standalone header icon to an item inside
      // the header drawer in sk-285.1.18.4) and a mismatch here fails
      // silently — the toggle simply stops toggling. The data attribute
      // exists for no other reason than to be this hook's anchor.
      const inspectButton = target.closest('[data-inspect-toggle]');
      if (inspectButton) {
        // Don't preventDefault / stopPropagation here — let the button's
        // React onClick fire and call inspectMode.toggle().
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const selector = computeSelector(target);
      const parents: string[] = [];
      let p = target.parentElement;
      while (p && parents.length < 5) {
        parents.push(computeSelector(p));
        p = p.parentElement;
      }
      const cs = getComputedStyle(target);
      const computedStyle: Record<string, string> = {
        color: cs.color,
        fontFamily: cs.fontFamily,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        backgroundColor: cs.backgroundColor,
      };

      // Lazy-imports keep useInspectMode free of a hard import edge into
      // themeTokens + api/themes — both modules pull additional
      // dependencies (font presets, fetch wrapper) that we don't need
      // unless the user actually engages Inspect.
      (async () => {
        try {
          const { reverseLookupTokens } = await import('./themeTokens');
          const { postInspectSelection } = await import('../api/themes');
          const tokens = reverseLookupTokens(selector, parents);
          await postInspectSelection({ selector, parents, tokens, computedStyle });
        } catch (err) {
          // Non-fatal. Surface in DEV so a contract regression on the
          // backend shows up in DevTools instead of silently breaking
          // the MCP agent's read path.
          if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.warn('[inspect] failed to POST selection', err);
          }
        }
      })();

      setEnabled(false);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEnabled(false);
    };

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);

    return () => {
      // Restore the last hovered element's outline before tearing down
      // so a "click → disable" or Esc doesn't leave a red ring behind.
      if (lastHover) {
        lastHover.style.outline = lastOutline;
        lastHover.style.outlineOffset = lastOutlineOffset;
      }
      document.body.style.cursor = '';
      document.documentElement.removeAttribute('data-inspect-mode');
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [enabled]);

  return { enabled, enable, disable, toggle };
}
