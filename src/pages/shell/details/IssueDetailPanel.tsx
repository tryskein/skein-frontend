import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  unwatchIssue,
  watchIssue,
  isWatching as isWatchingHelper,
} from '../../../api/watchers';
import { useAuth } from '../../../auth/AuthContext';
import { useIssueDetail, issueWatchersKey, isSaveFailure } from '../../../lib/useIssueDetail';
import { useProjectByHandle } from '../../../lib/useProjectByHandle';
import { useIssueReminders } from '../../../lib/useReminders';
import { useToaster } from '../../../components/Toaster';
import { ApiError } from '../../../api/client';
import { DetailsHeader } from './DetailsHeader';
import { IssueTitleEdit } from './IssueTitleEdit';
import { PeopleChain } from './PeopleChain';
import { ActivitySection } from './sections/ActivitySection';
import { AttachmentsSection } from './sections/AttachmentsSection';
import { ClosedReasonSection } from './sections/ClosedReasonSection';
import { CommentsSection } from './sections/CommentsSection';
import { CommitsSection } from './sections/CommitsSection';
import { DependenciesSection } from './sections/DependenciesSection';
import { EditableTextSection } from './sections/EditableTextSection';
import { EpicProgressSection } from './sections/EpicProgressSection';
import { BlockedBySection } from './sections/BlockedBySection';
import { UnavailableLinksNote } from './sections/UnavailableLinksNote';
import { IssuePropertiesRow } from './sections/IssuePropertiesRow';
import { RemindersSection } from './sections/RemindersSection';
import { ReviewFlagSection } from './sections/ReviewFlagSection';
import { WatchersSection } from './sections/WatchersSection';
import { extractMessage } from '../../../lib/extractApiMessage';
import { useFileDragWatch } from '../../../lib/useFileDragWatch';
import { useDeclareProjects } from '../../../lib/liveProjectDeclaration';

export interface IssueDetailPanelProps {
  /** Hierarchical issue id from URL. */
  issueId: string;
  /**
   * Project handle from URL when present (`/projects/:alias/issues/:id`).
   * For the inbox-overlay route `/issues/:id` we get null and fall back
   * to the issue's echoed projectId once the detail lands.
   */
  projectHandle: string | null;
}

/**
 * IssueDetailPanel — full single-page issue view (F5).
 *
 * Responsibilities:
 *   - Resolve the project handle from URL or from the project list
 *     cache (if the URL was alias-shaped).
 *   - Drive `useIssueDetail` for all data + mutations.
 *   - Compose the sticky header + scroll body of section components.
 *
 * What it does NOT do:
 *   - Handle the empty case (no issue selected) — the parent
 *     DetailsColumn does that.
 *   - Wire keyboard shortcuts — out of F5 scope per ui-frontend-plan.
 */
