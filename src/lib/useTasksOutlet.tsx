/**
 * sk-285.7 T019 — what the Tasks column is currently showing, published
 * for the two mobile surfaces that have to count it.
 *
 * ─── Why this module exists ─────────────────────────────────────────
 *
 * The mobile layout adds two numbers, and INV-10 puts both of them under
 * the global result lens: the aggregate counter on the zone tab strip
 * (`Shell.tsx`) and the positional counter in the full-screen description
 * sheet (`DetailsColumn.tsx`, "3 / 17"). Both are "derived from the task
 * list", so both have to move when the lens moves — entirely, not
 * partially (the rule is in the root `CLAUDE.md`).
 *
 * The lensed result exists exactly once, inside `TasksColumn`: it is the
 * `useTasks` call whose arguments carry `outboxMode` / `onMeMode`, plus
 * the per-mode corrections the column already makes on top of it (the
 * Reminders lens counts ringing tasks, blob mode counts resolved codes,
 * anchored mode HAS no honest total and says so with `null`). Neither of
 * the two new surfaces can reconstruct that:
 *
 *   - calling `useTasks` again from `Shell` would need the eleven
 *     arguments the column assembles, two of which are its own local
 *     state (the debounced search term, the ephemeral search-mode
 *     overlay). A near-miss on any of them is a DIFFERENT query key,
 *     i.e. a second network request AND two counters that disagree —
 *     the precise failure INV-10 exists to prevent;
 *   - deriving from the raw issue list would re-implement the lens on a
 *     second surface, which is the other way the same numbers drift.
 *
 * So the number is not recomputed, it is PUBLISHED: the column hands
 * over what it already worked out, and the two consumers read it. One
 * query, one lens, one answer.
 *
 * ─── Why two contexts ───────────────────────────────────────────────
 *
 * The publisher (`TasksColumn`) needs a setter that never changes; the
 * consumers need a value that changes on every result. Putting both in
 * one context object would re-render the publisher on every publish —
 * a loop that only terminates because the value settles. Split, the
 * setter context is referentially stable for the life of the provider.
 *
 * ─── Reading `count: null` ──────────────────────────────────────────
 *
 * `null` is "this mode has no honest total", NOT zero — the same
 * distinction the column's own header chip makes in anchored
 * (rooted-subtree) mode, where a subtree count would be a rival number
 * to the project total beside it. A consumer must print nothing there,
 * not `0`.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/** What the Tasks column is showing right now, as its consumers need it. */
export interface TasksOutlet {
  /**
   * The column's own total under the active lens, or `null` when the
   * current mode has no honest one. Not a length: the list is paged, and
   * this is the count for the whole query.
   */
  readonly count: number | null;
  /**
   * The same number as the column PRINTS it — which is not always the
   * number itself: a search total is rows loaded so far rather than a
   * `COUNT(*)`, and the column marks that with a `+`. Consumers show
   * this, so the strip and the column header can never read differently.
   */
  readonly countLabel: string | null;
  /**
   * Ids of the rows currently loaded, in the order the column lists
   * them. The positional counter indexes into this; an id that is not
   * here has no position to report (an issue opened from the Queues
   * column need not be in the Tasks query at all).
   */
  readonly ids: readonly string[];
}

const EMPTY_OUTLET: TasksOutlet = { count: null, countLabel: null, ids: [] };

const ValueContext = createContext<TasksOutlet>(EMPTY_OUTLET);
const PublishContext = createContext<((next: TasksOutlet) => void) | null>(null);

/**
 * sk-551.4 — which workspace view, if any, the Tasks column is drawing
 * as the row-filling body: `'board'`, `'tree'`, or `null` (Cards, a
 * search / pasted codes / anchored subtree overriding the board, the
 * folded column, the Reminders lens).
 *
 * Published for the same reason as the counters above: only the column
 * knows which body it ENDED UP rendering, and `Shell` needs that to
 * decide whether an empty reading pane and which resize handle belong
 * in the row. Its own pair of contexts — the counters change on every
 * result, this changes on a view switch, and neither should re-render
 * the other's readers.
 */
export type WorkspaceFill = 'board' | 'tree' | null;

const FillValueContext = createContext<WorkspaceFill>(null);
const FillPublishContext = createContext<((next: WorkspaceFill) => void) | null>(null);

