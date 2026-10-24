/**
 * sk-285.6.2 / sk-285.6.11 — the two rules `Section` enforces.
 *
 * 1. An EMPTY section is one row: the heading, the shared empty word and
 *    the add affordance on a single line, and NO body in the tree. The
 *    distinction between "no body" and "a hidden body" is the whole
 *    point of the fix — a `display:none` body still mounts its queries,
 *    its forms and its dropzone, which is what made a card of six empty
 *    sections cost 1754px against a 732px viewport.
 *
 * 2. The count chip is a LIST signal: rendered iff the count is greater
 *    than zero. The review's complaint was a rule nobody could state —
 *    "Dependencies 0" and "Commits 0" wore a zero while Attachments and
 *    Description wore nothing. The rule now lives in one place and is
 *    asserted here rather than at seven call sites.
 *
 * These are DOM-shape assertions. jsdom runs with `css: false`, so
 * nothing here claims anything about the height the fix actually buys —
 * the ranking of the two headings is a declaration check (see
 * `pages/shell/__tests__/CardEmptyStates.test.ts`) and the pixels stay a
 * browser matter.
 */

import { describe, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { Section } from './Section';

describe('Section — an empty section costs one row', () => {
  test('folds onto the heading row and drops the body from the tree', () => {
    const { container } = render(
      <Section
        title="Acceptance criteria"
        empty
        emptyAction={<button type="button">+ Add acceptance criteria</button>}
      >
        <div data-testid="body-content">expensive body</div>
      </Section>,
    );

    expect(container.querySelector('.detail-section--empty')).not.toBeNull();
    // Not rendered — not hidden.
    expect(screen.queryByTestId('body-content')).toBeNull();
    expect(container.querySelector('.detail-section-body')).toBeNull();

    // The heading survives: a reader has to keep learning the field exists.
    expect(
      screen.getByRole('heading', { name: 'Acceptance criteria' }),
    ).toBeTruthy();
    // …and so does one-click adding — the affordance rides on the row.
    const row = container.querySelector('.detail-section-emptyrow');
    expect(row).not.toBeNull();
    expect(
      row!.contains(
        screen.getByRole('button', { name: '+ Add acceptance criteria' }),
      ),
    ).toBe(true);
  });

  test('a filled section renders its body and no collapsed row', () => {
    const { container } = render(
      <Section title="Commits">
        <div data-testid="body-content">abc1234</div>
      </Section>,
    );

    expect(container.querySelector('.detail-section--empty')).toBeNull();
    expect(container.querySelector('.detail-section-emptyrow')).toBeNull();
    expect(screen.getByTestId('body-content')).toBeTruthy();
  });
});

/**
 * sk-460.6 — a section that prints its heading ITSELF.
 *
 * Checked by RENDERING, not by reading the source, and this is not a whim:
 * `Section.tsx` is in the slice of the mutation run, and Stryker
 * instruments the files of the slice — a guard that matches the text of this file
 * would start matching against `// @ts-nocheck function stryNS_9fa48…` and
 * would crash the dry-run, i.e. make the file unmeasurable (the same lesson
 * as recorded in `DetailsSurface.test.tsx` about the comment composer).
 * Rendering answers the needed question more directly: the heading in the TREE, not in
 * the text of the file.
 */
describe('Section — sk-460.6: the body prints the heading', () => {
  /** A section whose body prints the heading itself — like the epic section. */
  const withOwnTitle = (props: { bodyPrintsTitle?: boolean; count?: number }) =>
    render(
      <Section title="Epic Progress" {...props}>
        <div className="epic-progress">
          <h2 className="detail-section-title">Epic Progress</h2>
        </div>
      </Section>,
    );

  test('with the flag the section has ONE heading — the one the body printed', () => {
    const { container } = withOwnTitle({ bodyPrintsTitle: true });

    // One both in the markup and in the accessibility tree: a hidden `<h2>`
    // would remain a second heading for a screen reader.
    expect(container.querySelectorAll('h2')).toHaveLength(1);
    expect(screen.getAllByRole('heading', { name: 'Epic Progress' })).toHaveLength(1);
    // The heading belongs to the BODY, not to the wrapper: the flag suppresses its own, it does not
    // carry over someone else's.
    expect(container.querySelector('.detail-section-body h2')).not.toBeNull();
  });

  test('NEGATIVE CONTROL: without the flag there are two headings — so the flag really suppresses', () => {
    // Without this half the check above is green even for a `Section` that
    // NEVER printed its own heading: "one heading" would hold
    // by itself. The input is a distinguishing one — the very same children.
    const { container } = withOwnTitle({});
    expect(container.querySelectorAll('h2'), 'the flag suppresses nothing — the control is empty').toHaveLength(
      2,
    );
    expect(screen.getAllByRole('heading', { name: 'Epic Progress' })).toHaveLength(2);
  });

  test('the flag suppresses the counter too: it lives on the same heading row', () => {
    // Otherwise the number would hang without the heading it is
    // attached to.
    const { container } = withOwnTitle({ bodyPrintsTitle: true, count: 10 });
    expect(container.querySelector('.detail-section-count')).toBeNull();
    // …and without the flag the same input prints the counter — the control is not degenerate.
    cleanup();
    const plain = withOwnTitle({ count: 10 });
    expect(plain.container.querySelector('.detail-section-count')?.textContent).toBe('10');
  });

  test('the other card sections are untouched: without the flag Section prints the heading', () => {
    // The ten other sections call `Section` without the new prop. Here it
    // is pinned that NOTHING changed for them.
    const { container } = render(
      <Section title="Commits" count={2}>
        <div data-testid="body-content">abc1234</div>
      </Section>,
    );
    expect(screen.getByRole('heading', { name: /Commits/ })).toBeTruthy();
    expect(container.querySelector('.detail-section-count')?.textContent).toBe('2');
    expect(screen.getByTestId('body-content')).toBeTruthy();
  });

  test('the flag does NOT combine with a folded section, and `empty` wins', () => {
    // A folded section has no body at all (`children` are not rendered),
    // so there would be nobody to print the heading — the section would stay WITHOUT a
    // heading. It is decided deterministically, not left to luck.
    render(
      <Section title="Commits" empty bodyPrintsTitle>
        <div data-testid="body-content">abc1234</div>
      </Section>,
    );
    expect(screen.getByRole('heading', { name: 'Commits' })).toBeTruthy();
    expect(screen.queryByTestId('body-content')).toBeNull();
  });
});

describe('Section — the count chip is a list signal', () => {
  test('a zero count paints no chip', () => {
    const { container } = render(
      <Section title="Comments" count={0}>
        <div>composer</div>
      </Section>,
    );
    expect(container.querySelector('.detail-section-count')).toBeNull();
  });

  test('a non-zero count paints the chip with the number', () => {
    const { container } = render(
      <Section title="Comments" count={4}>
        <div>thread</div>
      </Section>,
    );
    const chip = container.querySelector('.detail-section-count');
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toBe('4');
  });

  test('an absent count paints no chip — prose sections never carry one', () => {
    const { container } = render(
      <Section title="Description">
        <div>prose</div>
      </Section>,
    );
    expect(container.querySelector('.detail-section-count')).toBeNull();
  });
});
