/**
 * sk-551.5 (review C2) — the issue window's focus trap.
 *
 * The reference is the maintainers' decision (sk-551.5): "focus: a trap in the window, the name
 * of the dialog is the issue title"; review C2: the initial focus is on the dialog itself,
 * Shift+Tab from it stays in the dialog. A Tab stop is what the browser would
 * stop on: not disabled, not `tabindex=-1`, not a hidden input, not inside
 * `inert` / `hidden` / `aria-hidden`.
 *
 * jsdom does not move focus on Tab by itself, so what is checked is the
 * trap's own move at the edges and whether it claimed the key
 * (`defaultPrevented`); between the edges the browser's default is left
 * alone.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, type ReactNode } from 'react';
import { useDialogFocusTrap } from './useDialogFocusTrap';

function Dialog({ active, children }: { active: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocusTrap(ref, active);
  return (
    <div ref={ref} role="dialog" aria-label="Issue" tabIndex={-1}>
      {children}
    </div>
  );
}

const STOPS = (
  <>
    <button type="button" disabled>
      disabled
    </button>
    <button type="button">first</button>
    <a href="#x">middle</a>
    {/* A text field, so «an input is a stop unless it is hidden» is tested too. */}
    <input type="text" aria-label="last" />
    <span tabIndex={-1}>not a stop</span>
    {/* React 18's DOM types do not list `inert`; the attribute is real. */}
    <div {...({ inert: '' } as Record<string, string>)}>
      <button type="button">inert</button>
    </div>
    <div hidden>
      <button type="button">hidden</button>
    </div>
    <div aria-hidden="true">
      <button type="button">aria-hidden</button>
    </div>
    <input type="hidden" name="h" />
  </>
);

/** Fires Tab / Shift+Tab on the focused element; true if the trap took it. */
function tab(shift = false): boolean {
  const target = (document.activeElement as HTMLElement | null) ?? document.body;
  return !fireEvent.keyDown(target, { key: 'Tab', shiftKey: shift });
}

const dialog = () => screen.getByRole('dialog', { name: 'Issue' });
const button = (name: string) => screen.getByRole('button', { name });
const lastStop = () => screen.getByRole('textbox', { name: 'last' });

afterEach(cleanup);

describe('useDialogFocusTrap', () => {
  test('on activation the dialog itself takes focus', () => {
    render(<Dialog active>{STOPS}</Dialog>);
    expect(document.activeElement).toBe(dialog());
  });

  test('Shift+Tab from the dialog goes to the LAST real stop', () => {
    render(<Dialog active>{STOPS}</Dialog>);
    expect(tab(true)).toBe(true);
    expect(document.activeElement).toBe(lastStop());
  });

  test('Tab on the last stop wraps to the FIRST real stop, Shift+Tab on the first wraps back', () => {
    render(<Dialog active>{STOPS}</Dialog>);
    lastStop().focus();
    expect(tab()).toBe(true);
    expect(document.activeElement).toBe(button('first'));

    expect(tab(true)).toBe(true);
    expect(document.activeElement).toBe(lastStop());
  });

  test('between the edges the browser keeps the key', () => {
    render(<Dialog active>{STOPS}</Dialog>);
    button('first').focus();
    expect(tab()).toBe(false);
    expect(document.activeElement).toBe(button('first'));
    lastStop().focus();
    expect(tab(true)).toBe(false);
  });

  test('other keys are not touched', () => {
    render(<Dialog active>{STOPS}</Dialog>);
    lastStop().focus();
    expect(!fireEvent.keyDown(lastStop(), { key: 'Enter' })).toBe(false);
    expect(document.activeElement).toBe(lastStop());
  });

  test('a dialog with no stops keeps Tab on itself', () => {
    render(<Dialog active>{<p>text only</p>}</Dialog>);
    expect(tab()).toBe(true);
    expect(document.activeElement).toBe(dialog());
  });

  test('focus outside the dialog is left alone', () => {
    render(
      <>
        <button type="button">outside</button>
        <Dialog active>{STOPS}</Dialog>
      </>,
    );
    button('outside').focus();
    expect(tab(true)).toBe(false);
    expect(document.activeElement).toBe(button('outside'));
  });

  test('focus outside a dialog with no stops is not pulled in', () => {
    render(
      <>
        <button type="button">outside</button>
        <Dialog active>{<p>text only</p>}</Dialog>
      </>,
    );
    button('outside').focus();
    expect(tab()).toBe(false);
    expect(document.activeElement).toBe(button('outside'));
  });

  test('inactive: no focus move and no trap; activating later focuses the dialog', () => {
    const { rerender } = render(<Dialog active={false}>{STOPS}</Dialog>);
    expect(document.activeElement).toBe(document.body);
    lastStop().focus();
    expect(tab()).toBe(false);

    rerender(<Dialog active>{STOPS}</Dialog>);
    expect(document.activeElement).toBe(dialog());
  });

  test('deactivated: the trap lets go', () => {
    const { rerender } = render(<Dialog active>{STOPS}</Dialog>);
    rerender(<Dialog active={false}>{STOPS}</Dialog>);
    lastStop().focus();
    expect(tab()).toBe(false);
    expect(document.activeElement).toBe(lastStop());
  });
});