export function TasksOutletProvider({ children }: { children: ReactNode }) {
  const [outlet, setOutlet] = useState<TasksOutlet>(EMPTY_OUTLET);
  // Stable for the life of the provider: `setState` from `useState` is,
  // and nothing else is closed over.
  const publish = useCallback((next: TasksOutlet) => {
    setOutlet((prev) =>
      prev.count === next.count &&
      prev.countLabel === next.countLabel &&
      prev.ids.length === next.ids.length &&
      prev.ids.every((id, i) => id === next.ids[i])
        ? // Equal by content — returning `prev` makes the publish a no-op
          // for React and stops a stable result from re-rendering the
          // consumers once per pass of the publisher.
          prev
        : next,
    );
  }, []);
  const [fill, setFill] = useState<WorkspaceFill>(null);
  return (
    <PublishContext.Provider value={publish}>
      <ValueContext.Provider value={outlet}>
        <FillPublishContext.Provider value={setFill}>
          <FillValueContext.Provider value={fill}>{children}</FillValueContext.Provider>
        </FillPublishContext.Provider>
      </ValueContext.Provider>
    </PublishContext.Provider>
  );
}

/**
 * Read what the Tasks column is showing.
 *
 * Outside a provider this answers the empty outlet rather than throwing:
 * the consumers are layout surfaces that must render on any route, and a
 * missing provider is "no counter to show", not a crash.
 */
export function useTasksOutlet(): TasksOutlet {
  return useContext(ValueContext);
}

/**
 * Publish the column's current result. Call it from the ONE component
 * that owns the lensed query; a second publisher would make the last
 * render win, which is the drift this module exists to remove.
 *
 * A no-op outside a provider, so the column stays mountable on its own
 * in tests and in any future surface that does not need the outlet.
 */
export function usePublishTasksOutlet(
  count: number | null,
  countLabel: string | null,
  items: ReadonlyArray<{ id: string }> | undefined,
): void {
  const publish = useContext(PublishContext);
  // The ids are re-derived only when the array identity changes — the
  // query hands back a stable array between renders, so a keystroke in
  // an unrelated field does not rebuild it.
  const ids = useMemo(() => (items ?? []).map((it) => it.id), [items]);
  useEffect(() => {
    if (publish === null) return;
    publish({ count, countLabel, ids });
  }, [publish, count, countLabel, ids]);
}

/**
 * The position of `issueId` in the published list, 1-based, together
 * with the total — or `null` when there is no honest answer.
 *
 * Three ways to get `null`, and they are deliberately one outcome: no
 * issue is open, the open issue is not in the list (it was opened from
 * the Queues column, or the list has not loaded it yet), or the mode has
 * no total. In every one of them a printed "N / M" would be a claim the
 * data does not support.
 */
export function taskPosition(
  outlet: TasksOutlet,
  issueId: string | null,
): { position: number; total: number } | null {
  if (issueId === null) return null;
  if (outlet.count === null) return null;
  const index = outlet.ids.indexOf(issueId);
  if (index < 0) return null;
  return { position: index + 1, total: outlet.count };
}

/**
 * The id that follows `issueId` in the published list, or `null` when
 * there is none to name.
 *
 * sk-285.7.2.74 — the mobile sheet's «next task» control (§5) reads
 * this. It comes off the SAME published list as the counter beside it,
 * which is what keeps INV-10 whole: a lens that moves "4 of 49" moves
 * where the chevron goes, because there is one list and both surfaces
 * read it.
 *
 * `outlet.ids` is what the column has LOADED, and `outlet.count` is what
 * the query totals — the two differ on a paged list. This answers from
 * `ids` alone and therefore says `null` on the last loaded row even when
 * the total promises more. That is deliberate: the control's job is to
 * open a specific issue, and the id of the row after the last loaded one
 * is not something this module knows. A button that cannot name its
 * destination must not offer one.
 */
export function nextTaskId(outlet: TasksOutlet, issueId: string | null): string | null {
  if (issueId === null) return null;
  const index = outlet.ids.indexOf(issueId);
  if (index < 0) return null;
  return outlet.ids[index + 1] ?? null;
}

/** sk-551.4 — the body the Tasks column fills the row with, or `null`. */
export function useWorkspaceFill(): WorkspaceFill {
  return useContext(FillValueContext);
}

/**
 * sk-551.4 — publish {@link WorkspaceFill}. Same contract as
 * {@link usePublishTasksOutlet}: one publisher, a no-op outside a provider.
 *
 * A LAYOUT effect, not a plain one: `Shell` drops the empty reading pane
 * on this value, and a passive effect would paint one frame of the pane
 * the view is about to take over. Unmounting publishes `null` — a column
 * that is gone fills nothing.
 */
export function usePublishWorkspaceFill(fill: WorkspaceFill): void {
  const publish = useContext(FillPublishContext);
  useLayoutEffect(() => {
    if (publish === null) return;
    publish(fill);
    return () => publish(null);
  }, [publish, fill]);
}
