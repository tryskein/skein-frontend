/**
 * sk-1048.32 — the issue-create-prefs client on the HTTP boundary.
 *
 * Contract (skein-api `handler/issue_create_prefs.go`): `GET` and `PUT`
 * `/api/v1/me/issue-create-prefs`; `PUT` takes a partial JSON body in which an
 * explicit `false` is a value, and both answer with the stored setting.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { getIssueCreatePrefs, updateIssueCreatePrefs } from './issue-create-prefs';

const fetchSpy = vi.fn<typeof fetch>();

function answer(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => vi.unstubAllGlobals());

function onlyCall(): { url: string; init: RequestInit } {
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  const [url, init] = fetchSpy.mock.calls[0];
  return { url: String(url), init: init ?? {} };
}

describe('issue-create-prefs client', () => {
  test('reads the setting with GET and returns the stored value', async () => {
    fetchSpy.mockResolvedValue(answer({ assignAgentIssuesToMe: false }));

    await expect(getIssueCreatePrefs()).resolves.toEqual({ assignAgentIssuesToMe: false });

    const { url, init } = onlyCall();
    expect(url).toBe('/api/v1/me/issue-create-prefs');
    expect(init.method ?? 'GET').toBe('GET');
    expect(init.body).toBeUndefined();
  });

  test('saves an explicit false with PUT', async () => {
    fetchSpy.mockResolvedValue(answer({ assignAgentIssuesToMe: false }));

    await updateIssueCreatePrefs({ assignAgentIssuesToMe: false });

    const { url, init } = onlyCall();
    expect(url).toBe('/api/v1/me/issue-create-prefs');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({ assignAgentIssuesToMe: false });
  });

  test('returns the value the server stored, not the one it was sent', async () => {
    fetchSpy.mockResolvedValue(answer({ assignAgentIssuesToMe: false }));

    await expect(updateIssueCreatePrefs({ assignAgentIssuesToMe: true }))
      .resolves.toEqual({ assignAgentIssuesToMe: false });
  });
});
