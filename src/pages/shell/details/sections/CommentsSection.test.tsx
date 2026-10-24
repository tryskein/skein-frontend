/**
 * sk-285.7.2.56 — the Comments section's copy (audit D2B-8, D2B-9).
 *
 * ─── D2B-8: «> no comments yet.» ─────────────────────────────────────
 *
 * §6 and reference `1b` head an empty thread «Comments · none yet» — the
 * emptiness is stated ON the heading line. The product stated it as a
 * sentence UNDER the heading, opening with `> `: a command prompt, the
 * same terminal dialect the redesign removed from `[ post ]`. The first
 * audit run found that one occurrence; this is the second.
 *
 * Two claims, and they have to be made together, because moving a
 * message is not the same as deleting one: the heading must GAIN it and
 * the body must LOSE it. Either half alone passes on a defect — a fix
 * that only added the heading aside would say it twice.
 *
 * ─── D2B-9: the composer stopped mentioning @mention ─────────────────
 *
 * `Sk Details.dc.html` and frame 2 of `1g` both write the placeholder
 * `add comment… @mention to notify`. The product wrote `add comment...`.
 * That second half is the ONLY place the interface says that typing
 * `@name` notifies that person, so dropping it made the feature
 * discoverable by accident only.
 *
 * ─── sk-414.5: the filter chips moved onto this heading ──────────────
 *
 * Artboard 4d draws the Humans / Agents toggles right-aligned on the
 * section's heading row, beside the count — `Section`'s `headerAction`
 * slot. They used to sit at the top of `CommentsThread`, which is why
 * the interaction tests for the lens live in this file now: the chips
 * and the list they filter are only in one tree together HERE, and a
 * chip whose click does not reach the rows is the whole risk of the
 * move.
 */

import { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../../api/issues', async (importActual) => {
  const actual = await importActual<typeof import('../../../../api/issues')>();
  return { ...actual, listComments: vi.fn(), addComment: vi.fn() };
});

import { listComments, type CommentDTO } from '../../../../api/issues';
import { CommentsSection } from './CommentsSection';
import { en } from '../../../../i18n/locales/en';

const mockedList = vi.mocked(listComments);

function Wrap({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
}

function renderSection(count: number) {
  return render(
    <Wrap>
      <CommentsSection projectHandle="pj-1" issueId="sk-1" count={count} />
    </Wrap>,
  );
}

const comment = (overrides: Partial<CommentDTO> = {}): CommentDTO =>
  ({
    id: 'c-1',
    issueId: 'sk-1',
    body: 'hello',
    author: 'tester',
    authorUserId: 'u-1',
    authorType: 'human',
    authorKind: 'human',
    version: 1,
    editedAt: null,
    deletedAt: null,
    mentions: [],
    createdAt: '2026-05-22T18:48:00Z',
    updatedAt: '2026-05-22T18:48:00Z',
    ...overrides,
  }) as CommentDTO;

/** A human, an agent answering an instruction, and an agent's own note. */
const mixed = (): CommentDTO[] => [
  comment({ id: 'c-human', body: 'human note', author: 'alice' }),
  comment({
    id: 'c-directed',
    body: 'directed agent note',
    author: 'agent-alice',
    authorType: 'agent',
    authorKind: 'agent_directed',
  }),
  comment({
    id: 'c-autonomous',
    body: 'autonomous agent note',
    author: 'agent-bob',
    authorType: 'agent',
    authorKind: 'agent_autonomous',
  }),
];

beforeEach(() => {
  mockedList.mockReset();
});
afterEach(() => cleanup());

describe('D2B-8 — an empty thread says so on the HEADING, once', () => {
  test('the heading carries the aside', async () => {
    mockedList.mockResolvedValue([]);
    const { container } = renderSection(0);
    await waitFor(() => {
      expect(container.querySelector('.detail-section-title')).not.toBeNull();
    });
    const heading = container.querySelector('.detail-section-title')!;
    expect(heading.textContent).toContain('Comments');
    expect(heading.textContent).toContain('none yet');
    // The aside is the muted grade, not a second title.
    const aside = [...heading.querySelectorAll('.detail-section-count')].find((el) =>
      (el.textContent ?? '').includes('none yet'),
    );
    expect(aside, 'the aside is not on the heading').toBeTruthy();
  });

  test('…and the body no longer repeats it', async () => {
    mockedList.mockResolvedValue([]);
    const { container } = renderSection(0);
    // Wait for the QUERY to settle, not merely for the heading: the
    // heading is there on the first paint, and while the thread is
    // still loading the body renders the waiting plaque instead of its
    // empty state — so an assertion made too early passes on a body
    // that WOULD have repeated the message. Verified by mutation: with
    // the sentence put back, this test only went red once the wait
    // moved here. (sk-414.5 swapped the Mantine loader for the card's
    // shared `.detail-status-plaque`; the wait follows it.)
    await waitFor(() => expect(mockedList).toHaveBeenCalled());
    await waitFor(() =>
      expect(container.querySelector('.detail-status-plaque')).toBeNull(),
    );
    const body = container.querySelector('.detail-section-body')!;
    expect(body.textContent ?? '').not.toContain('none yet');
    // …and the terminal prompt is gone from the surface entirely.
    expect(container.textContent ?? '').not.toContain('> no comments');
  });

  test('a thread with comments gets no aside at all', async () => {
    // The other direction: an aside that appeared unconditionally would
    // pass the first test and be wrong on every filled thread.
    mockedList.mockResolvedValue([comment()]);
    const { container } = renderSection(1);
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy());
    const heading = container.querySelector('.detail-section-title')!;
    expect(heading.textContent ?? '').not.toContain('none yet');
  });
});

