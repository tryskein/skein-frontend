/**
 * sk-285.6.10 — the people row said `reviewer → admin` and nothing else.
 *
 * Two names, an arrow between them, and the ONLY thing distinguishing
 * the author from the assignee was the magenta fill on the second chip.
 * That is a convention, and a convention has to be taught: the arrow
 * reads equally well as "handed to" and as "waiting on", and the fill
 * says nothing at all to a screen reader, to a greyscale screen, or to
 * a reader who cannot separate those two hues.
 *
 * So the tests below never ask "is the current assignee styled". They
 * ask what a reader with NO colour and NO prior knowledge can recover
 * from the row — which is exactly the acceptance criterion — and they
 * ask it in both locales, because a role caption that exists only in
 * English is a row that goes back to being a puzzle for half the users.
 */

import { afterEach, beforeAll, describe, expect, test } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import i18n, { DEFAULT_LANGUAGE } from '../../../i18n/config';
import type { IssueDetail } from '../../../api/issues';
import { PeopleChain } from './PeopleChain';

function issue(overrides: Partial<IssueDetail> = {}): IssueDetail {
  return {
    id: 'shop-9',
    projectId: 'p1',
    version: 1,
    title: 't',
    description: '',
    type: 'task',
    priority: 2,
    status: 'open',
    pinned: false,
    source: 'human',
    design: '',
    acceptanceCriteria: '',
    notes: '',
    createdBy: 'u-reviewer',
    createdByUsername: 'reviewer',
    createdAt: '2026-08-31T10:00:00Z',
    updatedAt: '2026-08-31T10:00:00Z',
    metadata: {},
    componentIds: [],
    labels: [],
    commentsCount: 0,
    commitRefs: [],
    mentions: [],
    isBlocked: false,
    blockers: [],
    assignee: 'admin',
    previousAssignees: [],
    dismissedBy: [],
    ...overrides,
  } as IssueDetail;
}

beforeAll(() => {
  // The suite pins `en`; each locale test restores it so no ordering
  // dependency leaks into the next file.
  void i18n.changeLanguage(DEFAULT_LANGUAGE);
});

afterEach(() => {
  cleanup();
  void i18n.changeLanguage(DEFAULT_LANGUAGE);
});

/**
 * The row as a reader without colour actually receives it: every run of
 * visible text in document order, joined by the boundary the layout
 * draws between them (the flex `gap`, which a screen reader renders as a
 * word boundary too).
 *
 * Reconstructed rather than taken from `textContent`, because the
 * markup carries no literal whitespace between the spans — reading
 * `textContent` raw would produce `авторreviewer` and say more about
 * JSX formatting than about what anyone perceives.
 *
 * ⚠ This walks TEXT NODES, not "leaf spans". It used to do the latter,
 * and sk-285.7 fidelity D5 showed what that costs: the collapsed chip
 * gained a child (an <Avatar> disc), which made the chip itself a
 * non-leaf — so the helper silently dropped the chip's own text, i.e.
 * THE NAME, and the row it reported was `author & assignee RE`. A
 * heuristic about element shape cannot survive an element gaining a
 * child; a walk over text says what is actually written.
 */
function plainText(container: HTMLElement): string {
  const row = container.querySelector('.people-chain');
  if (row === null) return '';
  const parts: string[] = [];
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    const s = (n.textContent ?? '').trim();
    if (s.length > 0) parts.push(s);
  }
  return parts.join(' ');
}

describe('sk-285.6.10 — the row names its roles in words', () => {
  test('author and assignee are readable with no colour at all', () => {
    const { container } = render(<PeopleChain issue={issue()} />);
    // The exact reading the ticket asked for: the caption sits with the
    // name it labels, so "who wrote this" and "who owes this" are both
    // answered by the text alone.
    expect(plainText(container)).toBe('author reviewer → assignee admin');
  });

  test('a name and its caption are the same step, not two loose spans', () => {
    // Order-of-text alone would be fragile: a flex reflow that moved a
    // caption next to the wrong name would still produce the right
    // concatenation. Assert the containment instead.
    const { container } = render(<PeopleChain issue={issue()} />);
    const steps = [...container.querySelectorAll('.people-chain-step')];
    expect(steps.length).toBe(2);
    expect(within(steps[0] as HTMLElement).getByText('author')).toBeTruthy();
    expect(within(steps[0] as HTMLElement).getByText('reviewer')).toBeTruthy();
    expect(within(steps[1] as HTMLElement).getByText('assignee')).toBeTruthy();
    expect(within(steps[1] as HTMLElement).getByText('admin')).toBeTruthy();
  });

  test('the arrow stays out of the announced row', () => {
    // The arrow is the ambiguous glyph the ticket is about. It carries
    // no meaning a screen reader can use, and read aloud it makes the
    // row worse, so it is decoration and marked as such.
    const { container } = render(<PeopleChain issue={issue()} />);
    const arrow = container.querySelector('.people-chain-arrow');
    expect(arrow?.getAttribute('aria-hidden')).toBe('true');
  });

  test('the row is a named group, so its label is honoured', () => {
    // An aria-label on a bare <div> with no role is dropped by most
    // screen readers — the label was there before this change and did
    // nothing.
    const { container } = render(<PeopleChain issue={issue()} />);
    const row = container.querySelector('.people-chain');
    expect(row?.getAttribute('role')).toBe('group');
    expect(row?.getAttribute('aria-label')).toBe('People involved');
  });

  test('a past assignee is captioned too, so the middle is not a mystery', () => {
    const { container } = render(
      <PeopleChain
        issue={issue({
          previousAssigneeUsernames: ['bob'],
        } as Partial<IssueDetail>)}
      />,
    );
    expect(plainText(container)).toBe(
      'author reviewer → previously bob → assignee admin',
    );
  });

  test('an unassigned task still says which slot is empty', () => {
    const { container } = render(<PeopleChain issue={issue({ assignee: null })} />);
    expect(plainText(container)).toBe('author reviewer → assignee unassigned');
  });

  test('the self-assigned collapse says BOTH roles rather than nothing', () => {
    // This branch used to render a bare chip plus a hard-coded English
    // "(creator & assignee)" that no dictionary owned.
    //
    // sk-285.7 fidelity D5 — `RE` is the <Avatar> disc the artboard puts
    // in front of the name (`Sk Details.dc.html`: an 18px circle of mono
    // initials, then the username). It is `aria-hidden`, so a screen
    // reader hears the name once; it is on screen, so a helper that
    // reports what is written reports it. The claim this test makes is
    // unchanged — both roles are named in words, and the name follows.
    const { container } = render(
      <PeopleChain issue={issue({ assignee: 'reviewer' })} />,
    );
    expect(plainText(container)).toBe('author & assignee RE reviewer');
  });
});

describe('sk-285.6.10 — and it names them in the reader’s language', () => {
  test('Russian gets the captions, not a half-translated row', async () => {
    await i18n.changeLanguage('ru');
    const { container } = render(<PeopleChain issue={issue()} />);
    expect(plainText(container)).toBe('автор reviewer → исполнитель admin');
  });

  test('the collapsed branch is translated too', async () => {
    await i18n.changeLanguage('ru');
    const { container } = render(
      <PeopleChain issue={issue({ assignee: 'reviewer' })} />,
    );
    // `RE` — the avatar disc, see the English twin of this test.
    expect(plainText(container)).toBe('автор и исполнитель RE reviewer');
  });

  test('the group label is translated', async () => {
    await i18n.changeLanguage('ru');
    render(<PeopleChain issue={issue()} />);
    expect(screen.getByRole('group', { name: 'Участники' })).toBeTruthy();
  });
});
