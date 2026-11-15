/**
 * The commit hash links out only to an absolute `http(s)` address. The
 * commit `url` is written by whoever linked the commit, so any other scheme
 * (`javascript:`, `data:`, a relative path) must not become a link a
 * colleague clicks; the hash is then shown as text.
 */
import { afterEach, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import type { CommitRef } from '../../../../api/issues';
import { CommitsSection } from './CommitsSection';

const HASH = '0123456789abcdef0123456789abcdef01234567';

function commit(url: string | undefined): CommitRef {
  return {
    hash: HASH,
    repoId: 'repo-1',
    url,
    message: 'fix: something',
    linkedAt: '2026-10-01T10:00:00Z',
    linkedByKind: 'agent',
  };
}

function renderCommit(url: string | undefined): void {
  render(
    <MantineProvider>
      <CommitsSection commits={[commit(url)]} />
    </MantineProvider>,
  );
}

afterEach(() => {
  cleanup();
});

test.each([
  'https://git.example.org/repo/commit/0123456',
  'http://git.example.org/repo/commit/0123456',
])('an http(s) url %s links the hash to it', (url) => {
  renderCommit(url);
  expect(screen.getByRole('link', { name: '0123456' }).getAttribute('href')).toBe(url);
});

test.each([
  'javascript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'vbscript:msgbox(1)',
  '//evil.example.org/commit',
  'https://git.example.org/a\nhttps://evil.example.org/b',
  undefined,
])('a url %j leaves the hash as text, with no link', (url) => {
  renderCommit(url);
  expect(screen.queryByRole('link')).toBeNull();
  expect(screen.getByText('0123456')).toBeTruthy();
});
