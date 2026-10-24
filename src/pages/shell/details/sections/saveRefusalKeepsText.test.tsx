/**
 * sk-425 — a refused save of an editable text on the card keeps the typed
 * text, says why, and offers a retry.
 *
 * Real `useIssueDetail` (optimistic write + rollback on refusal) and the real
 * editors, wired to `detail.updateField` the way `IssueDetailPanel` wires
 * them: the four sections on `EditableTextSection` and the title on
 * `IssueTitleEdit`. `api/issues` is mocked: `getIssue` serves the fixture,
 * `patchIssue` answers with the API's real refusals (skein-api
 * `handler/issues.go`, what `apiFetch` turns a 422 into):
 *
 *   - `locked_by_other` — 422 `{error, message, lockedBy: <session id>}`,
 *     every REST save of a claimed issue;
 *   - `version_conflict` — 422, someone saved first;
 *   - a plain server failure — 500.
 *
 * The refusal arrives after a macrotask, like a network answer: a
 * synchronous rejection folds the optimistic write and its rollback into one
 * notification and would hide the very step that used to wipe the text
 * (see the note in designSection.test.tsx).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ApiError, BusinessError } from '../../../../api/client';
import type { PatchIssueInput } from '../../../../api/issues';
import i18n, { DEFAULT_LANGUAGE } from '../../../../i18n/config';

const PID = 'proj-refusal';
const ID = 'sk-77';
const HOLDER = 'agent-bob';
const SESSION = 'mcp-session-0000-secret';

const api = vi.hoisted(() => ({
  server: {} as Record<string, unknown>,
  patchIssue: vi.fn(),
  getIssue: vi.fn(),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock('../../../../api/issues', async (importActual) => {
  const actual = await importActual<typeof import('../../../../api/issues')>();
  return {
    ...actual,
    getIssue: (...args: unknown[]) => api.getIssue(...args),
    patchIssue: (...args: unknown[]) => api.patchIssue(...args),
    listComments: () => Promise.resolve([]),
  };
});
vi.mock('../../../../api/activity', () => ({
  listIssueActivity: () => Promise.resolve({ items: [], nextCursor: null }),
}));
vi.mock('../../../../api/attachments', () => ({
  listAttachments: () => Promise.resolve({ items: [] }),
}));
vi.mock('../../../../api/dependencies', () => ({
  listDependencies: () => Promise.resolve({ outgoing: [], incoming: [] }),
}));
vi.mock('../../../../api/watchers', () => ({
  listIssueWatchers: () => Promise.resolve([]),
}));
vi.mock('../../../../components/Toaster', () => ({
  useToaster: () => toast,
}));

import { isSaveFailure, useIssueDetail } from '../../../../lib/useIssueDetail';
import { EditableTextSection } from './EditableTextSection';
import { IssueTitleEdit } from '../IssueTitleEdit';

type Field = 'description' | 'acceptanceCriteria' | 'notes' | 'design';
const FIELDS: Field[] = ['description', 'acceptanceCriteria', 'notes', 'design'];

/** `acceptanceCriteria` starts EMPTY: the collapsed «Add» path is covered too. */
const SERVER_TEXT: Record<Field, string> = {
  description: 'server description text',
  acceptanceCriteria: '',
  notes: 'server notes text',
  design: 'server design text',
};

const ADD_LABEL: Record<Field, string> = {
  description: 'addDescription',
  acceptanceCriteria: 'addAcceptanceCriteria',
  notes: 'addNotes',
  design: 'addDesign',
};

function fixture(): Record<string, unknown> {
  return {
    id: ID,
    projectId: PID,
    version: 3,
    title: 'server title',
    ...SERVER_TEXT,
    type: 'task',
    priority: 2,
    status: 'in_progress',
    pinned: false,
    source: 'human',
    createdBy: 'u-1',
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
    lockedBy: SESSION,
    lockedByUsername: HOLDER,
  };
}

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(`details:${key}`, opts);

function Card() {
  const detail = useIssueDetail({ issueId: ID, projectHandle: PID });
  if (!detail.issue) return null;
  const issue = detail.issue;
  return (
    <>
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
      {FIELDS.map((field) => (
        <div key={field} data-testid={`field-${field}`}>
          <EditableTextSection
            title={t(`sections.${field}`)}
            field={field}
            emptyAddLabel={t(ADD_LABEL[field])}
            issue={issue}
            updateField={detail.updateField}
          />
        </div>
      ))}
    </>
  );
}

