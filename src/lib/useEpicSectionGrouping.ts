/**
 * sk-421.3 T04 (US-2, R-3, SC-004, A1) — memory of the grouping choice
 * of the epic section "List".
 *
 * A second setting on the same mechanism as the section mode
 * (`useUserChoice`): one per user in this browser, shared by ALL
 * epics. All the caveats — the key by `User.id`, no subscription to
 * `storage`, behaviour without a user and with a throwing storage —
 * are written in `useUserChoice` and not repeated here.
 *
 * ─── How it differs from the model ─────────────────────────────────
 *
 * By the default, and this is the only difference: grouping is ON
 * by default (A1), whereas the default mode is "List". A setting
 * the user has not touched shows the children assembled by
 * category.
 *
 * ─── Why the value is a string, not a boolean ──────────────────────
 *
 * The storage keeps strings, and the shared mechanism works with a string
 * union. A boolean API would require encoding on input and parsing
 * on output — that is, a second place that decides what counts as
 * "on", and what to do with garbage in the storage. There are two values, they are
 * named, and they are recognized by the same predicate as in the model.
 */

import { useUserChoice } from './useUserChoice';

/** The "List" grouping state. */
export type EpicSectionGrouping = 'on' | 'off';

/** By default grouping is on (A1) — a difference from the model. */
const DEFAULT_GROUPING: EpicSectionGrouping = 'on';

/** The storage key without a user; the final one is `<this>.<userId>`. */
const KEY_PREFIX = 'skein.epic.sectionGrouping';

function isGrouping(value: unknown): value is EpicSectionGrouping {
  return value === 'on' || value === 'off';
}

/**
 * Reads and saves the grouping choice of the epic section for one
 * user.
 */
export function useEpicSectionGrouping(
  userId: string | null,
): readonly [EpicSectionGrouping, (next: EpicSectionGrouping) => void] {
  return useUserChoice(KEY_PREFIX, userId, DEFAULT_GROUPING, isGrouping);
}
