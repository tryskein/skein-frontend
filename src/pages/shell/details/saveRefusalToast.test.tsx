/**
 * sk-492 — a refused card save is reported ONCE, in translated words.
 *
 * After sk-425 the inline editors (the text sections, the title) print the
 * reason of a refused save under the editor (`saveFailureReason`). The
 * mutation's toast still fired beside it with the server's raw English
 * message («issue is locked by another session») — the reason twice, the
 * second time untranslated and without the claim holder. The header's
 * priority / type share that toast and have no room for a reason in place.
 *
 * Contract checked here, on the real `useIssueDetail` and the real
 * components (`DetailsHeader`, `EditableTextSection`, `IssueTitleEdit`)
 * wired the way `IssueDetailPanel` wires them:
 *
 *   1. an editor's refusal — the reason under the editor, NO toast;
 *   2. a header field's refusal — a toast, worded by the same
 *      `saveFailureReason` (translated, the holder by the card's
 *      `lockedByUsername`, never the session id, never the raw message).
 *
 * `api/issues` answers with the API's real refusals (skein-api
 * `handler/issues.go`: 422 `locked_by_other` carrying a session id, 422
 * `version_conflict`) and a plain 500, a macrotask later like the network.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ApiError, BusinessError } from '../../../api/client';
import i18n, { DEFAULT_LANGUAGE } from '../../../i18n/config';

const PID = 'proj-toast';
const ID = 'sk-78';
const HOLDER = 'agent-bob';
const SESSION = 'mcp-session-1111-secret';
const RAW_LOCKED = 'issue is locked by another session';

const api = vi.hoisted(() => ({
  server: {} as Record<string, unknown>,
  patchIssue: vi.fn(),
  getIssue: vi.fn(),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock('../../../api/issues', async (importActual) => {
  const actual = await importActual<typeof import('../../../api/issues')>();
  return {
    ...actual,
    getIssue: (...args: unknown[]) => api.getIssue(...args),
    patchIssue: (...args: unknown[]) => api.patchIssue(...args),
    listComments: () => Promise.resolve([]),
  };
});
vi.mock('../../../api/activity', () => ({
  listIssueActivity: () => Promise.resolve({ items: [], nextCursor: null }),
}));
const upload = vi.hoisted(() => ({ uploadAttachment: vi.fn() }));
vi.mock('../../../api/attachments', async (importActual) => {
  const actual = await importActual<typeof import('../../../api/attachments')>();
  return {
    ...actual,
    listAttachments: () => Promise.resolve({ items: [] }),
    uploadAttachment: (...args: unknown[]) => upload.uploadAttachment(...args),
  };
});
vi.mock('../../../api/dependencies', () => ({
  listDependencies: () => Promise.resolve({ outgoing: [], incoming: [] }),
}));
vi.mock('../../../api/watchers', () => ({
  listIssueWatchers: () => Promise.resolve([]),
}));
vi.mock('../../../components/Toaster', () => ({
  useToaster: () => toast,
}));
vi.mock('../../../auth/AuthContext', async (importActual) => {
  const actual = await importActual<typeof import('../../../auth/AuthContext')>();
  return {
    ...actual,
    useAuth: () => ({
      user: { id: 'u-1', username: 'carol', email: 'c@example.com', name: 'Carol', role: 'user' },
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    }),
  };
});

import { isSaveFailure, useIssueDetail } from '../../../lib/useIssueDetail';
import { refusalReason } from '../../../lib/saveFailureReason';
import { LayoutProvider } from '../../../lib/useLayoutState';
import { DetailsHeader } from './DetailsHeader';
import { IssueTitleEdit } from './IssueTitleEdit';
import { EditableTextSection } from './sections/EditableTextSection';
import { AttachmentDropzone } from '../../../components/AttachmentDropzone';

function fixture(): Record<string, unknown> {
  return {
    id: ID,
    projectId: PID,
    version: 3,
    title: 'server title',
    description: '',
    acceptanceCriteria: '',
    notes: 'server notes text',
    design: '',
    type: 'task',
    priority: 2,
    status: 'in_progress',
    pinned: false,
    source: 'human',
    createdBy: 'u-9',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    metadata: {},
    componentIds: [],
    labels: [],
    commentsCount: 0,
    commitRefs: [],
    mentions: [],
    isBlocked: false,
    blockers: [],
    assignee: 'dave',
    previousAssignees: [],
    dismissedBy: [],
    lockedBy: SESSION,
    lockedByUsername: HOLDER,
  };
}

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(`details:${key}`, opts);

/** The card's three save paths, wired as `IssueDetailPanel` wires them. */
function Card() {
  const detail = useIssueDetail({ issueId: ID, projectHandle: PID });
  if (!detail.issue) return null;
  const issue = detail.issue;
  return (
    <>
      <DetailsHeader
        issue={issue}
        isWatching={false}
        watchToggling={false}
        onUpdateField={(patch) => detail.updateField(patch)}
        // sk-489 · review F/1: the rig mirrors the PRODUCT stitching, so
        // it must carry the same three parameters. A two-argument copy modelled
        // a wiring that no longer exists in the product, and would hide its return.
        onChangeStatus={(next, reason, close) => detail.changeStatus(next, reason, undefined, close)}
        onAccept={() => detail.accept()}
        onWatchToggle={() => {}}
      />
      <div data-testid="field-title">
        <IssueTitleEdit
          initial={issue.title}
          onSave={async (v) => {
            const result = await detail.updateField({ title: v }, { reportsInline: true });
            if (isSaveFailure(result)) throw result.error;
          }}
          lockedByUsername={issue.lockedByUsername}
        />
      </div>
      <div data-testid="field-notes">
        <EditableTextSection
          title={t('sections.notes')}
          field="notes"
          emptyAddLabel={t('addNotes')}
          issue={issue}
          updateField={detail.updateField}
        />
      </div>
    </>
  );
}

