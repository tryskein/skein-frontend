import { useEffect, useMemo, useState } from 'react';
import { Menu, Modal, Button, Group } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  IconArrowDown,
  IconArrowLeft,
  IconArrowRight,
  IconArrowUp,
  IconCheck,
  IconEye,
  IconUser,
  IconX,
} from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import type {
  IssueDetail,
  IssueStatus,
  IssueType,
  PatchIssueInput,
  TransitionCloseInput,
} from '../../../api/issues';
import { allowedTransitions, dismissIssue, undismissIssue } from '../../../api/issues';
import { CreateSubtaskButton } from './CreateSubtaskButton';
import { useAuth } from '../../../auth/AuthContext';
import { useLayoutState } from '../../../lib/useLayoutState';
import { issueDetailKey } from '../../../lib/useIssueDetail';
import { useToaster } from '../../../components/Toaster';
import { SkeinTooltip } from '../../../components/SkeinTooltip';
import { IssueIDBadge } from '../../../components/IssueIDBadge';
import { Attribute, isDerivedBlocked } from '../../../components/Attribute';
import { BusinessError } from '../../../api/client';
import { isStatusChangeFailure } from '../../../lib/useIssueDetail';
import { CloseOutcomeControl } from './CloseOutcomeControl';
import { StatusChangeReasonModal } from './StatusChangeReasonModal';
import { MoveIssueButton } from './MoveIssueButton';
import { extractMessage } from '../../../lib/extractApiMessage';
import { refusalReason } from '../../../lib/saveFailureReason';
import { DANGER_BUTTON_VARS } from '../../../lib/dangerButtonVars';
import { formatDate, formatDateUtc, formatRelative, formatTimestamp } from '../../../components/format';
import { useMySpaces } from '../../../lib/useMySpaces';
import { spaceHandle, spacePath } from '../../../lib/shellUrlState';

// sk-31: 'blocked' is no longer a writable status. The menu lists only
// real wire statuses; the [blocked] chip on StatusBadge surfaces the
// derived flag separately when a typed-deps edge exists.
const STATUS_OPTIONS: IssueStatus[] = [
  'open',
  'in_progress',
  'deferred',
  'standing',
  'closed',
];
const PRIORITY_OPTIONS = [0, 1, 2, 3, 4] as const;
// sk-7: full writable type set, mirrors IssueType union in api/issues.ts
// and the colour map in TypeBadge. Kept in declaration order (matches
// the backend enum + skein_create's `type` arg).
const TYPE_OPTIONS: IssueType[] = [
  'bug',
  'feature',
  'task',
  'epic',
  'chore',
  'decision',
  'idea',
  'note',
];

/**
 * sk-285.6.3 — WHICH action is the primary one, per state.
 *
 * The header used to draw six controls in one weight — `→ start work`,
 * `✓ Accept`, `👁 Watch`, `↪ Move`, the version chip and the
 * close ×, all outlined, all 12px — so nothing said what the reader was
 * meant to do next. The fix is a RANK, not a smaller set: the frequent
 * actions stay one click away, but exactly one of them is filled.
 *
 * The table is the rule, in one place, read top to bottom — the FIRST
 * row that matches wins, which is what makes "exactly one" a property
 * of the data rather than of the reading order of some `if` chain:
 *
 *   ┌────────────────────────────────┬──────────────────────────────┐
 *   │ state                          │ primary action               │
 *   ├────────────────────────────────┼──────────────────────────────┤
 *   │ assigned to me, not accepted   │ Accept                       │
 *   │ standing (any owner)           │ Create subtask               │
 *   │ mine · open                    │ → in progress                │
 *   │ mine · in_progress             │ ✗ close                      │
 *   │ mine · deferred                │ → resume                     │
 *   │ mine · closed                  │ ↻ reopen                     │
 *   │ someone else's (any status)    │ Watch                        │
 *   └────────────────────────────────┴──────────────────────────────┘
 *
 * Read as prose: the first thing you owe a task handed to you is to
 * ACKNOWLEDGE it, so Accept outranks everything while it applies. A
 * standing task is never worked in place (sk-118), so its primary is
 * the one action that does make progress on it — spawning a cycle.
 * After that, the primary is whatever moves YOUR task to its next
 * state. On a task that is not yours the only thing you can usefully
 * do is follow it, so Watch takes the weight — and nothing else on the
 * row gets it.
 *
 * `null` is not in the table on purpose: every state has a primary.
 * If a future state cannot name one, the honest change is to add a row
 * saying so, not to let the function fall through.
 */
type PrimaryAction =
  | 'accept'
  | 'subtask'
  | 'status-shortcut'
  | 'watch';

/**
 * The table above, executed. `shortcutNext` names the status the
 * shortcut row would move to, so the caller can mark exactly the
 * matching button (a `deferred` task offers two shortcuts, and only
 * "resume" is the primary one — closing it is not).
 *
 * Exported for `DetailsHeaderPrimary.test.tsx`, which asserts the
 * MAPPING directly. Matching on `shortcutNext` rather than on "the
 * first shortcut in the list" is not load-bearing today — resume
 * happens to be listed first — so a render test cannot tell the two
 * apart. Pinning the mapping here is what stops a later reordering of
 * `shortcuts` from silently moving the promotion onto the close.
 */
