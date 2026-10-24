/**
 * sk-401 — the global search page.
 *
 * What the page PROMISES is checked, not how it is built:
 *
 *   • the address is the only source of state: `?q` goes into the request, the field
 *     changes the address only on submit;
 *   • the view is narrowed by the `?kind` parameter, and "all four" and "none" are one
 *     and the same search with one address;
 *   • each of the four kinds leads to where its entity lives, and a row
 *     without data for navigation is text, not a link to nowhere;
 *   • degradation (semantic search unavailable) is said out loud;
 *   • page after page — by the server cursor, without its own arithmetic;
 *   • sk-674.18 T056 (matrix row 247; US-13, SC-014, screens 1.11): with
 *     two or more spaces the choice is written to `?space=` and goes into the
 *     request, the row carries the label "Space · Project"; with one
 *     space there is neither a choice nor labels.
 *
 * "My spaces" — the real `useMySpaces` over a substituted
 * `getMySpaces` (the network boundary) and a signed-in user.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import type { SearchItem, SearchParams, SearchResponse } from '../../api/search';
import type { MySpace, MySpacesResponse } from '../../api/spaces';
import i18n, { DEFAULT_LANGUAGE } from '../../i18n/config';

/** GET /me/spaces answers with this; by default one "Personal", like a person without teams. */
let mySpaces: MySpace[] = [];
/** Responses of GET /me/spaces already handed to the page. */
let spacesAnswered = 0;

vi.mock('../../api/spaces', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/spaces')>();
  return {
    ...actual,
    getMySpaces: async (): Promise<MySpacesResponse> => {
      spacesAnswered += 1;
      return { items: mySpaces, ownedCount: 0, ownedLimit: null, canCreate: true, cannotCreateReason: null };
    },
  };
});
vi.mock('../../auth/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth/AuthContext')>();
  const user = { id: 'user-bob', username: 'bob', email: 'bob@example.com', name: 'Bob', role: 'user' };
  return { ...actual, useAuthOptional: () => ({ user }) };
});

const globalSearchSpy = vi.fn<(params: SearchParams) => Promise<SearchResponse>>();

vi.mock('../../api/search', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/search')>();
  return { ...actual, globalSearch: (p: SearchParams) => globalSearchSpy(p) };
});

import { SearchPage, parseKinds, resultHref } from './SearchPage';

const PID = '11111111-2222-3333-4444-555555555555';

const PERSONAL = 'p0aa11bb';
const ACME = 'k3x9p2qa';

function space(id: string, name: string, kind: MySpace['kind']): MySpace {
  return {
    id, slug: kind === 'personal' ? '' : name.toLowerCase(), name, kind, myRole: 'member', adminAccess: false,
    canCreateProject: true, memberCount: 2, memberLimit: null, pendingInvitations: 0,
    projectCount: 1, projectQuota: null, storageUsedBytes: 0, storageQuotaBytes: null,
  };
}

function item(over: Partial<SearchItem> = {}): SearchItem {
  return {
    kind: 'issue',
    id: 'sk-1',
    projectId: PID,
    projectName: 'skein',
    title: 'Search came back',
    snippet: 'about <b>search</b>',
    score: 1,
    exactMatch: false,
    status: 'open',
    priority: 2,
    updatedAt: '2026-09-20T10:00:00Z',
    ...over,
  };
}

function page(items: SearchItem[], over: Partial<SearchResponse> = {}): SearchResponse {
  return { items, nextCursor: null, hasMore: false, degraded: false, tookMs: 5, ...over };
}

/** The current address — to check that the page writes to it. */
function LocationProbe() {
  const loc = useLocation();
  return <output data-testid="loc">{`${loc.pathname}${loc.search}`}</output>;
}

