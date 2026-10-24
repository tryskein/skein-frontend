/**
 * sk-551.36 — `<html data-motion-idle>` follows "is anybody looking":
 * present while the tab is hidden OR the window has no focus, absent when
 * it is visible and focused. `index.css` pauses the ringing animations
 * off it; this pins the JS half — the attribute flips on the three
 * events the task names (`visibilitychange`, `focus`, `blur`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installMotionIdle, MOTION_IDLE_ATTR } from '../motionIdle';

let hidden = false;
let focused = true;
let uninstall: (() => void) | null = null;

beforeEach(() => {
  hidden = false;
  focused = true;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
});

afterEach(() => {
  uninstall?.();
  uninstall = null;
  vi.restoreAllMocks();
});

const idle = () => document.documentElement.hasAttribute(MOTION_IDLE_ATTR);

describe('installMotionIdle', () => {
  it('reflects the state at install time', () => {
    focused = false;
    uninstall = installMotionIdle();
    expect(idle()).toBe(true);
  });

  it('goes idle on blur and back on focus', () => {
    uninstall = installMotionIdle();
    expect(idle()).toBe(false);

    focused = false;
    window.dispatchEvent(new Event('blur'));
    expect(idle()).toBe(true);

    focused = true;
    window.dispatchEvent(new Event('focus'));
    expect(idle()).toBe(false);
  });

  it('goes idle on blur even when hasFocus() still reports true (WebKit 219472)', () => {
    uninstall = installMotionIdle();
    expect(idle()).toBe(false);

    // Safari after a click into the address bar: blur fires, hasFocus() stays true.
    window.dispatchEvent(new Event('blur'));
    expect(idle()).toBe(true);
  });

  it('goes idle when the tab is hidden, even with focus reported', () => {
    uninstall = installMotionIdle();

    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(idle()).toBe(true);

    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(idle()).toBe(false);
  });

  it('stops listening and clears the attribute when uninstalled', () => {
    focused = false;
    const off = installMotionIdle();
    off();
    expect(idle()).toBe(false);

    window.dispatchEvent(new Event('blur'));
    expect(idle()).toBe(false);
  });
});
