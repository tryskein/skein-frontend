/**
 * sk-118 — the "Permanent" (standing) status pill. The status
 * <Attribute> must render a distinct standing chip (∞ glyph + the standing label) and
 * expose it to assistive tech via role=status + a Russian aria-label.
 */

import { afterEach, describe, expect, test } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Attribute } from './Attribute';

afterEach(() => {
  cleanup();
});

describe('Attribute kind="status" — sk-118 standing pill', () => {
  test('renders the standing chip as a status pill with the ∞ marker', () => {
    render(<Attribute kind="status" value="standing" />);
    const node = screen.getByText(/standing/i);
    expect(node.textContent?.trim()).toBe('∞ standing');
    // sk-285.1.9 — a pill, not brackets.
    expect(node.textContent).not.toMatch(/[[\]]/);
  });

  test('exposes the «Standing» status to assistive tech', () => {
    render(<Attribute kind="status" value="standing" />);
    const chip = screen.getByRole('status');
    expect(chip.getAttribute('aria-label')).toMatch(/Standing/);
  });

  test('standing is never overridden by a (stray) isBlocked flag', () => {
    // §11.2 — nothing can target a standing task with blocks/waits-for, so
    // a standing badge must keep its ∞ standing marker even if isBlocked
    // arrives true (it shouldn't, but the badge must not silently flip to
    // `blocked`).
    render(<Attribute kind="status" value="standing" isBlocked />);
    const node = screen.getByText(/standing/i);
    expect(node.textContent).toContain('∞');
    expect(screen.queryByText(/^\s*blocked\s*$/)).toBeNull();
  });

  test('non-standing statuses do NOT get the ∞ marker', () => {
    render(<Attribute kind="status" value="open" />);
    const node = screen.getByText(/open/i);
    expect(node.textContent).not.toContain('∞');
  });
});
