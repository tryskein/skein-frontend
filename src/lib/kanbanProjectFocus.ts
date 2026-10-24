/**
 * sk-285.2.6 — the board's project focus.
 *
 * The reason this whole stage exists, in the words of its own brief:
 * people arriving from YouTrack "no need to see all projects at once — they
 * are focused on a few". The Projects column already answers
 * "show me ONE project", and the cross-project surface answers "show me
 * EVERYTHING". Focus is the missing third answer: these two or three.
 *
 * It is a lens over the rows the board already has, not a second query:
 * `useTasks` still fetches the same cross-project page under the same
 * shared filters, and the focus narrows what the board projects out of
 * it. That keeps the promise the research made (§3.4 — the board is a
 * view of one task set, never a second source of truth).
 *
 * ── How it agrees with the Projects column ────────────────────────
 *
 * Both mechanisms answer the same question at different scales, so one
 * of them has to yield, and it must be the one the user did not just
 * click. Clicking a project in the left column is an explicit, immediate
 * act; the focus set is a preference saved days ago. Therefore:
 *
 *   selectedProject === null  → focus APPLIES  (`'active'`)
 *   selectedProject !== null  → focus PAUSES   (`'paused'`)
 *
 * Pausing rather than clearing is the whole point. The alternative —
 * intersecting the two — produces the one outcome a user can never
 * explain: pick `shop` in the column while focused on `mob`+`pay` and
 * the board goes blank, with two controls each insisting they are on.
 * And clearing the set on a project click would silently destroy a
 * saved preference with a navigation gesture. So the narrower, explicit
 * choice wins, the broader saved one waits its turn — and says so on the
 * board, because a paused setting that stays silent is indistinguishable
 * from a broken one.
 *
 * ── On the place «space» (sk-674.18 T052) ─────────────────────────
 *
 * A space is a place between the two (screens 1.9, decision of stage 1):
 * the focus keeps working there, but only INSIDE the space — the board
 * shows the focused projects of this space, the picker offers only this
 * space's projects, and the projects of other spaces stay in the saved
 * set untouched for when the user goes back. If the saved set holds no
 * project of this space, intersecting would blank the board for the same
 * reason as above, so the focus PAUSES and the board says why.
 *
 * ── Why project UUIDs and not handles ─────────────────────────────
 *
 * The set is matched against `IssueSummary.projectId`, which is a uuid.
 * Storing handles would mean resolving the projects list before the
 * board could filter a single row, and a renamed handle would quietly
 * drop a project out of the user's focus. The uuid is the identity;
 * the handle is a label the picker resolves for display.
 */

/** The user's chosen project set. Empty = the whole cross-project board. */
export type ProjectFocus = ReadonlySet<string>;

/** Shared "no focus" value — a stable reference for hook deps / memos. */
export const EMPTY_PROJECT_FOCUS: ProjectFocus = new Set<string>();

/**
 * What the focus is doing right now.
 *
 * `'off'`    — the set is empty: the board shows every visible project.
 * `'active'` — the set narrows the board (cross-project surface).
 * `'paused'` — a single project is open, so the column's choice governs
 *              and the focus is held, unapplied, until the user goes
 *              back to «All projects».
 */
export type ProjectFocusState = 'off' | 'active' | 'paused';

/**
 * Read the stored value.
 *
 * CSV, because that is what the sibling card-field preference uses and
 * because a hand-inspectable storage value is worth more here than a
 * JSON envelope. Unlike that preference, an EMPTY value carries no
 * special meaning: no focus and an empty focus are the same board, so
 * both collapse to the empty set.
 */
export function parseProjectFocus(raw: string | null | undefined): ProjectFocus {
  if (!raw) return new Set<string>();
  const out = new Set<string>();
  for (const part of raw.split(',')) {
    const id = part.trim();
    if (id) out.add(id);
  }
  return out;
}

