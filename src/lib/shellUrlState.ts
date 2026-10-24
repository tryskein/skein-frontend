/**
 * sk-303.13 (T027) — shell state that lives in the ADDRESS.
 *
 * The left column's active tab and the lens (On me / Delegated /
 * Reminders) used to live only in localStorage: nothing in the URL said
 * which queue or lens the user was looking at, so an inbox view could
 * not be linked to, bookmarked, or restored by back/forward.
 *
 * They are query PARAMETERS, not path segments (R-10): the path is
 * fully occupied by entity selection (project / component / issue), and
 * orthogonal state cannot go there without multiplying every route.
 * Living in the query string also lets them coexist with the
 * pre-existing `?file=` attachment-viewer parameter (US-10).
 *
 * sk-674.18 T052 — it also owns the PATH of the place «space»
 * (`/spaces/<id>-<slug>[/issues/:id]`): how the segment is built and which
 * part of it identifies the space.
 *
 * This module is the whole vocabulary plus the pure search-string math.
 * `useLayoutState` is its only production consumer; keeping the parsing
 * and the functional URLSearchParams update here makes both unit-
 * testable without a router and made the Outbox removal (US-9) a single
 * list to delete from.
 */

/**
 * Every tab the left column can show, in render order.
 *
 * `outbox` used to be here. US-9 removed that surface, and deleting the
 * entry WAS the entire URL-side change: a saved `?tab=outbox` link now
 * parses as unknown, so `normalizeShellSearch` strips it and the column
 * falls back to `inbox` — exactly the documented edge case ("stored UI
 * state points at a removed tab → go to Inbox, not an empty screen").
 * Any tab removed later inherits the same behaviour for free.
 */
export const INBOX_TABS = ['inbox', 'mentions', 'watching'] as const;
export type InboxTab = (typeof INBOX_TABS)[number];

/** The three lenses, mutually exclusive by construction — one key, one value. */
export const LENSES = ['on-me', 'delegated', 'budilnik'] as const;
export type Lens = (typeof LENSES)[number];

/**
 * sk-303.14 (T024) — the SELECTION applied to the surface a lens opens.
 *
 * A second parameter beside `?lens=`, and deliberately a separate axis:
 * the lens says WHICH surface, the selection says WHICH SUBSET of it. One
 * value today — `unreviewed`, the set of closed results the caller
 * delegated and has not marked reviewed (US-2) — so the union is a union
 * of one, not a boolean, and a second selection later costs one entry.
 *
 * It lives in the address for the same reason the lens does: the jump to
 * the unreviewed set is one action, and the state it lands on has to be
 * reproducible from the URL alone — a bookmark, a shared link, a tap on a
 * push notification all have to open the same thing. That is also what
 * makes the first frame a SYNCHRONOUS derivation: the parameter is read
 * during render, so the filters the list query builds in that very render
 * already carry the selection, instead of being seeded afterwards by an
 * effect (which fires after the first request has already gone out).
 *
 * Unlike `?lens=` there is NO localStorage fallback: a selection is where
 * you jumped to, not a preference you keep. An address that says nothing
 * about it means "no selection".
 */
export const SELECTS = ['unreviewed'] as const;
export type ShellSelect = (typeof SELECTS)[number];

/**
 * sk-303.14 — the route the SERVER's unreviewed digest encodes when it
 * carries more than one issue, transcribed from
 * `skein-api/src/internal/outbox/digest.go` (`digestRouteUnreviewed`).
 *
 * Kept here as a literal ON PURPOSE, and it is not a third copy of the
 * URL-building rules: nothing in the app navigates BY this constant. The
 * jump beside the Delegated toggle goes through
 * `setUnreviewedSelected(true)` → `setLens('delegated', 'unreviewed')`,
 * which composes the address out of `LENS_PARAM` / `SELECT_PARAM` and the
 * lens-cycle bookkeeping. So this string and the app's own navigation are
 * two independent producers of one state, and matrix row 119 — "the jump
 * from the control opens the same state the digest encodes in its route" —
 * is a real comparison rather than a tautology. If the two ever drift, one
 * of them is wrong and the row says so.
 */
export const UNREVIEWED_DIGEST_ROUTE = '/?lens=delegated&select=unreviewed';

export const TAB_PARAM = 'tab';
export const LENS_PARAM = 'lens';
export const SELECT_PARAM = 'select';
/** sk-41 — attachment viewer parameter; predates this module. */
export const FILE_PARAM = 'file';

/** Tab shown when nothing valid is known (address silent AND storage unusable). */
export const DEFAULT_TAB: InboxTab = 'inbox';

/**
 * Parse a raw `?tab=` value. Unknown values (typo, removed tab, stale
 * bookmark) return `null` — the caller treats that as "the address has
 * no opinion" and normalises the URL.
 */
export function parseTab(raw: string | null | undefined): InboxTab | null {
  if (raw === null || raw === undefined) return null;
  return (INBOX_TABS as readonly string[]).includes(raw) ? (raw as InboxTab) : null;
}