function mountCard() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MantineProvider>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </MantineProvider>
  );
  return render(<Card />, { wrapper });
}

type Scope = ReturnType<typeof within>;

async function scopeOf(view: ReturnType<typeof mountCard>, field: Field | 'title'): Promise<Scope> {
  return within(await view.findByTestId(`field-${field}`));
}

/** Open the editor (Edit, or «Add» on an empty section), type, leave. */
async function typeAndBlur(scope: Scope, field: Field, text: string) {
  const title = t(`sections.${field}`);
  const opener =
    SERVER_TEXT[field] === ''
      ? scope.getByRole('button', { name: t(ADD_LABEL[field]) })
      : scope.getByRole('button', { name: t('editable.editAria', { title }) });
  fireEvent.click(opener);
  const textarea = await waitFor(() => scope.getByRole('textbox') as HTMLTextAreaElement);
  // sk-493 — type only once the editor HAS focus, as a person does. «Edit»
  // focuses the textarea on the next animation frame (`enterEdit`); typing
  // and blurring before that frame, as this helper used to, let the deferred
  // focus land AFTER the blur — back into an editor the "user" had already
  // left, whenever the refusal had remounted it by then. A focused editor
  // rightly stays open, so a later successful Retry did not close it: the
  // Retry test went red whenever the frame lost that race (~1 run in 3).
  await waitFor(() => expect(document.activeElement).toBe(textarea));
  await act(async () => {
    fireEvent.change(textarea, { target: { value: text } });
  });
  await act(async () => {
    fireEvent.blur(textarea);
  });
}

/** A refusal delivered a macrotask later, like a network answer. */
function refuseWith(err: Error) {
  api.patchIssue.mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        setTimeout(() => reject(err), 0);
      }),
  );
}

function acceptPatches() {
  api.patchIssue.mockImplementation(
    async (_pid: string, _id: string, _version: number, patch: PatchIssueInput) => {
      api.server = { ...api.server, ...patch, version: (api.server.version as number) + 1 };
      return { ...api.server };
    },
  );
}

const LOCKED = () =>
  new BusinessError(422, 'issue is locked by another session', 'locked_by_other', {
    lockedBy: SESSION,
  });
const CONFLICT = () =>
  new BusinessError(422, 'the issue was modified since you read it', 'version_conflict');
const SERVER_DOWN = () => new ApiError(500, 'internal error');

const REFUSALS = [
  ['locked_by_other', LOCKED, () => t('editable.reason.lockedBy', { user: HOLDER })],
  ['version_conflict', CONFLICT, () => t('editable.reason.versionConflict')],
  ['server error', SERVER_DOWN, () => 'internal error'],
] as const;

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

