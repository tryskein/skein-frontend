import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  createApiKey,
  getApiKeysSettings,
  narrowApiKey,
  reissueApiKey,
  revokeApiKey,
} from './api-keys';

// US-10, SC-010 — the API keys client on the HTTP boundary. The browser path
// stays /api/v1/me/api-keys* (the BFF forwards it to /ui/v1); the bodies
// follow the skein-api cabinet contract.

const fetchSpy = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => vi.unstubAllGlobals());

function sentRequest(): { path: string; method: string; body: unknown } {
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  const [url, init] = fetchSpy.mock.calls[0];
  const raw = init?.body;
  return {
    path: new URL(String(url), 'http://localhost').pathname,
    method: init?.method ?? 'GET',
    body: typeof raw === 'string' ? JSON.parse(raw) : raw,
  };
}

const KEY_ID = '0f8b5c2e-7a41-4d3b-9c6e-2b1d4e5f6a70';

describe('US-10 — API keys client', () => {
  test('create sends the label with permissions, scope and expiry', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({}, 201));
    await createApiKey({
      label: 'ci',
      permissions: { level: 'write', admin: false },
      scope: { mode: 'projects', projects: ['11111111-2222-3333-4444-555555555555'] },
      expiresAt: '2027-02-08T00:00:00.000Z',
    });
    const sent = sentRequest();
    expect(sent.method).toBe('POST');
    expect(sent.path).toBe('/api/v1/me/api-keys');
    expect(sent.body).toEqual({
      label: 'ci',
      permissions: { level: 'write', admin: false },
      scope: { mode: 'projects', projects: ['11111111-2222-3333-4444-555555555555'] },
      expiresAt: '2027-02-08T00:00:00.000Z',
    });
  });

  test('create sends an admin-only grant with a null level', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({}, 201));
    await createApiKey({
      label: 'ops',
      permissions: { level: null, admin: true },
      scope: { mode: 'all' },
      expiresAt: '2027-02-08T00:00:00.000Z',
    });
    expect(sentRequest().body).toMatchObject({ permissions: { level: null, admin: true }, scope: { mode: 'all' } });
  });

  test('narrowing patches the key with the new grant', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({}));
    await narrowApiKey(KEY_ID, {
      permissions: { level: 'read', admin: false },
      scope: { mode: 'spaces', spaces: ['22222222-3333-4444-5555-666666666666'] },
      expiresAt: '2026-12-01T00:00:00.000Z',
    });
    const sent = sentRequest();
    expect(sent.method).toBe('PATCH');
    expect(sent.path).toBe(`/api/v1/me/api-keys/${KEY_ID}`);
    expect(sent.body).toEqual({
      permissions: { level: 'read', admin: false },
      scope: { mode: 'spaces', spaces: ['22222222-3333-4444-5555-666666666666'] },
      expiresAt: '2026-12-01T00:00:00.000Z',
    });
  });

  test.each([
    ['reissue', () => reissueApiKey(KEY_ID), 'POST', `/api/v1/me/api-keys/${KEY_ID}/reissue`, 201],
    ['revoke', () => revokeApiKey(KEY_ID), 'DELETE', `/api/v1/me/api-keys/${KEY_ID}`, 204],
  ])('%s calls its own route', async (_name, call, method, path, status) => {
    fetchSpy.mockResolvedValue(status === 204 ? new Response(null, { status }) : jsonResponse({}, status));
    await call();
    const sent = sentRequest();
    expect(sent.method).toBe(method);
    expect(sent.path).toBe(path);
    expect(sent.body).toBeUndefined();
  });

  test('settings keep an unset public API address as null', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({
      publicApiEnabled: true,
      publicApiUrl: null,
      openApiUrl: null,
      defaultTtlSeconds: 7776000,
      maxTtlSeconds: 31536000,
    }));
    const settings = await getApiKeysSettings();
    const sent = sentRequest();
    expect(sent.method).toBe('GET');
    expect(sent.path).toBe('/api/v1/me/api-keys/settings');
    expect(settings.publicApiUrl).toBeNull();
    expect(settings.openApiUrl).toBeNull();
  });
});
