/**
 * sk-421.1 T017 — harness (2): «Design» behaves like
 * «Notes» on the shared `updateField`, under one fixture.
 *
 * Real `useIssueDetail` + real `EditableTextSection` for BOTH fields, each
 * wired to `detail.updateField` the way the panel wires them. `api/issues` is
 * mocked (`getIssue` serves the fixture, `patchIssue` is a spy); the hook's
 * other reads resolve empty; `toast.error` is one module-level spy.
 *
 * What is pinned, for `notes` and `design` alike:
 *   - success: the save sends exactly `patchIssue(pid, id, version, {<field>})`
 *     — no other key — and the section shows the new text;
 *   - refusal (version conflict; a claimed issue is refused the same way):
 *     no toast (sk-492 — the reason is said once, under the editor), and
 *     the typed text STAYS in the editor, marked unsaved, with
 *     the reason. Until sk-425 the text was lost here (US-9, NC-2a, inherited
 *     on purpose); sk-425 fixed it for every editable section — its full
 *     contract is in saveRefusalKeepsText.test.tsx, and this row keeps only
 *     the parity of the two fields;
 *   - no «Save» / «Cancel» buttons, in en and ru.
 *
 * Panel wiring (that the panel passes `detail.updateField` to «Design» at
 * all) is NOT visible here — this harness wires the handler itself. That half
 * lives in sectionOrder.test.tsx (row 56 (1)).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ApiError } from '../../../../api/client';
import type { PatchIssueInput } from '../../../../api/issues';
import i18n, { DEFAULT_LANGUAGE } from '../../../../i18n/config';

const PID = 'proj-design';
const ID = 'sk-55';

const api = vi.hoisted(() => ({
  server: {} as Record<string, unknown>,
  patchIssue: vi.fn(),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock('../../../../api/issues', async (importActual) => {
  const actual = await importActual<typeof import('../../../../api/issues')>();
  return {
    ...actual,
    getIssue: () => Promise.resolve({ ...api.server }),
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

import { useIssueDetail } from '../../../../lib/useIssueDetail';
import { EditableTextSection } from './EditableTextSection';

type Field = 'notes' | 'design';

const SERVER_TEXT: Record<Field, string> = {
  notes: 'server notes text',
  design: 'server design text',
};

function fixture(): Record<string, unknown> {
  return {
    id: ID,
    projectId: PID,
    version: 3,
    title: 'task',
    description: '',
    type: 'task',
    priority: 2,
    status: 'open',
    pinned: false,
    source: 'human',
    design: SERVER_TEXT.design,
    acceptanceCriteria: '',
    notes: SERVER_TEXT.notes,
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
  };
}

/** Both text sections, wired to the hook's handler as the panel does. */
function Card() {
  const detail = useIssueDetail({ issueId: ID, projectHandle: PID });
  if (!detail.issue) return null;
  const t = (key: string) => i18n.t(`details:${key}`);
  return (
    <>
      <div data-testid="field-notes">
        <EditableTextSection
          title={t('sections.notes')}
          field="notes"
          emptyAddLabel={t('addNotes')}
          issue={detail.issue}
          updateField={detail.updateField}
        />
      </div>
      <div data-testid="field-design">
        <EditableTextSection
          title={t('sections.design')}
          field="design"
          emptyAddLabel={t('addDesign')}
          issue={detail.issue}
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
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </MantineProvider>
  );
  return render(<Card />, { wrapper });
}

async function scopeOf(view: ReturnType<typeof mountCard>, field: Field) {
  return within(await view.findByTestId(`field-${field}`));
}

function sectionTitle(field: Field): string {
  return i18n.t(`details:sections.${field}`);
}

