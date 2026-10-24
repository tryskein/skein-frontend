/**
 * sk-285.2.3 / sk-285.2.4 — "drag a card into another column" as a
 * write to the axis field.
 *
 * The board owns no state of its own: dropping a card into the
 * `in_progress` column is exactly the transition the Details panel
 * already performs, taken through the same endpoint
 * (`POST …/transitions`, `If-Match: <version>`), and dropping it into
 * the `P1` column is exactly the priority edit the Details panel
 * performs (`PATCH`, same `If-Match`). That matters for more than
 * tidiness — every server-side rule (locked issues, standing promotion,
 * optimistic concurrency) keeps applying to the gesture, because there
 * is no second path for it to bypass them through.
 *
 * ── Which endpoint each axis writes ───────────────────────────────
 *
 *   status     POST   …/transitions        If-Match  (workflow rules)
 *   priority   PATCH  …/{id}               If-Match
 *   type       PATCH  …/{id}               If-Match
 *   assignee   PATCH  …/{id}               If-Match  ('' = unassign)
 *   component  PUT    …/{id}/components    —  (see below)
 *   label      POST/DELETE …/{id}/labels   —  (see below)
 *   project    — the board never writes it (see KANBAN_READ_ONLY_AXES)
 *
 * The components and labels endpoints take NO `If-Match` — the backend
 * simply does not accept one there (`ReplaceComponents` / `AddLabel` /
 * `RemoveLabel` in `internal/handler/issues.go` never call
 * `requireIfMatch`). So on those two axes a concurrent edit cannot be
 * detected and the last writer wins. That is a backend fact, not a
 * choice made here; the alternative would be to forbid the two axes the
 * project explicitly asked for. Both endpoints DO take the whole
 * intended set / the single label, so the write is still expressed as a
 * complete intent rather than a blind increment.
 *
 * The interaction contract, and why:
 *
 *   - the card moves IMMEDIATELY (optimistic cache patch). A board that
 *     waits ~200 ms for a round-trip before the card lands feels broken;
 *   - a rejection puts the card back exactly where it was (snapshot
 *     restore, not a refetch — a refetch shows a blank flash and, on a
 *     stale-while-revalidate cache, may even paint the wrong thing
 *     first) and says WHY in a toast;
 *   - either way the tasks queries are invalidated afterwards, so the
 *     server's version / updatedAt (which the optimistic patch can only
 *     guess at) replaces the guess.
 */

import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { ApiError, BusinessError } from '../api/client';
import {
  addLabel,
  patchIssue,
  removeLabel,
  replaceComponents,
  transitionStatus,
} from '../api/issues';
import type { IssueStatus, IssueSummary, IssueType } from '../api/issues';
import { nextMultiValue, type KanbanAxis } from './kanbanBoard';
import { issueDetailKey } from './useIssueDetail';
import { useToaster } from '../components/Toaster';

/** Every Tasks-column cache key starts with this — see `useTasks`. */
const TASKS_KEY_ROOT = 'tasks';

function isTasksKey(key: QueryKey): boolean {
  return Array.isArray(key) && key[0] === TASKS_KEY_ROOT;
}

/**
 * Shape of an infinite-query cache entry under a `['tasks', …]` key.
 * Every Tasks surface (project-scoped list, cross-project list, the
 * `/me/*` lenses, search) pages through objects carrying `items` — the
 * only field this patch touches — so one structural guard covers them
 * all without the hook needing to know which surface it is on.
 */
interface PagedIssues {
  pages?: Array<{ items?: IssueSummary[] } | undefined>;
}

/** The fields a board move may rewrite on a cached row. */
export type KanbanPatchFields = Partial<
  Pick<
    IssueSummary,
    'status' | 'priority' | 'type' | 'assignee' | 'componentIds' | 'labels'
  >
>;

