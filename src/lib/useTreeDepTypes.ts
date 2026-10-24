/**
 * sk-36 F1 — per-project chip-row state for the layered tree view.
 *
 * Stores the set of typed-deps edges the user has toggled ON for the
 * Tasks-column tree (and the EpicProgressSection children list). Mirrors
 * the per-project tree-expanded plumbing in `TasksColumn.tsx`
 * (`skein.tasks.tree.{project}.expanded`) so different projects don't
 * clobber each other's lens preferences.
 *
 * Invariants:
 *   - `parent-child` is mandatory-on: the spine of the hierarchy never
 *     gets toggled off. The setter always merges `parent-child` into
 *     the supplied next set.
 *   - Default = `Set(['parent-child'])` (spine only).
 *   - Cross-project surface (no project selected) shares one slot keyed
 *     by `__cross__`.
 *
 * Storage key: `skein.tasks.tree.${project ?? '__cross__'}.depTypes`.
 * Serialised as `JSON.stringify([...set].sort())` so the on-disk shape
 * is canonical (sorted strings) regardless of insertion order.
 */

import { useCallback, useEffect, useState } from 'react';
import type { DepType } from '../api/dependencies';

const MANDATORY: DepType = 'parent-child';

function storageKey(project: string | null): string {
  return `skein.tasks.tree.${project ?? '__cross__'}.depTypes`;
}

function serialise(set: ReadonlySet<DepType>): string {
  return JSON.stringify([...set].sort());
}

function readFromStorage(project: string | null): Set<DepType> {
  const fallback = new Set<DepType>([MANDATORY]);
  try {
    const raw = window.localStorage.getItem(storageKey(project));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback;
    const out = new Set<DepType>();
    for (const s of parsed) {
      if (typeof s === 'string') {
        out.add(s as DepType);
      }
    }
    // Enforce the spine invariant even on read — guards against an
    // older release that may have written `parent-child` out.
    out.add(MANDATORY);
    return out;
  } catch {
    return fallback;
  }
}

/**
 * Read + persist the per-project tree dep-type lens set. The returned
 * setter normalises the input — `parent-child` is always re-merged so
 * the spine stays on, and the storage write is canonical-sorted.
 */
export function useTreeDepTypes(
  project: string | null,
): readonly [ReadonlySet<DepType>, (next: ReadonlySet<DepType>) => void] {
  const [state, setState] = useState<Set<DepType>>(() =>
    readFromStorage(project),
  );

  // Re-read whenever the project changes so cross-project ↔ project
  // navigation surfaces each scope's saved preferences.
  useEffect(() => {
    setState(readFromStorage(project));
  }, [project]);

  const set = useCallback(
    (next: ReadonlySet<DepType>) => {
      // Always enforce `parent-child` membership — the chip row in the
      // UI ALSO renders this as disabled+checked, but a stray setter
      // call from elsewhere mustn't bypass the invariant.
      const normalised = new Set<DepType>([MANDATORY, ...next]);
      setState(normalised);
      try {
        window.localStorage.setItem(storageKey(project), serialise(normalised));
      } catch {
        /* private-mode / quota — silently ignore, in-memory state still tracks the toggle */
      }
    },
    [project],
  );

  return [state, set] as const;
}
