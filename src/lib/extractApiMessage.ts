import { ApiError, BusinessError } from '../api/client';

/**
 * Normalise a mutation/query rejection into the string we surface to
 * the user (toast, inline error frame, form-level message).
 *
 * Extracted verbatim from the 20 byte-identical private copies that
 * lived across `pages/` and `components/` (sk-194 wave C dedup). The
 * branch order is preserved exactly, including the subtle bit that
 * `ApiError` / `BusinessError` return `err.message` RAW — an API error
 * carrying an empty message renders as an empty string, while a plain
 * `Error` with an empty message falls back to 'unknown error'.
 *
 * Deliberately NOT the single normaliser for the whole app — three call
 * sites keep their own variants because their output differs and this
 * refactor must not change any user-visible text:
 *   - `pages/watching.tsx` prefixes BusinessError with `code: `;
 *   - `lib/useReminders.ts` accepts `unknown` and drops the code;
 *   - `pages/shell/details/MoveIssueButton.tsx` falls back to
 *     'failed to move issue' instead of 'unknown error'.
 */
export function extractMessage(err: Error): string {
  if (err instanceof BusinessError || err instanceof ApiError) return err.message;
  return err.message || 'unknown error';
}