describe.each(FIELDS)('sk-425 — «%s»: a refused save keeps the typed text', (field) => {
  for (const [name, error, reason] of REFUSALS) {
    test(`${name}: the editor stays open on the typed text, marked unsaved, with the reason`, async () => {
      refuseWith(error());
      const view = mountCard();
      const scope = await scopeOf(view, field);
      const typed = `typed ${field} text`;

      await typeAndBlur(scope, field, typed);

      const alert = await waitFor(() => scope.getByRole('alert'));
      expect(alert.textContent).toBe(t('editable.saveFailed', { message: reason() }));
      // The session id of the claim is never shown.
      expect(view.container.textContent).not.toContain(SESSION);
      // The typed text is still in the editor — after blur, rollback and refusal.
      const textarea = scope.getByRole('textbox') as HTMLTextAreaElement;
      expect(textarea.value).toBe(typed);
      expect(scope.getByText(t('editable.unsaved'))).toBeTruthy();
      // sk-492 — said once: the line under the editor, no toast beside it.
      expect(toast.error).not.toHaveBeenCalled();
    });
  }

  test('Retry after the claim is released saves the kept text; the editor closes on it', async () => {
    refuseWith(LOCKED());
    const view = mountCard();
    const scope = await scopeOf(view, field);
    const typed = `typed ${field} text`;
    await typeAndBlur(scope, field, typed);
    await waitFor(() => scope.getByRole('alert'));

    acceptPatches();
    fireEvent.click(
      scope.getByRole('button', {
        name: t('editable.retryAria', { title: t(`sections.${field}`) }),
      }),
    );

    await waitFor(() => expect(scope.queryByRole('alert')).toBeNull());
    expect(api.patchIssue).toHaveBeenLastCalledWith(PID, ID, 3, { [field]: typed });
    await waitFor(() => expect(scope.queryByRole('textbox')).toBeNull());
    expect(scope.getByText(typed)).toBeTruthy();
    expect(scope.queryByText(t('editable.unsaved'))).toBeNull();
  });

  test('version conflict: the card is re-read, and Retry goes out against the new version', async () => {
    refuseWith(CONFLICT());
    const view = mountCard();
    const scope = await scopeOf(view, field);
    const typed = `typed ${field} text`;
    // Someone else saved first: the server is at version 4 now.
    api.server = { ...api.server, version: 4, [field]: `their ${field} text` };
    await typeAndBlur(scope, field, typed);
    await waitFor(() => scope.getByRole('alert'));
    await waitFor(() => expect(api.getIssue.mock.calls.length).toBeGreaterThanOrEqual(2));
    // The re-read brought THEIR text in; the draft is still ours.
    await waitFor(() => expect((scope.getByRole('textbox') as HTMLTextAreaElement).value).toBe(typed));

    acceptPatches();
    fireEvent.click(
      scope.getByRole('button', {
        name: t('editable.retryAria', { title: t(`sections.${field}`) }),
      }),
    );

    await waitFor(() => expect(scope.queryByRole('alert')).toBeNull());
    expect(api.patchIssue).toHaveBeenLastCalledWith(PID, ID, 4, { [field]: typed });
  });

  test('going back into the refused draft and typing keeps the editor (the error clears, the text does not vanish)', async () => {
    refuseWith(LOCKED());
    const view = mountCard();
    const scope = await scopeOf(view, field);
    await typeAndBlur(scope, field, `typed ${field} text`);
    await waitFor(() => scope.getByRole('alert'));

    const textarea = scope.getByRole('textbox') as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.focus(textarea);
      fireEvent.change(textarea, { target: { value: `typed ${field} text, more` } });
    });

    expect(scope.queryByRole('alert')).toBeNull();
    expect((scope.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
      `typed ${field} text, more`,
    );
  });
});

describe('sk-425 — the title editor, on the same updateField', () => {
  for (const [name, error, reason] of REFUSALS) {
    test(`${name}: the typed title stays, with the reason`, async () => {
      refuseWith(error());
      const view = mountCard();
      const scope = await scopeOf(view, 'title');
      const textarea = scope.getByRole('textbox') as HTMLTextAreaElement;

      await act(async () => {
        fireEvent.change(textarea, { target: { value: 'typed title' } });
      });
      await act(async () => {
        fireEvent.blur(textarea);
      });

      const alert = await waitFor(() => scope.getByRole('alert'));
      expect(alert.textContent).toBe(t('title.saveFailed', { message: reason() }));
      expect((scope.getByRole('textbox') as HTMLTextAreaElement).value).toBe('typed title');
    });
  }
});

describe('sk-425 — the claim holder is named only when the card knows it', () => {
  test('no lockedByUsername on the card → «another session», never the session id', async () => {
    api.server = { ...fixture(), lockedByUsername: undefined };
    refuseWith(LOCKED());
    const view = mountCard();
    const scope = await scopeOf(view, 'notes');
    await typeAndBlur(scope, 'notes', 'typed notes text');

    const alert = await waitFor(() => scope.getByRole('alert'));
    expect(alert.textContent).toBe(
      t('editable.saveFailed', { message: t('editable.reason.locked') }),
    );
    expect(view.container.textContent).not.toContain(SESSION);
  });

  test('ru: the same reason, translated', async () => {
    await i18n.changeLanguage('ru');
    refuseWith(LOCKED());
    const view = mountCard();
    const scope = await scopeOf(view, 'notes');
    await typeAndBlur(scope, 'notes', 'typed text');

    const alert = await waitFor(() => scope.getByRole('alert'));
    expect(alert.textContent).toBe(
      `не удалось сохранить — задачу захватил ${HOLDER}; правки не принимаются, пока захват не снят`,
    );
    expect((scope.getByRole('textbox') as HTMLTextAreaElement).value).toBe('typed text');
  });
});
