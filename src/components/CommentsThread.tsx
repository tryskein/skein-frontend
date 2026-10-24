import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Group, Textarea } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconFilter, IconFilterOff, IconPencil, IconSend, IconTrash } from '@tabler/icons-react';
import {
  addComment as addCommentApi,
  CommentDTO,
  deleteComment as deleteCommentApi,
  listComments as listCommentsApi,
  updateComment as updateCommentApi,
} from '../api/issues';
import { ApiError } from '../api/client';
import { useAuthOptional } from '../auth/AuthContext';
import { toaster } from './Toaster';
import { Avatar } from './Avatar';
import { ConfirmDialog } from './ConfirmDialog';
import { ErrorFrame } from './ErrorFrame';
import { UserMention } from './UserMention';
import { formatTimestamp } from './format';
import { TimeLabel } from './TimeLabel';
import { SkeinTooltip } from './SkeinTooltip';
import { MarkdownView } from '../pages/shell/details/MarkdownView';
import { extractMessage } from '../lib/extractApiMessage';

/**
 * The thread's cache entry. Exported because two surfaces read it: this
 * component renders the list, and `CommentsSection` counts it to label
 * the filter chips on the section heading. One key, one fetch — the
 * second reader is served from the cache.
 */
export const issueCommentsKey = (issueId: string) =>
  ['issues', 'comments', issueId] as const;

/** The query behind both of them. */
export function useIssueComments(projectId: string, issueId: string) {
  return useQuery<CommentDTO[]>({
    queryKey: issueCommentsKey(issueId),
    queryFn: () => listCommentsApi(projectId, issueId),
  });
}

/**
 * The filter, applied once and reported whole.
 *
 * sk-16 — the wire semantics from skein-api: `human-driven` = human +
 * agent_directed, `agent-autonomous` = agent_autonomous. Both chips off
 * yields an empty list on purpose — there is no implicit «show all»
 * fallback, because a filter that quietly stops filtering is worse than
 * an empty screen that says why.
 *
 * The two hidden counts are returned SEPARATELY rather than summed: the
 * strip under the thread has to name what is missing, and «3 agent
 * comments hidden» is a different sentence from «3 human comments
 * hidden». A single total could only have said «3 comments», which is
 * the one thing the reader can already see.
 *
 * No useMemo: thread length is bounded by human attention (typically
 * <100), so an O(N) pass per render is cheaper than the memo
 * bookkeeping — and the input is a fresh `[]` literal in loading and
 * error states anyway, which would defeat a memo on its identity.
 */
export function splitCommentsByFilter(
  comments: CommentDTO[] | undefined,
  showHumans: boolean,
  showAgents: boolean,
): {
  all: CommentDTO[];
  visible: CommentDTO[];
  humansCount: number;
  agentsCount: number;
  hiddenHumans: number;
  hiddenAgents: number;
} {
  const all = comments ?? [];
  const isAutonomous = (c: CommentDTO) => c.authorKind === 'agent_autonomous';
  const humansCount = all.filter((c) => !isAutonomous(c)).length;
  const agentsCount = all.length - humansCount;
  const visible = all.filter((c) => (isAutonomous(c) ? showAgents : showHumans));
  return {
    all,
    visible,
    humansCount,
    agentsCount,
    hiddenHumans: showHumans ? 0 : humansCount,
    hiddenAgents: showAgents ? 0 : agentsCount,
  };
}

/**
 * CommentsThread renders the chronological comment list for an issue plus
 * an inline composer. Comments are sorted ascending (oldest first).
 *
 * The list query is `useIssueComments` — the same hook, and therefore the
 * same TanStack cache entry, that `CommentsSection` reads to build the
 * heading's filter chips. One fetch, two readers.
 *
 * Adding a comment also bumps the parent issue's commentsCount; we
 * invalidate the issue detail query so the count badge refreshes.
 *
 * ─── sk-414.5 — where the chips went ───────────────────────────────
 *
 * The Humans / Agents toggle used to live at the top of this component.
 * Artboard 4d puts it on the SECTION HEADING, right-aligned beside the
 * count, which is `Section`'s `headerAction` slot — so the state moved
 * up to `CommentsSection` and arrives here as props. This component
 * still owns everything that is about the thread itself: the list, the
 * composer, the per-comment edit / delete, and the two states that
 * explain a filtered thread (`some hidden` / `all hidden`), because
 * those belong under the comments they are talking about.
 *
 * The props default to «both on», so the thread can still be rendered
 * on its own — the filter is a lens over it, not a part of it.
 */