describe('D2B-9 — the composer says what @mention does', () => {
  test('the placeholder carries both halves', async () => {
    mockedList.mockResolvedValue([]);
    renderSection(0);
    const box = await screen.findByLabelText('Add comment');
    expect(box.getAttribute('placeholder')).toBe('add comment… @mention to notify');
  });
});

describe('sk-414.5 — the filter chips ride the heading', () => {
  test('they are in the heading row, not in the body', async () => {
    // The move itself. `Section` puts `headerAction` inside
    // `.detail-section-head`, which is the heading row; anything the
    // thread renders lands in `.detail-section-body`. Asserting the
    // container is what tells the two apart — both would satisfy a
    // plain `getByRole('button')`.
    mockedList.mockResolvedValue(mixed());
    const { container } = renderSection(3);
    await waitFor(() => screen.getByText('human note'));

    const head = container.querySelector('.detail-section-head');
    expect(head).not.toBeNull();
    expect(head!.querySelectorAll('.filter-chip').length).toBe(2);
    expect(
      container.querySelector('.detail-section-body .filter-chip'),
      'a chip is still being rendered inside the thread',
    ).toBeNull();
  });

  test('each chip states its own count and whether it is on', async () => {
    mockedList.mockResolvedValue(mixed());
    renderSection(3);
    await waitFor(() => screen.getByText('human note'));

    const humans = screen.getByRole('button', { name: /^Humans/ });
    const agents = screen.getByRole('button', { name: /^Agents/ });
    // human + agent_directed = 2, agent_autonomous = 1. The split is
    // the wire's, not the transport's — an agent writing on someone's
    // instruction counts as that person speaking.
    expect(humans.textContent).toContain('2');
    expect(agents.textContent).toContain('1');
    // `aria-pressed` is the state a screen reader hears AND the hook the
    // stylesheet paints the checked chip from — one attribute, so the
    // two cannot drift.
    expect(humans.getAttribute('aria-pressed')).toBe('true');
    expect(agents.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(agents);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /^Agents/ }).getAttribute('aria-pressed'),
      ).toBe('false'),
    );
  });

  test('no comments, no chips — a filter over nothing can only disappoint', async () => {
    mockedList.mockResolvedValue([]);
    const { container } = renderSection(0);
    await waitFor(() => expect(mockedList).toHaveBeenCalled());
    await waitFor(() =>
      expect(container.querySelector('.detail-status-plaque')).toBeNull(),
    );
    expect(container.querySelector('.filter-chip')).toBeNull();
  });
});

/**
 * sk-414.8 — the chip's WORDS, because the chip is words.
 *
 * The mutation run over this file came back 48.94, and every unkilled
 * mutant sat in the same place: the four i18n keys the two chips
 * resolve, the group's `aria-label`, and the ternary that appends
 * ` (N)` to the accessible name. Blanking any of them left the suite
 * green — which is what a survivor means: rendered by a covered line,
 * asserted by nobody.
 *
 * They are not decoration. A filter chip has no icon and no shape of
 * its own — «Humans» IS the control; the count in its accessible name
 * is how a screen-reader user learns how much the lens is holding
 * back; and `title` is the sentence explaining that an agent writing
 * on a human's instruction counts as that human speaking. The tests
 * below query the chips by `name: /^Humans/` — a PREFIX, deliberately,
 * because they are about the lens BEHAVIOUR and not about its copy —
 * so the suffix rule fell between two files. It lands here.
 */
