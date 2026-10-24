import { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// Mock the comments API before importing the component under test.
vi.mock('../api/issues', async (importActual) => {
  const actual = await importActual<typeof import('../api/issues')>();
  return {
    ...actual,
    listComments: vi.fn(),
    addComment: vi.fn(),
    updateComment: vi.fn(),
    deleteComment: vi.fn(),
  };
});

import { addComment, CommentDTO, listComments } from '../api/issues';
import { AuthProvider, ME_KEY } from '../auth/AuthContext';
import type { User } from '../api/auth';
import { CommentsThread } from './CommentsThread';

const PROJECT_ID = 'pj-1';
const ISSUE_ID = 'sk-1';
const CALLER: User = {
  id: 'user-uuid-1',
  username: 'tester',
  email: 'tester@example.com',
  name: 'tester',
  role: 'user',
} as unknown as User;

function makeComment(overrides: Partial<CommentDTO> = {}): CommentDTO {
  return {
    id: 'c-1',
    issueId: ISSUE_ID,
    body: 'plain body',
    author: 'alice',
    authorUserId: 'user-uuid-1',
    authorType: 'human',
    authorKind: 'human',
    version: 1,
    editedAt: null,
    deletedAt: null,
    mentions: [],
    createdAt: '2026-05-22T18:48:00Z',
    updatedAt: '2026-05-22T18:48:00Z',
    ...overrides,
  };
}

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

/**
 * The same wrapper with a signed-in caller.
 *
 * `AuthProvider` reads the session out of the query cache under
 * `ME_KEY` with `staleTime: Infinity`, so seeding the entry is enough —
 * no `meApi` call is made. Needed by every assertion about the
 * AUTHOR: the Edit affordance is author-gated, and the optimistic row
 * is drawn with the caller's own name and avatar.
 */
function WrapAuthed({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(ME_KEY, CALLER);
  return (
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <AuthProvider>{children}</AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
}

const mockedList = vi.mocked(listComments);
const mockedAdd = vi.mocked(addComment);

beforeEach(() => {
  // sk-16 review fix W2 — reset BOTH mocks; addComment was previously
  // not reset, so any future composer-flow test would inherit stale
  // call counts from earlier tests. Pre-emptive isolation fix.
  mockedList.mockReset();
  mockedAdd.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('CommentsThread markdown rendering (sk-15)', () => {
  test('renders markdown headings, bold and code as HTML, not raw text', async () => {
    mockedList.mockResolvedValueOnce([
      makeComment({
        body:
          '## Summary\n\n**Done.** ' +
          'BuildId = `42b426f5-42a8-47be-bd55-00b8f91a5883`.',
      }),
    ]);

    render(
      <Wrap>
        <CommentsThread projectId={PROJECT_ID} issueId={ISSUE_ID} />
      </Wrap>,
    );

    // Wait for the query to resolve and the comment to land in the DOM.
    const heading = await waitFor(() =>
      screen.getByRole('heading', { level: 2, name: /Summary/ }),
    );
    expect(heading).toBeTruthy();

    // Bold must be a <strong>, not a literal `**Done.**` string.
    const bold = screen.getByText('Done.');
    expect(bold.tagName.toLowerCase()).toBe('strong');

    // Inline code must be a <code> element, not a literal backtick run.
    const code = screen.getByText(
      '42b426f5-42a8-47be-bd55-00b8f91a5883',
    );
    expect(code.tagName.toLowerCase()).toBe('code');

    // Negative: the raw markdown sequence should NOT survive in the DOM
    // text — the previous renderer rendered it as plain text and this
    // is the regression we are guarding against.
    expect(screen.queryByText(/## Summary/)).toBeNull();
  });

  test('renders a markdown table', async () => {
    mockedList.mockResolvedValueOnce([
      makeComment({
        body: '| Field | Value |\n|---|---|\n| Contact | user@example.com |',
      }),
    ]);

    render(
      <Wrap>
        <CommentsThread projectId={PROJECT_ID} issueId={ISSUE_ID} />
      </Wrap>,
    );

    const table = await waitFor(() => screen.getByRole('table'));
    expect(table).toBeTruthy();
    expect(screen.getByText('Field')).toBeTruthy();
    expect(screen.getByText('Value')).toBeTruthy();
    expect(screen.getByText('Contact')).toBeTruthy();
    expect(screen.getByText('user@example.com')).toBeTruthy();
  });

});

describe('sk-414.5 — the comment is a grid, and the thread is a list', () => {
  test('each comment is an <article> carrying avatar, head and body', async () => {
    // The three cells of artboard 4d's `28px / minmax(0,1fr)` grid.
    // `<article>` rather than a div: a comment is a self-contained
    // contribution, and the CSS grid is declared on this element.
    mockedList.mockResolvedValueOnce([makeComment({ body: 'the words' })]);
    const { container } = render(
      <Wrap>
        <CommentsThread projectId={PROJECT_ID} issueId={ISSUE_ID} />
      </Wrap>,
    );
    await waitFor(() => screen.getByText('the words'));

    const block = container.querySelector('.comment-block');
    expect(block).not.toBeNull();
    expect(block!.tagName).toBe('ARTICLE');
    expect(block!.querySelector('.comment-avatar')).not.toBeNull();
    expect(block!.querySelector('.comment-head')).not.toBeNull();
    expect(block!.querySelector('.comment-body')).not.toBeNull();
  });

  test('the list announces optimistic inserts', async () => {
    // The invariant behind the whole optimistic path: a comment that
    // appears without a page change has to be spoken. `aria-relevant`
    // narrows the announcement to what was ADDED, so an edit elsewhere
    // in the thread does not re-read the list.
    mockedList.mockResolvedValueOnce([makeComment()]);
    const { container } = render(
      <Wrap>
        <CommentsThread projectId={PROJECT_ID} issueId={ISSUE_ID} />
      </Wrap>,
    );
    await waitFor(() => screen.getByText('plain body'));

    const list = container.querySelector('ol.comment-list');
    expect(list).not.toBeNull();
    expect(list!.getAttribute('aria-live')).toBe('polite');
    expect(list!.getAttribute('aria-relevant')).toBe('additions');
    // Direct <li> children — an `ol` whose children are divs is not a
    // list to a screen reader, and the live region degrades with it.
    expect(list!.children.length).toBe(1);
    expect(list!.children[0].tagName).toBe('LI');
  });
});

describe('CommentsThread author_kind filter (sk-16, lens moved in sk-414.5)', () => {
  function mixed(): CommentDTO[] {
    return [
      makeComment({
        id: 'c-human',
        body: 'human note',
        authorType: 'human',
        authorKind: 'human',
        author: 'alice',
      }),
      makeComment({
        id: 'c-directed',
        body: 'directed agent note',
        authorType: 'agent',
        authorKind: 'agent_directed',
        author: 'agent-alice',
      }),
      makeComment({
        id: 'c-autonomous',
        body: 'autonomous agent note',
        authorType: 'agent',
        authorKind: 'agent_autonomous',
        author: 'agent-bob',
      }),
    ];
  }

  test('default — both lenses open — all three rows render', async () => {
    mockedList.mockResolvedValueOnce(mixed());
    render(
      <Wrap>
        <CommentsThread projectId={PROJECT_ID} issueId={ISSUE_ID} />
      </Wrap>,
    );
    await waitFor(() => screen.getByText('human note'));
    expect(screen.getByText('human note')).toBeTruthy();
    expect(screen.getByText('directed agent note')).toBeTruthy();
    expect(screen.getByText('autonomous agent note')).toBeTruthy();

    // Per-comment intent chips: human → none; agent_directed →
    // "directed"; agent_autonomous → "autonomous".
    expect(screen.getByText('directed')).toBeTruthy();
    expect(screen.getByText('autonomous')).toBeTruthy();
    // The 'human' kind must NOT surface a chip — the only "human" text
    // visible is the avatar / author tooltip.
    expect(screen.queryByLabelText('comment kind: human')).toBeNull();
    // Nothing is hidden, so nothing claims to be.
    expect(screen.queryByText(/hidden/)).toBeNull();
  });

  test('Humans closed hides human + agent_directed but keeps agent_autonomous', async () => {
    mockedList.mockResolvedValueOnce(mixed());
    render(
      <Wrap>
        <CommentsThread projectId={PROJECT_ID} issueId={ISSUE_ID} showHumans={false} />
      </Wrap>,
    );
    await waitFor(() => screen.getByText('autonomous agent note'));
    expect(screen.queryByText('human note')).toBeNull();
    expect(screen.queryByText('directed agent note')).toBeNull();
  });

  test('Agents closed hides agent_autonomous but keeps human + agent_directed', async () => {
    mockedList.mockResolvedValueOnce(mixed());
    render(
      <Wrap>
        <CommentsThread projectId={PROJECT_ID} issueId={ISSUE_ID} showAgents={false} />
      </Wrap>,
    );
    await waitFor(() => screen.getByText('human note'));
    expect(screen.getByText('directed agent note')).toBeTruthy();
    expect(screen.queryByText('autonomous agent note')).toBeNull();
  });

  test('a thread cut by the filter says how much is missing, and by whom', async () => {
    // The failure this exists to stop: a reader who does not know a
    // filter is on reads the short thread as the whole one. The count
    // and the AUTHOR KIND are both load-bearing — "1 comment hidden"
    // would tell them only what they can already see.
    mockedList.mockResolvedValueOnce(mixed());
    const { container } = render(
      <Wrap>
        <CommentsThread projectId={PROJECT_ID} issueId={ISSUE_ID} showAgents={false} />
      </Wrap>,
    );
    await waitFor(() => screen.getByText('human note'));

    const strip = container.querySelector('.comment-hidden-note');
    expect(strip).not.toBeNull();
    expect(strip!.textContent).toContain('1 agent comment hidden');
  });

  test('…and the other chip gets the mirror sentence, not the agent one', async () => {
    // Either chip can be closed. A single agent-flavoured string would
    // be a lie here — two humans are missing, not two agents.
    mockedList.mockResolvedValueOnce(mixed());
    const { container } = render(
      <Wrap>
        <CommentsThread projectId={PROJECT_ID} issueId={ISSUE_ID} showHumans={false} />
      </Wrap>,
    );
    await waitFor(() => screen.getByText('autonomous agent note'));

    const strip = container.querySelector('.comment-hidden-note');
    expect(strip).not.toBeNull();
    expect(strip!.textContent).toContain('2 human comments hidden');
    expect(strip!.textContent).not.toContain('agent comment');
  });

  test('the strip offers the way back in one press', async () => {
    mockedList.mockResolvedValueOnce(mixed());
    const onResetFilter = vi.fn();
    render(
      <Wrap>
        <CommentsThread
          projectId={PROJECT_ID}
          issueId={ISSUE_ID}
          showAgents={false}
          onResetFilter={onResetFilter}
        />
      </Wrap>,
    );
    await waitFor(() => screen.getByText('human note'));

    fireEvent.click(screen.getByRole('button', { name: 'show' }));
    expect(onResetFilter).toHaveBeenCalledTimes(1);
  });
});

describe('sk-414.5 — a filter that hides EVERYTHING says so, loudly', () => {
  const agentsOnly = (): CommentDTO[] => [
    makeComment({ id: 'a1', body: 'note one', authorType: 'agent', authorKind: 'agent_autonomous' }),
    makeComment({ id: 'a2', body: 'note two', authorType: 'agent', authorKind: 'agent_autonomous' }),
  ];

  test('an empty-by-filter thread is a status, with the reason and the way out', async () => {
    // Silence here is the defect: an empty thread and a thread whose
    // every comment is filtered out look identical, and the chips that
    // caused it sit up on the heading, out of the reader's eye.
    mockedList.mockResolvedValueOnce(agentsOnly());
    const onResetFilter = vi.fn();
    const { container } = render(
      <Wrap>
        <CommentsThread
          projectId={PROJECT_ID}
          issueId={ISSUE_ID}
          showAgents={false}
          onResetFilter={onResetFilter}
        />
      </Wrap>,
    );

    const plaque = await waitFor(() => {
      const el = container.querySelector('.comment-filter-empty');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    // Announced, because it arrives without a navigation.
    expect(plaque.getAttribute('role')).toBe('status');
    expect(plaque.textContent).toContain('no comments match the active filter');
    // …and it names WHY: all of them were written by agents.
    expect(plaque.textContent).toContain('all 2 were written by agents');

    fireEvent.click(screen.getByRole('button', { name: 'Reset filter' }));
    expect(onResetFilter).toHaveBeenCalledTimes(1);
  });

  test('an actually-empty thread stays silent — the heading owns that message', async () => {
    // The other direction. «none yet» lives on the section heading
    // (D2B-8); a filter plaque here would say the wrong thing about a
    // thread nobody has written in yet.
    mockedList.mockResolvedValueOnce([]);
    const { container } = render(
      <Wrap>
        <CommentsThread projectId={PROJECT_ID} issueId={ISSUE_ID} />
      </Wrap>,
    );
    await waitFor(() => expect(mockedList).toHaveBeenCalled());
    await waitFor(() =>
      expect(container.querySelector('.detail-status-plaque')).toBeNull(),
    );
    expect(container.querySelector('.comment-filter-empty')).toBeNull();
    expect(container.querySelector('.comment-hidden-note')).toBeNull();
    // The composer is always there — that is the one thing an empty
    // thread must still offer.
    expect(screen.getByLabelText('Add comment')).toBeTruthy();
  });
});

describe('sk-285.6.1 — the delete affordance is quiet, not absent', () => {
  test('Delete is a real button in the tree even with the pointer nowhere near', () => {
    // The whole risk of "show it on hover" is that someone implements
    // it in JS — `{hovered && <Button/>}` — and the action silently
    // becomes mouse-only. Nothing here hovers anything: the button has
    // to be queryable, by ROLE and by its accessible name, in the
    // resting DOM.
    mockedList.mockResolvedValueOnce([makeComment()]);
    render(
      <Wrap>
        <CommentsThread projectId={PROJECT_ID} issueId={ISSUE_ID} />
      </Wrap>,
    );

    return waitFor(() => {
      const del = screen.getByRole('button', { name: 'Delete' });
      expect(del.tagName).toBe('BUTTON');
      // Not hidden from assistive tech by an attribute either — CSS
      // opacity is the only thing standing between it and the reader.
      expect(del.getAttribute('aria-hidden')).toBeNull();
      expect(del.hasAttribute('hidden')).toBe(false);
      // And it is focusable: no `tabindex="-1"` sneaked in to "help"
      // with the visual quiet.
      expect(del.getAttribute('tabindex')).toBeNull();
    });
  });

  test('a deleted comment keeps its slot and loses its actions', async () => {
    // sk-57's tombstone, in artboard 4d's grade. The row must not
    // vanish — the timeline has to keep saying somebody wrote here and
    // it was removed — and it must not offer to edit or delete what is
    // already gone.
    mockedList.mockResolvedValueOnce([
      makeComment({ deletedAt: '2026-05-23T10:00:00Z', body: 'gone' }),
    ]);
    const { container } = render(
      <WrapAuthed>
        <CommentsThread projectId={PROJECT_ID} issueId={ISSUE_ID} />
      </WrapAuthed>,
    );

    await waitFor(() => screen.getByText('comment deleted'));
    expect(container.querySelector('.comment-deleted')).not.toBeNull();
    // The body itself is not rendered — a deleted comment is not a
    // hidden one.
    expect(screen.queryByText('gone')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    // …but the slot is still a comment, with its author and its stamp.
    expect(container.querySelector('.comment-block')).not.toBeNull();
    expect(container.querySelector('.comment-head')).not.toBeNull();
  });
});

describe('sk-414.5 — editing happens in the comment’s own slot', () => {
  test('Edit swaps the body for a textarea with Cancel and Save', async () => {
    mockedList.mockResolvedValueOnce([makeComment({ body: 'first draft' })]);
    const { container } = render(
      <WrapAuthed>
        <CommentsThread projectId={PROJECT_ID} issueId={ISSUE_ID} />
      </WrapAuthed>,
    );

    await waitFor(() => screen.getByText('first draft'));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    const box = await screen.findByLabelText('Edit comment');
    expect((box as HTMLTextAreaElement).value).toBe('first draft');
    expect(container.querySelector('.comment-edit')).not.toBeNull();
    // The rendered body is gone while the source is being edited —
    // showing both would be two versions of one comment on screen.
    expect(container.querySelector('.comment-body')).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByText('first draft')).toBeTruthy());
    expect(container.querySelector('.comment-edit')).toBeNull();
  });

  test('Edit is offered to the author and to nobody else', async () => {
    // sk-57. Delete stays visible to non-authors (the API's 403 is the
    // real gate for it), but editing someone else's words is not even
    // offered.
    mockedList.mockResolvedValueOnce([
      makeComment({ authorUserId: 'someone-else', author: 'alice' }),
    ]);
    render(
      <WrapAuthed>
        <CommentsThread projectId={PROJECT_ID} issueId={ISSUE_ID} />
      </WrapAuthed>,
    );
    await waitFor(() => screen.getByText('plain body'));
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
  });
});

describe('sk-414.5 — the post in flight', () => {
  test('the comment is on screen, marked provisional, before the server has it', async () => {
    mockedList.mockResolvedValueOnce([]);
    // Never resolves: the assertion is about the state DURING the
    // request, and a promise that settles would race the queries.
    mockedAdd.mockReturnValueOnce(new Promise<CommentDTO>(() => {}));

    const { container } = render(
      <WrapAuthed>
        <CommentsThread projectId={PROJECT_ID} issueId={ISSUE_ID} />
      </WrapAuthed>,
    );

    const box = await screen.findByLabelText('Add comment');
    fireEvent.change(box, { target: { value: 'starting the run' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));

    const pending = await waitFor(() => {
      const el = container.querySelector('.comment-block--pending');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    // The words the writer typed, verbatim — they are still looking at
    // them, and blanking the composer without showing them anywhere
    // reads as "it was lost".
    expect(pending.textContent).toContain('starting the run');
    expect(pending.textContent).toContain('sending…');
    expect(pending.querySelector('.detail-spinner')).not.toBeNull();
    // It sits inside the announced list, not beside it.
    expect(container.querySelector('ol.comment-list .comment-block--pending')).not.toBeNull();

    // …and the button cannot be pressed twice: the second press would
    // post the same comment again.
    const post = screen.getByRole('button', { name: 'Post' });
    expect((post as HTMLButtonElement).disabled).toBe(true);
    expect(post.querySelector('.detail-spinner')).not.toBeNull();
  });

  test('when it lands, the provisional row gives way to the real one', async () => {
    mockedList.mockResolvedValueOnce([]);
    mockedAdd.mockResolvedValueOnce(
      makeComment({ id: 'c-new', body: 'saved for real' }),
    );

    const { container } = render(
      <WrapAuthed>
        <CommentsThread projectId={PROJECT_ID} issueId={ISSUE_ID} />
      </WrapAuthed>,
    );

    const box = await screen.findByLabelText('Add comment');
    fireEvent.change(box, { target: { value: 'saved for real' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));

    await waitFor(() => expect(screen.getByText('saved for real')).toBeTruthy());
    await waitFor(() =>
      expect(container.querySelector('.comment-block--pending')).toBeNull(),
    );
    // One comment, not two: the optimistic row is replaced, not joined.
    expect(container.querySelectorAll('.comment-block').length).toBe(1);
    expect((screen.getByLabelText('Add comment') as HTMLTextAreaElement).value).toBe('');
  });
});

/**
 * sk-416 (review finding 2) — one comment, one row, at every instant.
 *
 * The provisional row used to be derived from the MUTATION's own state
 * (`addMutation.isPending ? addMutation.variables : null`), and v5 keeps
 * a mutation pending until `onSuccess` RESOLVES. `onSuccess` wrote the
 * real comment into the cache and then awaited an invalidation of the
 * issue detail, so for the whole length of that refetch the thread held
 * both rows and the reader saw their comment twice.
 *
 * The window is what this test holds open on purpose: a live
 * `['issues','detail',ISSUE_ID]` observer — the card's own query, which
 * is always mounted beside the thread in the product — whose refetch
 * never settles. Under the old code that makes the duplicate permanent
 * instead of a flicker; under the fixed one the provisional row is gone
 * the moment the real one exists, whatever the mutation is still doing.
 */
describe('sk-414.5 / sk-416 — the posted comment is never on screen twice', () => {
  test('the provisional row goes the instant the real one arrives', async () => {
    mockedList.mockResolvedValueOnce([]);
    mockedAdd.mockResolvedValueOnce(makeComment({ id: 'c-new', body: 'saved for real' }));

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(ME_KEY, CALLER);
    // The detail query the badge count lives on. It is ACTIVE, so the
    // invalidation in `onSuccess` refetches it — and this one never
    // answers, which pins the mutation open.
    const DetailProbe = () => {
      useQuery({
        queryKey: ['issues', 'detail', ISSUE_ID],
        queryFn: () => new Promise<{ id: string }>(() => {}),
      });
      return null;
    };

    const { container } = render(
      <MantineProvider>
        <QueryClientProvider client={qc}>
          <MemoryRouter>
            <AuthProvider>
              <DetailProbe />
              <CommentsThread projectId={PROJECT_ID} issueId={ISSUE_ID} />
            </AuthProvider>
          </MemoryRouter>
        </QueryClientProvider>
      </MantineProvider>,
    );

    const box = await screen.findByLabelText('Add comment');
    fireEvent.change(box, { target: { value: 'saved for real' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));

    // The provisional row first — the writer must see their words while
    // the request is out.
    await waitFor(() =>
      expect(container.querySelector('.comment-block--pending')).not.toBeNull(),
    );

    // …and then the real one lands. From that render on there must be
    // exactly one row: the badge refetch is still in flight (nothing
    // settles it), so anything keyed on the mutation's own lifetime is
    // still «pending» here.
    await waitFor(() =>
      expect(
        container.querySelector('.comment-block:not(.comment-block--pending)'),
      ).not.toBeNull(),
    );
    // The window really is open: the badge's own query is still out.
    expect(qc.getQueryState(['issues', 'detail', ISSUE_ID])?.fetchStatus).toBe('fetching');
    expect(
      container.querySelectorAll('.comment-block--pending').length,
      'the provisional row is still on screen beside the real comment',
    ).toBe(0);
    expect(container.querySelectorAll('.comment-block').length).toBe(1);
    expect(screen.getAllByText('saved for real').length).toBe(1);
  });
});