export interface CommentsThreadProps {
  projectId: string;
  issueId: string;
  /** When true, hide the composer (e.g. closed issues — kept editable for now). */
  disabled?: boolean;
  /** Show human + agent_directed comments. Default true. */
  showHumans?: boolean;
  /** Show agent_autonomous comments. Default true. */
  showAgents?: boolean;
  /** Turn every chip back on. Supplied by the surface that owns them. */
  onResetFilter?: () => void;
}

export function CommentsThread({
  projectId,
  issueId,
  disabled,
  showHumans = true,
  showAgents = true,
  onResetFilter,
}: CommentsThreadProps) {
  const { t } = useTranslation('comments');
  const queryClient = useQueryClient();
  // useAuthOptional (not useAuth) so this presentation component renders
  // outside an AuthProvider — e.g. in isolated component tests — without
  // throwing. callerUserId gates the author-only "Edit" affordance.
  const auth = useAuthOptional();
  const callerUserId = auth?.user?.id ?? null;
  const callerUsername = auth?.user?.username ?? null;
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  // The provisional row's body, owned here rather than read off the
  // mutation — see the note above `PendingCommentRow`'s render below.
  const [pendingBody, setPendingBody] = useState<string | null>(null);

  const commentsQuery = useIssueComments(projectId, issueId);

  const addMutation = useMutation<CommentDTO, Error, string>({
    mutationFn: (body) => addCommentApi(projectId, issueId, body),
    onSuccess: (created) => {
      setDraft('');
      setError(null);
      // Optimistic append so the new comment appears instantly without a refetch.
      queryClient.setQueryData<CommentDTO[]>(
        issueCommentsKey(issueId),
        (current) => [...(current ?? []), created],
      );
      // …and the provisional row goes in the SAME commit. The cache
      // write above is synchronous and `useQuery` recomputes its result
      // on every render, so the re-render this `setState` schedules
      // already carries the real comment: the swap is one frame, never a
      // frame with both rows and never a frame with neither.
      setPendingBody(null);
      // Refresh issue detail (commentsCount on badge) — NOT awaited. The
      // badge is a number elsewhere on the card; waiting for it would
      // only stretch this mutation's `isPending`, which is what used to
      // keep the provisional row alive beside the real one (sk-416,
      // review finding 2).
      void queryClient.invalidateQueries({
        queryKey: ['issues', 'detail', issueId],
      });
    },
    onError: (err) => {
      // The post failed, so the row it promised has to go with it —
      // otherwise the thread keeps a comment the server never took,
      // under a spinner that will never stop.
      setPendingBody(null);
      setError(extractMessage(err));
    },
  });

  const handlePost = () => {
    const body = draft.trim();
    if (!body) {
      setError('comment body cannot be empty');
      return;
    }
    setPendingBody(body);
    addMutation.mutate(body);
  };

  const { all: allComments, visible: visibleComments, hiddenAgents, hiddenHumans } =
    splitCommentsByFilter(commentsQuery.data, showHumans, showAgents);
  const hidden = hiddenAgents + hiddenHumans;

  // The post is in flight: the row is on screen before the server has
  // it. The body is held in local state (set on submit, cleared in
  // `onSuccess` / `onError`) rather than read off the draft or off the
  // mutation:
  //   - the draft is cleared on success, so it would blank the row while
  //     it is still needed;
  //   - `addMutation.isPending` outlives the moment the comment becomes
  //     real. TanStack keeps a mutation pending until `onSuccess`
  //     resolves, so anything derived from it draws the provisional row
  //     for as long as that callback runs — beside the real comment the
  //     callback has already put in the cache. That was a visible double
  //     of the reader's own comment (sk-416, review finding 2), and
  //     shortening the callback only narrows the window; owning the flag
  //     here closes it.

  return (
    <Box>
      {commentsQuery.isLoading ? (
        // The card's shared waiting plaque — one row tall, so the section
        // does not resize when the answer arrives. Same object the
        // Attachments and Dependencies sections wait behind.
        <div className="detail-status-plaque" role="status" aria-live="polite">
          <span className="detail-spinner" aria-hidden />
          {t('loading')}
        </div>
      ) : commentsQuery.isError ? (
        <ErrorFrame message={extractMessage(commentsQuery.error as Error)} />
      ) : allComments.length === 0 && pendingBody === null ? (
        // sk-285.7.2.56 — nothing here. «none yet» is stated on the
        // section's HEADING (`CommentsSection` passes it as `note`),
        // which is where §6 and reference `1b` put it; a second
        // sentence under the heading would say it twice.
        null
      ) : visibleComments.length === 0 && pendingBody === null ? (
        // The filter hid everything. An empty thread and a thread whose
        // every comment is filtered out look identical unless the second
        // one says so — and it has to offer the way back, because the
        // chips that caused it are on the heading, out of the reader's
        // eye by the time they are looking at the gap.
        <div className="comment-filter-empty" role="status">
          <IconFilterOff size={20} stroke={1.75} aria-hidden />
          <span>
            {t('noneMatchFilter')}
            {hiddenAgents > 0 && hiddenHumans === 0
              ? ` — ${t('noneMatchFilterAgents', { count: hiddenAgents })}`
              : null}
            {hiddenHumans > 0 && hiddenAgents === 0
              ? ` — ${t('noneMatchFilterHumans', { count: hiddenHumans })}`
              : null}
          </span>
          {onResetFilter ? (
            <button type="button" className="comment-filter-reset" onClick={onResetFilter}>
              {t('resetFilter')}
            </button>
          ) : null}
        </div>
      ) : (
        // Render as <ol> so screen readers announce a list of comments
        // and (with aria-live) optimistic-appended entries get a
        // live-region announcement on post.
        //
        // sk-16 review fix C1 — direct <li> children of <ol>, not
        // through a <Stack> wrapper (which renders as <div>, breaking
        // the ol content-model contract and silently degrading the
        // aria-live behaviour for optimistic-append in SR engines).
        <ol className="comment-list" aria-live="polite" aria-relevant="additions">
          {visibleComments.map((c) => (
            <li key={c.id}>
              <CommentRow
                comment={c}
                projectId={projectId}
                issueId={issueId}
                callerUserId={callerUserId}
              />
            </li>
          ))}
          {pendingBody !== null ? (
            <li>
              <PendingCommentRow
                body={pendingBody}
                username={callerUsername}
                userId={callerUserId}
              />
            </li>
          ) : null}
        </ol>
      )}

      {/* Part of the thread is behind the filter. Saying nothing here is
          the failure mode this strip exists for: a reader who does not
          know a filter is on reads the short thread as the whole one. */}
      {hidden > 0 && visibleComments.length > 0 ? (
        <Box mt="sm">
          <div className="comment-hidden-note">
            <IconFilter size={16} stroke={1.75} aria-hidden />
            {/* Exactly one of the two is non-zero here, and that is not
                luck: closing BOTH chips leaves nothing visible, which
                is the plaque's case rather than this strip's. So the
                pair is a total choice and needs no neutral third
                phrasing — which would have been dead code carrying a
                dead pair of dictionary entries. */}
            <span>
              {hiddenAgents > 0
                ? t('hiddenByFilter', { count: hiddenAgents })
                : t('hiddenByFilterHumans', { count: hiddenHumans })}
            </span>
            {onResetFilter ? (
              <button type="button" className="comment-hidden-show" onClick={onResetFilter}>
                {t('showHidden')}
              </button>
            ) : null}
          </div>
        </Box>
      ) : null}

      {disabled ? null : (
        <Box mt="md">
          <Textarea
            placeholder={t('placeholder')}
            aria-label={t('addAria')}
            value={draft}
            onChange={(e) => {
              setDraft(e.currentTarget.value);
              if (error) setError(null);
            }}
            minRows={2}
            autosize
            disabled={addMutation.isPending}
            // sk-285.7 T030 — §6: "Comments — textarea 72px on --bg".
            // A class rather than more inline `styles`, because the
            // height and the ground are stylesheet facts a test can
            // read; an inline object is invisible to the sheet and
            // would have to be re-stated at every other composer.
            // `autosize` still grows it past the floor.
            classNames={{ input: 'comment-composer-input' }}
            styles={{
              input: {
                fontSize: 'var(--font-base)',
              },
            }}
          />
          {error ? (
            <Box mt={6}>
              <ErrorFrame message={error} />
            </Box>
          ) : null}
          {/* sk-285.7 fidelity D3 — the panel's own primary button, not
              a Mantine one. `Sk Details.dc.html` draws Post at
              `height:36px; background:var(--primary); color:var(--on-primary);
              font-size:14px; font-weight:600` — which is exactly what
              `.action-button.primary` is, and what every other primary
              action in this panel already wears (see
              `DependenciesSection`). The Mantine button it replaces — a
              filled `Button` element on the amber ramp at size xs —
              measured 30px and painted the terminal-era colour: Mantine resolves
              a Button's colour and height into INLINE custom properties
              on the element, so no stylesheet could have retinted it in
              place.
              `loading` goes with it — the pending state is `disabled`,
              which `.action-button:disabled` already draws (dimmed,
              `cursor: progress`), plus the ring artboard 4d puts on the
              button while the post is in flight. */}
          {/* sk-514 (6) — padding at the BOTTOM too, not only at the top.
              The card sections are separated by the top padding of the next one, and it is
              designed for text: a text line has natural air below the
              baseline. A button box does not have it — its edge was
              the edge of the section (the group's `margin-bottom` and the wrapper's
              `padding-bottom` are zero, measured). Hence "no gap below the
              send button": the next block started flush against it. */}
          <Group mt="sm" mb="sm" justify="flex-end">
            <button
              type="button"
              className="action-button primary"
              disabled={addMutation.isPending}
              onClick={handlePost}
            >
              {addMutation.isPending ? (
                <span className="detail-spinner" aria-hidden />
              ) : (
                // sk-285.7.2.45 — `ti-send` 16px, the icon
                // `Sk Details.dc.html` draws on this button. §6 names
                // Post among the panel's iconned controls; it was the
                // last one in the zone still drawn as bare text.
                <IconSend size={16} stroke={1.75} aria-hidden />
              )}
              {t('post')}
            </button>
          </Group>
        </Box>
      )}
    </Box>
  );
}