describe('sk-414.8 — what the filter chips actually say', () => {
  test('each chip is labelled, and its accessible name carries its count', async () => {
    // `mixed()` is 2 humans (human + agent-directed) and 1 autonomous
    // agent. The name is asserted WHOLE — an exact string, not a
    // prefix — because the count inside it is the assertion.
    mockedList.mockResolvedValue(mixed());
    renderSection(3);
    await waitFor(() => screen.getByText('human note'));

    // Built from the dictionary rather than retyped: the claim is that
    // the chip composes `humansAria` with the count in the `{{suffix}}`
    // slot, and retyping the sentence here would let the two drift while
    // this test kept passing on its own copy of it.
    const humans = screen.getByRole('button', {
      name: en.comments.humansAria.replace('{{suffix}}', ' (2)'),
    });
    const agents = screen.getByRole('button', {
      name: en.comments.agentsAria.replace('{{suffix}}', ' (1)'),
    });
    // The VISIBLE label is the bare word: the count rides beside it in
    // its own mono span, and the parenthesised form exists only in the
    // accessible name.
    expect(humans.textContent).toBe('Humans2');
    expect(agents.textContent).toBe('Agents1');
  });

  test('a chip holding nothing says so without a count — on EITHER side', async () => {
    // The ternary's other branch, and the reason it has one: «Agents
    // (0)» reads as a quantity when the honest statement is that this
    // side of the lens is simply empty.
    //
    // Both sides, and that is not symmetry for its own sake: the two
    // chips compute their suffix from two separate expressions, so a
    // test that only ever empties one of them leaves the other's
    // `> 0` free to become `>= 0` unnoticed. Verified by hand — with
    // the agents-only half missing, that exact edit stayed green.
    mockedList.mockResolvedValue([comment({ id: 'c-only', body: 'human note' })]);
    const first = renderSection(1);
    await waitFor(() => screen.getByText('human note'));

    expect(
      screen.getByRole('button', {
        name: en.comments.humansAria.replace('{{suffix}}', ' (1)'),
      }),
    ).toBeTruthy();
    // Exactly «Agents», suffix slot and all: the whole accessible name
    // is read back, so a stray ` (0)` lands here instead of matching by
    // accident.
    expect(
      screen
        .getByRole('button', { name: en.comments.agentsAria.replace('{{suffix}}', '') })
        .getAttribute('aria-label'),
    ).toBe(en.comments.agentsAria.replace('{{suffix}}', ''));

    first.unmount();

    // …and the mirror image: a thread that is nothing but an agent's
    // own notes, where it is the HUMANS chip that holds nothing.
    mockedList.mockResolvedValue([
      comment({ id: 'c-auto', body: 'agent note', authorType: 'agent', authorKind: 'agent_autonomous' }),
    ]);
    renderSection(1);
    await waitFor(() => screen.getByText('agent note'));

    expect(
      screen
        .getByRole('button', { name: en.comments.humansAria.replace('{{suffix}}', '') })
        .getAttribute('aria-label'),
    ).toBe(en.comments.humansAria.replace('{{suffix}}', ''));
    expect(
      screen.getByRole('button', {
        name: en.comments.agentsAria.replace('{{suffix}}', ' (1)'),
      }),
    ).toBeTruthy();
  });

  test('each chip explains itself on hover, and the pair reads as one lens', async () => {
    // `title` is the one place the interface says WHY a comment an
    // agent posted on someone's instruction is filed under Humans. The
    // group's `aria-label` is what tells a screen reader that these two
    // buttons are one lens rather than two unrelated toggles.
    mockedList.mockResolvedValue(mixed());
    const { container } = renderSection(3);
    await waitFor(() => screen.getByText('human note'));

    const named = (aria: string, suffix: string) =>
      screen.getByRole('button', { name: aria.replace('{{suffix}}', suffix) });
    expect(named(en.comments.humansAria, ' (2)').getAttribute('title')).toBe(
      en.comments.humansTitle,
    );
    expect(named(en.comments.agentsAria, ' (1)').getAttribute('title')).toBe(
      en.comments.agentsTitle,
    );
    const group = container.querySelector('.comment-filter-chips');
    expect(group?.getAttribute('role')).toBe('group');
    expect(group?.getAttribute('aria-label')).toBe(en.comments.filterAria);
  });

  test('the heading names the section, in the dictionary’s words', async () => {
    // `Section` is handed `t('details:sectionsMore.comments')`; blank
    // that key and the card grows an untitled block. The heading is
    // also what advertises that a task can HAVE comments — see the
    // docblock on `Section`.
    mockedList.mockResolvedValue(mixed());
    renderSection(3);
    await waitFor(() => screen.getByText('human note'));

    // The heading also carries the count chip, so the whole accessible
    // name is «Comments 3»; what this pins is that the WORD is the
    // dictionary's and not an empty string with a number beside it.
    const heading = screen.getByRole('heading');
    expect(heading.textContent).toContain(en.details.sectionsMore.comments);
  });
});

