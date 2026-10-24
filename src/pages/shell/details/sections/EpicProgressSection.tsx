import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, BusinessError } from '../../../../api/client';
import {
  createIssue,
  type CreateIssueInput,
  type IssueDetail,
  type IssueTreeNode,
  type IssueType,
} from '../../../../api/issues';
import { useToaster } from '../../../../components/Toaster';
import { useAuth } from '../../../../auth/AuthContext';
import { useLayoutState } from '../../../../lib/useLayoutState';
import {
  layeredTreeQueryKey,
  useLayeredTree,
} from '../../../../lib/useLayeredTree';
import { isStaleAgainstEpicSectionClock } from '../../../../lib/epicSectionClock';
import { ringPercentText } from '../../../../lib/epicRingPercent';
import { progressNumbers } from '../../../../lib/progressNumbers';
import {
  useEpicSectionMode,
  type EpicSectionMode,
} from '../../../../lib/useEpicSectionMode';
import { useRadioGroupKeys } from '../../../../lib/useRadioGroupKeys';
import { useEpicSectionGrouping } from '../../../../lib/useEpicSectionGrouping';
import { useCardScopedCollapse } from '../../../../lib/useCardScopedCollapse';
import type { DepType } from '../../../../api/dependencies';
import { EpicChildrenList } from './EpicChildrenList';
import {
  EpicChildrenTree,
  expandableIds,
  isEpicSectionRow,
  treeRowsOf,
  type EpicTreeEntry,
} from './EpicChildrenTree';
import { SkeinTooltip } from '../../../../components/SkeinTooltip';
import { Section } from '../Section';

export interface EpicProgressSectionProps {
  issue: IssueDetail;
}

// Whitelist excludes 'epic' for consistency with skein_epic_create's
// child rules — nested epics are out of scope for sk-32 light.
/**
 * sk-421.2 INV-5 — the section builds the list and the tree ONLY from hierarchical
 * links. Before, the types came from `useTreeDepTypes` — a setting of the Tasks
 * column shared by the project: the card section depended on what the user
 * enabled in another surface, and even changed it. Now the set is pinned here,
 * and the query key and the invalidation key are both computed from it.
 */
const PARENT_CHILD: DepType[] = ['parent-child'];

/**
 * sk-490 — the order of the mode switch segments. One source for both
 * the markup and the arrows: "next in a circle" is computed from the same
 * list in which the segments stand on screen.
 */
const EPIC_SECTION_MODES: readonly EpicSectionMode[] = ['list', 'tree'];

/**
 * sk-421.3 T17 (US-7, m-15) — the geometry of the header ring.
 *
 * 44×44, radius 18, thickness 5. The circumference is the denominator of the dash:
 * an arc is given by a pair "how much is painted, how much is skipped", and the
 * second number is always the full circumference, so that no copy of the
 * arc follows the first one.
 *
 * It is computed, not typed in as a number: `2π·18 = 113.097…`, and a hand-written
 * "113" would drift from the radius at the first edit of the radius —
 * and drift SILENTLY, leaving the arcs slightly longer or shorter than the share.
 */
const RING_R = 18;
const RING_C = 2 * Math.PI * RING_R;

const CHILD_TYPE_OPTIONS: Exclude<IssueType, 'epic'>[] = [
  'task',
  'feature',
  'bug',
  'chore',
  'decision',
  'idea',
  'note',
];

/**
 * EpicProgressSection — sk-32 slice 6.
 *
 * Rendered only for epic-typed issues. Composes:
 *   - a progress ring (done/counted — sk-489 INV-5, children closed
 *     without work leave the denominator) and the four-counter status line
 *   - the list of hierarchical children sourced from issues.parent_id
 *     (sk-33 dropped the parent-child dep edge as a parallel mechanism)
 *   - an inline "add child" form (title + type) that calls createIssue
 *     with parentId = epic.id. The new child's hierarchical id is
 *     allocated server-side; on success we let the cache invalidation
 *     pipeline (useIssueDetail / liveEventInvalidation) refresh the
 *     epic rollup so progress updates without a manual round-trip.
 *
 * Note on children retrieval: the rows are taken from the TREE response, not from
 * a task list. The earlier text described `listIssues(parentId=…)` — a path
 * removed back in sk-36 and finally diverged from the code in sk-421.2:
 * now it is a CROSS-PROJECT tree query rooted at the epic with depth 1
 * (R-3, R-7). The summary stays a cheap source of NUMBERS, the tree — of rows.
 *
 * Children sourced via parent_id only (sk-33). DependenciesSection
 * renders the dep-graph edges separately.
 */
