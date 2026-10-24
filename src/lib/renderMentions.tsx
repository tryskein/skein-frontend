import { Fragment, ReactNode } from 'react';
import { MentionRef } from '../api/issues';
import { UserMention } from '../components/UserMention';

/**
 * Mirror of the backend mention regex
 * (`internal/mentions/parser.go`):
 *
 *   - capture: `@([a-zA-Z0-9][a-zA-Z0-9_-]{2,29})` — first char alnum,
 *     total 3..30 chars from [a-zA-Z0-9_-].
 *   - boundary handling: we don't use a single regex with lookbehind
 *     (it would consume the boundary char and break adjacent mentions
 *     like `@a,@b`); instead we scan for `@` and check the preceding
 *     char manually — same approach as the backend Parse().
 *
 * Why FE matches mixed case while BE matches lowercase only:
 * usernames are stored lowercased per `users.username` CHECK, and the
 * backend Parse() captures only [a-z0-9_-] because it never needs to
 * resolve a mixed-case input — it owns canonicalisation. The FE,
 * however, has to render text typed by humans verbatim. If a user
 * types `@Alice` the BE-shaped regex would silently drop the mention
 * (no underline, no link), even though `mentions[]` carries
 * `{username: "alice", userId: ...}`. By accepting `[A-Za-z0-9_-]`
 * here and lowercasing the captured handle before lookup we keep the
 * FE forgiving without diverging from the BE's canonical resolution.
 */
const usernameBody = /^[A-Za-z0-9][A-Za-z0-9_-]{2,29}/;

function isWordChar(ch: string): boolean {
  // Word char per Postgres / Go regex \w semantics: [0-9A-Za-z_].
  return /^[0-9A-Za-z_]$/.test(ch);
}

/**
 * renderTextWithMentions parses `text` for `@username` mentions and
 * returns a React fragment list. For each mention whose username is
 * in `resolved`, we substitute a <UserMention> link; unresolved
 * `@foo` matches are emitted as plain text (the backend deliberately
 * does NOT resolve non-member usernames so we don't leak membership).
 *
 * Pure function — no hooks. Safe to call from anywhere a React node
 * is expected. Output preserves whitespace and arbitrary text outside
 * mentions verbatim (no markdown / link parsing).
 *
 * The result is always a flat ReactNode array; callers wrap it in
 * whatever container they want (`<Text whiteSpace="pre-wrap">`,
 * `<span>`, etc).
 */
export function renderTextWithMentions(
  text: string,
  resolved: MentionRef[] | null | undefined,
): ReactNode[] {
  if (!text) return [];

  // Build a username → reference lookup once. We only render mentions
  // whose username appears here — unresolved `@foo` stays plain. The
  // whole reference is kept: sk-674.18 T055 — its `status` (departed /
  // deleted + pseudonym) reaches the mention as it reaches every other
  // place people are shown.
  const lookup = new Map<string, MentionRef>();
  for (const m of resolved ?? []) {
    lookup.set(m.username, m);
  }

  const out: ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '@') continue;

    // Boundary check: previous char must be start-of-text or non-word.
    if (i > 0 && isWordChar(text[i - 1])) continue;

    const tail = text.slice(i + 1);
    const match = tail.match(usernameBody);
    if (!match) continue;
    // Preserve the user-typed casing in the rendered token (so `@Alice`
    // stays `@Alice` on screen) but lowercase before the lookup —
    // resolved usernames are always canonical lowercase.
    const typed = match[0];
    const canonical = typed.toLowerCase();

    // Flush plain-text run preceding the mention.
    if (cursor < i) {
      out.push(<Fragment key={`t-${key++}`}>{text.slice(cursor, i)}</Fragment>);
    }

    const ref = lookup.get(canonical);
    if (ref?.userId) {
      out.push(
        <UserMention
          key={`m-${key++}`}
          username={canonical}
          userId={ref.userId}
          status={ref.status}
          // Inline styling — mentions inside body text shouldn't break
          // line-height or contrast; the component's defaults are fine.
          style={{ fontFamily: 'inherit', fontWeight: 600 }}
        />,
      );
    } else {
      // Unresolved → plain text. Includes the `@` so the user still
      // sees what they typed (preserve original casing).
      out.push(
        <Fragment key={`u-${key++}`}>
          {`@${typed}`}
        </Fragment>,
      );
    }

    // Advance past `@username`. The for-loop's trailing i++ then moves
    // i one further, landing on the boundary char (e.g. the ',' in
    // "@alice,@bob") — the next iteration's boundary check correctly
    // treats that non-word char as a valid mention start.
    const consumed = 1 + typed.length;
    i += consumed - 1;
    cursor = i + 1; // i is at last byte of username; cursor is one past it
  }

  // Tail — any remaining text after the last mention.
  if (cursor < text.length) {
    out.push(<Fragment key={`t-${key++}`}>{text.slice(cursor)}</Fragment>);
  }

  return out;
}