function mountCard() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <LayoutProvider>{children}</LayoutProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
  return render(<Card />, { wrapper });
}

function refuseWith(err: Error) {
  api.patchIssue.mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        setTimeout(() => reject(err), 0);
      }),
  );
}

const LOCKED = () =>
  new BusinessError(422, RAW_LOCKED, 'locked_by_other', { lockedBy: SESSION });
const CONFLICT = () =>
  new BusinessError(422, 'the issue was modified since you read it', 'version_conflict');
const SERVER_DOWN = () => new ApiError(500, 'internal error');

/** [name, refusal, the header toast's reason, the editor's reason]. */
const REFUSALS = [
  [
    'locked_by_other',
    LOCKED,
    () => t('editable.reason.lockedBy', { user: HOLDER }),
    () => t('editable.reason.lockedBy', { user: HOLDER }),
  ],
  [
    'version_conflict',
    CONFLICT,
    () => t('editable.reason.versionConflictField'),
    () => t('editable.reason.versionConflict'),
  ],
  ['server error', SERVER_DOWN, () => 'internal error', () => 'internal error'],
] as const;

async function pickPriority(user: ReturnType<typeof userEvent.setup>, p: number) {
  await user.click(await screen.findByRole('button', { name: t('header.priorityAria', { priority: 2 }) }));
  const menu = await screen.findByRole('menu');
  await user.click(within(menu).getByRole('menuitem', { name: `P${p}` }));
}

beforeEach(() => {
  api.server = fixture();
  api.patchIssue.mockReset();
  api.getIssue.mockReset();
  api.getIssue.mockImplementation(() => Promise.resolve({ ...api.server }));
  toast.error.mockReset();
  toast.success.mockReset();
});

afterEach(async () => {
  cleanup();
  if (i18n.language !== DEFAULT_LANGUAGE) await i18n.changeLanguage(DEFAULT_LANGUAGE);
});

