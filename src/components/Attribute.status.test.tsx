import { describe, expect, test, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Attribute } from './Attribute';

afterEach(() => {
  cleanup();
});

describe('Attribute kind="status" (sk-31 derived blocked-ness)', () => {
  test('renders the status when isBlocked is false', () => {
    render(<Attribute kind="status" value="in_progress" isBlocked={false} />);
    // sk-285.7 fidelity T3 — the BADGE spells the value as prose, so the
    // underscore of the wire enum is a space here. Both artboards write
    // it that way («in progress»), while the same design keeps
    // `in_progress` monospaced in the activity feed; the assertion is on
    // the badge, so it pins the prose spelling.
    expect(screen.getByText(/in progress/i)).toBeTruthy();
    expect(screen.queryByText(/in_progress/)).toBeNull();
    const chip = screen.getByText(/in progress/i);
    expect(chip.textContent?.trim()).toBe('in progress');
  });

  test('renders blocked when isBlocked=true and status != closed', () => {
    render(<Attribute kind="status" value="in_progress" isBlocked />);
    // The badge should override the underlying status with "blocked".
    expect(screen.getByText(/blocked/i)).toBeTruthy();
    expect(screen.queryByText(/in.progress/i)).toBeNull();
  });

  test('renders blocked for an open issue when isBlocked=true', () => {
    render(<Attribute kind="status" value="open" isBlocked />);
    expect(screen.getByText(/blocked/i)).toBeTruthy();
    expect(screen.queryByText(/^\s*open\s*$/)).toBeNull();
  });

  test('closed status wins over isBlocked (terminal state)', () => {
    // A closed issue keeps its `closed` marker even when isBlocked is
    // (stale) true — the terminal state is the dominant signal.
    render(<Attribute kind="status" value="closed" isBlocked />);
    expect(screen.getByText(/closed/i)).toBeTruthy();
    expect(screen.queryByText(/^\s*blocked\s*$/)).toBeNull();
  });

  test('renders blocked without the underlying status when isBlocked', () => {
    render(<Attribute kind="status" value="open" isBlocked />);
    // Only the `blocked` marker is present; no `open` text.
    const node = screen.getByText(/blocked/i);
    expect(node.textContent?.trim()).toBe('blocked');
  });
});
