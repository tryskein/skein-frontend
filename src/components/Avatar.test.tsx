/**
 * sk-1048.23 — what the Avatar shows and what its hover tooltip says.
 *
 * Contract (`Avatar.tsx`): the face is one or two alphanumeric characters of
 * the username, uppercased, after a leading `@` is stripped, and `?` when no
 * such character exists. The tooltip (`title`) defaults to `@username`, takes
 * an override, and is absent altogether when `title` is `null`.
 */

import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import { Avatar } from './Avatar';

afterEach(() => cleanup());

function face(username: string, title?: string | null): HTMLElement {
  const { container } = render(<Avatar username={username} title={title} />);
  return container.firstElementChild as HTMLElement;
}

describe('Avatar initials', () => {
  test.each([
    { username: 'alice', shown: 'AL' },
    { username: '@bob', shown: 'BO' },
    { username: 'x', shown: 'X' },
    { username: 'j.doe-42', shown: 'JD' },
    { username: '_9lives', shown: '9L' },
    { username: '@.-_', shown: '?' },
    { username: '', shown: '?' },
  ])('$username → $shown', ({ username, shown }) => {
    expect(face(username).textContent).toBe(shown);
  });
});

describe('Avatar tooltip', () => {
  test('defaults to the @-handle, without doubling a leading @', () => {
    expect(face('alice').getAttribute('title')).toBe('@alice');
    expect(face('@bob').getAttribute('title')).toBe('@bob');
  });

  test('shows the tooltip it is given', () => {
    expect(face('alice', 'Alice Smith').getAttribute('title')).toBe('Alice Smith');
  });

  test('null leaves no tooltip at all', () => {
    expect(face('alice', null).hasAttribute('title')).toBe(false);
  });
});
