/**
 * Shared query-string builder for the REST clients in `src/api/`.
 *
 * Extracted verbatim from the byte-identical copies that lived in
 * `activity.ts`, `dashboard.ts`, `notifications.ts` and `projects.ts`
 * (sk-194 wave C dedup) — the encoding contract is unchanged:
 *
 *   - `undefined`, `null` and the empty string are DROPPED (an absent
 *     param and an empty one mean the same thing to the backend
 *     handlers, which all treat "" as "not supplied");
 *   - every other value is stringified via `String(v)` and percent-
 *     encoded with `encodeURIComponent` on BOTH key and value (so a
 *     space encodes as `%20`, not `+` — this differs from
 *     `URLSearchParams`, which is why `users.ts` keeps its own path);
 *   - the result carries its own leading `?`, or is empty when every
 *     param was dropped, so call sites can concatenate unconditionally.
 */
export function buildQuery(
  params: Record<string, string | number | boolean | null | undefined>,
): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}