function mount(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/search" element={<><SearchPage /><LocationProbe /></>} />
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

const loc = () => screen.getByTestId('loc').textContent;

beforeEach(async () => {
  globalSearchSpy.mockReset();
  mySpaces = [space(PERSONAL, 'Личное', 'personal')];
  spacesAnswered = 0;
  await i18n.changeLanguage('ru');
});

afterEach(async () => {
  cleanup();
  if (i18n.language !== DEFAULT_LANGUAGE) await i18n.changeLanguage(DEFAULT_LANGUAGE);
});

describe('sk-401 — the address as the source of state', () => {
  test('without a query the search is not called, and the field waits for input', () => {
    mount('/search');
    expect(globalSearchSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('searchbox')).toBe(document.activeElement);
  });

  test('`?q` goes into the request trimmed, without narrowing by kinds', async () => {
    globalSearchSpy.mockResolvedValue(page([item()]));
    mount('/search?q=%20%20search%20');
    await waitFor(() => expect(globalSearchSpy).toHaveBeenCalled());
    const p = globalSearchSpy.mock.calls[0][0];
    expect(p.q).toBe('search');
    expect(p.kind).toBeUndefined();
  });

  test('typing changes the address only on submit, not on every key', async () => {
    globalSearchSpy.mockResolvedValue(page([]));
    mount('/search');
    const box = screen.getByRole('searchbox');
    fireEvent.change(box, { target: { value: 'кольцо' } });
    // The address is untouched: browser history must not get clogged with letters.
    expect(loc()).toBe('/search');
    fireEvent.submit(box.closest('form')!);
    expect(loc()).toBe('/search?q=%D0%BA%D0%BE%D0%BB%D1%8C%D1%86%D0%BE');
  });
});

describe('sk-401 — narrowing by kinds', () => {
  test('`?kind` goes into the request, garbage is discarded', async () => {
    globalSearchSpy.mockResolvedValue(page([]));
    mount('/search?q=x&kind=comment,nonsense,project');
    await waitFor(() => expect(globalSearchSpy).toHaveBeenCalled());
    expect(globalSearchSpy.mock.calls[0][0].kind).toEqual(['comment', 'project']);
  });

  test('parseKinds: empty and garbage — "all", a repeat is not doubled', () => {
    expect(parseKinds(null)).toEqual([]);
    expect(parseKinds('bogus')).toEqual([]);
    expect(parseKinds('issue,ISSUE, issue')).toEqual(['issue']);
  });

  test('removing one kind from "all" — the remaining three go into the address', async () => {
    globalSearchSpy.mockResolvedValue(page([]));
    mount('/search?q=x');
    const group = screen.getByRole('group');
    const comments = within(group).getByRole('button', { name: /Комментарии/ });
    expect(comments.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(comments);
    // A pressed button is released, not made the only one.
    expect(loc()).toBe('/search?q=x&kind=issue%2Cproject%2Ccomponent');
    expect(comments.getAttribute('aria-pressed')).toBe('false');
  });

  test('the last remaining kind is released into "all", not into emptiness', async () => {
    globalSearchSpy.mockResolvedValue(page([]));
    mount('/search?q=x&kind=project');
    fireEvent.click(within(screen.getByRole('group')).getByRole('button', { name: /Проекты/ }));
    expect(loc()).toBe('/search?q=x');
  });

  test('selecting all four is the same as none: the parameter is removed', async () => {
    globalSearchSpy.mockResolvedValue(page([]));
    mount('/search?q=x&kind=issue,comment,project');
    const group = screen.getByRole('group');
    fireEvent.click(within(group).getByRole('button', { name: /Компоненты/ }));
    // One and the same search must not have two addresses.
    expect(loc()).toBe('/search?q=x');
  });

  test('none selected — all are marked: an empty row would read as "we search for nothing"', () => {
    mount('/search?q=x');
    const buttons = within(screen.getByRole('group')).getAllByRole('button');
    expect(buttons).toHaveLength(4);
    for (const b of buttons) expect(b.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('sk-401 — where each kind leads', () => {
  test('task → its own card in its own project', () => {
    expect(resultHref(item({ kind: 'issue', id: 'sk-7.2' }))).toBe(`/projects/${PID}/issues/sk-7.2`);
  });

  test('comment → the PARENT task, without promising an anchor', () => {
    const href = resultHref(item({ kind: 'comment', id: 'c-uuid', parentIssueId: 'sk-9' }));
    expect(href).toBe(`/projects/${PID}/issues/sk-9`);
    // There are no `#c-…` anchors in the new shell's feed — the link must not promise them.
    expect(href).not.toContain('#');
  });

  test('a comment without a parent has nowhere to lead', () => {
    expect(resultHref(item({ kind: 'comment', parentIssueId: undefined }))).toBeNull();
  });

  test('project → the project itself; component → its own route, not a tab', () => {
    expect(resultHref(item({ kind: 'project', id: PID, projectId: null }))).toBe(`/projects/${PID}`);
    expect(resultHref(item({ kind: 'component', id: 'cmp-1' }))).toBe(
      `/projects/${PID}/components/cmp-1`,
    );
  });

  test('a result with an address is a link to where its kind leads', async () => {
    globalSearchSpy.mockResolvedValue(page([item({ id: 'sk-3', title: 'alive' })]));
    mount('/search?q=x');
    const link = await screen.findByRole('link', { name: 'alive' });
    expect(link.getAttribute('href')).toBe(`/projects/${PID}/issues/sk-3`);
  });

  test('a row without an address is drawn as text, not a link to nowhere', async () => {
    globalSearchSpy.mockResolvedValue(
      page([item({ kind: 'comment', id: 'c1', title: 'orphan', parentIssueId: undefined })]),
    );
    mount('/search?q=x');
    const title = await screen.findByText('orphan');
    expect(title.closest('a')).toBeNull();
  });
});

describe('sk-401 — results', () => {
  test('the kind is announced to the screen reader by a word: the badge is decorative, it has a letter', async () => {
    globalSearchSpy.mockResolvedValue(page([item({ kind: 'project', id: PID, title: 'skein' })]));
    mount('/search?q=x');
    const list = await screen.findByRole('list');
    expect(within(list).getByText(/Проекты:/)).toBeTruthy();
  });

  test('the match is highlighted with a tag, not with other HTML', async () => {
    globalSearchSpy.mockResolvedValue(
      page([item({ snippet: 'about <b>search</b><img src=x onerror="alert(1)">' })]),
    );
    const { container } = mount('/search?q=x');
    await screen.findByRole('list');
    expect(container.querySelector('.search-result-snippet b')?.textContent).toBe('search');
    // The snippet is server output: everything except `<b>` must be stripped.
    expect(container.querySelector('.search-result-snippet img')).toBeNull();
  });

  test('nothing found — said in words, with the query', async () => {
    globalSearchSpy.mockResolvedValue(page([]));
    mount('/search?q=empty');
    expect(await screen.findByText(/«empty».*ничего не найдено/)).toBeTruthy();
  });

  test('server failure — said, and there is a retry', async () => {
    globalSearchSpy.mockRejectedValueOnce(new Error('boom'));
    globalSearchSpy.mockResolvedValueOnce(page([item()]));
    mount('/search?q=x');
    fireEvent.click(await screen.findByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('list')).toBeTruthy();
  });
});

describe('sk-401 — degradation and pages', () => {
  test('semantic search unavailable — said out loud', async () => {
    globalSearchSpy.mockResolvedValue(page([item()], { degraded: true }));
    mount('/search?q=x');
    expect(await screen.findByText(/Смысловой поиск сейчас недоступен/)).toBeTruthy();
  });

  test('without degradation there is no banner', async () => {
    globalSearchSpy.mockResolvedValue(page([item()]));
    mount('/search?q=x');
    await screen.findByRole('list');
    expect(screen.queryByText(/Смысловой поиск сейчас недоступен/)).toBeNull();
  });

  test('"Show more" goes by the server cursor and appends, not replaces', async () => {
    globalSearchSpy
      .mockResolvedValueOnce(page([item({ id: 'sk-1', title: 'first' })], { hasMore: true, nextCursor: 'CUR-2' }))
      .mockResolvedValueOnce(page([item({ id: 'sk-2', title: 'second' })]));
    mount('/search?q=x');
    fireEvent.click(await screen.findByRole('button', { name: 'Показать ещё' }));
    expect(await screen.findByText('second')).toBeTruthy();
    expect(screen.getByText('first')).toBeTruthy();
    expect(globalSearchSpy.mock.calls[1][0].cursor).toBe('CUR-2');
    // The last page — the button is gone.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Показать ещё' })).toBeNull());
  });
});

describe('sk-674.18 T056 — space choice and row label (row 247)', () => {
  const personalName = () => i18n.t('common:spaceFilter.personal');
  const spaceGroup = () => screen.queryByRole('group', { name: i18n.t('common:spaceFilter.label') });
  const lastParams = () => globalSearchSpy.mock.calls[globalSearchSpy.mock.calls.length - 1][0];

  test('two spaces: choosing "Acme" is written to `?space=` and goes into the request', async () => {
    mySpaces = [space(PERSONAL, 'Личное', 'personal'), space(ACME, 'Acme', 'common')];
    globalSearchSpy.mockResolvedValue(page([]));
    mount('/search?q=release');

    const group = await screen.findByRole('group', { name: i18n.t('common:spaceFilter.label') });
    const all = within(group).getByRole('button', { name: i18n.t('common:spaceFilter.all') });
    // By default — "All": a request without a space.
    expect(all.getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(globalSearchSpy).toHaveBeenCalled());
    expect(lastParams().space).toBeNull();
    // "Personal" — as a word, not the name from the response.
    expect(within(group).getByRole('button', { name: personalName() })).toBeTruthy();

    fireEvent.click(within(group).getByRole('button', { name: 'Acme' }));
    expect(loc()).toBe(`/search?q=release&space=${ACME}`);
    await waitFor(() => expect(lastParams().space).toBe(ACME));
    expect(lastParams().q).toBe('release');
    expect(within(group).getByRole('button', { name: 'Acme' }).getAttribute('aria-pressed')).toBe('true');

    // Back to "All" — the parameter is removed, the request is again without a space.
    fireEvent.click(within(group).getByRole('button', { name: i18n.t('common:spaceFilter.all') }));
    expect(loc()).toBe('/search?q=release');
    await waitFor(() => expect(lastParams().space).toBeNull());
  });

  test('`?space=` from the address goes into the very first request and is marked in the choice', async () => {
    mySpaces = [space(PERSONAL, 'Личное', 'personal'), space(ACME, 'Acme', 'common')];
    globalSearchSpy.mockResolvedValue(page([]));
    mount(`/search?q=x&space=${ACME}`);
    await waitFor(() => expect(globalSearchSpy).toHaveBeenCalled());
    expect(globalSearchSpy.mock.calls[0][0].space).toBe(ACME);
    const group = await screen.findByRole('group', { name: i18n.t('common:spaceFilter.label') });
    expect(within(group).getByRole('button', { name: 'Acme' }).getAttribute('aria-pressed')).toBe('true');
  });

  test('many spaces — choice by a list, the chosen one goes into the address and the request', async () => {
    mySpaces = [
      space(PERSONAL, 'Личное', 'personal'),
      space(ACME, 'Acme', 'common'),
      space('b1b1b1b1', 'Beta', 'regular'),
      space('c2c2c2c2', 'Gamma', 'regular'),
      space('d3d3d3d3', 'Delta', 'regular'),
    ];
    globalSearchSpy.mockResolvedValue(page([]));
    mount('/search?q=x');
    const select = await screen.findByRole('combobox', { name: i18n.t('common:spaceFilter.label') });
    fireEvent.change(select, { target: { value: 'c2c2c2c2' } });
    expect(loc()).toBe('/search?q=x&space=c2c2c2c2');
    await waitFor(() => expect(lastParams().space).toBe('c2c2c2c2'));
  });

  test('label "Space · Project" on the row; "Personal" — as a word', async () => {
    mySpaces = [space(PERSONAL, 'Личное', 'personal'), space(ACME, 'Acme', 'common')];
    globalSearchSpy.mockResolvedValue(
      page([
        item({ id: 'shop-9.15', title: 'Prepare release', projectName: 'Website', spaceId: ACME }),
        item({ id: 'home-3', title: 'Blog release', projectName: 'Blog', spaceId: PERSONAL }),
      ]),
    );
    mount('/search?q=release');
    const acmeRow = (await screen.findByRole('link', { name: 'Prepare release' })).closest('li')!;
    await waitFor(() =>
      expect(
        within(acmeRow).getByText(i18n.t('search:spaceProject', { space: 'Acme', project: 'Website' })),
      ).toBeTruthy(),
    );
    const homeRow = screen.getByRole('link', { name: 'Blog release' }).closest('li')!;
    expect(
      within(homeRow).getByText(i18n.t('search:spaceProject', { space: personalName(), project: 'Blog' })),
    ).toBeTruthy();
  });

  test('someone else\'s `?space=`: one request without a space, the parameter is removed from the address', async () => {
    mySpaces = [space(PERSONAL, 'Личное', 'personal'), space(ACME, 'Acme', 'common')];
    globalSearchSpy.mockResolvedValue(page([]));
    mount('/search?q=x&space=zzzzzzzz');
    await waitFor(() => expect(globalSearchSpy).toHaveBeenCalled());
    await waitFor(() => expect(loc()).toBe('/search?q=x'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(globalSearchSpy).toHaveBeenCalledTimes(1);
    expect(globalSearchSpy.mock.calls[0][0].space).toBeNull();
  });

  test('one space: neither a choice nor a label — the row as before, a request without a space', async () => {
    globalSearchSpy.mockResolvedValue(
      page([item({ id: 'home-3', title: 'Blog release', projectName: 'Blog', spaceId: PERSONAL })]),
    );
    mount('/search?q=release');
    const row = (await screen.findByRole('link', { name: 'Blog release' })).closest('li')!;
    // "My spaces" has already answered — the absence of a choice is not because the
    // list has not arrived yet.
    await waitFor(() => expect(spacesAnswered).toBeGreaterThan(0));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(within(row).getByText('Blog')).toBeTruthy();
    expect(
      within(row).queryByText(i18n.t('search:spaceProject', { space: personalName(), project: 'Blog' })),
    ).toBeNull();
    expect(spaceGroup()).toBeNull();
    expect(screen.queryByRole('combobox', { name: i18n.t('common:spaceFilter.label') })).toBeNull();
    expect(lastParams().space).toBeNull();
  });
});