/** Open the editor, type, leave the field — the section's own save path. */
async function typeAndBlur(scope: ReturnType<typeof within>, field: Field, text: string) {
  const edit = scope.getByRole('button', {
    name: i18n.t('details:editable.editAria', { title: sectionTitle(field) }),
  });
  fireEvent.click(edit);
  const textarea = await waitFor(() => {
    const el = scope.getByRole('textbox');
    return el as HTMLTextAreaElement;
  });
  // sk-493 — the same order a person keeps: type only after «Edit»'s
  // deferred focus has landed (see saveRefusalKeepsText.test.tsx#typeAndBlur).
  await waitFor(() => expect(document.activeElement).toBe(textarea));
  await act(async () => {
    fireEvent.change(textarea, { target: { value: text } });
  });
  await act(async () => {
    fireEvent.blur(textarea);
  });
}

beforeEach(() => {
  api.server = fixture();
  api.patchIssue.mockReset();
  toast.error.mockReset();
  toast.success.mockReset();
});

afterEach(async () => {
  cleanup();
  if (i18n.language !== DEFAULT_LANGUAGE) {
    await i18n.changeLanguage(DEFAULT_LANGUAGE);
  }
});

describe.each(['notes', 'design'] as Field[])('«%s» on the shared updateField (row 56 (2))', (field) => {
  test('save sends exactly {<field>} with the version; the section shows the new text', async () => {
    api.patchIssue.mockImplementation(
      async (_pid: string, _id: string, _version: number, patch: PatchIssueInput) => ({
        ...api.server,
        ...patch,
        version: 4,
      }),
    );
    const view = mountCard();
    const scope = await scopeOf(view, field);

    await typeAndBlur(scope, field, `new ${field} text`);

    await waitFor(() => expect(api.patchIssue).toHaveBeenCalledTimes(1));
    // Exactly this field — no other key rides along (SC-009: only this field changes).
    expect(api.patchIssue).toHaveBeenCalledWith(PID, ID, 3, { [field]: `new ${field} text` });
    await waitFor(() => expect(scope.getByText(`new ${field} text`)).toBeTruthy());
    expect(toast.error).not.toHaveBeenCalled();
  });

  test('refusal: the typed text stays in the editor marked unsaved, with the reason (sk-425), and no toast beside it (sk-492)', async () => {
    // The refusal arrives LATER, like a real network answer — after a
    // macrotask, not in the same tick. A synchronous rejection collapses the
    // optimistic write and its rollback into one TanStack notification: the
    // optimistic value never renders and the editor's external-change sync
    // never sees it — the very step that used to wipe the draft.
    api.patchIssue.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          setTimeout(() => reject(new ApiError(409, 'version conflict', 'version_conflict')), 0);
        }),
    );
    const view = mountCard();
    const scope = await scopeOf(view, field);

    await typeAndBlur(scope, field, `typed ${field} text`);

    // sk-425 — the draft survives the rollback: the editor stays open on it,
    // marked unsaved, and the heading row says why. The full contract (every
    // section, the claim refusal, Retry) is in saveRefusalKeepsText.test.tsx;
    // this row only pins that «Design» and «Notes» behave alike.
    const alert = await waitFor(() => scope.getByRole('alert'));
    expect(alert.textContent).toBe(
      i18n.t('details:editable.saveFailed', {
        message: i18n.t('details:editable.reason.versionConflict'),
      }),
    );
    expect((scope.getByRole('textbox') as HTMLTextAreaElement).value).toBe(`typed ${field} text`);
    expect(scope.getByText(i18n.t('details:editable.unsaved'))).toBeTruthy();
    // sk-492 — the reason is said once: the line under the editor, no toast.
    expect(api.patchIssue).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  test.each(['en', 'ru'])('no «Save» / «Cancel» buttons (%s), in read and in edit mode', async (lang) => {
    await i18n.changeLanguage(lang);
    const view = mountCard();
    const scope = await scopeOf(view, field);
    const saveOrCancel = /save|cancel|сохранить|отмена|отменить/i;

    expect(scope.queryByRole('button', { name: saveOrCancel })).toBeNull();

    fireEvent.click(
      scope.getByRole('button', {
        name: i18n.t('details:editable.editAria', { title: sectionTitle(field) }),
      }),
    );
    await waitFor(() => expect(scope.getByRole('textbox')).toBeTruthy());
    expect(scope.queryByRole('button', { name: saveOrCancel })).toBeNull();
  });
});