export function EpicProgressSection({ issue }: EpicProgressSectionProps) {
  const { t } = useTranslation('details');
  // C1 — Rules-of-Hooks: ALL hooks must be called on every render in the
  // same order. The `issue.epic` guard moved BELOW the hook block; the
  // useQuery is gated via `enabled: !!rollup` so an issue without an
  // epic rollup never triggers the children fetch.
  const qc = useQueryClient();
  const toast = useToaster();
  const layout = useLayoutState();
  // sk-472 — id of the line about the ring's coverage, which the ring references
  // by `aria-describedby`. From `useId`, not a constant: two epic cards
  // on one page would publish one id twice, and the second ring
  // would take the description of the first (the same argument as for
  // `TaskTreeVirtualList.tsx#sortNoteId`).
  const ringScopeId = useId();

  const rollup = issue.epic;

  // C4 — toggle ref so we can return focus to the "+ Add child" button
  // after the form unmounts (otherwise focus drops to <body>).
  const toggleRef = useRef<HTMLButtonElement>(null);

  // sk-421.2.8 T011 — fallback focus targets OUTSIDE the rows (sk-421.2 US-2 items 4–5):
  // the mode toggle, otherwise "Add child". The "List" decides that
  // no rows are left for the focus and hands the request here — the elements live in
  // the section. In the toggle, the focus goes to the selected mode.
  const switchRef = useRef<HTMLDivElement>(null);
  const focusFallback = useCallback(() => {
    const group = switchRef.current;
    const radio =
      group?.querySelector<HTMLButtonElement>('[aria-checked="true"]') ??
      group?.querySelector<HTMLButtonElement>('button') ??
      null;
    if (radio) {
      radio.focus();
      return;
    }
    toggleRef.current?.focus();
  }, []);

  // sk-421.2 — "counted children": the summary total plus standing ones. The total already
  // counts visible non-standing and all inaccessible ones; standing ones are taken
  // out of it on purpose (sk-118), so the number of section rows is the sum of two.
  // The same number stands in the section header and decides whether there is anything to load.
  const counted = rollup
    ? rollup.totalChildren + (rollup.standingChildren ?? 0)
    : 0;

  // sk-421.2, wave B/1 review (INV-8) — "the field did not arrive" and "zero
  // standing" are DIFFERENT facts, and `?? 0` glues them together. On a server without US-1
  // (no `standingChildren` field at all) an epic ALL of whose children are
  // standing gave `counted === 0`: the query was not sent and the
  // false "No child tasks" was printed — although children exist. Before T015 the query
  // was sent unconditionally, so this was also a regression.
  //
  // Soft reading stays where it is appropriate — for SHOWING the number;
  // for the GATE and for the claim "no children" the fact that the field is present is needed.
  const standingKnown = rollup?.standingChildren !== undefined;
  const mayHaveRows = !!rollup && (counted > 0 || !standingKnown);

  // sk-36 — replace the old `listIssues(parentId=epic.id)` direct
  // children fetch with `useLayeredTree(rootId=epic.id)`. The wire
  // response is the flat DFS walk rooted at this epic; we slice off
  // the root row (depth=0) and surface depth=1 nodes as the "direct
  // children" the section's UI already renders.
  //
  // sk-421.2 F-19 / SC-014 — when "total + standing = 0" the rows query is NOT
  // executed: there is nothing to load, while before it was sent for any summary.
  // sk-421.2 SC-011 / INV-4 — the query arguments do not contain the
  // "My-assigned mode" lens: the section does not read it and need not — it shows
  // the epic's children, not what I delegated to someone.
  // sk-421.2 R-3 — the CROSS-PROJECT variant of the query: tree visibility in
  // the card equals the caller's horizon, like the summary's. The project-
  // restricted variant treats only the epic's project as visible, and visible
  // children from OTHER projects would arrive in it as stubs — the summary
  // counts them, and the list would declare "no access" (a violation of INV-7).
  //
  // sk-460.12 — THERE IS NO DEPTH ANY MORE. Before, the "List" asked for `maxDepth: 1`,
  // answering the question "who are the direct children"; the maintainers' decision of 2026-09-18
  // brought its coverage in line with the design, where both modes are built from ONE set.
  // Since the set is one, the query is one too — and the cache key is shared by the modes, so
  // switching the mode no longer goes to the server at all.
  // sk-421.2 T022 — the mode memory per user (R-6). `useAuth` is typed
  // as `User | null`, although inside the section the user is always there
  // (RequireAuth does not render content without one); we pass `null` honestly —
  // the hook then returns "List" and writes nothing, instead of writing to a shared slot.
  const { user } = useAuth();
  const [mode, setMode] = useEpicSectionMode(user?.id ?? null);

  // sk-490 — the toggle keyboard modelled on the WAI-ARIA radiogroup:
  // one Tab stop (on the selected mode), the arrows ←/→ and ↑/↓ select
  // the neighbouring mode in a circle and move the focus to it. The selection is the
  // arrow itself, Space/Enter are not needed for it (pressing Space/Enter on
  // the selected segment stays a click and changes nothing). The model is shared
  // with the filter chip groups and lives in `useRadioGroupKeys` (sk-491).
  // The segments are not unmounted on a mode change, so the focus moves
  // at once; the fallback focus target (`focusFallback`) still looks for
  // the segment with `aria-checked="true"` — that is the single Tab stop.
  const modeKeys = useRadioGroupKeys({
    values: EPIC_SECTION_MODES,
    value: mode,
    onChange: setMode,
  });

  // sk-421.3 T06 — the choice of "List" grouping (US-2, A1: enabled
  // by default). The toggle control is task T07; here the section only
  // reads the memory and passes the choice on to the list. The flag is NOT part of
  // the rows query arguments: grouping is a layout of the already received
  // set, and switching it means redrawing, not going to the
  // server (R-1).
  const [grouping, setGrouping] = useEpicSectionGrouping(user?.id ?? null);

  // The collapsed state of the "Tree" nodes lives HERE, not in the tree: it must
  // survive the "Tree → List → Tree" switch while the card is
  // open, while the tree's internal state dies together with it.
  //
  // ⚠ The earlier argument — "the section is remounted for every new card,
  // so 'expanded in full on every opening' holds by itself" —
  // WAS FALSE, and it held for another reason. Verified in code: the details
  // panel is rendered WITHOUT `key`
  // (`DetailsColumn.tsx#<IssueDetailPanel issueId={issueId} projectHandle={selectedProject} />`
  // — both render sites), and
  // a change of the card's identity does not remount the section — only the
  // prop changes. The subtree disappears only where the panel stops
  // rendering it: loading (`IssueDetailPanel.tsx#if (detail.isLoading)`),
  // a card failure (`IssueDetailPanel.tsx#detail.isError || !detail.issue`)
  // and the type condition
  // (`IssueDetailPanel.tsx#issue.type === 'epic' && issue.epic`). On a direct
  // "epic → epic" transition none of the three paths is passed.
  //
  // "Expanded in full on opening" held only on the NON-COINCIDENCE of
  // node ids of different epics: another's collapsed state simply landed on
  // nothing. The non-coincidence was an accident — and the bulk
  // collapse (T16) puts the ids of ALL tree nodes into the set
  // and makes the coincidence systematic. So the reset is now explicit.
  // PK-3, INV-12, SC-016 — the collapsed state belongs to the CARD, and the reset on
  // a card change lives in the hook together with the state itself.
  //
  // sk-421.3 T15a — before, the reset stood here as a passive `useEffect` on
  // `[issue.id]`, and those run AFTER the frame is painted: on a direct
  // "epic → epic" transition with the new card's tree in cache, the first frame
  // drew the new rows against the PREVIOUS collapsed set. The hook
  // notices the change in the render phase and returns an empty set on the same
  // pass — a frame with another card's collapsed state does not exist. The full argument and
  // the caveat about the return value are in the hook's docblock.
  const [collapsed, setCollapsed] = useCardScopedCollapse(issue.id);

  // sk-427 item 3 (US-2, SC-013) — the "Tree" remembers the row of its entry point
  // across mode switches. The tree is unmounted, so the memory lives
  // here, next to the collapsed state; it is bound to the card by the epic id
  // inside the record — the tree does not read another's record.
  const treeEntryRef = useRef<EpicTreeEntry | null>(null);

  // sk-460.12 — ONE query for both modes. Before, there were two, and they
  // differed in exactly the depth: the "List" asked for `maxDepth: 1`, the "Tree" — for a
  // full walk, and each was disabled while its mode was not active. The coverage
  // of the "List" is brought in line with the design, the set of the modes became shared — which means
  // there is nothing left to separate the queries by, and no reason to.
  //
  // The gain is not only tidiness: the cache key is now one, so
  // switching "List ↔ Tree" does not go to the server and does not show
  // an empty place while waiting for a response. The earlier pair of keys re-read
  // the inactive mode on every switch.
  //
  // sk-421.2.8 T011 (US-1 "both modes", D-2) — the `blockers` field is requested by both
  // modes: the sub-row under the child's row is the same in the "List" and in the
  // "Tree". The flag is part of the cache key (R-9), so the section's record is not
  // shared with the tasks column, which does not request it.
  const layered = useLayeredTree({
    project: null,
    rootId: issue.id,
    types: PARENT_CHILD,
    includeBlockers: true,
    enabled: mayHaveRows,
  });

  // The section rows are the WHOLE subtree walk without the root (sk-460.12, PK-1).
  //
  // Before, the first level was cut off here (`r.depth === 1`), and that was
  // half of the "List" coverage: even having received a full walk from an old
  // server, the section showed only direct children. The maintainers' decision of
  // 2026-09-18 cancelled both the depth query and this cut.
  //
  // The predicate is SHARED with the "Tree" (`isEpicSectionRow`), and this is a requirement, not
  // thrift: two copies would drift apart, and one and the same child would land
  // on screen in one mode and disappear in the other.
  //
  // sk-421.2 R-8 / INV-7 — reference rows split in two, and the earlier
  // `!isReference` selection threw out both. The stub of an inaccessible child
  // MUST stay: hiding it would mean the tail "inaccessible W"
  // points to children that are nowhere. Only the repeated
  // occurrence of a node goes — a duplicate of a row visible in this same panel.
  //
  // ⚠ Filtering here happens BEFORE flattening (the "List" does it itself),
  // so the derived `hasChildren` flag in the list does not
  // deserve trust — row adjacency is broken. The "List" does not need it: it
  // draws a flat row without chevrons. Row identification (`epicRowKeys`)
  // reads only depth and reference-ness, which the filter does not spoil.
  const sectionRows = useMemo<IssueTreeNode[]>(
    () => layered.tree.filter(isEpicSectionRow),
    [layered.tree],
  );

  /**
   * sk-421.3 T16 (US-6, PL-7, SC-009) — the expandable nodes of the RECEIVED
   * tree, not of the shown rows: "collapse all" must also reach
   * nodes temporarily hidden under other collapsed ones.
   *
   * Computed by the SECTION, which already has the rows at hand. A callback
   * "the tree reports its set to the section" is not introduced: it would be a
   * second source of truth about the same set, and it would diverge from the first
   * exactly when the tree stops being rendered (loading, denial,
   * error) — while the decision to show the control is made at those moments too.
   *
   * Through `treeRowsOf`, not through the layered response directly: otherwise the root
   * would be counted as an expandable node and repeated occurrences would enter the count.
   */
  const expandable = useMemo(
    () => (mode === 'tree' ? expandableIds(treeRowsOf(layered.tree)) : []),
    [mode, layered.tree],
  );

  // Inline "add child" form state.
  const [addOpen, setAddOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftType, setDraftType] = useState<Exclude<IssueType, 'epic'>>('task');

  const createMut = useMutation<IssueDetail, Error, void>({
    mutationFn: async () => {
      const trimmed = draftTitle.trim();
      if (!trimmed) throw new Error('title required');
      const input: CreateIssueInput = {
        title: trimmed,
        type: draftType,
        priority: 3,
        parentId: issue.id,
      };
      return createIssue(issue.projectId, input);
    },
    onSuccess: () => {
      setDraftTitle('');
      setAddOpen(false);
      // C4 — return focus to the toggle after the form unmounts. The
      // toggle re-mounts in the same render cycle as `setAddOpen(false)`,
      // so requestAnimationFrame defers .focus() until after React's
      // commit phase has placed the button in the DOM.
      requestAnimationFrame(() => toggleRef.current?.focus());
      // Refresh the epic detail so the `.epic` rollup updates.
      void qc.invalidateQueries({ queryKey: ['issues', 'detail', issue.id] });
      // sk-421.2 T019 — there is no targeted invalidation of the tree key here
      // any more. It hit the key of the PROJECT-RESTRICTED variant without
      // depth, while the section has gone with this task to the cross-project variant with
      // depth 1: the key is different, and the call would become a miss on a record
      // nobody holds — a silent one, because an
      // invalidation miss breaks nothing.
      //
      // sk-427 item 4 — only the keys of THIS epic's section are reset: the prefix
      // `['issues','tree','__cross__', <epic>]` covers any variant of its
      // key (depth, blockers flag). The earlier prefix
      // `['issues','tree']` reset the tasks column trees of all
      // projects as well; those are updated by the live task creation event
      // (`liveEventInvalidation.ts#invalidateTasksColumnTrees`).
      void qc.invalidateQueries({ queryKey: ['issues', 'tree', '__cross__', issue.id] });
    },
    onError: (err) => {
      const msg =
        err instanceof BusinessError || err instanceof ApiError
          ? err.message
          : err.message || 'failed to create child';
      toast.error(msg);
    },
  });

  // sk-421.2, wave B/2 review (SC-015, second half) — before this fix
  // the freshness criterion was built entirely and called from nowhere:
  // `requestedAt` arrived from the hook, the clock was moved by the live event
  // router, and nobody made the COMPARISON between them. The spec says it directly:
  // "opening the epic card or switching the mode re-reads the rows
  // if the response they are shown from was requested earlier than the
  // section event received by the tab".
  //
  // Why exactly a key invalidation, and not the hook's `refetch()`: the key is computed
  // by the same exported builder as the query itself, so the modes
  // do not mix cache records, and `refetchType: 'active'` does not touch
  // unmounted trees.
  //
  // There is no loop: a re-read sets a new `requestedAt` that is certainly later than the
  // clock, and the next pass exits on the very first check.
  useEffect(() => {
    if (!mayHaveRows) return;
    if (layered.isLoading) return;
    // No response yet — nothing to judge; the request is in flight anyway.
    if (layered.requestedAt === null) return;
    if (!isStaleAgainstEpicSectionClock(layered.requestedAt)) return;
    void qc.invalidateQueries({
      queryKey: layeredTreeQueryKey(
        null,
        issue.id,
        PARENT_CHILD,
        // sk-460.12 — there is no depth in the key any more, because there is none in
        // the query either: the modes read ONE cache record. Before, here stood
        // `mode === 'list' ? 1 : undefined`, and the key had to follow
        // the active mode.
        undefined,
        // sk-421.2.8 T011 — the same flag as in the query: without it the key
        // would become a key WITHOUT blockers, and the invalidation would silently miss
        // the record that the section reads.
        true,
      ),
      refetchType: 'active',
    });
  }, [mayHaveRows, layered.isLoading, layered.requestedAt, issue.id, qc]);

  // C1 — guard AFTER all hooks have been called. Returning null before
  // the hooks would skip subsequent calls on re-render and crash with
  // "rendered more/fewer hooks than during previous render".
  if (!rollup) return null;

  // sk-421.3 T17 (m-16) — the ARC LENGTH and the PRINTED NUMBER are computed
  // separately, and this is a requirement, not decoration.
  //
  // The arcs take the EXACT share: they draw a magnitude, and there is nothing to round.
  // The printed percentage is another matter: it is the first place where rounding
  // reaches the screen, and it has its own edge rule (T18). Tie them with
  // one number — and the text clamping would leak into the arc width, i.e. the
  // doubling that m-16 fears would happen in the opposite direction.
  // sk-489 T015 (US-5, INV-5) — ALL parts of the ring from ONE denominator.
  //
  // The denominator is not the summary total: visible children closed
  // without work are subtracted from it (`countedChildren`). It is read by exactly one place —
  // `lib/progressNumbers.ts` — because there is one rule for the ring, the branch
  // and the chips, and two copies would drift at the first edit. On an api
  // response that knows nothing about the total, the same call returns the former pair
  // "closed / total" (US-10), and the ring shows today's numbers.
  const numbers = progressNumbers(rollup);

  // The "in progress" arc is divided by THE SAME denominator as the "done" arc.
  // The divisor `totalChildren` would be no trifle here: for an epic "1 done
  // + 1 in progress + 2 won't do" (SC-012) the ring must be filled
  // entirely — 50 % and 50 % — while from the total it would come out 25 % and 25 %.
  const closedArc =
    numbers.denominator === 0
      ? 0
      : (numbers.done / numbers.denominator) * RING_C;
  const workingArc =
    numbers.denominator === 0
      ? 0
      : (rollup.inProgressChildren / numbers.denominator) * RING_C;

  // sk-421.3 T18 (PL-6, m-16) — the printed number comes from ONE
  // rule living in a separate module. It knows about the edges: `100` and `0`
  // are printed only when they are true, not when rounding
  // has arrived at them. The arcs above do NOT know this function and must not.
  const percentText = ringPercentText(numbers);

  // US-1 — "Not done" is open AND in progress, not a count of open ones:
  // "Done X · Not done Y", where X + Y + deferred + inaccessible = Y
  // of the ring caption (US-5, "the ring's on-screen identity").
  const notDone = rollup.openChildren + rollup.inProgressChildren;
  const standing = rollup.standingChildren ?? 0;

  // sk-489 T015 — the "without work: N" tail. `?? 0` is FORBIDDEN here
  // (`lib/progressNumbers.ts`): a missing field means "the api did not report
  // the dropped ones", and showing it as zero would assert something on the server's behalf.
  // Hence two different checks in one: the field arrived AND it is not zero —
  // the tail at zero is hidden by the maintainers' decision.
  const noWork = numbers.noWork;
  const hasNoWork = typeof noWork === 'number' && noWork > 0;

  // SC-014 — the accessible text of the bar, three cases and exactly one text for the name
  // and the value. The counters of deferred and inaccessible are read softly: a server
  // without the US-1 changes does not send them, and the section must render (SC-009).
  //
  // sk-489 T015 (US-5) — the fourth entry into the same third case: all
  // visible children DROPPED. The denominator is zero, but there are children and their rows
  // are shown, so "no child tasks" would be a direct lie —
  // the text "no task counts toward progress" is needed.
  const barText =
    numbers.denominator > 0
      ? t('epic.progressAria', {
          done: numbers.done,
          total: numbers.denominator,
        })
      : hasNoWork || standing > 0 || (!standingKnown && layered.tree.length > 0)
        ? t('epic.barNoneCounted')
        : t('epic.noChildren');

  // sk-421.2 F-1 — we open by the project of the ROW itself, not by the one selected
  // in the shell. The earlier argument "the epic and the child share a project by construction
  // of the hierarchical id" is not always true: a child may lie in another
  // VISIBLE project, and then the card would open under someone else's project.
  // `setSelectedIssue` substitutes the second argument straight into the path
  // (`useLayoutState.tsx#/projects/${encodeURIComponent(projectHandle)}/issues/`),
  // and the route accepts both an alias and a UUID — the dependencies section walks the same path:
  // a dependency row passes up the id AND
  // the project of the edge, and this claim is verified
  // (`DependencyRow.test.tsx#and with a handler calls it with the identifier and the project`).
  //
  // sk-417 — the anchor was moved from the row's SOURCE to its test on purpose, and
  // not for convenience: `DependencyRow.tsx` entered the `mutate` slice, Stryker
  // instruments the slice files, and an anchor by an expression from such a file
  // would stop being found in the instrumented copy — failing the dry-run,
  // and with it the whole mutation run. Test files never enter the slice, and
  // a reference to a test is also stronger: it points not to a line of code but
  // to a verified claim about it.
  //
  // sk-439 — the component segment of the current route is carried over by `setSelectedIssue`
  // only to a task of THE SAME project (the row UUID is matched against the
  // address alias via the project cache, `projectHandleCache.ts#isKnownSameProject`);
  // a child of another project, like a child of an unknown project, is opened
  // without someone else's component.
  const handleOpenChild = (id: string, projectId: string) => {
    layout.setSelectedIssue(id, projectId);
  };

  return (
    // sk-460.6 — the section prints the heading ITSELF, next to the ring (as in the
    // design, on both boards), so the shared `Section` turns off its own.
    //
    // THE NUMBERS ARE REMOVED FROM THE HEADING along with it, and this is not a side effect but
    // half of the decision: the design prints nothing in the heading, and our
    // "Epic Progress 1" was a recorded deviation No. 17 ("the header prints
    // more than the design: the number of counted children in the heading"). The numbers live
    // in the caption under the heading — where the design draws them. `counted`
    // stays the gate of the rows query and prints nothing.
    <Section title={t('epic.title')} bodyPrintsTitle className="epic-progress-card">
      <div className="epic-progress">
        {/* sk-421.3 T17 (US-7, m-15) — the progress block header: the ring
            on the left, the counters to the right of it.

            The design's "To the left of the progress block HEADING" is implemented
            here, not in `Section`: the section heading belongs to the shared
            `Section`, which this task does not touch (it is in the mutation
            run slice). In the section body the nearest thing to the heading is the
            counters row, and the ring stands next to it. The number of counted
            children stays in the section heading and is computed as before. */}
        <div className="epic-progress-head">
          {/* sk-460.2 — the ring and the caption are ONE header block.

              The wrapper was introduced not for nesting: the header now stands next to
              two edges (`space-between`), and without it the ring, the caption and
              the toggle would spread over the row as three equidistant
              items. The design holds the ring with the caption as a single group
              at the left edge, and the toggle at the right. */}
          <div className="epic-progress-headline">
            {/* W8 — when the progress DENOMINATOR is 0, aria-valuemax must remain
             * > aria-valuemin per ARIA spec. Use valuemax=1, valuenow=0, and
             * aria-valuetext to convey the empty state explicitly.
             *
             * sk-489 T015 — the condition moved from `totalChildren === 0` to
             * `numbers.denominator === 0`, and that is three states, not one:
             * no children at all, only standing children, and — new with INV-5 —
             * an epic whose every counted child dropped out without work. The
             * first two say "no children"; the third says `epic.barNoneCounted`,
             * and `totalChildren` is NOT zero there (measured: totalChildren 2,
             * denominator 0). Reading this comment as "no children" would send
             * the next reader back to the field the rule no longer uses.
             *
             * sk-421.2 SC-014 — name and value are ONE concept, so both
             * take `barText`: two different texts on one element the screen reader
             * reads as a contradiction.
             *
             * sk-421.3 T17 — the bar became a ring, and the accessibility contract
             * moved WHOLE: the role, three numbers and one text for the name and for the
             * value — all three cases. The carrier of the contract remains this
             * element, not the `svg`: the progress indicator role belongs to
             * the thing that has a value, and the drawing inside is its illustration,
             * hidden from the screen reader. */}
            {/* sk-460.12 — the COVERAGE HINT, and it is here by condition,
                not for beauty.

                The ring counts by the epic summary, i.e. by DIRECT children;
                the "List" category counters under it count over the whole walk of the
                subtree. On `pay-7` that is "10" next to a list of 23
                rows, and without an explanation two numbers on one screen simply
                contradict each other.

                The maintainers accepted this discrepancy on 2026-09-18 on the condition that
                the coverage must be named to the user, not left
                silent. Computing the share over the subtree on the frontend is not allowed —
                the subtree contains inaccessible descendants whose status is not
                revealed by anything (INV-10), and standing ones are taken out of
                the total by the server itself (sk-118); the top-up would diverge from the
                summary or introduce a second copy of it.

                A hint, not a visible line: the accessibility contract of the
                ring is "one concept, one text" (SC-014), and a second
                label next to the percentage would argue with it for the place.

                sk-472 — but a hint is opened only by hover and focus,
                and the ring is a `progressbar` without focus, and making it
                interactive for the hint is pointless. So the coverage
                reaches the accessibility tree SEPARATELY from the hint:
                a visually hidden `.sr-only` line next to the ring and
                an `aria-describedby` reference to it — a technique already adopted in the
                repo (`TaskTreeVirtualList.tsx#sortNoteId`,
                `ApiKeysPage.tsx#mcp-json-copy-hint`). The coverage becomes
                the DESCRIPTION of the indicator, not part of the name: the name and value
                are still one `barText` (SC-014), while the coverage is a second
                concept, and it has its own place in the tree.

                One text for both paths — the key `epic.ringScope`; the hint
                and the line cannot diverge. The ring's reference to the line
                lives even when the hint is open: `SkeinTooltip` merges
                the child's props LAST (Floating UI `mergeProps`), so
                the hint's `aria-describedby` does not override it. */}
            <SkeinTooltip content={t('epic.ringScope')} position="bottom-start">
              <div
                className="epic-ring"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={numbers.denominator === 0 ? 1 : numbers.denominator}
                aria-valuenow={numbers.done}
                aria-valuetext={barText}
                aria-label={barText}
                aria-describedby={ringScopeId}
              >
              {/* The drawing is HIDDEN from the screen reader entirely: everything it conveys is
                  already said in words in `aria-valuetext`, and a second voice about
                  one fact would be read as two. The same technique as the
                  branch indicator in the row. */}
              <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden focusable="false">
                <circle className="epic-ring-track" cx="22" cy="22" r={RING_R} fill="none" />
                {/* The arcs END TO END, not overlapping, both from 12 o'clock (rotation −90°).
                    The closed one goes first — from the very top; "in progress"
                    starts where the closed one ended, so its
                    offset equals the length of the first and is taken with a minus sign
                    (the dash is counted backwards).

                    The second dash number is always the full circumference: without
                    it the pattern would repeat, and a copy of the arc would follow it. */}
                <circle
                  className="epic-ring-done"
                  cx="22"
                  cy="22"
                  r={RING_R}
                  fill="none"
                  strokeDasharray={`${closedArc} ${RING_C}`}
                  transform="rotate(-90 22 22)"
                />
                <circle
                  className="epic-ring-doing"
                  cx="22"
                  cy="22"
                  r={RING_R}
                  fill="none"
                  strokeDasharray={`${workingArc} ${RING_C}`}
                  strokeDashoffset={-closedArc}
                  transform="rotate(-90 22 22)"
                />
              </svg>
              {/* A zero total — nothing to print: the share does not exist, and "0"
                  on an empty epic would claim that nothing is done out of
                  something. The accessibility contract stays intact: three numbers and
                  the text are in place, they are above.

                  The RULE itself decides this, returning "nothing to print"
                  as a separate value: the condition here reads it and does not
                  repeat it with a second comparison to zero. */}
                {percentText !== null ? (
                  <span className="epic-ring-percent" aria-hidden>
                    {percentText}
                  </span>
                ) : null}
              </div>
            </SkeinTooltip>
            <span id={ringScopeId} className="sr-only">
              {t('epic.ringScope')}
            </span>
            {/* sk-460.6 — the heading and the caption as a COLUMN to the right of the ring.

                The heading stays a real `<h2>`: the design tells where
                it stands and in what size it is set, not what it is in
                the document structure. A screen reader walks the structure, and
                a styled `<span>` would pull the section out of the card's
                table of contents.

                On screen there is ONE: the shared `Section` turns off its own heading
                (`bodyPrintsTitle` above), and a second source of the same
                string does not exist. The `t('epic.title')` label is taken by
                the same key as the heading of the `Section` itself, so
                the two places cannot diverge in text. */}
            <div className="epic-progress-headtext">
              <h2 className="detail-section-title epic-progress-title">
                {t('epic.title')}
              </h2>
              <div className="epic-progress-counters">
              {/* US-1 — "Done" and "Not done" are visible ALWAYS, even as zeros;
                  the tails below are hidden at zero. */}
                <strong>
                  {t('epic.counters', {
                    done: numbers.done,
                    notDone,
                  })}
                </strong>
                {rollup.inProgressChildren > 0 ? (
                  <span>{t('epic.inProgress', { count: rollup.inProgressChildren })}</span>
                ) : null}
                {/* R-11 — "blocked" is counted only by "Not done": a deferred
                    child with a blocker is not included, so B ≤ Y always. */}
                {rollup.blockedChildren > 0 ? (
                  <span>{t('epic.blocked', { count: rollup.blockedChildren })}</span>
                ) : null}
                {(rollup.deferredChildren ?? 0) > 0 ? (
                  <span>{t('epic.deferred', { count: rollup.deferredChildren })}</span>
                ) : null}
                {(rollup.unavailableChildren ?? 0) > 0 ? (
                  <span>{t('epic.unavailable', { count: rollup.unavailableChildren })}</span>
                ) : null}
                {/* sk-489 T015 (US-5) — the "without work: N" tail: children
                    closed not as "done". They are taken OUT of the denominator, and
                    without this tail the on-screen identity would not add up:
                    the caption's Y + "without work" = direct non-standing children.

                    The separator stands in the markup, not in the string, unlike
                    the neighbouring tails. The key is shared with the closing modal
                    and the section row (`closeOutcome.excludedCount`),
                    and a "· " inside it would end up where there is
                    nothing to separate. */}
                {hasNoWork ? (
                  <span>
                    {' · '}
                    {t('closeOutcome.excludedCount', { count: noWork })}
                  </span>
                ) : null}
                {/* sk-118 — standing children are EXCLUDED from total/closed
                    (a perpetual obligation never closes, so it mustn't block the
                    epic from becoming "ready to close") and surfaced here as an
                    informational tail instead. */}
                {standing > 0 ? (
                  <span>{t('epic.standing', { count: standing })}</span>
                ) : null}
              </div>
            </div>
          </div>

          {/* sk-460.2 — the mode toggle moved HERE, to the right
              edge of the header, from its own row under it, as in the design
              (on both boards it stands in one row
              with the ring and the caption).

              The gate is NOT touched — it stayed the same as T022 set it,
              and the argument under it is preserved verbatim. Only the place in the
              markup moved, so `switchRef` and the fallback focus target
              keep finding the same group. */}
          {/* sk-421.2 T019 — the list body (messages and rows) lives in its own
              component; the counters, the bar and — after T022 — the toggle
              stay here and do not go anywhere at any of the messages
              (INV-7 names the denial and the error as explicit exceptions). */}
          {/* SC-014 (upstream repair from the test plan) — there is NO toggle when
              there are no counted children at all: there is nothing to switch, and offering
              a choice between two empty screens is not needed. */}
          {counted > 0 || layered.tree.length > 0 ? (
            <div
              ref={switchRef}
              className="epic-mode-switch"
              role="radiogroup"
              aria-label={t('epic.modeGroup')}
              onKeyDown={modeKeys.onKeyDown}
            >
              {EPIC_SECTION_MODES.map((m, i) => (
                <button
                  key={m}
                  // sk-490 — one Tab stop per group: `tabIndex` and
                  // `ref` from `useRadioGroupKeys` — in the traversal order only
                  // the selected mode stands, the other is reachable by arrows.
                  {...modeKeys.itemProps(i)}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  className="epic-mode-btn"
                  onClick={() => setMode(m)}
                >
                  {t(m === 'list' ? 'epic.modeList' : 'epic.modeTree')}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* US-1 — "No child tasks" exactly when total + standing
            = 0. With total 0 and standing > 0 there ARE children, and this text would be
            untrue: there the bar says "no task is counted". */}
        {counted === 0 && layered.tree.length === 0 && !layered.isLoading ? (
          <div className="col-empty">{t('epic.noChildren')}</div>
        ) : null}

        {mode === 'tree' ? (
          <EpicChildrenTree
            rows={layered.tree}
            isLoading={layered.isLoading}
            tooLarge={layered.tooLarge}
            error={layered.error}
            onOpen={handleOpenChild}
            collapsed={collapsed}
            onCollapsedChange={setCollapsed}
            epicId={issue.id}
            onFocusFallback={focusFallback}
            entryMemory={treeEntryRef}
          />
        ) : (
          <EpicChildrenList
            rows={sectionRows}
            isLoading={layered.isLoading}
            tooLarge={layered.tooLarge}
            error={layered.error}
            onOpen={handleOpenChild}
            epicId={issue.id}
            onFocusFallback={focusFallback}
            grouped={grouping === 'on'}
          />
        )}

        {/* sk-460.1 — the section FOOTER: one row above a hairline
            (as in the design: the footer row above the hairline, on both boards, in the
            "List" and in the "Tree").

            Before, three controls stood here in a COLUMN, each with its own
            `align-self: flex-start` and its own top margin, and there was no line
            separating the actions from the rows. The design draws
            one row: on the left "Add child" (or the expanded add
            form), on the right — the layout control of the mode that is
            currently shown.

            The order in the MARKUP is the same as on screen: first the button,
            then the control. This is not cosmetics. The design draws the button on the left, and
            swapping them visually via `order`, leaving the markup as
            it was, would pull the keyboard traversal order apart from the
            reading order for the eyes — which WCAG 1.3.2 and
            2.4.3 forbid. The control is pushed to the right by its own `margin-left:
            auto`; the argument for why exactly it and not `space-between` on the row
            is recorded at the rule in index.css.

            The control gates are NOT touched — they stayed exactly as
            T07 and T16 set them, and their arguments below are preserved verbatim. */}
        <div className="epic-progress-foot">
          {/* sk-514 (8) — the add form lives in a POPUP, not in the footer.

              Expanded right in the row, it pushed the footer apart and crowded out the
              layout control, and its fields were drawn by hand outside the
              system (3px rounding, `--ink-2` ink in the input).
              Now the footer always shows one button, and the input goes in
              a dialog.

              The toggle is now rendered ALWAYS, not in one of two
              mutually exclusive branches. Hence a consequence that had to be
              closed in the dictionary: the submit button label in English
              coincided with the toggle label ("Add child" for both), and in
              one tree with the popup they would become indistinguishable by
              accessible name — as they were already distinguished in Russian
              ("Добавить" versus "Добавить дочернюю"). */}
          <button
            ref={toggleRef}
            type="button"
            className="action-button epic-add-child-toggle"
            onClick={() => setAddOpen(true)}
          >
            {/* sk-285.7.2.88 — the literal `+` that opened
                `epic.addChildToggle` was U+002B PLUS SIGN, the same
                character sk-285.7.2.57 took out of `reminders.add` in
                THIS panel. §8 names `plus`; a typed plus is drawn by
                whichever face the run resolves, so neither the 1.75
                stroke nor the 16/20/24 scale reaches it, and the two
                add-affordances of one panel were drawn two ways. 16 —
                the same step `.reminder-add-btn` carries, because these
                two buttons are siblings and were measured together. */}
            <IconPlus size={16} stroke={1.75} aria-hidden />
            {t('epic.addChildToggle')}
          </button>

          <Modal
            opened={addOpen}
            onClose={() => {
              if (createMut.isPending) return;
              setAddOpen(false);
              setDraftTitle('');
            }}
            title={t('epic.addChildToggle')}
            centered
            size="md"
            closeOnEscape={!createMut.isPending}
            closeOnClickOutside={!createMut.isPending}
          >
            <form
              className="epic-add-child-form"
              onSubmit={(e) => {
                e.preventDefault();
                createMut.mutate();
              }}
            >
              <input
                type="text"
                className="epic-add-child-title"
                placeholder={t('epic.newChildTitle')}
                aria-label={t('epic.newChildTitle')}
                autoFocus
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                disabled={createMut.isPending}
                maxLength={1000}
              />
              <select
                className="epic-add-child-type"
                aria-label={t('epic.childType')}
                value={draftType}
                onChange={(e) =>
                  setDraftType(e.target.value as Exclude<IssueType, 'epic'>)
                }
                disabled={createMut.isPending}
              >
                {CHILD_TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <div className="epic-add-child-actions">
                <button
                  type="button"
                  className="action-button"
                  onClick={() => {
                    setAddOpen(false);
                    setDraftTitle('');
                    // C4 — the focus returns to the toggle. It is not remounted
                    // now, but the dialog took the focus into itself, and
                    // without the transfer it would have settled on `<body>`.
                    requestAnimationFrame(() => toggleRef.current?.focus());
                  }}
                  disabled={createMut.isPending}
                >
                  {t('common:cancel')}
                </button>
                <button
                  type="submit"
                  className="action-button primary"
                  disabled={createMut.isPending || !draftTitle.trim()}
                >
                  {createMut.isPending ? t('epic.adding') : t('epic.addChild')}
                </button>
              </div>
            </form>
          </Modal>

            {/* sk-421.3 T07 — the grouping control: AFTER the rows, next to
              "Add child" (US-9).

              The gate is ITS OWN, and it is not the toggle's. The control
              exists if and only if there are rows on screen
              that can be grouped — so it disappears together with the
              rows on loading, on the "set too large" denial,
              on an error and on an empty result, whereas the mode
              toggle stays (it is gated on `counted > 0 ||
              layered.tree.length > 0` above).

              "The fact of rendered rows" cannot be the gate: the child draws
              the rows, and the section does not know whether it got to them. Asking
              it with a callback would introduce a second source of truth about the same
              thing, counting by the DOM — even more so. So the gate is built from the same
              data the child itself decides by, and the section passes
              it to the child two lines above.

              Non-emptiness is counted over the SECTION ROWS, not over
              `layered.tree`: the layered response includes the root, so its
              length is non-empty even for an epic without a single child, and a gate on it
              would open the control where there is nothing to group.

              sk-460.12 — before, "direct children" stood here; the coverage is aligned with
              the "Tree", and the gate counts over the same set that the section
              gives the "List" two lines above. The argument has not changed:
              what matters is that the ROOT is subtracted from the set, not what
              depth it is. */}
          {mode === 'list' &&
          !layered.isLoading &&
          !layered.tooLarge &&
          !layered.error &&
          sectionRows.length > 0 ? (
            <button
              type="button"
              className="epic-group-toggle"
              aria-pressed={grouping === 'on'}
              onClick={() => setGrouping(grouping === 'on' ? 'off' : 'on')}
            >
              {/* The label reflects the ACTION, not the state. */}
              {grouping === 'on' ? t('epic.ungroup') : t('epic.groupByStatus')}
            </button>
          ) : null}

          {/* sk-421.3 T16 — the bulk collapse control: AFTER the rows, next
              to "Add child" (US-9), like the grouping control.

              The gate is the same by design: the control exists if and only if
              there is something to collapse — i.e. it disappears together with the
              rows on loading, the "set too large" denial, an error
              and for a tree without a single expandable node (US-6, acceptance
              "when there are no expandable nodes there is no control").

              The label reflects the ACTION the press will perform, not the
              current state — the same rule as for the grouping control.
              "Expand" is offered if and only if EVERY expandable
              node is collapsed.

              The bulk action REPLACES the per-node state: "expand
              all" also expands what the user collapsed by hand before
              it — no separate memory of manual collapses is kept
              (PK-3).

              The control is NOT part of the fallback focus target chain: that one
              ends with the mode toggle, otherwise "Add
              child" — the same caveat as for the grouping control. */}
          {mode === 'tree' &&
          !layered.isLoading &&
          !layered.tooLarge &&
          !layered.error &&
          expandable.length > 0 ? (
            <button
              type="button"
              className="epic-collapse-toggle"
              onClick={() => {
                const allCollapsed = expandable.every((id) => collapsed.has(id));
                setCollapsed(allCollapsed ? new Set<string>() : new Set(expandable));
              }}
            >
              {expandable.every((id) => collapsed.has(id))
                ? t('epic.expandAll')
                : t('epic.collapseAll')}
            </button>
          ) : null}
        </div>
      </div>
    </Section>
  );
}
