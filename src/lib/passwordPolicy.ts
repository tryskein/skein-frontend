/**
 * The password policy of a NEW password, mirrored from skein-api
 * (`internal/users/store.go#PasswordMinLen`, `#passwordMaxBytes`); the server
 * remains the point of enforcement, the client checks only to spare a
 * pointless round trip.
 *
 * - The minimum counts CHARACTERS (Unicode code points, as Go's
 *   utf8.RuneCountInString does) — not bytes and not `.length` (UTF-16 code
 *   units, which counts an emoji twice).
 * - The maximum counts BYTES of the UTF-8 encoding: bcrypt's structural
 *   ceiling, which a long password in Cyrillic or emoji reaches well before
 *   72 characters.
 */
export const PASSWORD_MIN_CHARS = 12;
export const PASSWORD_MAX_BYTES = 72;

/** Characters (code points) of value. */
export function charLength(value: string): number {
  return Array.from(value).length;
}

/** Bytes of value once UTF-8 encoded. */
export function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** What a new password breaks: too short, too long, or nothing (null). */
export function passwordProblem(value: string): 'tooShort' | 'tooLong' | null {
  if (charLength(value) < PASSWORD_MIN_CHARS) return 'tooShort';
  if (byteLength(value) > PASSWORD_MAX_BYTES) return 'tooLong';
  return null;
}