describe('CommentsThread author_kind filter (sk-16), driven from the heading', () => {
  test('default — both chips on — all three rows render', async () => {
    mockedList.mockResolvedValue(mixed());
    renderSection(3);
    await waitFor(() => screen.getByText('human note'));
    expect(screen.getByText('human note')).toBeTruthy();
    expect(screen.getByText('directed agent note')).toBeTruthy();
    expect(screen.getByText('autonomous agent note')).toBeTruthy();
  });

  test('turning Humans off hides human + agent_directed but keeps agent_autonomous', async () => {
    mockedList.mockResolvedValue(mixed());
    renderSection(3);
    await waitFor(() => screen.getByText('human note'));

    fireEvent.click(screen.getByRole('button', { name: /^Humans/ }));

    await waitFor(() => {
      expect(screen.queryByText('human note')).toBeNull();
    });
    expect(screen.queryByText('directed agent note')).toBeNull();
    expect(screen.getByText('autonomous agent note')).toBeTruthy();
  });

  test('turning Agents off hides agent_autonomous but keeps human + agent_directed', async () => {
    mockedList.mockResolvedValue(mixed());
    renderSection(3);
    await waitFor(() => screen.getByText('human note'));

    fireEvent.click(screen.getByRole('button', { name: /^Agents/ }));

    await waitFor(() => {
      expect(screen.queryByText('autonomous agent note')).toBeNull();
    });
    expect(screen.getByText('human note')).toBeTruthy();
    expect(screen.getByText('directed agent note')).toBeTruthy();
  });

  test('both chips off — the thread says the filter emptied it', async () => {
    mockedList.mockResolvedValue(mixed());
    const { container } = renderSection(3);
    await waitFor(() => screen.getByText('human note'));

    fireEvent.click(screen.getByRole('button', { name: /^Humans/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Agents/ }));

    await waitFor(() => {
      expect(screen.queryByText('human note')).toBeNull();
    });
    expect(screen.queryByText('directed agent note')).toBeNull();
    expect(screen.queryByText('autonomous agent note')).toBeNull();
    expect(screen.getByText(/no comments match the active filter/)).toBeTruthy();
    expect(container.querySelector('.comment-filter-empty')).not.toBeNull();
  });

  test('and the reset in the body puts every chip back on', async () => {
    // The round trip: the chips are on the heading, the way back is
    // offered where the reader is looking. Both ends have to be wired
    // to one state or the button would clear a filter nothing shows.
    mockedList.mockResolvedValue(mixed());
    renderSection(3);
    await waitFor(() => screen.getByText('human note'));

    fireEvent.click(screen.getByRole('button', { name: /^Humans/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Agents/ }));
    await waitFor(() => screen.getByRole('button', { name: 'Reset filter' }));

    fireEvent.click(screen.getByRole('button', { name: 'Reset filter' }));

    await waitFor(() => expect(screen.getByText('human note')).toBeTruthy());
    expect(screen.getByText('autonomous agent note')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /^Humans/ }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      screen.getByRole('button', { name: /^Agents/ }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  test('the chips and the rows read ONE fetch, not two', async () => {
    // The counts on the heading and the rows under it come from the
    // same TanStack entry. Two queries would be two chances to
    // disagree — and one extra request per issue opened.
    mockedList.mockResolvedValue(mixed());
    renderSection(3);
    await waitFor(() => screen.getByText('human note'));
    expect(mockedList).toHaveBeenCalledTimes(1);
  });
});
