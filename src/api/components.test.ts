/**
 * sk-1048.55 — the components client on the HTTP boundary.
 *
 * Routes are skein-api `cmd/api/main.go` (under `/api/v1/projects/{id}/components`):
 * GET and POST on the collection; GET, PATCH, DELETE (soft-archive alias) on one
 * component; POST `/archive` and `/unarchive`. The list reads `archived`
 * (`true` / `false` / `all`) and `lens` (`on-me` / `delegated`).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  archiveComponent,
  createComponent,
  deleteComponent,
  getComponent,
  listComponents,
  patchComponent,
  unarchiveComponent,
} from './components';

const fetchSpy = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchSpy.mockReset();
  fetchSpy.mockImplementation(async () => new Response(JSON.stringify([]), {
    status: 200, headers: { 'content-type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => vi.unstubAllGlobals());

function onlyCall(): { url: string; method: string; body: unknown } {
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  const [url, init] = fetchSpy.mock.calls[0];
  return {
    url: String(url),
    method: init?.method ?? 'GET',
    body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
  };
}

// An id with a space and a slash proves each segment is percent-encoded.
const PROJECT = 'proj 1/a';
const COMPONENT = 'comp 2/b';
const COLLECTION = '/api/v1/projects/proj%201%2Fa/components';
const ONE = `${COLLECTION}/comp%202%2Fb`;

describe('listComponents — query parameters', () => {
  test.each([
    { archived: undefined, lens: undefined, query: '' },
    { archived: 'true', lens: undefined, query: '?archived=true' },
    { archived: 'false', lens: undefined, query: '?archived=false' },
    { archived: 'all', lens: undefined, query: '?archived=all' },
    { archived: undefined, lens: 'on-me', query: '?lens=on-me' },
    { archived: undefined, lens: 'delegated', query: '?lens=delegated' },
    { archived: 'all', lens: 'delegated', query: '?archived=all&lens=delegated' },
  ] as const)('archived=$archived lens=$lens → "$query"', async ({ archived, lens, query }) => {
    await listComponents(PROJECT, archived, lens);
    const call = onlyCall();
    expect(call.method).toBe('GET');
    expect(call.url).toBe(`${COLLECTION}${query}`);
  });
});

describe('component operations — path, method and body', () => {
  test.each([
    {
      name: 'get',
      run: () => getComponent(PROJECT, COMPONENT),
      method: 'GET', url: ONE, body: undefined,
    },
    {
      name: 'create',
      run: () => createComponent(PROJECT, { name: 'Billing', description: 'd', paths: [] }),
      method: 'POST', url: COLLECTION, body: { name: 'Billing', description: 'd', paths: [] },
    },
    {
      name: 'patch',
      run: () => patchComponent(PROJECT, COMPONENT, { paths: [] }),
      method: 'PATCH', url: ONE, body: { paths: [] },
    },
    {
      name: 'archive',
      run: () => archiveComponent(PROJECT, COMPONENT),
      method: 'POST', url: `${ONE}/archive`, body: undefined,
    },
    {
      name: 'unarchive',
      run: () => unarchiveComponent(PROJECT, COMPONENT),
      method: 'POST', url: `${ONE}/unarchive`, body: undefined,
    },
    {
      name: 'delete',
      run: () => deleteComponent(PROJECT, COMPONENT),
      method: 'DELETE', url: ONE, body: undefined,
    },
  ])('$name', async ({ run, method, url, body }) => {
    await run();
    expect(onlyCall()).toEqual({ url, method, body });
  });
});
