/**
 * sk-1048.51 — `uploadAttachment` from the upload URL to the confirmation.
 *
 * Contract (`attachments.ts#uploadAttachment`): POST
 * `/api/v1/issues/{id}/attachments/upload-url` with the file's name, type
 * (`application/octet-stream` when the browser gives none), size and the
 * optional comment; then a multipart POST of the presigned fields and the file
 * to the storage URL, reporting progress; then POST
 * `/api/v1/attachments/{attachmentId}/confirm`, whose attachment is the result.
 * A failed or cancelled transfer rejects and is never confirmed.
 *
 * `fetch` (the API) and `XMLHttpRequest` (the storage POST) are the stubbed
 * boundaries; the test drives the transfer's events itself.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { uploadAttachment, type Attachment } from './attachments';

const log: string[] = [];

class FakeXhr {
  static sent: FakeXhr[] = [];
  upload: { onprogress: ((ev: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  status = 0;
  statusText = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  method = '';
  url = '';
  body: FormData | null = null;
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  send(body: FormData) {
    this.body = body;
    log.push(`xhr ${this.method} ${this.url}`);
    FakeXhr.sent.push(this);
  }
  abort() {
    this.onabort?.();
  }
}

const POLICY = {
  attachmentId: 'att 1',
  url: 'https://storage.test/bucket',
  fields: { key: 'issues/sk-1/att-1', policy: 'cG9saWN5' },
  expiresAt: '2026-12-01T00:00:00Z',
  sizeBytes: 5,
  maxSizeBytes: 1024,
};

const ATTACHMENT: Attachment = {
  id: 'att 1', issueId: 'sk-1', filename: 'notes.txt', contentType: 'text/plain', sizeBytes: 5,
  status: 'ready', uploadedBy: 'u-1', uploadedAt: '2026-11-23T10:00:00Z',
} as Attachment;

const fetchSpy = vi.fn<typeof fetch>();

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  log.length = 0;
  FakeXhr.sent = [];
  fetchSpy.mockReset();
  fetchSpy.mockImplementation(async (url, init) => {
    log.push(`fetch ${init?.method} ${String(url)}`);
    return String(url).endsWith('/upload-url') ? json(POLICY) : json(ATTACHMENT);
  });
  vi.stubGlobal('fetch', fetchSpy);
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
});

afterEach(() => vi.unstubAllGlobals());

async function transfer(): Promise<FakeXhr> {
  await vi.waitFor(() => expect(FakeXhr.sent).toHaveLength(1));
  return FakeXhr.sent[0];
}

const confirmed = () => log.filter((l) => l.includes('/confirm'));

describe('uploadAttachment', () => {
  test('asks for the upload URL, sends the file with the policy, reports progress, then confirms', async () => {
    const onProgress = vi.fn();
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });

    const pending = uploadAttachment('sk-1', file, onProgress, undefined, 'c-9');
    const xhr = await transfer();
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 2, total: 5 });
    xhr.upload.onprogress?.({ lengthComputable: false, loaded: 3, total: 0 });
    xhr.status = 204;
    xhr.onload?.();

    await expect(pending).resolves.toEqual(ATTACHMENT);
    expect(log).toEqual([
      'fetch POST /api/v1/issues/sk-1/attachments/upload-url',
      'xhr POST https://storage.test/bucket',
      'fetch POST /api/v1/attachments/att%201/confirm',
    ]);
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))).toEqual({
      filename: 'notes.txt', contentType: 'text/plain', sizeBytes: 5, commentId: 'c-9',
    });
    expect(xhr.body?.get('key')).toBe('issues/sk-1/att-1');
    expect(xhr.body?.get('policy')).toBe('cG9saWN5');
    expect(xhr.body?.get('file')).toBeInstanceOf(File);
    expect(onProgress.mock.calls).toEqual([[2, 5]]);
    expect(JSON.parse(String(fetchSpy.mock.calls[1][1]?.body))).toEqual({});
  });

  test.each([200, 299])('storage status %i is a finished transfer', async (status) => {
    const pending = uploadAttachment('sk-1', new File(['hello'], 'notes.txt'));
    const xhr = await transfer();
    xhr.status = status;
    xhr.onload?.();
    await expect(pending).resolves.toEqual(ATTACHMENT);
  });

  test('a confirmation answered as { attachment } yields that attachment; a malformed one rejects', async () => {
    fetchSpy.mockImplementation(async (url) => (String(url).endsWith('/upload-url')
      ? json(POLICY)
      : json({ attachment: ATTACHMENT })));
    const wrapped = uploadAttachment('sk-1', new File(['hello'], 'notes.txt'));
    (await transfer()).status = 204;
    FakeXhr.sent[0].onload?.();
    await expect(wrapped).resolves.toEqual(ATTACHMENT);

    FakeXhr.sent = [];
    fetchSpy.mockImplementation(async (url) => (String(url).endsWith('/upload-url')
      ? json(POLICY)
      : json({ attachment: { id: 'att 1' } })));
    const malformed = uploadAttachment('sk-1', new File(['hello'], 'notes.txt'));
    (await transfer()).status = 204;
    FakeXhr.sent[0].onload?.();
    await expect(malformed).rejects.toThrow(Error);
  });

  test('a file without a type is sent as octet-stream, and no comment means no commentId', async () => {
    const pending = uploadAttachment('sk-1', new File(['hello'], 'blob.bin'));
    const xhr = await transfer();
    xhr.status = 201;
    xhr.onload?.();
    await pending;

    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))).toEqual({
      filename: 'blob.bin', contentType: 'application/octet-stream', sizeBytes: 5,
    });
  });

  test.each([
    {
      name: 'a refused transfer',
      fail: (xhr: FakeXhr) => { xhr.status = 403; xhr.statusText = 'Forbidden'; xhr.onload?.(); },
    },
    {
      name: 'a redirect status',
      fail: (xhr: FakeXhr) => { xhr.status = 300; xhr.onload?.(); },
    },
    { name: 'a network failure', fail: (xhr: FakeXhr) => xhr.onerror?.() },
  ])('$name rejects and is not confirmed', async ({ fail }) => {
    const pending = uploadAttachment('sk-1', new File(['hello'], 'notes.txt', { type: 'text/plain' }));
    fail(await transfer());

    await expect(pending).rejects.toThrow(Error);
    expect(confirmed()).toEqual([]);
  });

  test('a signal already cancelled before the transfer rejects without sending the file', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(uploadAttachment('sk-1', new File(['hello'], 'notes.txt'), undefined, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeXhr.sent).toHaveLength(0);
    expect(confirmed()).toEqual([]);
  });

  test('a cancel during the transfer rejects with AbortError and is not confirmed', async () => {
    const controller = new AbortController();
    const pending = uploadAttachment('sk-1', new File(['hello'], 'notes.txt'), undefined, controller.signal);
    await transfer();

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(confirmed()).toEqual([]);
  });
});