/**
 * sk-16 — the INTENT chip beside the author. `human` carries none (the
 * default / common case stays uncluttered); `agent_directed` and
 * `agent_autonomous` each get one, so the reader can tell an answer
 * from an agent's own note without reading the body.
 *
 * Intent is not transport. The avatar and the `· agent` / `· system`
 * suffix on the timestamp say WHO wrote; this says who decided to. The
 * two axes are orthogonal, which is why artboard 4d draws them as two
 * separate marks rather than folding one into the other.
 */
function CommentKindBadge({ kind }: { kind: CommentDTO['authorKind'] }) {
  const { t } = useTranslation('comments');
  if (kind === 'human') return null;
  const label =
    kind === 'agent_directed' ? t('kind.directed') : t('kind.autonomous');
  const title =
    kind === 'agent_directed'
      ? t('kind.directedTitle')
      : t('kind.autonomousTitle');
  // sk-16 review fix W6 — class-driven instead of inline-style, so the
  // theme tokens and the forced-colors repair reach it.
  //
  // sk-16 review fix W1 — the full explanation lives in `aria-label` so
  // touch / keyboard / SR users get the same context as mouse hover.
  // `role="img"` lets the `aria-label` actually carry an accessible
  // name on a non-interactive span (per ARIA 1.2 Accessible Name spec).
  return (
    <span
      className={`comment-kind-badge ${kind === 'agent_directed' ? 'directed' : 'autonomous'}`}
      role="img"
      aria-label={t('kind.aria', { label, title })}
      title={title}
    >
      {label}
    </span>
  );
}