export function primaryActionFor(input: {
  status: IssueStatus;
  isAssignee: boolean;
  isAccepted: boolean;
}): { action: PrimaryAction; shortcutNext?: IssueStatus } {
  const { status, isAssignee, isAccepted } = input;
  if (isAssignee && !isAccepted && status !== 'closed') return { action: 'accept' };
  if (status === 'standing') return { action: 'subtask' };
  if (isAssignee) {
    switch (status) {
      case 'open':
        return { action: 'status-shortcut', shortcutNext: 'in_progress' };
      case 'in_progress':
        return { action: 'status-shortcut', shortcutNext: 'closed' };
      case 'deferred':
        return { action: 'status-shortcut', shortcutNext: 'in_progress' };
      case 'closed':
        return { action: 'status-shortcut', shortcutNext: 'open' };
    }
  }
  return { action: 'watch' };
}

/**
 * sk-285.7.2.45 — the icon each control on this row wears.
 *
 * The row used to spell its icons as literal characters inside the
 * TRANSLATION strings — `→ in progress`, `👁 Watching`, `↪ Move`, `×`,
 * `✓ Accept`, `↓ Drop…`, `↑ Resume…` — and the audit's zone count is the
 * shape of the cost: `.col-details` held ZERO `<svg>` while the header
 * held 15 and each of the other three columns held 4…7.
 *
 * A character is not a small icon. It is drawn by whatever font the
 * system resolves for it (`👁` lands in the emoji face, so it arrives
 * coloured, at its own weight, and off the 16/20/24 scale of §8), it
 * cannot take `currentColor`, and it cannot take a stroke width — so
 * §8's «stroke 1.75» has nothing to attach to. `Sk Details.dc.html`
 * draws all four as `ti-*` elements, and §8 names every one of them.
 *
 * The map is keyed by the ACTION, not by the label, because the labels
 * are per-locale and the icon is not: `→ в работу` and `→ in progress`
 * are one control. `null` means "this control draws no icon" and is
 * spelled out rather than left to a missing key, so a new shortcut
 * cannot acquire "no icon" by omission.
 *
 * `size` follows the artboard: 16 on the labelled action buttons (the
 * inline-in-text step), 20 on the icon-only close.
 */
const SHORTCUT_ICON: Record<IssueStatus, typeof IconArrowRight> = {
  // → in progress / → resume: the task moves forward.
  in_progress: IconArrowRight,
  // ✗ close / ✗ retire: the task is struck out.
  closed: IconX,
  // ↻ reopen: the task comes back to where it started.
  open: IconArrowLeft,
  // No shortcut targets these two today (a standing task is retired,
  // never "deferred to"), but the map is total so a future one cannot
  // land here silently without an icon.
  deferred: IconArrowRight,
  standing: IconArrowRight,
};

const STATUS_CLASS: Record<IssueStatus, string> = {
  open: 'open',
  in_progress: 'in-progress',
  deferred: 'deferred',
  // sk-118 — distinct class so the header status pill picks up the
  // standing cyan styling (see index.css .status-standing).
  standing: 'standing',
  closed: 'closed',
};

export interface DetailsHeaderProps {
  issue: IssueDetail;
  isWatching: boolean;
  watchToggling: boolean;
  onUpdateField: (
    // sk-489 (US-12) — the outcome is edited by the same path as priority and type
    // (`useIssueDetail#updateField` → `patchMutation`), so the field list
    // is extended, not a second prop introduced: header field editing has
    // one road and one display of refusal.
    patch: Pick<PatchIssueInput, 'priority' | 'type' | 'closeOutcome' | 'closeTarget'>,
  ) => Promise<unknown>;
  // Returns the typed changeStatus result: a successful IssueDetail, a
  // `{ error }` failure wrapper, or null (no-op). The retire flow in
  // submitReason() branches on this so a failed close keeps the modal
  // open with the open-children guard rather than closing it as if it
  // had succeeded. `unknown` would also type-check, but the explicit
  // union documents the contract the dialog relies on.
  onChangeStatus: (
    next: IssueStatus,
    reason?: string,
    // sk-489 (US-1, US-2) — the outcome and target picked in the close modal.
    // `undefined` — not asked (a transition that does not close, or
    // a retirement), and then the server default applies.
    close?: TransitionCloseInput,
  ) => Promise<IssueDetail | { error: Error } | null>;
  onAccept: () => Promise<unknown>;
  onWatchToggle: () => void;
}