export interface KanbanPatch {
  fields: KanbanPatchFields;
  /**
   * Whether the server bumps `issues.version` for this write.
   *
   * It matters because the row's version is what a SECOND drag sends as
   * `If-Match`; guessing it wrong in either direction turns a quick
   * two-step move into a spurious 409 the user did nothing to deserve.
   * `transitions` and `PATCH` bump it; `PUT …/components` bumps it too
   * (it writes `version = version + 1` explicitly, since the join table
   * carries no version of its own); the label endpoints touch only
   * `updated_at` and are therefore NOT bumped here.
   */
  bumpVersion: boolean;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

/**
 * What the drop means for the dragged issue, as a field patch.
 *
 * Returns `null` when the gesture writes nothing: a read-only axis, a
 * value the axis cannot hold, or a move that would leave the row
 * exactly as it is.
 *
 * `from` — the column the card was dragged OUT of — is only consulted
 * on the multi-value axes, where it is the whole point: the drop
 * REPLACES that one value and leaves the issue's other components /
 * labels alone (research §4.2, `nextMultiValue`).
 */
export function computeKanbanPatch(
  item: IssueSummary,
  axis: KanbanAxis,
  from: string | null,
  to: string | null,
): KanbanPatch | null {
  const patch = ((): KanbanPatch | null => {
    switch (axis) {
      case 'status':
        return to === null ? null : { fields: { status: to as IssueStatus }, bumpVersion: true };
      case 'priority': {
        if (to === null) return null;
        const n = Number(to);
        if (!Number.isInteger(n)) return null;
        return { fields: { priority: n }, bumpVersion: true };
      }
      case 'type':
        return to === null ? null : { fields: { type: to as IssueType }, bumpVersion: true };
      case 'assignee':
        // `null` is a real destination here — the "unassigned" column.
        return { fields: { assignee: to }, bumpVersion: true };
      case 'component':
        return {
          fields: { componentIds: nextMultiValue(item.componentIds, from, to) },
          bumpVersion: true,
        };
      case 'label':
        return {
          fields: { labels: nextMultiValue(item.labels, from, to) },
          // The label endpoints write `updated_at` only.
          bumpVersion: false,
        };
      case 'project':
        // Skein has no "move to another project"; the axis is read-only.
        return null;
    }
  })();
  if (!patch) return null;
  const changed = Object.entries(patch.fields).some(
    ([k, v]) => !sameValue((item as unknown as Record<string, unknown>)[k], v),
  );
  return changed ? patch : null;
}

/**
 * Rewrite one issue inside a paged tasks cache entry.
 *
 * Pure and exported for tests. Returns the input UNCHANGED (same
 * reference) when the issue is not on that page set, so React Query's
 * structural sharing and every downstream `memo()` on the row survive
 * an unrelated board's cache entry being visited.
 */
export function applyKanbanPatchToTasksCache<T>(
  data: T,
  issueId: string,
  patch: KanbanPatch,
): T {
  const paged = data as PagedIssues | undefined;
  if (!paged || !Array.isArray(paged.pages)) return data;
  let touched = false;
  const pages = paged.pages.map((page) => {
    if (!page || !Array.isArray(page.items)) return page;
    let pageTouched = false;
    const items = page.items.map((it) => {
      if (it.id !== issueId) return it;
      const changed = Object.entries(patch.fields).some(
        ([k, v]) => !sameValue((it as unknown as Record<string, unknown>)[k], v),
      );
      if (!changed) return it;
      pageTouched = true;
      return {
        ...it,
        ...patch.fields,
        version: patch.bumpVersion ? it.version + 1 : it.version,
      };
    });
    if (!pageTouched) return page;
    touched = true;
    return { ...page, items };
  });
  if (!touched) return data;
  return { ...(paged as object), pages } as T;
}

/**
 * Turn a rejected move into one line the user can act on.
 *
 * The two cases worth naming explicitly are the two the board actually
 * produces: a stale `If-Match` (409 — somebody, quite possibly this
 * user's own agent, moved the issue first) and a write the workflow
 * forbids (a `BusinessError` whose message the server wrote). Anything
 * else falls back to the raw message rather than a generic "failed",
 * because a generic failure gives the user nothing.
 */
export function formatTransitionError(err: unknown, t: TFunction): string {
  if (err instanceof ApiError && err.statusCode === 409) {
    return t('kanban.errorVersionConflict');
  }
  if (err instanceof BusinessError || err instanceof ApiError) {
    return err.message || t('kanban.errorGeneric');
  }
  if (err instanceof Error) return err.message || t('kanban.errorGeneric');
  return t('kanban.errorGeneric');
}

export interface KanbanMoveVars {
  item: IssueSummary;
  axis: KanbanAxis;
  /** Value of the column the card was dragged OUT of (`null` = "none"). */
  from: string | null;
  /** Value of the column it was dropped INTO (`null` = "none"). */
  to: string | null;
}

/**
 * Send the move to the server, on whichever endpoint the axis lives on.
 *
 * On the label axis the write is two calls, ADD first: if the add fails
 * the card keeps the label it had, whereas removing first and failing
 * the add would strip a label the user never asked to lose.
 */
async function runKanbanMove({ item, axis, from, to }: KanbanMoveVars): Promise<unknown> {
  switch (axis) {
    case 'status':
      return transitionStatus(item.projectId, item.id, item.version, to as IssueStatus);
    case 'priority':
      return patchIssue(item.projectId, item.id, item.version, {
        priority: Number(to),
      });
    case 'type':
      return patchIssue(item.projectId, item.id, item.version, {
        type: to as IssueType,
      });
    case 'assignee':
      // Unassign is the EMPTY STRING on the wire, not null: the Go
      // handler decodes `assignee` into a *string, so `null` reads as
      // "field absent" and would silently keep the current assignee.
      return patchIssue(item.projectId, item.id, item.version, { assignee: to ?? '' });
    case 'component':
      return replaceComponents(
        item.projectId,
        item.id,
        nextMultiValue(item.componentIds, from, to),
      );
    case 'label': {
      if (to !== null) await addLabel(item.projectId, item.id, to);
      if (from !== null) await removeLabel(item.projectId, item.id, from);
      return undefined;
    }
    case 'project':
      // Unreachable: the axis is read-only, its columns are not
      // droppable and its cards carry no drag listeners. Kept as a hard
      // stop so a future caller cannot quietly acquire a "move issue
      // between projects" operation that does not exist in Skein.
      throw new Error('kanban: the project axis is read-only');
  }
}

interface Ctx {
  /** Every touched `['tasks', …]` entry, for an exact rollback. */
  snapshot: Array<[QueryKey, unknown]>;
}

export function useKanbanMove() {
  const qc = useQueryClient();
  const toast = useToaster();
  const { t } = useTranslation('tasks');

  return useMutation<unknown, Error, KanbanMoveVars, Ctx>({
    mutationFn: (vars) => runKanbanMove(vars),

    onMutate: async ({ item, axis, from, to }) => {
      // Cancel in-flight tasks refetches first: one landing mid-drag
      // would overwrite the optimistic patch with pre-move data and the
      // card would visibly jump back for no reason.
      await qc.cancelQueries({ predicate: (q) => isTasksKey(q.queryKey) });
      const snapshot = qc.getQueriesData({
        predicate: (q) => isTasksKey(q.queryKey),
      }) as Array<[QueryKey, unknown]>;
      const patch = computeKanbanPatch(item, axis, from, to);
      if (patch) {
        qc.setQueriesData(
          { predicate: (q) => isTasksKey(q.queryKey) },
          (data: unknown) => applyKanbanPatchToTasksCache(data, item.id, patch),
        );
      }
      return { snapshot };
    },

    onError: (err, _vars, ctx) => {
      for (const [key, data] of ctx?.snapshot ?? []) {
        qc.setQueryData(key, data);
      }
      toast.error(formatTransitionError(err, t));
    },

    onSettled: (_dto, _err, { item }) => {
      void qc.invalidateQueries({ predicate: (q) => isTasksKey(q.queryKey) });
      void qc.invalidateQueries({ queryKey: issueDetailKey(item.id) });
    },
  });
}
