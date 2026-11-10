/**
 * The API keys page (US-10, SC-010, SC-023).
 *
 * The owner creates a key with permissions (a preset, a level, or only
 * `admin`), a scope (projects, spaces, everything) and a lifetime; the
 * secret is shown once. Each row shows the expiry as a date and the time
 * left, the status with its reason and the permissions the owner no longer
 * holds. A key is narrowed in place, reissued and revoked — each through
 * its own client call; widening is never offered in place. The "Public
 * API" block has three states: turned off, on without an address, on with
 * one (the `openapi.json` link).
 *
 * The request bodies are the cabinet contract of skein-api
 * (`/ui/v1/me/api-keys*`): permissions `{level, admin}`, scope
 * `{mode, projects | spaces}` with project UUIDs and space short ids, an
 * optional `expiresAt`. Elements are found by role and accessible name.
 */
import { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../../../i18n/config';
import type { ApiKey, ApiKeyCreateResponse, ApiKeysSettings } from '../../../api/api-keys';
import { ApiError, BusinessError } from '../../../api/client';

const api = vi.hoisted(() => ({
  listApiKeys: vi.fn(),
  createApiKey: vi.fn(),
  narrowApiKey: vi.fn(),
  reissueApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
  getApiKeysSettings: vi.fn(),
}));
const who = vi.hoisted(() => ({ role: 'user' }));

vi.mock('../../../api/api-keys', () => api);

vi.mock('../../../auth/AuthContext', () => ({
  useAuthOptional: () => null,
  useAuth: () => ({
    user: { id: 'u-1', username: 'alice', role: who.role },
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock('../../../lib/useAuthConfig', () => ({
  useAuthConfig: () => ({ isSuccess: true, isError: false, data: { mcpUrl: null } }),
}));

const PROJECT_A = '0193aaaa-0000-7000-8000-00000000000a';
const PROJECT_B = '0193bbbb-0000-7000-8000-00000000000b';

const PROJECT_C = '0193cccc-0000-7000-8000-00000000000c';
const PROJECTS = [
  { id: PROJECT_A, name: 'Alpha', spaceId: 'k3x9p2qa' },
  { id: PROJECT_B, name: 'Beta', spaceId: 'm7y2q4rb' },
  { id: PROJECT_C, name: 'Gamma', spaceId: 'm7y2q4rb' },
];

/**
 * The picker hook, answered from PROJECTS: the search and the space
 * narrow the rows as the server would. Its own request (active projects,
 * no lens, pages) is `src/lib/__tests__/useProjectsPicker.test.tsx`.
 */
const picker = vi.hoisted(() => ({
  calls: [] as Array<{ query: string; space?: string; enabled?: boolean }>,
  hasNextPage: false,
  fetchNextPage: vi.fn(),
}));
vi.mock('../../../lib/useProjectsList', () => ({
  useProjectsPicker: (query: string, opts: { space?: string; enabled?: boolean } = {}) => {
    picker.calls.push({ query, ...opts });
    const q = query.trim().toLowerCase();
    const items =
      opts.enabled === false
        ? []
        : PROJECTS.filter((p) => (!opts.space || p.spaceId === opts.space) && p.name.toLowerCase().includes(q));
    return {
      items,
      total: items.length,
      isLoading: false,
      isFetching: false,
      isFetchingNextPage: false,
      isError: false,
      hasNextPage: picker.hasNextPage,
      fetchNextPage: picker.fetchNextPage,
    };
  },
}));

vi.mock('../../../lib/useMySpaces', () => ({
  useMySpaces: () => ({
    data: {
      items: [
        { id: 'k3x9p2qa', name: 'Acme' },
        { id: 'm7y2q4rb', name: 'Lab' },
      ],
    },
  }),
}));

import { NewApiKeysPage } from './ApiKeysPage';

const tk = (key: string, opts?: Record<string, unknown>) => i18n.t(`settings:keys.${key}`, opts);

const SETTINGS: ApiKeysSettings = {
  publicApiEnabled: true,
  publicApiUrl: 'https://api.example.net',
  openApiUrl: 'https://api.example.net/api/v1/openapi.json',
  defaultTtlSeconds: 90 * 86400,
  maxTtlSeconds: 365 * 86400,
};

function key(over: Partial<ApiKey> = {}): ApiKey {
  return {
    id: 'k-1',
    label: 'ci-runner',
    prefix: 'ska_AbCdEfGh',
    createdAt: '2026-01-01T09:00:00Z',
    expiresAt: '2099-01-01T09:00:00Z',
    lastUsedAt: null,
    revokedAt: null,
    status: 'active',
    statusReason: null,
    permissions: { level: 'write', admin: false },
    scope: { mode: 'all', projects: [], spaces: [] },
    unavailablePermissions: [],
    reissuedFromId: null,
    ...over,
  };
}

function created(over: Partial<ApiKeyCreateResponse> = {}): ApiKeyCreateResponse {
  return { ...key({ id: 'k-new', label: 'new-key' }), plainKey: 'ska_SECRETVALUE0123456789', ...over };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MantineProvider>
      <MemoryRouter>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </MemoryRouter>
    </MantineProvider>
  );
  return render(<NewApiKeysPage />, { wrapper });
}

async function openCreateForm() {
  const button = await screen.findByRole('button', { name: tk('list.newKey') });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
  return screen.findByRole('form', { name: tk('form.createAria') });
}

function typeLabel(form: HTMLElement, value: string) {
  fireEvent.change(within(form).getByRole('textbox', { name: tk('form.label') }), {
    target: { value },
  });
}

async function rowOf(label: string): Promise<HTMLElement> {
  const table = await screen.findByRole('table');
  const row = within(table)
    .getAllByRole('row')
    .find((r) => within(r).queryByText(label) !== null);
  if (!row) throw new Error(`no row for ${label}`);
  return row;
}

/** The cell of a row under a column header. */
function cellOf(row: HTMLElement, header: string): HTMLElement {
  const table = row.closest('table')!;
  const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
  const index = headers.indexOf(header);
  expect(index, `no column ${header}`).toBeGreaterThanOrEqual(0);
  return within(row).getAllByRole('cell')[index];
}

beforeEach(() => {
  vi.clearAllMocks();
  who.role = 'user';
  picker.calls = [];
  picker.hasNextPage = false;
  api.listApiKeys.mockResolvedValue([]);
  api.getApiKeysSettings.mockResolvedValue(SETTINGS);
  api.createApiKey.mockResolvedValue(created());
  api.narrowApiKey.mockResolvedValue(key());
  api.reissueApiKey.mockResolvedValue(created({ id: 'k-2', label: 'ci-runner', plainKey: 'ska_REISSUEDSECRET0000000' }));
  api.revokeApiKey.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('US-10 — creating a key', () => {
  it('a preset sends its level, the whole scope and no expiry (the default lifetime)', async () => {
    renderPage();
    const form = await openCreateForm();
    typeLabel(form, 'deploy-bot');
    fireEvent.click(within(form).getByRole('radio', { name: new RegExp(tk('preset.write')) }));
    fireEvent.click(within(form).getByRole('button', { name: tk('form.create') }));

    await waitFor(() => expect(api.createApiKey).toHaveBeenCalledTimes(1));
    const body = api.createApiKey.mock.calls[0][0];
    expect(body).toEqual({
      label: 'deploy-bot',
      permissions: { level: 'write', admin: false },
      scope: { mode: 'all' },
    });
    expect('expiresAt' in body).toBe(false);
    expect(api.narrowApiKey).not.toHaveBeenCalled();
    expect(api.reissueApiKey).not.toHaveBeenCalled();
  });

  it('a level picked by hand, limited to chosen projects', async () => {
    renderPage();
    const form = await openCreateForm();
    typeLabel(form, 'pm');
    fireEvent.click(within(form).getByRole('radio', { name: tk('preset.custom') }));
    fireEvent.click(within(form).getByRole('radio', { name: tk('level.manage') }));
    fireEvent.click(within(form).getByRole('radio', { name: tk('scopeMode.projects') }));
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Alpha' }));
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Beta' }));
    fireEvent.click(within(form).getByRole('button', { name: tk('form.create') }));

    await waitFor(() => expect(api.createApiKey).toHaveBeenCalledTimes(1));
    expect(api.createApiKey.mock.calls[0][0]).toMatchObject({
      permissions: { level: 'manage', admin: false },
      scope: { mode: 'projects', projects: [PROJECT_A, PROJECT_B] },
    });
  });

  it('projects are found by search; a chosen project stays chosen when the search changes', async () => {
    renderPage();
    const form = await openCreateForm();
    typeLabel(form, 'beta-only');
    fireEvent.click(within(form).getByRole('radio', { name: tk('scopeMode.projects') }));
    const search = within(form).getByRole('searchbox', { name: tk('form.projectSearch') });
    fireEvent.change(search, { target: { value: 'bet' } });
    await waitFor(() => expect(within(form).queryByRole('checkbox', { name: 'Alpha' })).toBeNull());
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Beta' }));
    fireEvent.change(search, { target: { value: 'alp' } });
    await within(form).findByRole('checkbox', { name: 'Alpha' });
    expect((within(form).getByRole('checkbox', { name: 'Beta' }) as HTMLInputElement).checked).toBe(true);
    expect(picker.calls.some((c) => c.query === 'alp' && c.space === undefined)).toBe(true);
    fireEvent.click(within(form).getByRole('button', { name: tk('form.create') }));

    await waitFor(() => expect(api.createApiKey).toHaveBeenCalledTimes(1));
    expect(api.createApiKey.mock.calls[0][0].scope).toEqual({ mode: 'projects', projects: [PROJECT_B] });
  });

  it('more projects than one page: the picker asks for the next page', async () => {
    picker.hasNextPage = true;
    renderPage();
    const form = await openCreateForm();
    fireEvent.click(within(form).getByRole('radio', { name: tk('scopeMode.projects') }));
    fireEvent.click(within(form).getByRole('button', { name: tk('form.loadMore') }));
    expect(picker.fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('chosen spaces go by their short id', async () => {
    renderPage();
    const form = await openCreateForm();
    typeLabel(form, 'lab-reader');
    fireEvent.click(within(form).getByRole('radio', { name: tk('scopeMode.spaces') }));
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Lab' }));
    fireEvent.click(within(form).getByRole('button', { name: tk('form.create') }));

    await waitFor(() => expect(api.createApiKey).toHaveBeenCalledTimes(1));
    expect(api.createApiKey.mock.calls[0][0]).toMatchObject({
      permissions: { level: 'read', admin: false },
      scope: { mode: 'spaces', spaces: ['m7y2q4rb'] },
    });
  });

  it('an instance admin creates a key with only admin; the scope is then everything', async () => {
    who.role = 'admin';
    renderPage();
    const form = await openCreateForm();
    typeLabel(form, 'user-sync');
    fireEvent.click(within(form).getByRole('radio', { name: tk('preset.custom') }));
    fireEvent.click(within(form).getByRole('radio', { name: tk('level.none') }));
    fireEvent.click(within(form).getByRole('checkbox', { name: new RegExp(tk('form.admin')) }));
    expect((within(form).getByRole('radio', { name: tk('scopeMode.projects') }) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(within(form).getByRole('button', { name: tk('form.create') }));

    await waitFor(() => expect(api.createApiKey).toHaveBeenCalledTimes(1));
    expect(api.createApiKey.mock.calls[0][0]).toMatchObject({
      permissions: { level: null, admin: true },
      scope: { mode: 'all' },
    });
  });

  it('a person who is not an instance admin is not offered admin', async () => {
    renderPage();
    const form = await openCreateForm();
    fireEvent.click(within(form).getByRole('radio', { name: tk('preset.custom') }));
    expect(within(form).queryByRole('checkbox', { name: new RegExp(tk('form.admin')) })).toBeNull();
  });

  it('a chosen date sends an expiry on that day', async () => {
    renderPage();
    const form = await openCreateForm();
    typeLabel(form, 'short-lived');
    fireEvent.click(within(form).getByRole('radio', { name: tk('form.expiryDate') }));
    const day = new Date(Date.now() + 10 * 86400 * 1000);
    const value = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    fireEvent.change(within(form).getByLabelText(tk('form.expiryDateLabel')), { target: { value } });
    fireEvent.click(within(form).getByRole('button', { name: tk('form.create') }));

    await waitFor(() => expect(api.createApiKey).toHaveBeenCalledTimes(1));
    const sent = new Date(api.createApiKey.mock.calls[0][0].expiresAt);
    expect(sent.getFullYear()).toBe(day.getFullYear());
    expect(sent.getMonth()).toBe(day.getMonth());
    expect(sent.getDate()).toBe(day.getDate());
    expect(sent.getTime()).toBeGreaterThan(Date.now());
  });

  it('the secret is shown once: in the reveal dialog, and nowhere after it is dismissed', async () => {
    api.listApiKeys.mockResolvedValueOnce([]).mockResolvedValue([key({ id: 'k-new', label: 'new-key' })]);
    renderPage();
    const form = await openCreateForm();
    typeLabel(form, 'new-key');
    fireEvent.click(within(form).getByRole('button', { name: tk('form.create') }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('ska_SECRETVALUE0123456789')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: new RegExp(i18n.t('secretReveal:copy')) }));
    const dismiss = within(dialog).getByRole('button', { name: new RegExp(i18n.t('secretReveal:dismiss')) });
    await waitFor(() => expect((dismiss as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(dismiss);

    await rowOf('new-key');
    await waitFor(() => expect(screen.queryByText('ska_SECRETVALUE0123456789')).toBeNull());
  });
});

describe('US-10 — the list', () => {
  it('the expiry is a date in local time and the time left', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-03T10:00:00Z'));
    api.listApiKeys.mockResolvedValue([key({ expiresAt: '2030-01-15T10:00:00Z' })]);
    renderPage();
    const cell = cellOf(await rowOf('ci-runner'), tk('list.colExpires'));
    // The date: the same moment, read in the reader's own clock.
    const moment = within(cell).getByText((_, el) => el?.tagName === 'TIME');
    expect(moment.getAttribute('datetime')).toBe('2030-01-15T10:00:00.000Z');
    const local = new Date('2030-01-15T10:00:00Z');
    expect(moment.textContent).toContain(String(local.getFullYear()));
    expect(moment.textContent).toContain(String(local.getDate()).padStart(2, '0'));
    // The time left, beside it: 12 days (15.01 − 03.01).
    expect((cell.textContent ?? '').replace(moment.textContent ?? '', '')).toMatch(/\b12\b/);
  });

  it('an inactive key shows why: revoked or expired', async () => {
    api.listApiKeys.mockResolvedValue([
      key({ id: 'k-r', label: 'old-revoked', status: 'inactive', statusReason: 'revoked', revokedAt: '2026-02-01T00:00:00Z' }),
      key({ id: 'k-e', label: 'old-expired', status: 'inactive', statusReason: 'expired', expiresAt: '2026-02-01T00:00:00Z' }),
    ]);
    renderPage();
    expect(cellOf(await rowOf('old-revoked'), tk('list.colStatus')).textContent).toBe(tk('status.revoked'));
    expect(cellOf(await rowOf('old-expired'), tk('list.colStatus')).textContent).toBe(tk('status.expired'));
  });

  it('a permission the owner no longer holds is told apart from what the key allows', async () => {
    api.listApiKeys.mockResolvedValue([
      key({ permissions: { level: 'write', admin: true }, unavailablePermissions: ['admin'] }),
    ]);
    renderPage();
    const cell = cellOf(await rowOf('ci-runner'), tk('list.colPermissions'));
    expect(within(cell).getByText(tk('list.unavailable', { list: tk('level.admin') }))).toBeTruthy();
  });

  it('a revoked key offers neither reissue nor revoke; an expired one may be reissued', async () => {
    api.listApiKeys.mockResolvedValue([
      key({ id: 'k-r', label: 'old-revoked', status: 'inactive', statusReason: 'revoked', revokedAt: '2026-02-01T00:00:00Z' }),
      key({ id: 'k-e', label: 'old-expired', status: 'inactive', statusReason: 'expired', expiresAt: '2026-02-01T00:00:00Z' }),
    ]);
    renderPage();
    const revoked = await rowOf('old-revoked');
    expect(within(revoked).queryByRole('button')).toBeNull();
    const expired = await rowOf('old-expired');
    expect(within(expired).getByRole('button', { name: tk('actions.reissueAria', { label: 'old-expired', prefix: 'ska_AbCdEfGh' }) })).toBeTruthy();
    expect(within(expired).queryByRole('button', { name: tk('actions.narrowAria', { label: 'old-expired', prefix: 'ska_AbCdEfGh' }) })).toBeNull();
  });
});

describe('US-10 — narrowing, reissue, revoke', () => {
  async function openNarrow(label: string) {
    const row = await rowOf(label);
    const button = within(row).getByRole('button', { name: tk('actions.narrowAria', { label, prefix: 'ska_AbCdEfGh' }) });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    return screen.findByRole('form', { name: tk('form.narrowAria') });
  }

  it('narrowing sends the lower grant to the narrow call and keeps the expiry', async () => {
    api.listApiKeys.mockResolvedValue([key()]);
    renderPage();
    const form = await openNarrow('ci-runner');
    fireEvent.click(within(form).getByRole('radio', { name: tk('level.read') }));
    fireEvent.click(within(form).getByRole('button', { name: tk('form.narrowSave') }));

    await waitFor(() => expect(api.narrowApiKey).toHaveBeenCalledTimes(1));
    const [id, body] = api.narrowApiKey.mock.calls[0];
    expect(id).toBe('k-1');
    expect(body).toEqual({ permissions: { level: 'read', admin: false }, scope: { mode: 'all' } });
    expect(api.createApiKey).not.toHaveBeenCalled();
  });

  it('widening is not offered in place: no higher level, no admin — a new key is needed', async () => {
    who.role = 'admin';
    api.listApiKeys.mockResolvedValue([key({ permissions: { level: 'write', admin: false } })]);
    renderPage();
    const form = await openNarrow('ci-runner');
    expect(within(form).queryByRole('radio', { name: tk('level.manage') })).toBeNull();
    expect(within(form).queryByRole('radio', { name: new RegExp(tk('preset.manage')) })).toBeNull();
    expect(within(form).queryByRole('checkbox', { name: new RegExp(tk('form.admin')) })).toBeNull();
    expect(within(form).getByText(tk('form.widenHint'))).toBeTruthy();
  });

  it('a key limited to projects narrows only within them: the whole scope is not offered', async () => {
    api.listApiKeys.mockResolvedValue([
      key({ scope: { mode: 'projects', projects: [{ id: PROJECT_A, name: 'Alpha' }, { id: PROJECT_B, name: 'Beta' }], spaces: [] } }),
    ]);
    renderPage();
    const form = await openNarrow('ci-runner');
    expect(within(form).queryByRole('radio', { name: tk('scopeMode.all') })).toBeNull();
    expect(within(form).queryByRole('radio', { name: tk('scopeMode.spaces') })).toBeNull();
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Beta' }));
    fireEvent.click(within(form).getByRole('button', { name: tk('form.narrowSave') }));

    await waitFor(() => expect(api.narrowApiKey).toHaveBeenCalledTimes(1));
    expect(api.narrowApiKey.mock.calls[0][1].scope).toEqual({ mode: 'projects', projects: [PROJECT_A] });
  });

  it('reissue calls the reissue client and shows the new secret', async () => {
    api.listApiKeys.mockResolvedValue([key()]);
    renderPage();
    const row = await rowOf('ci-runner');
    fireEvent.click(within(row).getByRole('button', { name: tk('actions.reissueAria', { label: 'ci-runner', prefix: 'ska_AbCdEfGh' }) }));
    const confirm = await screen.findByRole('dialog', { name: tk('actions.reissueTitle') });
    fireEvent.click(within(confirm).getByRole('button', { name: tk('actions.reissue') }));

    await waitFor(() => expect(api.reissueApiKey).toHaveBeenCalledWith('k-1'));
    expect(await screen.findByText('ska_REISSUEDSECRET0000000')).toBeTruthy();
    expect(api.createApiKey).not.toHaveBeenCalled();
    expect(api.revokeApiKey).not.toHaveBeenCalled();
  });

  it('revoke calls the revoke client', async () => {
    api.listApiKeys.mockResolvedValue([key()]);
    renderPage();
    const row = await rowOf('ci-runner');
    fireEvent.click(within(row).getByRole('button', { name: tk('actions.revokeAria', { label: 'ci-runner', prefix: 'ska_AbCdEfGh' }) }));
    const confirm = await screen.findByRole('dialog', { name: tk('actions.revokeTitle') });
    fireEvent.click(within(confirm).getByRole('button', { name: tk('actions.revoke') }));

    await waitFor(() => expect(api.revokeApiKey).toHaveBeenCalledWith('k-1'));
    expect(api.reissueApiKey).not.toHaveBeenCalled();
    expect(api.narrowApiKey).not.toHaveBeenCalled();
  });
});

describe('US-10 — the public API address block', () => {
  it('turned off: says the public API is off, no link', async () => {
    api.getApiKeysSettings.mockResolvedValue({ ...SETTINGS, publicApiEnabled: false, publicApiUrl: null, openApiUrl: null });
    renderPage();
    expect(await screen.findByText(tk('publicApi.disabledTitle'))).toBeTruthy();
    expect(screen.queryByRole('link', { name: tk('publicApi.openApi') })).toBeNull();
  });

  it('on without an address: says the address is not set, no link', async () => {
    api.getApiKeysSettings.mockResolvedValue({ ...SETTINGS, publicApiUrl: null, openApiUrl: null });
    renderPage();
    expect(await screen.findByText(tk('publicApi.noAddressTitle'))).toBeTruthy();
    expect(screen.queryByRole('link', { name: tk('publicApi.openApi') })).toBeNull();
  });

  it('on with an address: shows it and links openapi.json', async () => {
    renderPage();
    const link = await screen.findByRole('link', { name: tk('publicApi.openApi') });
    expect(link.getAttribute('href')).toBe('https://api.example.net/api/v1/openapi.json');
    expect(screen.getByText('https://api.example.net')).toBeTruthy();
    expect(screen.queryByText(tk('publicApi.disabledTitle'))).toBeNull();
    expect(screen.queryByText(tk('publicApi.noAddressTitle'))).toBeNull();
  });
});

describe('US-10 — refusals are told by their machine code', () => {
  /** The alert that carries the refusal, found by its role. */
  async function refusalText(): Promise<string> {
    const alert = await screen.findByRole('alert');
    return alert.textContent ?? '';
  }

  async function submitCreate() {
    renderPage();
    const form = await openCreateForm();
    typeLabel(form, 'refused');
    fireEvent.click(within(form).getByRole('button', { name: tk('form.create') }));
  }

  it.each([
    'no_permission',
    'admin_requires_scope_all',
    'admin_not_available',
    'invalid_scope',
    'scope_unavailable',
    'expiry_out_of_range',
    'not_narrowing',
  ])('422 invalid_grant with rule %s → the text of that rule', async (rule) => {
    api.createApiKey.mockRejectedValue(
      new BusinessError(422, 'server wording', 'invalid_grant', { details: { rule } }),
    );
    await submitCreate();
    const text = await refusalText();
    expect(text).toContain(tk(`errors.rule.${rule}`));
    expect(text).not.toContain('server wording');
  });

  it('422 invalid_grant with a rule the page does not know → the server message', async () => {
    api.createApiKey.mockRejectedValue(
      new BusinessError(422, 'server wording', 'invalid_grant', { details: { rule: 'some_future_rule' } }),
    );
    await submitCreate();
    expect(await refusalText()).toContain('server wording');
  });

  it('400 validation_error with details.staleClient → "refresh the page"', async () => {
    api.createApiKey.mockRejectedValue(
      new ApiError(400, 'server wording', 'validation_error', { details: { staleClient: true } }),
    );
    await submitCreate();
    const text = await refusalText();
    expect(text).toContain(tk('errors.staleClient'));
    expect(text).not.toContain('server wording');
  });

  it('a 5xx answer → the general internal-error text, not the server message', async () => {
    api.createApiKey.mockRejectedValue(new ApiError(500, 'stack details', 'internal_error'));
    await submitCreate();
    const text = await refusalText();
    expect(text).toContain(tk('errors.internal'));
    expect(text).not.toContain('stack details');
  });

  it('422 key_revoked on reissue → "the key is revoked"', async () => {
    api.listApiKeys.mockResolvedValue([key()]);
    api.reissueApiKey.mockRejectedValue(new BusinessError(422, 'server wording', 'key_revoked'));
    renderPage();
    const row = await rowOf('ci-runner');
    fireEvent.click(within(row).getByRole('button', { name: tk('actions.reissueAria', { label: 'ci-runner', prefix: 'ska_AbCdEfGh' }) }));
    const confirm = await screen.findByRole('dialog', { name: tk('actions.reissueTitle') });
    fireEvent.click(within(confirm).getByRole('button', { name: tk('actions.reissue') }));
    expect(await refusalText()).toContain(tk('errors.keyRevoked'));
  });

  it('422 key_expired on narrowing → "the key has expired"', async () => {
    api.listApiKeys.mockResolvedValue([key()]);
    api.narrowApiKey.mockRejectedValue(new BusinessError(422, 'server wording', 'key_expired'));
    renderPage();
    const row = await rowOf('ci-runner');
    const narrow = within(row).getByRole('button', { name: tk('actions.narrowAria', { label: 'ci-runner', prefix: 'ska_AbCdEfGh' }) });
    await waitFor(() => expect((narrow as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(narrow);
    const form = await screen.findByRole('form', { name: tk('form.narrowAria') });
    fireEvent.click(within(form).getByRole('radio', { name: tk('level.read') }));
    fireEvent.click(within(form).getByRole('button', { name: tk('form.narrowSave') }));
    expect(await refusalText()).toContain(tk('errors.keyExpired'));
  });
});