export function IssueDetailPanel({ issueId, projectHandle }: IssueDetailPanelProps) {
  const { t } = useTranslation('details');
  const qc = useQueryClient();
  const toast = useToaster();
  const { user } = useAuth();

  // Resolve alias → UUID via `useProjectByHandle` BEFORE passing to
  // useIssueDetail. The REST `/api/v1/projects/{projectID}/...` route
  // parses {projectID} strictly as a UUID — passing an alias like
  // "web" returns 400. The hook tries the cached first-page list first
  // and falls back to `/api/v1/projects/resolve?q={handle}` for
  // aliases that paginate past the first page.
  //
  // When the URL is the cross-project `/issues/:id` shape, projectHandle
  // is null. We then GUESS a handle from the issue id — ids minted in
  // counter mode look like `{prefix}-{n}` (subtasks `{prefix}-{n}.{m}`)
  // and the prefix usually matches the project's `idPrefix`.
  //
  // This is an OPTIMISATION ONLY: a hit saves one round-trip by letting
  // the project-scoped route fire immediately. A miss is harmless —
  // useIssueDetail falls back to `getIssueByID`, which resolves the
  // project from the cross-project list before reading, and the child
  // queries pick up the projectId the detail response echoes back.
  //
  // It must stay optional. When this guess was load-bearing, every issue
  // it could not parse — hash / custom id modes such as
  // `fv-other-1fe1d873`, and ids whose prefix no longer matches their
  // project — never issued a request at all and the panel showed
  // "failed to load" forever.
  const handleFromUrl = projectHandle;
  const handleFromIssueId = (() => {
    if (handleFromUrl) return null;
    const m = issueId.match(/^(.+)-\d+(?:\.\d+)*$/);
    return m ? m[1] : null;
  })();
  const effectiveHandle = handleFromUrl ?? handleFromIssueId;
  const resolved = useProjectByHandle(effectiveHandle);
  const resolvedProjectId = resolved.project?.id ?? null;

  const detail = useIssueDetail({
    issueId,
    projectHandle: resolvedProjectId,
  });

  // Watchers — toggling lives next to the rest of the actions, but
  // it's not on `useIssueDetail` because we don't optimistic-merge
  // watcher rows into the IssueDetail cache. Mirror the WatchToggle
  // pattern: optimistic update on the watcher list, rollback on
  // error.
  const watchersKey = issueWatchersKey(issueId);
  type WatchCtx = { previous: typeof detail.watchers };
  const watchMut = useMutation<void, Error, boolean, WatchCtx>({
    mutationFn: (next) => (next ? watchIssue(issueId) : unwatchIssue(issueId)),
    onMutate: async (next): Promise<WatchCtx> => {
      await qc.cancelQueries({ queryKey: watchersKey });
      const previous = qc.getQueryData<typeof detail.watchers>(watchersKey);
      if (user) {
        qc.setQueryData<typeof detail.watchers>(watchersKey, (current) => {
          const list = current ?? [];
          const idx = list.findIndex((w) => w.userId === user.id);
          if (next) {
            if (idx === -1) {
              return [
                ...list,
                {
                  userId: user.id,
                  username: user.username,
                  name: user.name,
                  reasons: ['manual'],
                  since: new Date().toISOString(),
                },
              ];
            }
            const reasons = list[idx].reasons.filter((r) => r !== 'unwatched');
            if (!reasons.includes('manual')) reasons.push('manual');
            const copy = [...list];
            copy[idx] = { ...list[idx], reasons };
            return copy;
          }
          // Unwatching.
          if (idx === -1) return list;
          const copy = [...list];
          copy[idx] = { ...list[idx], reasons: ['unwatched'] };
          return copy;
        });
      }
      return { previous };
    },
    onError: (err, _next, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(watchersKey, ctx.previous);
      }
      toast.error(extractMessage(err));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: watchersKey });
    },
  });

  const isWatching = isWatchingHelper(detail.watchers, user?.id);

  // Project ID for the dependencies section — prefer the issue's
  // canonical UUID once it lands; before that, fall back to the
  // resolved alias from useProjectByHandle.
  const projectIdForDeps = detail.issue?.projectId ?? resolvedProjectId;

  // sk-622.21 T041 (US-9) — the open card's project is declared, so the
  // card's own events arrive even when no list shows its row.
  useDeclareProjects('card', [projectIdForDeps]);

  // sk-62.2 — reminders pick their own slot: when the issue HAS a reminder
  // the block sits near the top — right after the properties area
  // (sk-421.1 US-1, NC-3a: the old "first block under the people chain"
  // yields to it on every card), and on an EPIC card after the progress
  // section, which sk-421.2 US-1 put right after the properties area; when
  // it has none, the (empty) "+ one more alarm" affordance drops to the
  // bottom of the card so it doesn't clutter the head of every issue.
  const issueReminders = useIssueReminders(issueId);
  const hasReminders = issueReminders.length > 0;

  // sk-285.6.9 — the attachments dropzone is folded to one line at rest,
  // so a file dragged anywhere over the card has to unfold it or there
  // is nothing to aim at. The hook only observes the drag; the real drop
  // target is the dropzone it reveals and the upload path is untouched.
  const fileDrag = useFileDragWatch();

  if (detail.isLoading) {
    return <div className="col-empty">{t('loadingIssue', { id: issueId })}</div>;
  }
  if (detail.isError || !detail.issue) {
    const err = detail.error;
    const isNotFound =
      err instanceof ApiError &&
      (err.statusCode === 404 || err.statusCode === 422);
    return (
      <div className="col-empty col-error">
        {isNotFound
          ? t('notFound', { id: issueId })
          : t('loadFailed', { id: issueId })}
      </div>
    );
  }

  const issue = detail.issue;
  /**
   * sk-303.14 (INV-4) — did the reader create this issue?
   *
   * `createdBy` is the creator's UUID, so this compares against `user.id`
   * (not the username, which is a display projection and case-folds). An
   * unauthenticated render — there is none in the shell, but the type
   * allows it — is not the author.
   */
  const isAuthor = user !== null && user !== undefined && issue.createdBy === user.id;
  const commentsCount = detail.comments?.length ?? issue.commentsCount;

  return (
    <div className="issue-detail-panel">
      <DetailsHeader
        issue={issue}
        isWatching={isWatching}
        watchToggling={watchMut.isPending}
        // sk-492 — no `reportsInline`: priority and type have no room to
        // say why in place, so a refused save is reported by the toast.
        onUpdateField={(patch) => detail.updateField(patch)}
        // sk-489 · review of wave F/1, BLOCKER-1. The arrow must declare THREE
        // parameters and pass `close` as the FOURTH argument of the hook.
        //
        // Why this is not cosmetic and why the trap is double here. The positions
        // DIVERGED: the prop is `(next, reason?, close?)`, the hook is
        // `(next, reason?, force?, close?)`. The previous edition declared two
        // parameters — and the header's third argument (the outcome and target picked in
        // the close modal) was silently lost: the task closed as `done`,
        // the link by target was not created, there was no error. TypeScript stays
        // SILENT here: a function with fewer parameters is assignable to a type with
        // more. And the "obvious" fix through `(...args)` is wrong too —
        // it would put `close` into `force` and send `?force=true`.
        onChangeStatus={(next, reason, close) => detail.changeStatus(next, reason, undefined, close)}
        onAccept={() => detail.accept()}
        onWatchToggle={() => watchMut.mutate(!isWatching)}
      />
      <div className="issue-detail-body" {...fileDrag.handlers}>
        <IssueTitleEdit
          initial={issue.title}
          // sk-425 — a refusal must reject, or the title editor records
          // the refused title as saved. sk-492 — the title editor prints
          // the reason itself, so the save raises no toast.
          onSave={async (v) => {
            const result = await detail.updateField({ title: v }, { reportsInline: true });
            if (isSaveFailure(result)) throw result.error;
          }}
          lockedByUsername={issue.lockedByUsername}
        />
        <PeopleChain issue={issue} />

        {/* sk-421.1 T014 (US-1, R-4) — the properties area: the properties row right
            under the people chain, on ANY card (epic and non-epic). The project is
            the project of the task itself, not the one picked in the tree: the
            component directory is read by it (US-3, INV-8). The links and their loading
            state come from the same detail hook (T012), the row does not make
            a new links read. */}
        <IssuePropertiesRow
          issue={issue}
          projectId={issue.projectId}
          dependencies={detail.dependencies}
          dependenciesStatus={detail.dependenciesStatus}
        />
        {/* sk-421.1 T015 (US-5, INV-9) — the "Blocked" block right under the
            properties row, the second and last part of the properties area. It decides
            whether to render itself, by the same predicate as the status outline in the header. */}
        <BlockedBySection
          issue={issue}
          dependencies={detail.dependencies}
          dependenciesStatus={detail.dependenciesStatus}
        />
        {/* sk-479 (contract sk-423) — links to tasks from inaccessible
            projects: a separate row AFTER the "Blocked" block, not its
            row — such a link does not mean "blocks". It decides
            whether to render itself; with an old api (no field) it does not render. */}
        <UnavailableLinksNote issue={issue} />

        {/* sk-421.2 T014 (US-1, INV-6) — the epic progress section goes RIGHT
            after the properties area (sk-421.1 US-1): above the alarm block,
            the close reason, the acknowledgement flag and the description. The render condition
            is double — the "epic" type AND an arrived summary — so on a NON-epic
            card the order does not change at all; both are pinned by
            `sectionOrder.test.tsx` by rendering, not by reading the source: both
            neighbours here are conditional, and in the text of the file their mutual order is not
            visible. */}
        {issue.type === 'epic' && issue.epic ? (
          <EpicProgressSection issue={issue} />
        ) : null}

        {/* sk-62.2 — reminder block. With an active reminder it sits up top
            (above Description) so a ringing alarm is seen early — right after
            the properties area, which sk-421.1 US-1 (NC-3a) placed first on
            every card, and on an EPIC card after the progress section; with
            none it renders at the very bottom instead (see below) so the
            empty add-affordance doesn't clutter every card. */}
        {hasReminders ? (
          <RemindersSection projectId={issue.projectId} issueId={issueId} />
        ) : null}
        {/* sk-303.14 (T028) — the close block now hosts the review mark,
            and both it and the flag section below are gated on AUTHORSHIP,
            never on whether the review keys arrived: the server omits them
            for non-authors, so their absence is also how an author's unset
            flag looks (INV-2 / INV-4). */}
        <ClosedReasonSection
          issue={issue}
          isAuthor={isAuthor}
          onMarkReviewed={() => void detail.markResultReviewed()}
          marking={detail.reviewPending}
        />
        <ReviewFlagSection
          issue={issue}
          isAuthor={isAuthor}
          onChange={(next) => void detail.changeReviewRequired(next)}
          pending={detail.reviewPending}
        />
        <EditableTextSection
          title={t('sections.description')}
          field="description"
          emptyAddLabel={t('addDescription')}
          issue={issue}
          updateField={detail.updateField}
        />

        <EditableTextSection
          title={t('sections.acceptanceCriteria')}
          field="acceptanceCriteria"
          emptyAddLabel={t('addAcceptanceCriteria')}
          issue={issue}
          updateField={detail.updateField}
        />
        <EditableTextSection
          title={t('sections.notes')}
          field="notes"
          emptyAddLabel={t('addNotes')}
          issue={issue}
          updateField={detail.updateField}
        />
        {/* sk-421.1 T017 (US-9, SC-009) — "Design" right after "Notes" and before
            "Attachments", on the same editable-text mechanism: markup
            display, a one-line empty state, autosave with a
            version check. On refusal the typed text stays in the
            editor with the reason and "Retry" — as with "Notes" and the other
            sections (sk-425; it used to be lost, NC-2a). */}
        <EditableTextSection
          title={t('sections.design')}
          field="design"
          emptyAddLabel={t('addDesign')}
          issue={issue}
          updateField={detail.updateField}
        />

        {/* The list itself, not its length: `undefined` means the
            attachments query has not answered yet (or failed), and the
            section must not read that as "no attachments". */}
        <AttachmentsSection
          issueId={issueId}
          attachments={detail.attachments}
          dragActive={fileDrag.active}
          dropCount={fileDrag.dropCount}
        />

        {projectIdForDeps ? (
          <DependenciesSection
            projectId={projectIdForDeps}
            issueId={issueId}
            dependencies={detail.dependencies}
            isEpic={issue.type === 'epic'}
          />
        ) : null}

        {/* sk-285.7 fidelity D4 — Comments sits BELOW the stub sections,
            not above them. §6 "Task description" lists the panel in one
            order — "a list of empty sections Acceptance criteria / Notes /
            Attachments / Dependencies … Comments … Activity» — and
            `Sk Details.dc.html` draws the same: four one-line stubs, then
            the composer, then the activity feed. The reason is structural
            rather than aesthetic: Acceptance / Notes / Attachments /
            Dependencies are all FACTS OF THE ISSUE and are one 44px row
            each while empty, so they read as a block; Comments is a
            growing conversation, and putting it in the middle of that
            block pushed two of the four facts below a thread of unbounded
            length. Commits / Watchers / Reminders are not in §9's design
            at all; they keep their existing slots after Comments. */}
        <CommentsSection
          // Use the canonical UUID from the loaded issue, not the URL
          // handle — REST `/api/v1/projects/{projectID}/...` parses the
          // path param strictly as a UUID (parseUUIDParam in the Go
          // handler). The URL alias (e.g. `web`) would 400.
          projectHandle={issue.projectId}
          issueId={issueId}
          count={commentsCount}
        />

        <CommitsSection commits={issue.commitRefs} />

        <ActivitySection
          activity={detail.activity}
          createdAt={issue.createdAt}
          createdByUsername={issue.createdByUsername ?? '?'}
        />

        <WatchersSection issueId={issueId} watchers={detail.watchers} />

        {/* sk-62.2 — no active reminder → the add-affordance lives here at
            the bottom (out of the way). Once a reminder exists the block
            jumps to the top slot above Description. */}
        {!hasReminders ? (
          <RemindersSection projectId={issue.projectId} issueId={issueId} />
        ) : null}
      </div>
    </div>
  );
}
