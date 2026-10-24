/**
 * apiFetch — thin wrapper around `fetch` for talking to the Skein BFF.
 *
 * Responsibilities:
 *   - Always send the session cookie (`credentials: 'include'`).
 *   - Default Content-Type to JSON when there's a body.
 *   - Translate well-known status codes into typed errors so UI code can
 *     branch on `instanceof` instead of magic numbers.
 */

export class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/**
 * 429 from the BFF or the API. `code` is the machine code of the refusal
 * body (`error`, e.g. `rate_limited`); empty when the body carries none.
 */
export class RateLimitError extends Error {
  constructor(
    message = 'Rate limited',
    public code: string = '',
  ) {
    super(message);
    this.name = 'RateLimitError';
  }
}

/**
 * Business-error 422 from the API. The skein-api ProblemDetails-style body
 * always carries:
 *   - `error`: machine-readable code (e.g. "id_prefix_taken", "alias_taken")
 *   - `message`: human-readable explanation
 *   - any extra structured context (existingProjectId, components, etc.)
 *
 * UI code branches on `code` for known cases and falls back to `message`.
 */
export class BusinessError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code: string = '',
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'BusinessError';
  }
}

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code: string = '',
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ProblemDetailsLike {
  detail?: string;
  title?: string;
  error?: string;
  message?: string;
  [extra: string]: unknown;
}

interface ParsedProblem {
  message: string;
  code: string;
  extra: Record<string, unknown>;
}

async function readProblem(response: Response): Promise<ParsedProblem> {
  try {
    const body = (await response.json()) as ProblemDetailsLike;
    const code = typeof body.error === 'string' ? body.error : '';
    const message =
      (typeof body.message === 'string' && body.message) ||
      (typeof body.detail === 'string' && body.detail) ||
      (typeof body.title === 'string' && body.title) ||
      code ||
      `HTTP ${response.status}`;
    const extra: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (k !== 'error' && k !== 'message' && k !== 'detail' && k !== 'title') {
        extra[k] = v;
      }
    }
    return { message, code, extra };
  } catch {
    return { message: `HTTP ${response.status}`, code: '', extra: {} };
  }
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const hasBody = init.body !== undefined && init.body !== null;
  const headers: Record<string, string> = {
    ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    Accept: 'application/json',
    ...((init.headers as Record<string, string>) || {}),
  };

  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers,
  });

  if (response.status === 401) {
    throw new UnauthorizedError();
  }
  if (response.status === 429) {
    const p = await readProblem(response);
    throw new RateLimitError(p.message, p.code);
  }
  if (response.status === 422) {
    const p = await readProblem(response);
    throw new BusinessError(422, p.message, p.code, p.extra);
  }
  if (!response.ok) {
    const p = await readProblem(response);
    throw new ApiError(response.status, p.message, p.code, p.extra);
  }

  return response;
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, init);
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}
