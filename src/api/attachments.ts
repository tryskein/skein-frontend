/**
 * Attachments API client (R4.2).
 *
 * Three traits make this file unusual compared to other api/*.ts:
 *
 *   1. Direct-to-MinIO upload via multipart/form-data POST. The browser
 *      uploads bytes to MinIO using a presigned policy minted by the
 *      backend — skein-api never proxies file content.
 *
 *   2. XHR (not fetch) for the upload phase, because progress events
 *      are not part of the fetch streaming model in any browser yet.
 *
 *   3. Three-step lifecycle: upload-url → multipart POST → confirm.
 *      Helpers expose each step plus an `uploadAttachment()` orchestrator
 *      that does all three in one call (the React component uses this).
 *
 * Wire shapes mirror skein-api/internal/attachments/types.go (camelCase).
 */

import { apiJson, apiFetch, BusinessError } from './client';

// ───────────────────────── Wire DTOs ─────────────────────────

export type AttachmentStatus = 'pending' | 'ready';

/** One row as returned by the API. */
export interface Attachment {
  id: string;
  issueId: string;
  /** Optional: comment-scoped attachments populate this. */
  commentId?: string | null;
  filename: string;
  contentType: string;
  sizeBytes: number;
  status: AttachmentStatus;
  uploadedBy: string;
  uploadedByUsername?: string | null;
  uploadedAt: string;
}

/** GET /issues/{id}/attachments. */
export interface AttachmentList {
  items: Attachment[];
  total: number;
}

/** Body for POST .../upload-url. */
export interface UploadURLRequest {
  filename: string;
  contentType: string;
  sizeBytes: number;
  /** Optional: scope to a comment under the issue. */
  commentId?: string;
}

/** Response from POST .../upload-url. */
export interface UploadURLResponse {
  attachmentId: string;
  url: string;
  fields: Record<string, string>;
  expiresAt: string;
  sizeBytes: number;
  maxSizeBytes: number;
}

/** Response from GET /attachments/{id}/download-url. */
export interface DownloadURLResponse {
  url: string;
  expiresAt: string;
}

// ───────────────────────── Calls into skein-api (BFF) ─────────────────────────

export async function listAttachments(issueId: string): Promise<AttachmentList> {
  return apiJson<AttachmentList>(
    `/api/v1/issues/${encodeURIComponent(issueId)}/attachments`,
  );
}

export async function requestUploadURL(
  issueId: string,
  body: UploadURLRequest,
): Promise<UploadURLResponse> {
  return apiJson<UploadURLResponse>(
    `/api/v1/issues/${encodeURIComponent(issueId)}/attachments/upload-url`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );
}

export async function confirmAttachment(attachmentId: string): Promise<Attachment> {
  const raw = await apiJson<unknown>(
    `/api/v1/attachments/${encodeURIComponent(attachmentId)}/confirm`,
    { method: 'POST', body: '{}' },
  );
  // The REST handler returns the bare DTO; the MCP tool wraps under
  // `attachment`. Tolerate both shapes for forward-compat — but reject
  // anything that doesn't structurally look like an Attachment so a
  // server bug surfaces here rather than poisoning the cache.
  if (isAttachment(raw)) {
    return raw;
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const wrapped = (raw as { attachment?: unknown }).attachment;
    if (isAttachment(wrapped)) {
      return wrapped;
    }
  }
  throw new Error('confirmAttachment: malformed response from server');
}

/**
 * Hand-rolled type guard. Exported so tests can pin the contract; the
 * runtime cost is one isObject check + a handful of `typeof`s, so we
 * don't bother with zod for this single shape.
 */
export function isAttachment(value: unknown): value is Attachment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string'
    && typeof v.issueId === 'string'
    && typeof v.filename === 'string'
    && typeof v.contentType === 'string'
    && typeof v.sizeBytes === 'number'
    && (v.status === 'pending' || v.status === 'ready')
    && typeof v.uploadedBy === 'string'
    && typeof v.uploadedAt === 'string'
  );
}

export async function getDownloadURL(attachmentId: string): Promise<DownloadURLResponse> {
  return apiJson<DownloadURLResponse>(
    `/api/v1/attachments/${encodeURIComponent(attachmentId)}/download-url`,
  );
}

