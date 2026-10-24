/**
 * sk-674.18 T055 — the space chip in the card's header (spec US-13, SC-014; screens 1.10).
 *
 * With two spaces or more the header opens with the space of the issue
 * BEFORE the project code — `[Acme] [sk] [sk-42] …` — and the chip leads
 * to the place of the space. "Personal" is a person icon named "Personal". The
 * space is the one of the issue's PROJECT (`spaceId` of the card), never
 * read off the id prefix: a subtask may carry the prefix of a parent from
 * another project. With one space there is no chip — the header as before.
 *
 * The real `DetailsHeader` with the real «my spaces» read over a stubbed
 * `GET /me/spaces`.
 */
import { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '../../../i18n/config';

vi.mock('../../../auth/AuthContext', async (importActual) => {
  const actual = await importActual<typeof import('../../../auth/AuthContext')>();
  const user = { id: 'user-bob', username: 'bob', email: 'bob@example.com', name: 'Bob', role: 'user' };
  return {
    ...actual,
    useAuth: () => ({ user, isLoading: false, login: vi.fn(), logout: vi.fn() }),
    useAuthOptional: () => ({ user }),
  };
});
vi.mock('../../../api/dependencies', async (importActual) => {
  const actual = await importActual<typeof import('../../../api/dependencies')>();
  return { ...actual, listDependencies: () => Promise.resolve({ outgoing: [], incoming: [] }) };
});

import type { IssueDetail } from '../../../api/issues';
import type { MySpace } from '../../../api/spaces';
import { LayoutProvider } from '../../../lib/useLayoutState';
import { DetailsHeader } from './DetailsHeader';

const PERSONAL = 'p0aa11bb';
const ACME = 'k3x9p2qa';

function space(id: string, name: string, kind: MySpace['kind']): MySpace {
  return {
    id, slug: name === 'Личное' ? '' : name.toLowerCase(), name, kind, myRole: 'member', adminAccess: false,
    canCreateProject: true, memberCount: 2, memberLimit: null, pendingInvitations: 0,
    projectCount: 1, projectQuota: null, storageUsedBytes: 0, storageQuotaBytes: null,
  };
}

/** GET /me/spaces answers these. */
let mySpaces: MySpace[];
let location = '';
let qc: QueryClient;

function LocationProbe() {
  location = useLocation().pathname;
  return null;
}

function issue(over: Partial<IssueDetail> = {}): IssueDetail {
  return {
    id: 'sk-42',
    projectId: 'p1',
    spaceId: ACME,
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
    createdBy: 'user-alice',
    createdAt: '2026-05-15T10:00:00Z',
    updatedAt: '2026-05-15T10:00:00Z',
    metadata: {},
    componentIds: [],
    labels: [],
    commentsCount: 0,
    commitRefs: [],
    mentions: [],
    isBlocked: false,
    blockers: [],
    assignee: 'charlie',
    previousAssignees: [],
    dismissedBy: [],
    ...over,
  } as IssueDetail;
}

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/projects/sk/issues/sk-42']}>
          <LayoutProvider>
            <Routes>
              <Route
                path="*"
                element={
                  <>
                    <LocationProbe />
                    {children}
                  </>
                }
              />
            </Routes>
          </LayoutProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
}

async function mount(value: IssueDetail): Promise<HTMLElement> {
  const { container } = render(
    <Wrapper>
      <DetailsHeader
        issue={value}
        isWatching={false}
        watchToggling={false}
        onUpdateField={vi.fn()}
        onChangeStatus={vi.fn()}
        onAccept={vi.fn()}
        onWatchToggle={vi.fn()}
      />
    </Wrapper>,
  );
  if (value.spaceId !== undefined) {
    // «My spaces» answered, then the subscribers told on the next task.
    await vi.waitFor(() => expect(qc.getQueryState(['me', 'spaces', 'user-bob'])?.status).toBe('success'));
  }
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return container;
}

const chip = (name: string) => screen.queryByRole('link', { name: i18n.t('details:header.spaceChipAria', { name }) });
const anySpaceChip = () =>
  screen.queryByRole('link', { name: new RegExp(i18n.t('details:header.spaceChipAria', { name: '' }).trim()) });

beforeEach(async () => {
  await i18n.changeLanguage('ru');
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  location = '';
  mySpaces = [space(PERSONAL, 'Личное', 'personal'), space(ACME, 'Acme', 'common')];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const body = String(input).endsWith('/api/v1/me/spaces')
        ? { items: mySpaces, ownedCount: 0, ownedLimit: null, canCreate: true, cannotCreateReason: null }
        : {};
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('row 243 — the space chip before the project code, with two spaces or more', () => {
  test('the chip names the space, stands before the project code and opens the place of the space', async () => {
    const container = await mount(issue());
    const link = chip('Acme')!;
    expect(link).not.toBeNull();
    expect(link.textContent).toBe('Acme');
    // Before the project code, in the reading order of the header line.
    const line = container.textContent ?? '';
    expect(screen.getByText('sk')).toBeTruthy();
    expect(line.indexOf('Acme')).toBeLessThan(line.indexOf('sk'));

    fireEvent.click(link);
    expect(location).toBe(`/spaces/${ACME}-acme`);
  });

  test('"Personal" — a person icon named "Personal", no word', async () => {
    await mount(issue({ spaceId: PERSONAL }));
    const link = chip(i18n.t('details:header.personalSpace'))!;
    expect(link).not.toBeNull();
    // An icon: the name is for the screen reader, no word on screen.
    expect(link.textContent).toBe('');
  });

  test('the space is the project’s, not the id prefix’s: a subtask minted under another prefix', async () => {
    // The id carries the prefix of a parent in the personal space; the
    // issue's project is in Acme.
    await mount(issue({ id: 'me-7.1', spaceId: ACME }));
    expect(chip('Acme')).not.toBeNull();
    expect(chip(i18n.t('details:header.personalSpace'))).toBeNull();
  });
});

describe('row 243 — no chip: one space, or a card without its space', () => {
  test('one space → no chip, the header as before', async () => {
    mySpaces = [space(ACME, 'Acme', 'personal')];
    await mount(issue());
    expect(anySpaceChip()).toBeNull();
    expect(screen.getByText('sk')).toBeTruthy();
  });

  test('a card without `spaceId` → no chip', async () => {
    await mount(issue({ spaceId: undefined }));
    expect(anySpaceChip()).toBeNull();
  });
});
