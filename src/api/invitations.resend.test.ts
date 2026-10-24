/**
 * sk-674.18 T067 — the body of POST /spaces/{id}/invitations/{invId}/resend
 * (api `spaces/contract.go#ResendInvitationRequest`: an optional body
 * `{"turnstileToken"}`, an empty body is no token).
 *
 * Both halves can break: a token that never reaches the wire leaves the
 * resend at `captcha_required` for good; a body sent without a token
 * changes the request every resend made before the captcha rule.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { resendInvitation } from './invitations';

const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
  new Response(JSON.stringify({ id: 'inv-1' }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
);

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('resendInvitation — the request body', () => {
  test('without a token: POST to the resend route, no body', async () => {
    await resendInvitation('k3x9p2qa', 'inv-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/spaces/k3x9p2qa/invitations/inv-1/resend');
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });

  test('with a token: the body is exactly {"turnstileToken"}, sent as JSON', async () => {
    await resendInvitation('k3x9p2qa', 'inv-1', 'token-1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/spaces/k3x9p2qa/invitations/inv-1/resend');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ turnstileToken: 'token-1' });
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });
});
