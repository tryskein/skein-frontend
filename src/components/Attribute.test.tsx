/**
 * sk-285.1.5 — the attribute chip is ONE component, in TWO sizes.
 *
 * These tests pin what each kind of chip SAYS: its text, the clamp of an
 * out-of-range priority, the gate of a dependency type, the accessible
 * names. Tone, form, plate and size are not checked here (sk-540.11,
 * owner decision): what a person sees is not asserted from markup.
 */

import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Attribute } from './Attribute';

afterEach(() => {
  cleanup();
});

describe('Attribute — one chip per attribute kind', () => {
  test('type renders a lowercase pill, no brackets', () => {
    render(<Attribute kind="type" value="bug" />);
    expect(screen.getByText(/bug/).textContent?.trim()).toBe('bug');
  });

  test('priority renders Pn and clamps out-of-range values', () => {
    render(<Attribute kind="priority" value={9} />);
    expect(screen.getByText(/P4/).textContent?.trim()).toBe('P4');
  });

  test('dep-type renders the gate inline for waits-for', () => {
    render(<Attribute kind="dep-type" value="waits-for" gate="all-children" />);
    const chip = screen.getByText(/waits-for/);
    // sk-367 gave every edge type its glyph (form, not hue — see the
    // component docblock); the gate still rides in the text.
    expect(chip.textContent?.trim()).toBe('⧖ waits-for: all-children');
    expect(chip.getAttribute('aria-label')).toBe(
      'dependency type waits-for, gate all-children',
    );
  });

  test('search-kind exposes the human label and hides the letter from AT', () => {
    render(<Attribute kind="search-kind" value="component" />);
    const chip = screen.getByRole('img', { name: 'component' });
    expect(chip.textContent?.trim()).toBe('c');
    expect(chip.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  test('pinned status keeps the ★ marker', () => {
    render(<Attribute kind="status" value="open" />);
    expect(screen.getByText(/open/).textContent?.trim()).toBe('open');
    cleanup();
    render(<Attribute kind="status" value="open" pinned />);
    expect(screen.getByText(/open/).textContent?.trim()).toBe('★ open');
  });
});

describe('Attribute — the status dot', () => {
  test('the dot repeats the pill and is hidden from assistive tech', () => {
    const { container } = render(<Attribute kind="status" value="open" />);
    const chip = container.firstElementChild as HTMLElement;
    const hidden = chip.querySelectorAll('[aria-hidden="true"]');
    expect(hidden.length).toBeGreaterThan(0);
    // The dot carries no text, so the pill still reads as its status.
    expect(chip.textContent?.trim()).toBe('open');
  });
});
