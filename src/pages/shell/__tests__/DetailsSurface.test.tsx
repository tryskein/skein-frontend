/**
 * sk-285.7 T030 — the DOM half of the description surface.
 *
 * What is actually MOUNTED on the description surface, which a render
 * can see honestly — an affordance that exists but is never placed on
 * the row.
 *
 * ── Negative paths are the point here ───────────────────────────────
 *
 * Every claim below has an "and when there is nothing" twin: a section
 * with no affordance must not carry an empty box on its row, a card with
 * no description must still print the heading that teaches the field
 * exists, and a thread with no comments must still offer the composer.
 * The empty case is where a collapsed row quietly becomes a dead end.
 */

import type { ReactNode } from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Section } from '../details/Section';

function Wrap({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MantineProvider forceColorScheme="dark">
        <MemoryRouter>{children}</MemoryRouter>
      </MantineProvider>
    </QueryClientProvider>
  );
}

afterEach(() => cleanup());

describe('T030 · the collapsed section row', () => {
  test('the affordance is wrapped, so the sheet has something to push right', () => {
    render(
      <Wrap>
        <Section title="Acceptance criteria" empty emptyAction={<button>+ Add</button>}>
          <p>never rendered</p>
        </Section>
      </Wrap>,
    );
    const row = document.querySelector('.detail-section-emptyrow');
    expect(row).not.toBeNull();
    const holder = row!.querySelector('.detail-section-empty-action');
    expect(
      holder,
      'the action is on the row unwrapped — `margin-left: auto` has nothing to land on',
    ).not.toBeNull();
    expect(holder!.querySelector('button')).not.toBeNull();
    // It has to be LAST: `margin-left: auto` pushes the box to the far
    // edge only if nothing follows it.
    expect(row!.lastElementChild).toBe(holder);
  });

  test('a section with no affordance carries no empty box', () => {
    // The negative path. A wrapper rendered unconditionally would put an
    // `auto`-margined empty span at the end of every such row, which
    // silently shoves the `none` label leftwards for no reason.
    render(
      <Wrap>
        <Section title="Notes" empty>
          <p>never rendered</p>
        </Section>
      </Wrap>,
    );
    expect(document.querySelector('.detail-section-empty-action')).toBeNull();
    expect(document.querySelector('.detail-section-emptyrow')).not.toBeNull();
  });

  test('the heading survives collapsing — the field is still taught', () => {
    // sk-285.6.2's rule, restated because T030 rewrote this row: an empty
    // section is FOLDED, never hidden. A reader who never sees the
    // heading never learns the field exists.
    render(
      <Wrap>
        <Section title="Dependencies" empty>
          <p>never rendered</p>
        </Section>
      </Wrap>,
    );
    expect(screen.getByRole('heading', { name: 'Dependencies' })).toBeTruthy();
    // …and the body really is out of the tree, not merely hidden.
    expect(screen.queryByText('never rendered')).toBeNull();
  });

  test('a filled section keeps the plain heading + body shape', () => {
    render(
      <Wrap>
        <Section title="Description" count={2}>
          <p>the body</p>
        </Section>
      </Wrap>,
    );
    expect(document.querySelector('.detail-section-emptyrow')).toBeNull();
    expect(document.querySelector('.detail-section-body')).not.toBeNull();
    expect(screen.getByText('the body')).toBeTruthy();
  });
});