describe('sk-492 — an editor reports its refusal once, in place', () => {
  for (const [name, error, , editorReason] of REFUSALS) {
    test(`${name}: «Notes» — the reason under the editor, no toast`, async () => {
      refuseWith(error());
      const view = mountCard();
      const scope = within(await view.findByTestId('field-notes'));
      fireEvent.click(
        scope.getByRole('button', { name: t('editable.editAria', { title: t('sections.notes') }) }),
      );
      const textarea = await waitFor(() => scope.getByRole('textbox') as HTMLTextAreaElement);
      // sk-493 — type only after «Edit»'s deferred focus has landed
      // (see sections/saveRefusalKeepsText.test.tsx#typeAndBlur).
      await waitFor(() => expect(document.activeElement).toBe(textarea));
      await act(async () => {
        fireEvent.change(textarea, { target: { value: 'typed notes' } });
      });
      await act(async () => {
        fireEvent.blur(textarea);
      });

      const alert = await waitFor(() => scope.getByRole('alert'));
      expect(alert.textContent).toBe(t('editable.saveFailed', { message: editorReason() }));
      expect(api.patchIssue).toHaveBeenCalledTimes(1);
      expect(toast.error).not.toHaveBeenCalled();
    });

    test(`${name}: the title — the reason under it, no toast`, async () => {
      refuseWith(error());
      const view = mountCard();
      const scope = within(await view.findByTestId('field-title'));
      const textarea = scope.getByRole('textbox') as HTMLTextAreaElement;
      await act(async () => {
        fireEvent.change(textarea, { target: { value: 'typed title' } });
      });
      await act(async () => {
        fireEvent.blur(textarea);
      });

      const alert = await waitFor(() => scope.getByRole('alert'));
      expect(alert.textContent).toBe(t('title.saveFailed', { message: editorReason() }));
      expect(api.patchIssue).toHaveBeenCalledTimes(1);
      expect(toast.error).not.toHaveBeenCalled();
    });
  }
});

