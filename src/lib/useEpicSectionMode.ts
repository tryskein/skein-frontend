/**
 * sk-421.2 T016 (US-2, R-6, SC-007) — memory of the epic section's display mode.
 *
 * The epic section shows children as a "List" or a "Tree". The choice is ONE
 * setting per user in this browser, shared by ALL epics: not per
 * project and not per task. So the storage key carries the user id
 * and nothing else.
 *
 * ─── Where the rules live now ──────────────────────────────────────
 *
 * sk-421.3 T04: the mechanism "read / write the user's choice in this
 * browser" moved to `useUserChoice` — key by `User.id`, no
 * subscription to `storage`, "no user — default and nothing is
 * written", throwing storage. All caveats and arguments are written there
 * in one text; what remains here is only what is specific to the mode:
 * the value set and the default.
 *
 * The state "user not yet resolved" never occurs inside the section —
 * `RequireAuth` renders `<Outlet />` only for a non-empty user
 * (`RequireAuth.tsx:30`), and before that shows a spinner or redirects to login.
 * The hook still accepts `User | null`: that is the caller's type, and
 * coercing null to an empty string would create one shared slot for
 * everyone.
 *
 * ─── Lifetime of an unsaved choice ─────────────────────────────────
 *
 * When the write fails the choice lives WHILE THE SECTION STAYS MOUNTED CONTINUOUSLY
 * (SC-004, A15) — not "until the end of the tab's life", as this used to say
 * before. The difference is not verbal: the panel stops rendering the section on
 * several paths (card load, card failure, navigation through a
 * non-epic task), and on each of them the unsaved choice is lost although
 * the tab is alive.
 */

import { useUserChoice } from './useUserChoice';

/** Mode of showing children in the epic section. */
export type EpicSectionMode = 'list' | 'tree';

/** Default is "List" (US-2). */
const DEFAULT_MODE: EpicSectionMode = 'list';

/** Storage key without a user; the final one is `<this>.<userId>`. */
const KEY_PREFIX = 'skein.epic.sectionMode';

/**
 * Declared at module level, not as an arrow in the call: the predicate here
 * is the same for the whole lifetime of the hook.
 */
function isMode(value: unknown): value is EpicSectionMode {
  return value === 'list' || value === 'tree';
}

/**
 * Reads and saves the chosen epic section mode for one
 * user.
 */
export function useEpicSectionMode(
  userId: string | null,
): readonly [EpicSectionMode, (next: EpicSectionMode) => void] {
  return useUserChoice(KEY_PREFIX, userId, DEFAULT_MODE, isMode);
}