/**
 * Sticky single-row header for the Details panel. Everything wraps to
 * a second line if the column is too narrow; nothing scrolls
 * horizontally. The title is no longer here — it lives at the top of
 * the issue body (above the Description section) where it doubles as
 * the page heading and has more room to breathe.
 *
 *   Row 1: [project] [id] [status] [priority] [type] · spacer · created {date} · v{n} [×]
 *   Row 2: [subtask?] [status-shortcut buttons] [accept?] [watch] [move]
 *
 * sk-285.7.2.53 — TWO rows, which is §6's own shape: "a `project ·
 * id · status · P · type · v7 · ✕` row; an actions row". A reading of the
 * task on one line, the commands on the next. It used to be one wrapping
 * row plus an eyebrow above it — three lines, with the primary button
 * pulled up among the chips and `v7`/`✕` pushed down among the buttons,
 * so each line mixed a reading with a command.
 *
 * sk-285.6.3's `.details-header-sep` (a 1px rule between the two kinds)
 * went with that change: the row break states the same separation
 * structurally, and it survives a narrow column, which is the property
 * the rule was introduced for. Exactly ONE of the commands still wears
 * the filled `primary` class, chosen by `primaryActionFor` above.
 *
 * Status changes that require a reason (close / block / defer) open
 * a small Mantine modal owned by IssueDetailPanel — this header just
 * forwards the requested transition through `onChangeStatus`.
 */
