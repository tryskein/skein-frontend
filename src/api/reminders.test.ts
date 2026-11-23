/**
 * sk-1048.56 — the reminder write requests on the HTTP boundary.
 *
 * Routes are skein-api `cmd/api/main.go`: POST
 * `/api/v1/projects/{projectID}/issues/{issueID}/reminders`, POST
 * `/api/v1/reminders/{reminderID}/snooze` (exactly one of `by` / `until`), DELETE
 * `/api/v1/reminders/{reminderID}`. A note or reason that is blank is left out of
 * the body; a non-blank one is sent trimmed.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { createReminder, dismissReminder, snoozeReminder } from './reminders';

const fetchSpy = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchSpy.mockReset();
  fetchSpy.mockImplementation(async () => new Response('{}', {
    status: 200, headers: { 'content-type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => vi.unstubAllGlobals());

function onlyCall(): { url: string; method: string | undefined; body: unknown } {
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  const [url, init] = fetchSpy.mock.calls[0];
  return {
    url: String(url),
    method: init?.method,
    body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
  };
}

const AT = '2026-12-01T09:00:00Z';

describe('createReminder', () => {
  test.each([
    { note: undefined, body: { remindAt: AT } },
    { note: '   ', body: { remindAt: AT } },
    { note: '  call back  ', body: { remindAt: AT, note: 'call back' } },
  ])('note $note → $body', async ({ note, body }) => {
    await createReminder({ projectId: 'proj 1/a', issueId: 'sk-1.2', remindAt: AT, note });
    expect(onlyCall()).toEqual({
      url: '/api/v1/projects/proj%201%2Fa/issues/sk-1.2/reminders',
      method: 'POST',
      body,
    });
  });
});

describe('snoozeReminder', () => {
  test.each([
    { name: 'relative', args: { by: '3h' }, body: { by: '3h' } },
    { name: 'absolute', args: { until: AT }, body: { until: AT } },
    { name: 'absolute wins over relative', args: { by: '1d', until: AT }, body: { until: AT } },
    { name: 'blank reason left out', args: { by: '1w', reason: ' \t ' }, body: { by: '1w' } },
    { name: 'reason trimmed', args: { until: AT, reason: ' busy ' }, body: { until: AT, reason: 'busy' } },
  ])('$name', async ({ args, body }) => {
    await snoozeReminder({ reminderId: 'r 1/x', ...args });
    expect(onlyCall()).toEqual({ url: '/api/v1/reminders/r%201%2Fx/snooze', method: 'POST', body });
  });
});

describe('dismissReminder', () => {
  test.each([
    { note: undefined, body: undefined },
    { note: '  ', body: undefined },
    { note: ' done ', body: { note: 'done' } },
  ])('note $note → $body', async ({ note, body }) => {
    fetchSpy.mockImplementation(async () => new Response(null, { status: 204 }));
    await dismissReminder('r 1/x', note);
    expect(onlyCall()).toEqual({ url: '/api/v1/reminders/r%201%2Fx', method: 'DELETE', body });
  });
});