export async function deleteAttachment(attachmentId: string): Promise<void> {
  await apiFetch(
    `/api/v1/attachments/${encodeURIComponent(attachmentId)}`,
    { method: 'DELETE' },
  );
}

// ───────────────────────── Direct-to-MinIO upload (XHR) ─────────────────────────

/** Progress callback. Fired multiple times during upload. */
export type ProgressFn = (loaded: number, total: number) => void;

/**
 * Posts the file to MinIO via the presigned policy. Resolves on 2xx,
 * rejects with a typed Error on any failure.
 *
 * We use XHR because fetch has no progress events on upload yet —
 * ReadableStream upload progress is shipping but not in older Safari
 * builds. XHR works everywhere we care about.
 */
export function uploadFileToS3(
  policy: UploadURLResponse,
  file: File,
  onProgress?: ProgressFn,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', policy.url, true);

    let onAbort: (() => void) | undefined;
    const removeAbortListener = () => {
      if (signal && onAbort) {
        signal.removeEventListener('abort', onAbort);
        onAbort = undefined;
      }
    };

    if (signal) {
      if (signal.aborted) {
        reject(new DOMException('aborted', 'AbortError'));
        return;
      }
      onAbort = () => xhr.abort();
      signal.addEventListener('abort', onAbort);
    }

    xhr.upload.onprogress = (ev) => {
      if (onProgress && ev.lengthComputable) {
        onProgress(ev.loaded, ev.total);
      }
    };
    xhr.onload = () => {
      removeAbortListener();
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      reject(new Error(`upload failed: HTTP ${xhr.status} ${xhr.statusText}`));
    };
    xhr.onerror = () => {
      removeAbortListener();
      reject(new Error('upload failed: network error'));
    };
    xhr.onabort = () => {
      removeAbortListener();
      reject(new DOMException('aborted', 'AbortError'));
    };

    // Build the form. Order does not matter — MinIO reads the file last
    // by convention but the SDK's policy doc enforces every binding
    // independently of field order.
    const form = new FormData();
    for (const [k, v] of Object.entries(policy.fields)) {
      form.append(k, v);
    }
    form.append('file', file);
    xhr.send(form);
  });
}

/**
 * One-call orchestrator: upload-url → S3 POST → confirm.
 *
 * Used by AttachmentDropzone.tsx. The component supplies an onProgress
 * callback to drive its UI; on any failure the helper bubbles the error
 * up so the component can render a message and let the user retry.
 */
export async function uploadAttachment(
  issueId: string,
  file: File,
  onProgress?: ProgressFn,
  signal?: AbortSignal,
  commentId?: string,
): Promise<Attachment> {
  const policy = await requestUploadURL(issueId, {
    filename: file.name,
    contentType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
    ...(commentId ? { commentId } : {}),
  });
  await uploadFileToS3(policy, file, onProgress, signal);
  return confirmAttachment(policy.attachmentId);
}

// ───────────────────────── Helpers ─────────────────────────

/**
 * Client-side cap on file size. The server is the source of truth (see
 * skein-api/internal/attachments/store.go — currently 500 MiB), but we
 * gate at the dropzone too so a multi-GB drop doesn't round-trip MinIO
 * before failing.
 *
 * TODO(R4.3): wire to a config endpoint or Vite env var so client and
 * server stay aligned automatically. Hardcoded here for now to mirror
 * the server constant.
 */
export const ATTACHMENT_MAX_BYTES = 500 * 1024 * 1024; // 500 MiB


/** Format bytes as a short human string. Avoids extra deps. */
export function formatSize(bytes: number): string {
  // Guard NaN / Infinity / negative — the helper is exported and
  // sizeBytes flows in from the wire as `number`, so a server bug must
  // not bubble out as "NaN GB".
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

/**
 * True iff the error is a 422 from /upload-url indicating the file's
 * extension is denied (executable). UI uses this to show a specific
 * message rather than the generic "validation failed".
 */
export function isMimeBlocked(err: unknown): boolean {
  return err instanceof BusinessError && err.code === 'mime_blocked';
}

/** True iff the file size exceeds the API cap. */
export function isFileTooLarge(err: unknown): boolean {
  return err instanceof BusinessError && err.code === 'file_too_large';
}

/** True iff the issue already has 100 attachments. */
export function isAttachmentLimitExceeded(err: unknown): boolean {
  return err instanceof BusinessError && err.code === 'attachment_limit_exceeded';
}