/**
 * The author name, as artboard 4d draws it: 14/600 in `--ink`.
 *
 * The four properties are passed inline because `UserMention` writes
 * its own font family, weight and colour as an inline style object, and
 * an inline style cannot be reached from the sheet. Moving them into a
 * class belongs to that component, which this wave does not touch —
 * the epic's boundary is the two comment files, `index.css` and the
 * dictionaries.
 */
const AUTHOR_STYLE = {
  fontFamily: 'var(--font-ui)',
  fontSize: 'var(--font-sm)',
  fontWeight: 600,
  color: 'var(--ink)',
} as const;

/** The optimistic row: the comment is on screen, the server does not have it yet. */
function PendingCommentRow({
  body,
  username,
  userId,
}: {
  body: string;
  username: string | null;
  userId: string | null;
}) {
  const { t } = useTranslation('comments');
  return (
    <article className="comment-block comment-block--pending">
      <span className="comment-avatar">
        <Avatar username={username ?? '?'} userId={userId} kind="human" size="md" />
      </span>
      <div className="comment-head">
        {username ? (
          <UserMention
            username={username}
            userId={userId}
            kind="human"
            selfHighlight={false}
            style={AUTHOR_STYLE}
          />
        ) : null}
        <span className="comment-sending">
          <span className="detail-spinner" aria-hidden />
          {t('sending')}
        </span>
      </div>
      <div className="comment-body">
        <p className="comment-sending-body">{body}</p>
      </div>
    </article>
  );
}

