/**
 * sk-551.36 — `<html data-motion-idle>`: the page is not being looked at.
 *
 * Set while the document is hidden OR the window has no focus, removed
 * as soon as it is visible and focused again. `index.css` keys
 * `animation-play-state: paused` off it for the ringing-alarm
 * animations (`.lens-toggle.budilnik.ringing`, the shaking icon, the
 * badge, the card flags), so a window left on screen behind another one
 * stops asking the browser for frames.
 *
 * Why focus and not only visibility: Safari already suspends the
 * animations of a hidden tab, but a VISIBLE window without focus — the
 * case of Skein on a second screen — keeps animating at full frame
 * rate. `document.hidden` alone would miss exactly that case.
 *
 * Installed once, at module scope in `main.tsx`, before the first
 * render; returns the uninstaller (tests use it, the app never calls it).
 */
export const MOTION_IDLE_ATTR = 'data-motion-idle';

export function installMotionIdle(
  doc: Document = document,
  win: Window = window,
): () => void {
  const sync = () => {
    const idle = doc.hidden || !doc.hasFocus();
    doc.documentElement.toggleAttribute(MOTION_IDLE_ATTR, idle);
  };
  // `blur` itself means the window lost focus — it is not re-read from
  // `hasFocus()`: in WebKit (bug 219472) `document.hasFocus()` stays
  // `true` after a click into Safari's address bar, so re-reading it here
  // would keep the ring animating in exactly such a browser.
  const onBlur = () => doc.documentElement.setAttribute(MOTION_IDLE_ATTR, '');
  doc.addEventListener('visibilitychange', sync);
  win.addEventListener('focus', sync);
  win.addEventListener('blur', onBlur);
  sync();
  return () => {
    doc.removeEventListener('visibilitychange', sync);
    win.removeEventListener('focus', sync);
    win.removeEventListener('blur', onBlur);
    doc.documentElement.removeAttribute(MOTION_IDLE_ATTR);
  };
}