/** Write the stored value — the inverse of {@link parseProjectFocus}. */
export function serializeProjectFocus(focus: ProjectFocus): string {
  return [...focus].join(',');
}

/**
 * Resolve the two inputs into the one state everything else reads.
 *
 * `selectedProject` is the URL handle of the project open in the
 * Projects column, or null on the cross-project surface.
 */
export function projectFocusState(
  focus: ProjectFocus,
  selectedProject: string | null,
): ProjectFocusState {
  if (focus.size === 0) return 'off';
  return selectedProject === null ? 'active' : 'paused';
}

/** Rows the board may show, plus how many the focus took away. */
export interface FocusedRows<T> {
  items: readonly T[];
  /**
   * Rows dropped by the focus. Printed on the board so a shortened
   * board is never merely shorter — it is shortened BY something, by
   * this much.
   */
  hidden: number;
}

/**
 * Narrow the board's rows to the focused projects.
 *
 * A no-op in every state but `'active'`, and it returns the input array
 * unchanged in that case — the board memoises on this result, so
 * handing back a fresh copy of the same rows would re-bucket every
 * column on every tick for nothing.
 */
export function applyProjectFocus<T extends { projectId: string }>(
  items: readonly T[],
  focus: ProjectFocus,
  state: ProjectFocusState,
): FocusedRows<T> {
  if (state !== 'active') return { items, hidden: 0 };
  const kept = items.filter((i) => focus.has(i.projectId));
  return { items: kept, hidden: items.length - kept.length };
}

/**
 * sk-674.18 T052 — the focus as it applies on the current place.
 *
 * `spaceProjectIds` — the projects of the space that is the selected
 * place, or `null` when no space is (or its projects are not known: the
 * project list predates `spaceId`, and the server already narrows the
 * rows to the space, so the focus then works as on «All projects»).
 *
 *   project open                 → as `projectFocusState` (paused)
 *   space, focus ∩ space ≠ ∅     → 'active' over the intersection
 *   space, focus ∩ space = ∅     → 'paused', `pausedBySpace`
 *   «All projects»               → as `projectFocusState`
 *
 * `focus` is the set the board applies and prints: the intersection when
 * active in a space, the saved set itself otherwise.
 */
export interface ProjectFocusOnPlace {
  focus: ProjectFocus;
  state: ProjectFocusState;
  /** Paused because the space holds no focused project (not by an open project). */
  pausedBySpace: boolean;
}

export function projectFocusOnPlace(
  focus: ProjectFocus,
  selectedProject: string | null,
  spaceProjectIds: ReadonlySet<string> | null,
): ProjectFocusOnPlace {
  if (selectedProject !== null || spaceProjectIds === null || focus.size === 0) {
    return { focus, state: projectFocusState(focus, selectedProject), pausedBySpace: false };
  }
  const inside = focusWithinSpace(focus, spaceProjectIds);
  if (inside.size === 0) return { focus, state: 'paused', pausedBySpace: true };
  return { focus: inside, state: 'active', pausedBySpace: false };
}

/** The part of the saved focus that lies in the space. */
export function focusWithinSpace(
  focus: ProjectFocus,
  spaceProjectIds: ReadonlySet<string>,
): ProjectFocus {
  const out = new Set<string>();
  for (const id of focus) if (spaceProjectIds.has(id)) out.add(id);
  return out;
}

/**
 * The saved focus after the picker on a space place chose `nextInside`:
 * the space's part is replaced, every project of other spaces is kept —
 * editing the focus inside one space never drops another space's choice.
 */
export function replaceFocusWithinSpace(
  focus: ProjectFocus,
  spaceProjectIds: ReadonlySet<string>,
  nextInside: ProjectFocus,
): ProjectFocus {
  const out = new Set<string>();
  for (const id of focus) if (!spaceProjectIds.has(id)) out.add(id);
  for (const id of nextInside) if (spaceProjectIds.has(id)) out.add(id);
  return out;
}