describe('sk-492 — a header field reports its refusal in a translated toast', () => {
  for (const [name, error, fieldReason] of REFUSALS) {
    test(`${name}: priority — one toast, worded by saveFailureReason`, async () => {
      refuseWith(error());
      const user = userEvent.setup();
      mountCard();
      await pickPriority(user, 0);

      await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
      expect(api.patchIssue).toHaveBeenCalledWith(PID, ID, 3, { priority: 0 });
      const text = toast.error.mock.calls[0][0] as string;
      expect(text).toBe(t('editable.fieldSaveFailed', { message: fieldReason() }));
      expect(text).not.toContain(SESSION);
      expect(text).not.toContain(RAW_LOCKED);
    });
  }

  test('type goes through the same toast', async () => {
    refuseWith(LOCKED());
    const user = userEvent.setup();
    mountCard();
    await user.click(await screen.findByRole('button', { name: t('header.changeType', { type: 'task' }) }));
    const menu = await screen.findByRole('menu');
    await user.click(within(menu).getByRole('menuitem', { name: 'bug' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith(
      t('editable.fieldSaveFailed', { message: t('editable.reason.lockedBy', { user: HOLDER }) }),
    );
  });

  test('no holder on the card → «another session», never the session id', async () => {
    api.server = { ...fixture(), lockedByUsername: undefined };
    refuseWith(LOCKED());
    const user = userEvent.setup();
    mountCard();
    await pickPriority(user, 1);

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    const text = toast.error.mock.calls[0][0] as string;
    expect(text).toBe(t('editable.fieldSaveFailed', { message: t('editable.reason.locked') }));
    expect(text).not.toContain(SESSION);
  });

  test('ru: the toast is translated', async () => {
    await i18n.changeLanguage('ru');
    refuseWith(LOCKED());
    const user = userEvent.setup();
    mountCard();
    await pickPriority(user, 0);

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error.mock.calls[0][0]).toBe(
      `изменение не сохранено — задачу захватил ${HOLDER}; правки не принимаются, пока захват не снят`,
    );
  });
});

// ──────── sk-674.18 T055 — refusals of the spaces feature ────────
//
// Each code a card's links and people can meet is told in its own words —
// the message key picked by the code (`saveFailureReason.ts#refusalReason`),
// never a common «error» and never the server's English message. Checked
// on the header-field save path of the real card (the path an assignee
// change takes), and the space's attachment quota at the upload zone
// (US-14).

const RAW = 'raw server message';

describe('row 246 — every refusal code of the spaces feature has its own message', () => {
  const CODES: ReadonlyArray<[string, Record<string, unknown>, () => string]> = [
    ['assignee_not_allowed', {}, () => t('refusal.assigneeNotAllowed')],
    ['not_space_member', { spaceId: 'k3x9p2qa' }, () => t('refusal.notSpaceMember')],
    ['member_via_space', {}, () => t('refusal.memberViaSpace')],
    ['concurrent_change', {}, () => t('refusal.concurrentChange')],
    ['force_unlock_forbidden', {}, () => t('refusal.forceUnlockForbidden')],
    ['storage_quota', { spaceId: 'k3x9p2qa', storageUsedBytes: 10, storageQuotaBytes: 5 }, () => t('refusal.storageQuota')],
    ['project_quota', { spaceId: 'k3x9p2qa', projectCount: 3, projectQuota: 3 }, () => t('refusal.projectQuota')],
    [
      'ambiguous_project',
      {
        q: 'Backend',
        candidates: [
          { idPrefix: 'api', name: 'Backend', spaceId: 'k3x9p2qa', spaceName: 'Acme' },
          { idPrefix: 'be', name: 'Backend', spaceId: 'p0aa11bb', spaceName: 'Личное' },
        ],
      },
      () =>
        t('refusal.ambiguousProject', {
          candidates: [
            t('refusal.ambiguousProjectCandidate', { prefix: 'api', space: 'Acme' }),
            t('refusal.ambiguousProjectCandidate', { prefix: 'be', space: 'Личное' }),
          ].join(', '),
        }),
    ],
  ];

  test.each(CODES)('%s → its own words in the toast, not the server message', async (code, extra, words) => {
    refuseWith(new BusinessError(422, RAW, code, extra));
    const user = userEvent.setup();
    mountCard();
    await pickPriority(user, 0);

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    const text = toast.error.mock.calls[0][0] as string;
    expect(text).toBe(t('editable.fieldSaveFailed', { message: words() }));
    expect(text).not.toContain(RAW);
  });

  test('the codes are told apart: no two of them share a message', () => {
    // The product's own wording of each code, not the dictionary.
    const tDetails = i18n.getFixedT(null, 'details');
    const messages = CODES.map(([code, extra]) => refusalReason(new BusinessError(422, RAW, code, extra), tDetails));
    expect(messages.every((m) => m !== null && m !== RAW)).toBe(true);
    expect(new Set(messages).size).toBe(messages.length);
  });

  test('an unknown code keeps the server message, as before', async () => {
    refuseWith(new BusinessError(422, RAW, 'something_else'));
    const user = userEvent.setup();
    mountCard();
    await pickPriority(user, 0);
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error.mock.calls[0][0]).toBe(t('editable.fieldSaveFailed', { message: RAW }));
  });
});

describe('row 246 — the space’s attachment quota, told at the upload zone (US-14)', () => {
  async function dropFile() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MantineProvider>
        <QueryClientProvider client={qc}>
          <AttachmentDropzone issueId={ID} />
        </QueryClientProvider>
      </MantineProvider>,
    );
    const input = screen.getByTestId('attachment-file-input') as HTMLInputElement;
    const file = new File(['x'], 'report.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => {
      fireEvent.change(input);
      await Promise.resolve();
    });
    return screen.findByRole('alert');
  }

  test('storage_quota with the quota → the quota title and the quota in the detail, not the server message', async () => {
    upload.uploadAttachment.mockRejectedValue(
      new BusinessError(422, RAW, 'storage_quota', {
        spaceId: 'k3x9p2qa',
        storageUsedBytes: 5 * 1024 * 1024 * 1024 + 1,
        storageQuotaBytes: 5 * 1024 * 1024 * 1024,
      }),
    );
    const alert = await dropFile();
    expect(alert.textContent).toContain(i18n.t('attachments:upload.errors.storageQuota'));
    // The quota the refusal names (5 GiB) is in the detail.
    expect(alert.textContent).toContain('5.00 GB');
    expect(alert.textContent).not.toContain(i18n.t('attachments:upload.errors.generic'));
    expect(alert.textContent).not.toContain(RAW);
  });

  test('storage_quota without the quota → the same title, the detail without a number', async () => {
    upload.uploadAttachment.mockRejectedValue(new BusinessError(422, RAW, 'storage_quota', {}));
    const alert = await dropFile();
    expect(alert.textContent).toContain(i18n.t('attachments:upload.errors.storageQuota'));
    expect(alert.textContent).toContain(i18n.t('attachments:upload.errors.storageQuotaDetailBare'));
  });
});
