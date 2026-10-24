/**
 * sk-674.18 T055 — "Release the lock" (spec US-16;
 * screens 1.10, K4).
 *
 * The button stands beside the claim mark of the card's properties row
 * exactly when the card says the caller may release another holder's
 * claim (`canForceUnlock`) and the caller is not the holder: the project
 * owner, the space owner and the admin see it; the holder releases their
 * own claim as before and does not. Absent `canForceUnlock` (an api that
 * does not serve it yet) is «may not».
 *
 * Driven through the real `IssuePropertiesRow`; the release goes to a
 * stubbed `POST …/unlock`, whose answer — the card — replaces the cached
 * one.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '../../../i18n/config';

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('../../../components/Toaster', () => ({
  useToaster: () => ({ error: toastError, success: toastSuccess, info: vi.fn() }),
}));
vi.mock('../../../auth/AuthContext', () => ({
  useAuthOptional: () => ({ user: { id: 'u-own', username: 'olga', role: 'user' } }),
}));
vi.mock('../../../lib/useProjectComponentNames', () => ({
  useProjectComponentNames: () => ({ status: 'success', names: [] }),
}));

import type { IssueDetail } from '../../../api/issues';
import { issueDetailKey } from '../../../lib/useIssueDetail';
import { IssuePropertiesRow } from './sections/IssuePropertiesRow';

const PROJECT = 'p-uuid';
let qc: QueryClient;
/** The answer to POST …/unlock. */
let unlockAnswer: { status: number; body: unknown };

function claimed(over: Partial<IssueDetail> = {}): IssueDetail {
  return {
    id: 'sk-42',
    projectId: PROJECT,
    version: 3,
    title: 't',
    description: '',
    type: 'task',
    priority: 2,
    status: 'in_progress',
    pinned: false,
    source: 'human',
    design: '',
    acceptanceCriteria: '',
    notes: '',
    createdBy: 'u-x',
    createdAt: '2026-10-01T10:00:00Z',
    updatedAt: '2026-10-12T12:40:00Z',
    metadata: {},
    componentIds: [],
    labels: [],
    commentsCount: 0,
    commitRefs: [],
    mentions: [],
    isBlocked: false,
    blockers: [],
    lockedBy: 'mcp-session-1',
    lockedByUsername: 'oleg',
    lockedAt: '2026-10-12T12:40:00Z',
    ...over,
  } as IssueDetail;
}

function mount(value: IssueDetail) {
  qc.setQueryData(issueDetailKey(value.id), value);
  return render(
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <IssuePropertiesRow
            issue={value}
            projectId={value.projectId}
            dependencies={{ outgoing: [], incoming: [] }}
            dependenciesStatus="success"
          />
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

const releaseButton = () => screen.queryByRole('button', { name: i18n.t('details:forceUnlock.button') });
const confirmButton = () => screen.getByRole('button', { name: i18n.t('details:forceUnlock.confirmLabel') });

beforeEach(async () => {
  await i18n.changeLanguage('ru');
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  toastError.mockClear();
  toastSuccess.mockClear();
  unlockAnswer = { status: 200, body: claimed({ lockedBy: null, lockedByUsername: null, lockedAt: null, version: 4 }) };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify(unlockAnswer.body), {
        status: unlockAnswer.status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('row 244 — the button is there exactly for those who may release another holder’s claim', () => {
  test.each<[string, Partial<IssueDetail>, boolean]>([
    ['may release, another holder', { canForceUnlock: true }, true],
    ['may release, another holder without a name', { canForceUnlock: true, lockedByUsername: null }, true],
    ['may release, but holds it itself', { canForceUnlock: true, lockedByUsername: 'Olga' }, false],
    ['may not release', { canForceUnlock: false }, false],
    ['the card does not say (absent)', {}, false],
    ['may release, nothing is claimed', { canForceUnlock: true, lockedBy: null, lockedByUsername: null, lockedAt: null }, false],
  ])('%s → button %s', (_case, over, shown) => {
    mount(claimed(over));
    expect(releaseButton() !== null).toBe(shown);
  });

  test('the button sits beside the claim mark: in the same item of the row', () => {
    mount(claimed({ canForceUnlock: true }));
    const claimMark = screen.getByText(i18n.t('details:properties.claimedBy', { name: 'oleg' }));
    const item = claimMark.closest('[role="listitem"]') as HTMLElement;
    expect(within(item).getByRole('button', { name: i18n.t('details:forceUnlock.button') })).toBeTruthy();
  });
});

describe('row 244 — releasing', () => {
  test('asks first naming the holder; on yes the claim is released and the card replaced by the server’s', async () => {
    mount(claimed({ canForceUnlock: true }));
    fireEvent.click(releaseButton()!);
    const [before, after] = i18n.t('details:forceUnlock.confirm', { name: 'oleg', time: '\u0000' }).split('\u0000');
    expect(await screen.findByText((text) => text.startsWith(before) && text.endsWith(after))).toBeTruthy();
    // Nothing is sent before the answer.
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(confirmButton());
    });
    await vi.waitFor(() => expect(toastSuccess).toHaveBeenCalled());

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain(`/api/v1/projects/${PROJECT}/issues/sk-42/unlock`);
    expect(init?.method).toBe('POST');
    expect(qc.getQueryData<IssueDetail>(issueDetailKey('sk-42'))?.lockedByUsername).toBeNull();
  });

  test('a refusal is worded by its code', async () => {
    unlockAnswer = { status: 422, body: { error: 'force_unlock_forbidden', message: 'forbidden' } };
    mount(claimed({ canForceUnlock: true }));
    fireEvent.click(releaseButton()!);
    await act(async () => {
      await screen.findByRole('dialog');
      fireEvent.click(confirmButton());
    });
    await vi.waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(i18n.t('details:refusal.forceUnlockForbidden')),
    );
  });
});