export function DetailsHeader({
  issue,
  isWatching,
  watchToggling,
  onUpdateField,
  onChangeStatus,
  onAccept,
  onWatchToggle,
}: DetailsHeaderProps) {
  const { t } = useTranslation('details');
  const { user } = useAuth();
  const { clearSelectedIssue, selectedProject } = useLayoutState();
  const qc = useQueryClient();
  const toast = useToaster();

  // Priority dropdown — open/closed state. Mantine's <Menu> handles
  // outside-click + ESC for free; we keep controlled state only so we
  // can force-close on issue navigation and on item-pick.
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  // sk-7 — type dropdown open/closed; same controlled-state rationale
  // as the priority menu above.
  const [typeOpen, setTypeOpen] = useState(false);

  // Close dropdowns when the issue id changes (user navigated to
  // a different task and the dropdown was left open by accident).
  useEffect(() => {
    setPriorityOpen(false);
    setStatusOpen(false);
    setTypeOpen(false);
  }, [issue.id]);

  const isAssignee =
    !!user?.username &&
    !!issue.assignee &&
    user.username.toLowerCase() === issue.assignee.toLowerCase();
  // sk-25 — Accept is the "I see this task and I'm taking it" verb.
  // Closed issues are already done, so the affordance is meaningless
  // (and the backend now rejects it with cannot_accept_closed). Hide
  // the button on closed rows even when the row has assignee=caller
  // and acceptedAt=null (typical for tasks the caller closed without
  // ever accepting them — e.g. self-closing a row before acknowledging
  // it via the Accept verb).
  const showAccept =
    isAssignee && !issue.acceptedAt && issue.status !== 'closed';

  // sk-285.6.3 — the one primary action for this state. Every button on
  // the row asks this object whether it is the one; at most one can say
  // yes, because `primaryActionFor` returns a single verdict.
  const primary = primaryActionFor({
    status: issue.status,
    isAssignee,
    isAccepted: !!issue.acceptedAt,
  });

  // sk-34 — Delegated chain affordance. The Drop button surfaces when:
  //   * caller is in previousAssignees (was assignee at some point), AND
  //   * caller is NOT in dismissedBy (hasn't already opted out), AND
  //   * caller is NOT the current assignee (otherwise On-me's job), AND
  //   * caller is NOT the creator (the lens always shows creators their
  //     own delegations; dismissing makes no sense there — there's no
  //     opt-out path for creators).
  // Resume is the symmetric inverse: in chain AND dismissed.
  const inChain = !!user && (issue.previousAssignees ?? []).includes(user.id);
  const dismissed = !!user && (issue.dismissedBy ?? []).includes(user.id);
  const isCreator = !!user && issue.createdBy === user.id;
  const showDropButton = inChain && !dismissed && !isAssignee && !isCreator;
  const showResumeButton = inChain && dismissed && !isAssignee && !isCreator;

  const [dropConfirmOpen, setDropConfirmOpen] = useState(false);

  // Both mutations refresh:
  //   - this issue's detail (the new previousAssignees/dismissedBy
  //     surface needs to reflect the post-action state)
  //   - the cross-project Tasks column / Inbox queries (a dropped
  //     issue disappears from Delegated)
  //   - the watchers list (dismiss installs sticky-unwatch so the
  //     Watching panel's chip flips)
  const dismissMut = useMutation<IssueDetail, Error, void>({
    mutationFn: () => dismissIssue(issue.id),
    onSuccess: (dto) => {
      qc.setQueryData(issueDetailKey(issue.id), dto);
      void qc.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey)
          && (q.queryKey[0] === 'tasks'
            || q.queryKey[0] === 'inbox'
            || q.queryKey[0] === 'watchers'
            || q.queryKey[0] === 'notification-counts'),
      });
      setDropConfirmOpen(false);
    },
    onError: (err) => {
      toast.error(refusalReason(err, t) ?? extractMessage(err));
    },
  });
  const undismissMut = useMutation<IssueDetail, Error, void>({
    mutationFn: () => undismissIssue(issue.id),
    onSuccess: (dto) => {
      qc.setQueryData(issueDetailKey(issue.id), dto);
      void qc.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey)
          && (q.queryKey[0] === 'tasks'
            || q.queryKey[0] === 'inbox'
            || q.queryKey[0] === 'notification-counts'),
      });
    },
    onError: (err) => {
      toast.error(refusalReason(err, t) ?? extractMessage(err));
    },
  });

  // sk-31: the status pill in this header doubles as the derived-blocked
  // indicator when the issue has at least one open blocker AND isn't
  // closed. We render the underlying wire status (open/in_progress/...)
  // — the inline `[blocked]` chip lives on StatusBadge wherever the
  // issue is summarised — but we tint the pill border red and extend
  // the aria-label so AT users hear the derived state too.
  //
  // sk-118: standing is ALSO immune to the blocked override, mirroring
  // StatusBadge. Nothing can target a standing task with blocks/waits-for
  // (§11.2), so a stray isBlocked=true on a standing issue must NOT flip
  // its Standing pill to blocked (class/aria/title). The standing
  // band marker is the dominant signal.
  //
  // sk-421.1 T015 (INV-9, decision 7) — the rule is no longer restated
  // here: the header asks the shared predicate, and so does the
  // "Blocked" block under the properties row, so the red outline
  // and the block cannot disagree.
  const derivedBlocked = isDerivedBlocked(issue.status, issue.isBlocked);

  // Reason-required transitions (closed / blocked / deferred) open
  // the StatusChangeReasonModal; non-reason transitions flush
  // immediately. The modal state lives here so the dropdown can
  // close on pick without unmounting the modal.
  const [reasonModal, setReasonModal] = useState<{
    next: IssueStatus;
    // sk-118 — true when this close is a RETIRE of a standing task
    // (reframes the modal verb/placeholder + surfaces the open-children
    // guard). Set only on a 'closed' transition out of `standing`.
    isRetire?: boolean;
  } | null>(null);
  const [reasonSubmitting, setReasonSubmitting] = useState(false);
  const [reasonError, setReasonError] = useState<string | null>(null);
  // sk-118 — offending child ids parsed from a standing_has_open_children
  // rejection, surfaced as a list in the retire modal.
  const [standingChildIds, setStandingChildIds] = useState<string[]>([]);

  const requestStatus = async (next: IssueStatus) => {
    if (next === issue.status) return;
    setStatusOpen(false);
    // sk-31: 'blocked' dropped from the writable set. The remaining
    // reason-required transitions are 'closed' and 'deferred'.
    // sk-118: closing a standing task is a RETIRE — reframe the modal.
    const needsReason = next === 'closed' || next === 'deferred';
    if (needsReason) {
      setReasonError(null);
      setStandingChildIds([]);
      setReasonModal({ next, isRetire: next === 'closed' && issue.status === 'standing' });
      return;
    }
    await onChangeStatus(next);
  };

  const closeReasonModal = () => {
    setReasonModal(null);
    setReasonError(null);
    setStandingChildIds([]);
  };

  // Surface a failed reason-required transition INLINE in the modal and
  // keep it open. Shared by both the returned-`{ error }` path (the
  // useIssueDetail contract — changeStatus resolves a failure wrapper
  // rather than throwing) and the defensive thrown-error path (in case a
  // future onChangeStatus implementation rejects instead).
  //
  // sk-118 — the retire guard: when the backend rejects a standing close
  // with `standing_has_open_children`, surface the offending child ids
  // distinctly so the user knows what to close first. Over REST the ids
  // ride in `extra.childIds` when present (the message always names the
  // guard regardless). The parent toaster also surfaces the error
  // globally (via useIssueDetail) — the inline duplication here is
  // intentional: the modal is the focal point right now.
  const surfaceReasonError = (err: Error) => {
    if (err instanceof BusinessError && err.code === 'standing_has_open_children') {
      const ids = err.extra?.childIds;
      setStandingChildIds(Array.isArray(ids) ? ids.map((x) => String(x)) : []);
    }
    setReasonError(err.message || t('header.statusChangeFailed'));
  };

  const submitReason = async (reason: string, close?: TransitionCloseInput) => {
    if (!reasonModal) return;
    setReasonSubmitting(true);
    setReasonError(null);
    setStandingChildIds([]);
    try {
      const result = await onChangeStatus(reasonModal.next, reason || undefined, close);
      // The contract is a typed result, NOT a throw: a failed transition
      // resolves to `{ error }`. Only a successful IssueDetail closes the
      // modal — anything else (failure wrapper or null no-op) keeps it
      // open. Without this branch a rejected retire closed the modal as
      // if it had succeeded and the open-children guard never rendered.
      if (isStatusChangeFailure(result)) {
        surfaceReasonError(result.error);
        return;
      }
      if (result === null) {
        // No-op (issue not loaded). The hook already toasted; keep the
        // modal open without an inline error so the user can retry.
        return;
      }
      closeReasonModal();
    } catch (err) {
      // Defensive: a future onChangeStatus that rejects instead of
      // returning `{ error }` still keeps the modal open with the guard.
      surfaceReasonError(
        err instanceof Error ? err : new Error(t('header.statusChangeFailed')),
      );
    } finally {
      setReasonSubmitting(false);
    }
  };

  // Status shortcut buttons — keep at most two next to the dropdown.
  // Memoized so the array reference is stable across renders that
  // don't change `issue.status`.
  const shortcuts = useMemo<
    { next: IssueStatus; label: string; variant?: string }[]
  >(() => {
    // sk-31: 'blocked' no longer in the writable set. The "→ blocked"
    // shortcut is gone; users who want a blocked label add a typed-deps
    // edge via skein_dep_add / the Dependencies section, which the
    // StatusBadge picks up automatically.
    switch (issue.status) {
      case 'open':
        return [
          { next: 'in_progress', label: t('header.shortcuts.toInProgress') },
        ];
      case 'in_progress':
        return [
          { next: 'closed', label: t('header.shortcuts.close'), variant: 'danger' },
        ];
      case 'deferred':
        return [
          { next: 'in_progress', label: t('header.shortcuts.resume') },
          { next: 'closed', label: t('header.shortcuts.close'), variant: 'danger' },
        ];
      case 'standing':
        // sk-118 — a standing task is NOT worked in place: the "Create
        // subtask" affordance (rendered separately below, not as a status
        // shortcut) replaces the «→ in progress» button. The only inline
        // shortcut is the retire — closing it routes through the retire
        // dialog (requestStatus detects status==='standing').
        return [
          { next: 'closed', label: t('header.shortcuts.retire'), variant: 'danger' },
        ];
      case 'closed':
        return [{ next: 'open', label: t('header.shortcuts.reopen') }];
      default:
        return [];
    }
  }, [issue.status, t]);

  // sk-437 — hover text for the creation date. `formatRelative` folds
  // back to the plain UTC date (`formatDateUtc`) past 30 days, and on an
  // old issue that made the tooltip read
  // "Created 2026-05-16 15:00 UTC (2026-05-16 UTC)" — the
  // same date twice. Append the relative form only while it still says
  // something the absolute timestamp doesn't.
  const createdTitle = (() => {
    const exact = formatTimestamp(issue.createdAt);
    const relative = formatRelative(issue.createdAt);
    return relative === formatDateUtc(issue.createdAt)
      ? t('header.createdTitle', { exact })
      : t('header.createdTitleRelative', { exact, relative });
  })();

  // Project handle is derivable from the issue id by contract
  // (`{prefix}-{n}`). Cheaper than a project-lookup and works on the
  // cross-project `/issues/:id` route where no alias is in the URL.
  const projectHandle = (() => {
    const m = issue.id.match(/^(.+)-\d+(?:\.\d+)*$/);
    return m ? m[1] : null;
  })();

  // sk-35 — cosmetic mismatch chip. The issue's id prefix encodes
  // the PARENT's project (because new children inherit the parent's
  // id prefix even when the child's `project_id` column points at a
  // different project — sk-35 user decision #1). When the prefix
  // disagrees with the URL-selected project alias, surface the
  // discord so the user can see "this issue lives in <currentProj>
  // but was minted under <prefix>". `selectedProject` may be null
  // when the user landed on the cross-project `/issues/:id` route —
  // we skip the chip in that case (no current-project to compare).
  const crossProjectChipText = (() => {
    if (!projectHandle || !selectedProject) return null;
    if (projectHandle === selectedProject) return null;
    return t('header.crossProjectChip', { handle: projectHandle });
  })();

  return (
    <div className="details-header">
      <div className="details-header-row">
        {/* sk-551.50 — the row is two groups: the readings on the left
            (they wrap among themselves when the pane is narrow) and the
            version + ✕ pinned top-right, never wrapped onto a line of
            their own. */}
        <div className="details-header-meta">
        {/* sk-285.7.2.53 — §6 opens the metadata line with the project
            handle: "a `project · id · status · P · type · v7 · ✕` row".
            It used to be an eyebrow on a line of ITS OWN above the row,
            which is where the header's third line came from. */}
        <SpaceChip spaceId={issue.spaceId} />
        {projectHandle ? (
          <span className="details-header-eyebrow">{projectHandle}</span>
        ) : null}
        <IssueIDBadge id={issue.id} pinned={issue.pinned} copyable />
        {crossProjectChipText ? (
          <span
            className="details-header-prefix-mismatch"
            title={t('header.crossProjectChipTitle')}
          >
            {crossProjectChipText}
          </span>
        ) : null}
        {/* Status — clickable, opens Menu for full set. */}
        <Menu
          opened={statusOpen}
          onChange={setStatusOpen}
          position="bottom-end"
          offset={2}
          withinPortal
          trigger="click"
        >
          <Menu.Target>
            <button
              type="button"
              className={`header-attr-trigger header-status status-${STATUS_CLASS[issue.status]}${derivedBlocked ? ' is-blocked' : ''}`}
              aria-label={
                derivedBlocked
                  ? t('header.statusAriaBlocked', { status: issue.status })
                  : t('header.statusAria', { status: issue.status })
              }
              title={
                derivedBlocked
                  ? t('header.statusTitleBlocked', { status: issue.status })
                  : issue.status
              }
            >
              {/* sk-285.1.5 — the same <Attribute> the tree / cards /
                  search render, at the Details size. `isBlocked` is NOT
                  forwarded: this chip is the trigger for the WRITABLE
                  status, and `blocked` is not a writable value (sk-31).
                  The derived-blocked signal stays on the trigger itself
                  (`is-blocked` → red outline + extended aria-label). */}
              <Attribute kind="status" value={issue.status} size="regular" />
            </button>
          </Menu.Target>
          <Menu.Dropdown>
            {/* sk-118 — offer the current status (active, no-op) plus only
                the transitions the backend actually allows from it. This
                hides the forbidden standing edges (standing→in_progress,
                standing→deferred) so the menu can't drive a guaranteed
                rejection. */}
            {STATUS_OPTIONS.filter(
              (s) => s === issue.status || allowedTransitions(issue.status).includes(s),
            ).map((s) => (
              <Menu.Item
                key={s}
                className={`header-pill-menu-item${s === issue.status ? ' active' : ''}`}
                // a11y: see priority menu above — menuitemradio +
                // aria-checked is the correct shape for a single-pick
                // status group inside a Mantine Menu.
                role="menuitemradio"
                aria-checked={s === issue.status}
                onClick={() => {
                  void requestStatus(s);
                }}
              >
                {s}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>

        {/* sk-489 (US-7, US-12) — the close outcome right after the status: it
            refines the status specifically, and the two are read as a pair. It decides
            whether to show itself — see its docblock. */}
        <CloseOutcomeControl issue={issue} onUpdateField={onUpdateField} />

        {/* Priority — clickable badge opens a Mantine Menu (handles
            outside-click + ESC + a11y for free). */}
        <Menu
          opened={priorityOpen}
          onChange={setPriorityOpen}
          position="bottom-end"
          offset={2}
          withinPortal
          trigger="click"
        >
          <Menu.Target>
            <button
              type="button"
              className="header-attr-trigger header-priority"
              aria-label={t('header.priorityAria', { priority: issue.priority })}
              title={`P${issue.priority}`}
            >
              <Attribute kind="priority" value={issue.priority} size="regular" />
            </button>
          </Menu.Target>
          <Menu.Dropdown>
            {PRIORITY_OPTIONS.map((p) => (
              <Menu.Item
                key={p}
                className={`header-pill-menu-item${p === issue.priority ? ' active' : ''}`}
                // a11y: Mantine Menu.Item renders role="menuitem"; the
                // valid attribute for "selected one of a group" on a
                // menuitem is aria-checked + role="menuitemradio", not
                // aria-selected (which targets option/tab/row roles).
                role="menuitemradio"
                aria-checked={p === issue.priority}
                onClick={() => {
                  setPriorityOpen(false);
                  if (p !== issue.priority) {
                    void onUpdateField({ priority: p });
                  }
                }}
              >
                P{p}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>

        {/* Type — clickable badge opens a Mantine Menu listing all 8
            issue types. Mirrors the Priority menu below (controlled
            open-state, menuitemradio + aria-checked for the current
            value, optimistic UI via onUpdateField).
            sk-285.1.5 — the visible label is the shared <Attribute>
            (size="regular", the Details size), so the type reads
            identically here and in the tree / cards / search. The
            <button> is only the trigger chrome. */}
        <Menu
          opened={typeOpen}
          onChange={setTypeOpen}
          position="bottom-end"
          offset={2}
          withinPortal
          trigger="click"
        >
          <Menu.Target>
            <button
              type="button"
              className="header-attr-trigger header-type"
              aria-label={t('header.changeType', { type: issue.type })}
              title={t('header.typeTitle', { type: issue.type })}
            >
              <Attribute kind="type" value={issue.type} size="regular" />
            </button>
          </Menu.Target>
          <Menu.Dropdown>
            {TYPE_OPTIONS.map((t) => (
              <Menu.Item
                key={t}
                className={`header-pill-menu-item${t === issue.type ? ' active' : ''}`}
                // a11y: see priority menu below — menuitemradio +
                // aria-checked is the correct shape for a single-pick
                // type group inside a Mantine Menu.
                role="menuitemradio"
                aria-checked={t === issue.type}
                onClick={() => {
                  setTypeOpen(false);
                  if (t !== issue.type) {
                    void onUpdateField({ type: t });
                  }
                }}
              >
                {t}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>

          {/* sk-437 — creation date, rendered in UTC via the shared
              formatter so it reads the same for every reader, with the
              exact timestamp and a relative form on hover. `createdAt` is
              non-null on the wire, but formatDate degrades to an em-dash
              rather than "Invalid Date" if that ever changes. sk-551.50 —
              it is the last of the readings, so in a narrow pane it is
              the first to wrap, and never drags the ✕ along. */}
          <span className="details-header-created" title={createdTitle}>
            {t('header.created', { date: formatDate(issue.createdAt) })}
          </span>
        </div>
        <div className="details-header-tail">
          {/* sk-285.6.3 — `v1` sat unlabelled next to the close ×, where
              it reads as chrome of unknown purpose, so the number gained
              a name. sk-285.7.2.53 — the name moved from the CHIP to the
              TITLE: §6 and the artboard both write this slot `v7`, mono
              12 `--ink-3`. The hover still explains what the number
              counts, which is where an explanation belongs. */}
          <span
            className="details-header-version"
            title={t('header.versionTitle', { version: issue.version })}
          >
            {t('header.version', { version: issue.version })}
          </span>
          <button
            type="button"
            className="details-header-close"
            aria-label={t('header.closeAria')}
            title={t('header.closeTitle')}
            onClick={clearSelectedIssue}
          >
            {/* 20px — §8's control step, and the size the artboard gives
                this exact button. The accessible name is the aria-label. */}
            <IconX size={20} stroke={1.75} aria-hidden />
          </button>
        </div>
        {/* sk-285.7.2.53 — the header is TWO rows, which is what §6
            draws: a metadata line, then a line of actions. It was three,
            because the project handle sat on a line of its own above and
            the primary button had been pulled UP into the metadata line
            while `v7` and the ✕ were pushed DOWN into the actions. That
            put a reading and a command on each of two lines instead of
            one of each on its own.

            The seam element this replaces (`.details-header-sep`, a 1px
            rule) existed to keep state and commands apart INSIDE one
            row. Two rows say the same thing structurally, and a divider
            between rows would be a second, weaker copy of the break. */}
      </div>

      <div className="details-header-actions">

        {/* sk-118 — standing tasks aren't claimed/worked in place: the
            start/claim affordance is REPLACED by "Create subtask",
            which spawns a child cycle (skein_create parentId=<standing>).
            Rendered before the retire shortcut so the primary action sits
            first. */}
        {issue.status === 'standing' && projectHandle ? (
          <CreateSubtaskButton
            parentId={issue.id}
            projectHandle={projectHandle}
            primary={primary.action === 'subtask'}
          />
        ) : null}

        {shortcuts.map((sc) => {
          // sk-285.6.3 — a `deferred` task renders TWO shortcuts and
          // only one of them is the primary; matching on `shortcutNext`
          // rather than on "the first shortcut" is what keeps the fill
          // on "resume" instead of on "close".
          const isPrimary =
            primary.action === 'status-shortcut' && primary.shortcutNext === sc.next;
          const Icon = SHORTCUT_ICON[sc.next];
          return (
            <button
              key={sc.next}
              type="button"
              className={[
                'action-button',
                isPrimary ? 'primary' : '',
                // The danger tint is a warning about consequence and the
                // primary fill is a statement about rank; a close that
                // IS the expected next step is both, so `danger` is not
                // dropped when the button is promoted — the CSS layers
                // them (`.action-button.primary.danger`).
                sc.variant === 'danger' ? 'danger' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => void requestStatus(sc.next)}
            >
              {/* Decorative: the button's visible label already names the
                  transition, so announcing the glyph too would double it. */}
              <Icon size={16} stroke={1.75} aria-hidden />
              {sc.label}
            </button>
          );
        })}

        {issue.type === 'epic' && issue.epic?.eligibleForClose ? (
          // W5 — non-interactive <span>: aria-label on non-focusable
          // elements is ignored by most screen readers. The visible
          // text "Ready to close" is the accessible name; the ✓ glyph
          // is decorative and should be hidden from assistive tech to
          // avoid double-announce.
          <span
            className="header-epic-ready"
            title={t('header.readyToCloseTitle', {
              count: issue.epic.totalChildren,
            })}
          >
            <IconCheck size={16} stroke={1.75} aria-hidden />
            {t('header.readyToClose')}
          </span>
        ) : null}

        {showAccept ? (
          <button
            type="button"
            className={`action-button${primary.action === 'accept' ? ' primary' : ''}`}
            onClick={() => void onAccept()}
          >
            <IconCheck size={16} stroke={1.75} aria-hidden />
            {t('header.accept')}
          </button>
        ) : null}

        {showDropButton ? (
          <SkeinTooltip content={t('header.dropFromDelegatedTooltip')}>
            <button
              type="button"
              className="action-button"
              // sk-34 HTML-W3 — explicit aria-label embeds the issue id
              // so SR users hear context ("Drop sk-34 from Delegated"
              // rather than just "Drop from Delegated"). The Floating-UI
              // tooltip from SkeinTooltip isn't auto-wired to
              // aria-describedby, so the button needs to carry context
              // on its own.
              aria-label={t('header.dropFromDelegatedAria', { id: issue.id })}
              disabled={dismissMut.isPending}
              onClick={() => setDropConfirmOpen(true)}
            >
              <IconArrowDown size={16} stroke={1.75} aria-hidden />
              {t('header.dropFromDelegated')}
            </button>
          </SkeinTooltip>
        ) : null}

        {showResumeButton ? (
          <SkeinTooltip content={t('header.resumeTrackingTooltip')}>
            <button
              type="button"
              className="action-button"
              // sk-34 HTML-W3 — see Drop button above for rationale.
              aria-label={t('header.resumeTrackingAria', { id: issue.id })}
              disabled={undismissMut.isPending}
              onClick={() => void undismissMut.mutate()}
            >
              <IconArrowUp size={16} stroke={1.75} aria-hidden />
              {t('header.resumeTracking')}
            </button>
          </SkeinTooltip>
        ) : null}

        <button
          type="button"
          className={[
            'action-button',
            // `active` (already watching) wins over `primary` (watching
            // is the thing to do here): once the toggle is on, its own
            // state is the more useful thing for it to report.
            isWatching
              ? 'active'
              : primary.action === 'watch'
                ? 'primary'
                : '',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-pressed={isWatching}
          disabled={watchToggling}
          onClick={onWatchToggle}
          title={
            isWatching ? t('header.unwatchTitle') : t('header.watchTitle')
          }
        >
          <IconEye size={16} stroke={1.75} aria-hidden />
          {isWatching ? t('header.watching') : t('header.watch')}
        </button>

        {/* sk-35: re-parenting affordance. Visible on every issue —
            the modal exposes a "Top-level (no parent)" sentinel so
            this button covers both moving INTO an epic and dropping
            the parent link entirely. */}
        <MoveIssueButton issue={issue} />
      </div>

      <StatusChangeReasonModal
        opened={reasonModal !== null}
        issueId={issue.id}
        next={reasonModal?.next ?? 'closed'}
        loading={reasonSubmitting}
        error={reasonError}
        isRetire={reasonModal?.isRetire}
        standingChildIds={standingChildIds}
        onSubmit={submitReason}
        onClose={closeReasonModal}
      />

      <Modal
        opened={dropConfirmOpen}
        onClose={() => {
          // sk-34 TS-W1: don't allow the modal to close (via ESC,
          // click-outside, or the X) while the mutation is in flight —
          // half-applied close + late-arriving toast is confusing.
          if (dismissMut.isPending) return;
          setDropConfirmOpen(false);
        }}
        title={t('header.dropConfirm.title')}
        centered
        // sk-34 TS-W1 — gate ESC + click-outside on mutation state.
        // Mirrors StatusChangeReasonModal's pattern.
        closeOnEscape={!dismissMut.isPending}
        closeOnClickOutside={!dismissMut.isPending}
        // sk-34 HTML-W2 — wire the body paragraph to the dialog's
        // aria-describedby so SR users hear the consequence text and
        // not only the title.
        aria-describedby="drop-confirm-desc"
      >
        <p id="drop-confirm-desc" style={{ marginTop: 0 }}>
          {t('header.dropConfirm.body')}
        </p>
        <Group justify="flex-end" gap="sm" mt="md">
          <Button
            variant="default"
            // sk-34 HTML-W1 — explicit autofocus on the safe action
            // so initial keyboard focus doesn't depend on JSX order.
            // A future refactor that puts the destructive button
            // first won't steal focus.
            data-autofocus
            onClick={() => setDropConfirmOpen(false)}
            disabled={dismissMut.isPending}
          >
            {t('common:cancel')}
          </Button>
          {/* sk-285.7.2.85 — the confirming button of this dialog, and
              the one place where the fix is NOT «add variant="filled"»:
              `color="red"` is a builtin Mantine ramp that measures
              3.28:1 filled. The whole reasoning, and the numbers, live
              on `DANGER_BUTTON_VARS`. */}
          <Button
            variant="filled"
            style={DANGER_BUTTON_VARS}
            loading={dismissMut.isPending}
            onClick={() => void dismissMut.mutate()}
          >
            {t('header.dropConfirm.confirm')}
          </Button>
        </Group>
      </Modal>
    </div>
  );
}

/**
 * sk-674.18 T055 — the space chip before the project code in the card's
 * header (screens 1.10, plan 5.2): `[Acme] [shop] [shop-9.15] …`. Drawn only
 * with two spaces or more — with one (or none, an external user) the
 * header is as it was. The space is the one of the issue's PROJECT
 * (`spaceId` of the card), never guessed from the id prefix: a subtask may
 * carry the prefix of a parent from another project. "Personal" is a person
 * icon named "Personal". A click opens the place `/spaces/<id>-<slug>`, as
 * the project handle leads to the project; until the card carries
 * `spaceId`, or when the space is not among «my spaces», there is no chip.
 */
function SpaceChip({ spaceId }: { spaceId: string | undefined }) {
  // A card without `spaceId` (an api that does not serve it yet) asks for
  // nothing.
  if (spaceId === undefined) return null;
  return <SpaceChipOf spaceId={spaceId} />;
}

function SpaceChipOf({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation('details');
  const items = useMySpaces().data?.items ?? [];
  if (items.length < 2) return null;
  const space = items.find((sp) => sp.id === spaceId);
  if (space === undefined) return null;
  const personal = space.kind === 'personal';
  const name = personal ? t('header.personalSpace') : space.name;
  return (
    <Link
      className="details-header-space-chip"
      to={spacePath(spaceHandle(space))}
      aria-label={t('header.spaceChipAria', { name })}
    >
      {personal ? <IconUser size={14} stroke={1.75} aria-hidden /> : name}
    </Link>
  );
}