/** Parse a raw `?lens=` value. Unknown → `null`, same contract as `parseTab`. */
export function parseLens(raw: string | null | undefined): Lens | null {
  if (raw === null || raw === undefined) return null;
  return (LENSES as readonly string[]).includes(raw) ? (raw as Lens) : null;
}

/** Parse a raw `?select=` value. Unknown → `null`, same contract as `parseTab`. */
export function parseSelect(raw: string | null | undefined): ShellSelect | null {
  if (raw === null || raw === undefined) return null;
  return (SELECTS as readonly string[]).includes(raw) ? (raw as ShellSelect) : null;
}

/**
 * Functional update of a search string: start from what the URL
 * currently carries, apply the patch, keep everything else.
 *
 * A `null` value deletes the key. Every parameter that is not named in
 * the patch survives verbatim — this is what keeps `?file=` (and any
 * parameter added later) alive across a tab or lens change, instead of
 * the "build a fresh URLSearchParams from the two keys I know about"
 * shape that silently drops the rest.
 *
 * Returns a leading-`?` search string, or `''` when no parameters are
 * left (so callers can hand it straight to `navigate({ search })`
 * without producing a bare trailing `?`).
 */
export function updateSearch(
  search: string | URLSearchParams,
  patch: Record<string, string | null>,
): string {
  const next = new URLSearchParams(
    typeof search === 'string' ? search : search.toString(),
  );
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) next.delete(key);
    else next.set(key, value);
  }
  const out = next.toString();
  return out === '' ? '' : `?${out}`;
}

/**
 * Detect a `tab` / `lens` / `select` value the app cannot honour and
 * return the cleaned-up search string; `null` means the address is
 * already clean.
 *
 * Callers apply the result with `replace: true` — a normalisation is a
 * correction of the current entry, not a place the user navigated to,
 * so it must not add a history entry (pressing Back would otherwise
 * bounce between the bad URL and its fix).
 *
 * Only unknown VALUES are stripped — with one cross-parameter rule
 * (sk-303.14, B/1 review W1): `?select=` is meaningful only beside
 * `?lens=delegated`, because that is the only surface the selection
 * narrows, so a `select` the address cannot pair with its lens is a value
 * the app cannot honour just as much as a misspelt one. Stripping it is
 * what keeps the parameter free of a storage fallback: without this, an
 * address silent about the lens would still narrow for a reader whose
 * stored lens happened to be Delegated.
 *
 * A missing parameter is not an error: it means the address says nothing
 * about that dimension.
 */
export function normalizeShellSearch(search: string | URLSearchParams): string | null {
  const params = new URLSearchParams(
    typeof search === 'string' ? search : search.toString(),
  );
  const patch: Record<string, string | null> = {};
  const rawTab = params.get(TAB_PARAM);
  if (rawTab !== null && parseTab(rawTab) === null) patch[TAB_PARAM] = null;
  const rawLens = params.get(LENS_PARAM);
  if (rawLens !== null && parseLens(rawLens) === null) patch[LENS_PARAM] = null;
  const rawSelect = params.get(SELECT_PARAM);
  if (
    rawSelect !== null
    && (parseSelect(rawSelect) === null || parseLens(rawLens) !== 'delegated')
  ) {
    patch[SELECT_PARAM] = null;
  }
  if (Object.keys(patch).length === 0) return null;
  return updateSearch(params, patch);
}

// ───────────────────────── The place «space» ─────────────────────────

/**
 * sk-674.18 T052 — the address segment of a space, `<id>-<slug>` (screens
 * 1.1, 1.16; spaces contract: the id is an 8-character base32 short id,
 * the slug is derived from the name and never looked up). It is decoration
 * for the reader of the address: a renamed space keeps working under its
 * old slug, and a slug alone finds nothing.
 */
export function spaceHandle(space: { id: string; slug: string }): string {
  return space.slug === '' ? space.id : `${space.id}-${space.slug}`;
}

/**
 * The space id a `/spaces/:space` segment names — everything before the
 * first `-` (the short id has none). The slug after it plays no part:
 * `k3x9p2qa-acme` and `k3x9p2qa-old-name` name the same space. An empty
 * segment or an empty id is `null` — an address that names no space.
 */
export function parseSpaceHandle(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const dash = raw.indexOf('-');
  const id = dash === -1 ? raw : raw.slice(0, dash);
  return id === '' ? null : id;
}

/**
 * The path of the place «space», optionally with an issue open in it:
 * `/spaces/<handle>` or `/spaces/<handle>/issues/<id>`. `handle` is the
 * address segment as it stands (`spaceHandle`), kept verbatim so a
 * navigation inside the place does not rewrite the slug the reader came
 * with.
 */
export function spacePath(handle: string, issueId?: string | null): string {
  const base = `/spaces/${encodeURIComponent(handle)}`;
  return issueId ? `${base}/issues/${encodeURIComponent(issueId)}` : base;
}
