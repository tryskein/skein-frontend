/**
 * sk-421.3 T04 (R-3, US-2, SC-004) — the shared mechanism "the user's choice
 * in this browser".
 *
 * Extracted from `useEpicSectionMode` (sk-421.2 T016), which was the first and
 * so far the only carrier of these rules. An extraction, not a copy:
 * there are eight caveats below, and a hand-written second copy would drift from the first
 * on the first edit — and having drifted, would give two settings different
 * behaviour on one screen.
 *
 * ─── Why an identifier, not a name ─────────────────────────────────
 *
 * `User.username` is renamed, `User.id` is not. A key on the name
 * would reset the setting on rename and, worse, after a cycle of
 * renames could hand one user another's choice.
 *
 * ─── Why the user comes as a parameter ─────────────────────────────
 *
 * The hook does not reach into the auth context itself: this keeps it pure and
 * testable without a provider, following the `useTreeDepTypes(project)` pattern.
 *
 * ─── What is NOT here, and it is a requirement, not an oversight ───
 *
 * There is no subscription to the `storage` event ON PURPOSE. By acceptance, a second
 * open tab does not pick up someone else's switch: it stays on
 * its own value until reload. A `storage` listener is exactly what
 * would break this, and adding it "for consistency" means violating
 * the acceptance.
 *
 * ─── No user ───────────────────────────────────────────────────────
 *
 * There is no key for them, and writing to a shared slot is forbidden: that is exactly
 * the leak of a choice between accounts that the key by
 * identifier was introduced to prevent. Behaviour as with unavailable storage —
 * the default, and NOTHING goes to disk.
 *
 * ─── Unavailable storage ───────────────────────────────────────────
 *
 * Private mode, a site ban, overflow — any access to
 * `localStorage` may THROW instead of returning null. So both reading and
 * writing are wrapped: on failure the default applies, there is no error on screen,
 * and the new choice lives in memory WHILE THE CONSUMER STAYS MOUNTED CONTINUOUSLY.
 * Promising more is not possible: the boundary is set by the component's lifetime, and the hook itself does not
 * guarantee it (SC-004, A15).
 *
 * ─── Why the predicate and the default are read through a ref ──────
 *
 * The re-read effect must depend ONLY on the user and the key.
 * A caller that passed the predicate as an arrow right in the call would change its
 * identity on every render; if such a predicate got into the dependencies, the
 * effect would fire on every render and reset an unsaved choice
 * to the value read. A ref removes the question entirely, instead of
 * demanding a stable reference from every caller and hoping.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Reads and saves ONE string setting of one user.
 *
 * Returns a pair "current value, set value" — the same shape
 * as `useTreeDepTypes`, so the caller does not learn a second contract.
 *
 * @param keyPrefix storage key without the user, for example
 *   `skein.epic.sectionMode`; the final key is `<keyPrefix>.<userId>`
 * @param userId user identifier, or `null` if it is not yet
 *   resolved
 * @param defaultValue default value
 * @param isValid recognises ITS OWN values: everything else in storage is
 *   another version or a manual edit, and cannot be accepted silently
 */
export function useUserChoice<T extends string>(
  keyPrefix: string,
  userId: string | null,
  defaultValue: T,
  isValid: (raw: unknown) => raw is T,
): readonly [T, (next: T) => void] {
  const isValidRef = useRef(isValid);
  isValidRef.current = isValid;
  const defaultRef = useRef(defaultValue);
  defaultRef.current = defaultValue;

  const read = useCallback(
    (id: string | null): T => {
      if (id === null) return defaultRef.current;
      try {
        const raw = window.localStorage.getItem(`${keyPrefix}.${id}`);
        return isValidRef.current(raw) ? raw : defaultRef.current;
      } catch {
        return defaultRef.current;
      }
    },
    [keyPrefix],
  );

  const [value, setValue] = useState<T>(() => read(userId));

  // The user changed in this same browser — re-read: their choice
  // lies under its own key, and someone else's must not be picked up.
  useEffect(() => {
    setValue(read(userId));
  }, [userId, read]);

  const set = useCallback(
    (next: T) => {
      setValue(next);
      if (userId === null) return;
      try {
        window.localStorage.setItem(`${keyPrefix}.${userId}`, next);
      } catch {
        /* private mode / quota — the choice stays in the consumer's memory */
      }
    },
    [keyPrefix, userId],
  );

  return [value, set] as const;
}