function CommentRow({
  comment,
  projectId,
  issueId,
  callerUserId,
}: {
  comment: CommentDTO;
  projectId: string;
  issueId: string;
  callerUserId: string | null;
}) {
  const { t } = useTranslation('comments');
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(comment.body);
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isDeleted = comment.deletedAt != null;
  // sk-57 — author-only edit. Compare the comment's authorUserId to the
  // signed-in caller; both must be present and equal.
  const isAuthor =
    callerUserId != null &&
    comment.authorUserId != null &&
    comment.authorUserId === callerUserId;

  const commentsKey = issueCommentsKey(issueId);
  const detailKey = ['issues', 'detail', issueId];

  const editMutation = useMutation<CommentDTO, Error, string>({
    mutationFn: (body) =>
      updateCommentApi(projectId, issueId, comment.id, body, comment.version),
    onSuccess: async (updated) => {
      setEditing(false);
      setEditError(null);
      // Replace the row in place so the edit (+ "edited" badge) lands
      // without a full refetch.
      queryClient.setQueryData<CommentDTO[]>(commentsKey, (current) =>
        (current ?? []).map((c) => (c.id === updated.id ? updated : c)),
      );
    },
    onError: (err) => {
      // sk-57 — a concurrent edit comes back as a 409 version_conflict
      // ApiError; surface a toast + refetch so the user sees the live
      // body before retrying.
      if (err instanceof ApiError && err.code === 'version_conflict') {
        toaster.error(t('staleEdit'));
        void queryClient.invalidateQueries({ queryKey: commentsKey });
        setEditing(false);
        return;
      }
      setEditError(extractMessage(err));
    },
  });

  const deleteMutation = useMutation<void, Error, void>({
    mutationFn: () => deleteCommentApi(projectId, issueId, comment.id),
    onSuccess: async () => {
      setConfirmDelete(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: commentsKey }),
        queryClient.invalidateQueries({ queryKey: detailKey }),
      ]);
    },
    onError: (err) => {
      setConfirmDelete(false);
      toaster.error(extractMessage(err));
    },
  });

  const handleSaveEdit = () => {
    const body = editDraft.trim();
    if (!body) {
      setEditError('comment body cannot be empty');
      return;
    }
    editMutation.mutate(body);
  };

  return (
    // sk-285.6.1 — the class is the hover target the action row hangs
    // off (`.comment-block:hover .comment-actions`). It has to sit on
    // the whole comment, not on the button row: the reader's pointer is
    // over the TEXT when they decide to act on it.
    //
    // sk-414.5 — and it is the 28 / 1fr grid of artboard 4d. The left
    // 2px stripe it used to carry is gone; the hairline between list
    // items is what separates one comment from the next now.
    <article className="comment-block">
      <span className="comment-avatar">
        {/* R3.4 — avatar beside UserMention, so screen readers still
            announce the username. Decision 3 of the epic keeps the
            component as it is: the artboard's robot / gear circles are
            not built, and the transport axis stays on the avatar plus
            the suffix by the timestamp. */}
        {/* sk-674.18 T055 — a deleted account has no avatar (screens 1.10). */}
        {comment.authorStatus?.deleted === true ? null : (
          <Avatar
            username={comment.author}
            userId={comment.authorUserId ?? null}
            kind={comment.authorType}
            size="md"
          />
        )}
      </span>
      <div className="comment-head">
        {/* sk-514 (4) — the author label WITHOUT highlighting one's own mention:
            the plate was made for `@` references inside the text, and here the name
            stands at every row. Before, it went to one's own
            comments, and `AUTHOR_STYLE`, which overrides only the colour,
            put dark ink on the brand plate — 2.40 in the light
            theme and 1.74 in the dark one against a threshold of 4.5. */}
        <UserMention
          selfHighlight={false}
          username={comment.author}
          userId={comment.authorUserId ?? null}
          kind={comment.authorType}
          status={comment.authorStatus}
          style={AUTHOR_STYLE}
        />
        {/* sk-285.6.7 — the comment used to be the one place in the
            product printing a bare absolute stamp while every list
            beside it counted days. It now speaks the same clock; the
            exact instant rides in the title. */}
        <span className="comment-time">
          <TimeLabel iso={comment.createdAt} />
          {comment.authorType === 'agent' ? ' · agent' : ''}
          {comment.authorType === 'system' ? ' · system' : ''}
        </span>
        <CommentKindBadge kind={comment.authorKind} />
        {/* sk-57 — "edited" mark. sk-285.7.2.87: the wrapper is the
            product's own tooltip now, so the 0ms open is a property of
            the component rather than a prop this call site remembers to
            pass. */}
        {!isDeleted && comment.editedAt ? (
          <SkeinTooltip
            content={t('editedAt', { when: formatTimestamp(comment.editedAt) })}
          >
            <span className="comment-edited">{t('edited')}</span>
          </SkeinTooltip>
        ) : null}
      </div>

      {isDeleted ? (
        // sk-57 — tombstone: the slot stays in the thread but the body is
        // replaced with a muted placeholder and no edit/delete actions.
        <p className="comment-deleted">{t('deletedBody')}</p>
      ) : editing ? (
        <div className="comment-edit">
          <Textarea
            value={editDraft}
            aria-label={t('editAria')}
            onChange={(e) => {
              setEditDraft(e.currentTarget.value);
              if (editError) setEditError(null);
            }}
            minRows={2}
            autosize
            disabled={editMutation.isPending}
            styles={{
              input: {
                fontSize: 'var(--font-base)',
              },
            }}
          />
          {editError ? <ErrorFrame message={editError} /> : null}
          {/* The edit-mode pair follows the composer above (D3): §6's
              secondary and primary buttons, i.e. the two classes already
              in this panel. Leaving them on the amber `size="xs"`
              dialect while the Post button beside them moved would have
              split one component across two vocabularies. */}
          <Group justify="flex-end" gap="xs">
            <button
              type="button"
              className="action-button"
              disabled={editMutation.isPending}
              onClick={() => {
                setEditing(false);
                setEditDraft(comment.body);
                setEditError(null);
              }}
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              className="action-button primary"
              disabled={editMutation.isPending}
              onClick={handleSaveEdit}
            >
              {t('save')}
            </button>
          </Group>
        </div>
      ) : (
        <>
          {/*
            sk-15 — render the comment body through MarkdownView so headings,
            bold/italic, code blocks, tables and lists land formatted instead
            of raw `## …` `**…**` text. MarkdownView already runs the same
            `renderTextWithMentions` pipeline on text nodes (R4.3), so
            `@username` chips keep resolving — we just pass `comment.mentions`
            through. `.comment-body` is what steps the shared markdown
            surface down to artboard 4d's grade.
          */}
          <div className="comment-body">
            <MarkdownView text={comment.body} mentions={comment.mentions} />
          </div>
          {/* sk-57 — author edits; author OR project owner/admin deletes.
              The project-role isn't loaded client-side here, so the delete
              button is shown to non-authors too and the API's 403 is the
              real gate (per sk-57.2 spec). The edit button is strictly
              author-gated.

              sk-285.6.1 / sk-414.5 — the row is transparent at rest and
              revealed on hover of the comment OR on keyboard focus
              anywhere inside it (`:focus-within`), and it is hidden with
              OPACITY, never `display:none` / `visibility:hidden`: the
              buttons stay focusable, stay in the accessibility tree, and
              stay reachable by Tab. See `.comment-actions` in index.css. */}
          <div className="comment-actions">
            {isAuthor ? (
              <button
                type="button"
                className="comment-action"
                onClick={() => {
                  setEditDraft(comment.body);
                  setEditError(null);
                  setEditing(true);
                }}
              >
                <IconPencil size={16} stroke={1.75} aria-hidden />
                {t('edit')}
              </button>
            ) : null}
            <button
              type="button"
              className="comment-action comment-action-danger"
              disabled={deleteMutation.isPending}
              onClick={() => setConfirmDelete(true)}
            >
              <IconTrash size={16} stroke={1.75} aria-hidden />
              {t('delete')}
            </button>
          </div>
        </>
      )}

      <ConfirmDialog
        opened={confirmDelete}
        title={t('confirmDelete.title')}
        message={t('confirmDelete.message')}
        confirmLabel={t('confirmDelete.confirm')}
        cancelLabel={t('common:confirmDialog.cancel')}
        danger
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setConfirmDelete(false)}
      />
    </article>
  );
}
