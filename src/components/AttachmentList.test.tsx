import { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the attachments API before importing the component under test.
vi.mock('../api/attachments', async (importActual) => {
  const actual = await importActual<typeof import('../api/attachments')>();
  return {
    ...actual,
    listAttachments: vi.fn(),
    deleteAttachment: vi.fn(),
    getDownloadURL: vi.fn(),
  };
});

import {
  Attachment,
  deleteAttachment,
  getDownloadURL,
  listAttachments,
} from '../api/attachments';
import { AttachmentList } from './AttachmentList';

const ISSUE_ID = 'demo-1';

const SAMPLE_ATTACHMENT: Attachment = {
  id: 'att-1',
  issueId: ISSUE_ID,
  filename: 'design-spec.pdf',
  contentType: 'application/pdf',
  sizeBytes: 12345,
  status: 'ready',
  uploadedBy: 'user-1',
  uploadedByUsername: 'alice',
  uploadedAt: '2026-05-04T10:00:00Z',
};

function Wrapper({ children }: { children: ReactNode }) {
  // Fresh QueryClient per test so cache doesn't leak between cases.
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return (
    <MantineProvider forceColorScheme="dark">
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </MantineProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('AttachmentList — delete confirmation flow', () => {
  test('clicking delete opens ConfirmDialog without firing the mutation', async () => {
    vi.mocked(listAttachments).mockResolvedValue({
      items: [SAMPLE_ATTACHMENT],
      total: 1,
    });
    const user = userEvent.setup();

    render(
      <Wrapper>
        <AttachmentList issueId={ISSUE_ID} />
      </Wrapper>,
    );

    // Wait for the list to render.
    const deleteButton = await screen.findByRole('button', {
      name: `delete ${SAMPLE_ATTACHMENT.filename}`,
    });

    await user.click(deleteButton);

    // The Mantine Modal renders a dialog with the confirm/cancel pair.
    const dialog = await screen.findByRole('dialog');
    // sk-414.2 — the dialog's copy changed with the artboard: it now
    // names the file first and says WHAT is irreversible (the file
    // leaves everyone on the issue). What this asserts is unchanged —
    // the dialog names the file it is about.
    expect(
      within(dialog).getByText(/design-spec\.pdf disappears for everyone/i),
    ).toBeTruthy();
    // Mutation must NOT have been called yet — only the dialog opens.
    expect(deleteAttachment).not.toHaveBeenCalled();
  });

  test('confirming the dialog calls deleteAttachment with the right id', async () => {
    vi.mocked(listAttachments).mockResolvedValue({
      items: [SAMPLE_ATTACHMENT],
      total: 1,
    });
    vi.mocked(deleteAttachment).mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(
      <Wrapper>
        <AttachmentList issueId={ISSUE_ID} />
      </Wrapper>,
    );

    await user.click(
      await screen.findByRole('button', {
        name: `delete ${SAMPLE_ATTACHMENT.filename}`,
      }),
    );

    const dialog = await screen.findByRole('dialog');
    // sk-414.2 — `[ y · delete ]` was the terminal dialect the redesign
    // retired; the button now names the act. Still the confirm button
    // of this dialog, matched exactly so the row's own
    // "delete design-spec.pdf" action can never stand in for it.
    const confirm = within(dialog).getByRole('button', { name: /^delete$/i });
    await user.click(confirm);

    expect(deleteAttachment).toHaveBeenCalledTimes(1);
    expect(deleteAttachment).toHaveBeenCalledWith(SAMPLE_ATTACHMENT.id);
  });

  test('cancelling the dialog does not call deleteAttachment', async () => {
    vi.mocked(listAttachments).mockResolvedValue({
      items: [SAMPLE_ATTACHMENT],
      total: 1,
    });
    const user = userEvent.setup();

    render(
      <Wrapper>
        <AttachmentList issueId={ISSUE_ID} />
      </Wrapper>,
    );

    await user.click(
      await screen.findByRole('button', {
        name: `delete ${SAMPLE_ATTACHMENT.filename}`,
      }),
    );

    const dialog = await screen.findByRole('dialog');
    const cancel = within(dialog).getByRole('button', { name: /^cancel$/i });
    await user.click(cancel);

    // Mutation is the only assertion that matters here — the modal
    // close animation can leave the dialog node in the tree briefly,
    // which is a Mantine implementation detail we don't depend on.
    expect(deleteAttachment).not.toHaveBeenCalled();
  });
});

/**
 * sk-285.7.2.88 — the row's two affordances are DRAWN.
 *
 * Both were icon buttons whose icon was a letter: `↓` (U+2193) in the
 * download control and `×` (U+00D7) in the delete one, each the
 * button's entire content.
 *
 * WHICH icon is a separate question from whether one is drawn, and
 * sk-414.3 answered it again off artboard 4b — see the case below.
 *
 * Measured on the mounted node rather than live: this environment's
 * database holds no issue with an attachment, so the row does not
 * appear in the running app at all. The mount is the measurement.
 */
describe('AttachmentList — sk-285.7.2.88, the row draws its icons', () => {
  /** The characters these two controls used to be. */
  const STAND_INS = ['↓', '×', '✕', '✗'];

  async function renderRow() {
    vi.mocked(listAttachments).mockResolvedValue({
      items: [SAMPLE_ATTACHMENT],
      total: 1,
    });
    render(
      <Wrapper>
        <AttachmentList issueId={ISSUE_ID} />
      </Wrapper>,
    );
    // Tripwire: without this the queries below return null and every
    // assertion passes on an empty tree.
    await screen.findByRole('button', {
      name: `delete ${SAMPLE_ATTACHMENT.filename}`,
    });
  }

  test.each([
    // sk-414.3 — the two names moved with artboard 4b, and the move is
    // the point rather than a re-spelling: `arrow-down` is the glyph a
    // page uses to SCROLL, and `x` on a row means «unlink». This row
    // saves a file to disk and deletes bytes from a bucket, so the
    // canvas draws `download` and `trash`. Everything else this case
    // asserts — one drawn icon, no character left behind, the
    // accessible name on the button —
    // is unchanged and is what makes the pair worth pinning at all.
    ['download', `download ${SAMPLE_ATTACHMENT.filename}`, 'download'],
    ['delete', `delete ${SAMPLE_ATTACHMENT.filename}`, 'trash'],
  ])('the %s control is one Tabler `%s` ', async (_what, name, icon) => {
    await renderRow();
    const btn = screen.getByRole('button', { name });
    const svgs = btn.querySelectorAll('svg');
    expect(svgs.length, 'nothing drawn in the control').toBe(1);
    const svg = svgs[0];
    expect(svg.getAttribute('class')).toContain(`tabler-icon-${icon}`);
    // Audit Q-2: adding an icon does not remove the character it
    // replaced. Both halves, on the same node.
    const text = btn.textContent ?? '';
    expect(STAND_INS.filter((g) => text.includes(g))).toEqual([]);
    // The accessible name survives on the button — the icon is decoration.
    expect(btn.getAttribute('aria-label')).toBe(name);
  });
});

/**
 * sk-414.3 — the four states of the list that are NOT «here are the
 * files», each of which artboard 4b draws separately.
 *
 * They are worth their own cases because every one of them used to be
 * reachable only by a code path nothing rendered: «not known yet» and
 * «could not load» are what a reader sees when the section refuses to
 * collapse on an unanswered query (the guard `AttachmentsSection`
 * keeps), the pending row is the ONLY place an upload in flight appears
 * in the list, and the declined actions are what stops a second request
 * being fired at a row whose first one has not come back.
 */
describe('AttachmentList — the states around the files', () => {
  test('an unanswered query is a status line, not an empty list', async () => {
    // Never resolves: the query stays in flight for the whole case.
    vi.mocked(listAttachments).mockImplementation(() => new Promise(() => {}));

    const { container } = render(
      <Wrapper>
        <AttachmentList issueId={ISSUE_ID} />
      </Wrapper>,
    );

    const plaque = await screen.findByRole('status');
    expect(plaque.getAttribute('aria-live')).toBe('polite');
    // The distinction the plaque exists to make: nothing claims the
    // issue HAS no attachments while the answer is still coming.
    expect(container.querySelector('.attachments-empty')).toBeNull();
    expect(container.querySelector('.detail-list')).toBeNull();
  });

  test('a failed query is an alert plaque that says so', async () => {
    vi.mocked(listAttachments).mockRejectedValue(new Error('boom'));

    render(
      <Wrapper>
        <AttachmentList issueId={ISSUE_ID} />
      </Wrapper>,
    );

    const alert = await screen.findByRole('alert');
    // Both halves: the cause in the reader's language, and the server's
    // own words after it. A plaque with only one of them is what the
    // artboard's "bold title + detail" is against.
    expect(alert.textContent).toContain('failed to load attachments');
    expect(alert.textContent).toContain('boom');
  });

  test('a file still going up is a row of this list, with no actions', async () => {
    // The API answers with NOTHING — `status='ready'` only, so the file
    // being uploaded is invisible to it. This is the whole reason the
    // pending row is a prop (epic decision 1).
    vi.mocked(listAttachments).mockResolvedValue({ items: [], total: 0 });

    const { container } = render(
      <Wrapper>
        <AttachmentList issueId={ISSUE_ID} pendingName="worker-3.log" />
      </Wrapper>,
    );

    const row = await screen.findByRole('listitem');
    expect(row.getAttribute('aria-label')).toBe('worker-3.log');
    // The badge slot is the dashed placeholder, not an extension.
    expect(row.querySelector('.ext-badge--pending')).not.toBeNull();
    expect(row.querySelector('.detail-row-name-muted')?.textContent).toBe(
      'worker-3.log',
    );
    expect(row.textContent).toContain('uploading · just now');
    // Nothing to download and nothing to delete — the bytes are not
    // there yet, and a delete would race the confirm.
    expect(within(row).queryAllByRole('button')).toEqual([]);
    // …and «none» must not appear beside it: the list is not empty, it
    // is one row long.
    expect(container.querySelector('.attachments-empty')).toBeNull();
  });

  test('while one row is busy every row declines the press', async () => {
    const second: Attachment = { ...SAMPLE_ATTACHMENT, id: 'att-2', filename: 'b.pdf' };
    vi.mocked(listAttachments).mockResolvedValue({
      items: [SAMPLE_ATTACHMENT, second],
      total: 2,
    });
    // A download URL request that never comes back — the row stays busy.
    vi.mocked(getDownloadURL).mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup();

    render(
      <Wrapper>
        <AttachmentList issueId={ISSUE_ID} />
      </Wrapper>,
    );

    await user.click(
      await screen.findByRole('button', {
        name: `download ${SAMPLE_ATTACHMENT.filename}`,
      }),
    );

    // The busy row draws the ring in place of its icon…
    const busy = screen.getByRole('button', {
      name: `download ${SAMPLE_ATTACHMENT.filename}`,
    });
    await waitFor(() => expect(busy.querySelector('.detail-spinner')).not.toBeNull());

    // …and the OTHER row is declined, because the mutation state is
    // per-mutation: a second press there would look like it worked and
    // then finish under the first row's spinner.
    const other = screen.getByRole('button', { name: 'download b.pdf' });
    expect(other.getAttribute('aria-disabled')).toBe('true');
    // Declined, not removed: `aria-disabled` keeps the keyboard stop, so
    // a reader standing on this control is not dropped onto <body> for
    // the second the request takes (WCAG 2.4.3).
    expect(other.hasAttribute('disabled')).toBe(false);

    await user.click(other);
    // One request in total — the declined press did not fire a second.
    expect(getDownloadURL).toHaveBeenCalledTimes(1);
  });

  test('a file over the card steps the list back', async () => {
    vi.mocked(listAttachments).mockResolvedValue({
      items: [SAMPLE_ATTACHMENT],
      total: 1,
    });

    const { container, rerender } = render(
      <Wrapper>
        <AttachmentList issueId={ISSUE_ID} />
      </Wrapper>,
    );

    const list = await screen.findByRole('list');
    expect(list.getAttribute('data-dimmed')).toBeNull();

    rerender(
      <Wrapper>
        <AttachmentList issueId={ISSUE_ID} dimmed />
      </Wrapper>,
    );

    expect(container.querySelector('.detail-list')!.getAttribute('data-dimmed')).toBe(
      'true',
    );
  });
});
