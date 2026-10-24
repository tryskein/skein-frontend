/**
 * sk-521 — the agent badge on `Avatar` is drawn only for agents.
 *
 * The paint checks this file used to carry (inline colour roles, a source
 * scan for `var(--skein-*)`) were removed by the owner decision on
 * sk-540.11: colour is not checked by tests, and source scans are not
 * introduced by agents. What stays is the behaviour: which avatar kind
 * draws the badge.
 */

import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import { Avatar } from '../components/Avatar';

afterEach(() => cleanup());

function spanTexts(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll('span')].map((s) => (s.textContent ?? '').trim());
}

describe('sk-521 — Avatar draws the agent badge only for agents', () => {
  test('an agent avatar draws the `>` badge', () => {
    const { container } = render(<Avatar username="bot" kind="agent" size="header" />);
    expect(spanTexts(container)).toContain('>');
  });

  test('a regular avatar has no badge — the branch is not drawn for nothing', () => {
    const { container } = render(<Avatar username="admin" size="header" />);
    expect(spanTexts(container)).not.toContain('>');
  });
});
