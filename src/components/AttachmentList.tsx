import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconAlertCircle,
  IconDownload,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Attachment,
  AttachmentList as AttachmentListResp,
  deleteAttachment,
  formatSize,
  getDownloadURL,
  listAttachments,
} from '../api/attachments';
import { isViewableExtension } from '../lib/fileViewerSupport';
import { useOptionalLayoutState } from '../lib/useLayoutState';
import { ConfirmDialog } from './ConfirmDialog';
import { formatRelative, formatTimestamp } from './format';

/**
 * Renders the attachment list for one issue — artboard 4b, on the row
 * vocabulary sk-414.2 put in `index.css`.
 *
 * A row is two storeys inside a 32 / 1fr / auto grid, 56px tall: the
 * extension badge, the filename over its metadata, and the two 44px
 * actions. Nothing here draws its own geometry; the classes are the
 * same ones the dependency rows and the comment thread use, which is
 * the point of having them.
 *
 * Owns:
 *   - ['issues', issueId, 'attachments'] TanStack query.
 *   - delete mutation (confirm dialog → mutate → invalidate).
 *   - download click handler — fetches a presigned GET URL on demand
 *     and follows it via window.location.assign so the browser saves
 *     the file directly without intermediate React state.
 *
 * Live updates: invalidated externally by liveEventInvalidation.ts when
 * an `attachment.added` or `attachment.removed` event fires for this
 * issue.
 *
 * ─── What the API does NOT tell this list ──────────────────────────
 *
 * The backend returns `status = 'ready'` rows only, so a file being
 * uploaded right now is invisible to this query — by design, and the
 * epic's decision 1 keeps it that way. The pending row therefore comes
 * from the LOCAL state of the sibling dropzone, handed down as
 * `pendingName`: the section owns that string, the zone reports it, and
 * this list draws it as the last row so the file appears where it will
 * land rather than only inside the progress card.
 */
export interface AttachmentListProps {
  issueId: string;
  /** When true, suppress the delete action (e.g. read-only views). */
  readOnly?: boolean;
  /**
   * Filename of the upload running in the sibling `AttachmentDropzone`,
   * or null/absent when nothing is going up. Drawn as a pending row —
   * dashed badge slot, muted name, no actions. See the docblock above
   * for why it cannot come from the query.
   */
  pendingName?: string | null;
  /**
   * A file is being dragged over the card. The list steps back to 0.4
   * so the drop target below it is the only live-looking thing on
   * screen (artboard 4b, "dragover — the whole card").
   */
  dimmed?: boolean;
}

export function AttachmentList({
  issueId,
  readOnly,
  pendingName,
  dimmed,
}: AttachmentListProps) {
  const { t } = useTranslation('attachments');
  const qc = useQueryClient();
  // sk-41 — `useLayoutState` may not be provided in legacy pages.
  // `useOptionalLayoutState` returns null instead of throwing.
  const openAttachment = useOptionalLayoutState()?.openAttachment ?? null;
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Attachment | null>(null);

  const query = useQuery<AttachmentListResp>({
    queryKey: ['issues', issueId, 'attachments'],
    queryFn: () => listAttachments(issueId),
  });

  const deleteMutation = useMutation<void, Error, string>({
    mutationFn: (id) => deleteAttachment(id),
    onSuccess: async () => {
      setActionError(null);
      setPendingDelete(null);
      await qc.invalidateQueries({ queryKey: ['issues', issueId, 'attachments'] });
    },
    onError: (err) => {
      setActionError(err.message || t('deleteFailed'));
      setPendingDelete(null);
    },
  });

  const downloadMutation = useMutation<string, Error, string>({
    mutationFn: async (id) => {
      const resp = await getDownloadURL(id);
      return resp.url;
    },
    onSuccess: (url) => {
      // Top-frame navigation never trips popup blockers (unlike
      // window.open after an async hop). The presigned GET carries
      // Content-Disposition: attachment, so the browser shows the
      // download dialog and the page does not navigate away.
      window.location.assign(url);
    },
    onError: (err) => setActionError(err.message || t('downloadFailed')),
  });

  if (query.isLoading) {
    // «We do not know yet», one row tall — the same height as the empty
    // section it replaces, so nothing jumps when the answer arrives.
    return (
      <div className="detail-status-plaque" role="status" aria-live="polite">
        <span className="detail-spinner" aria-hidden />
        {t('loading')}
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="detail-alert" role="alert">
        <IconAlertCircle
          className="detail-alert-icon"
          size={20}
          stroke={1.75}
          aria-hidden
        />
        <span>
          <b className="detail-alert-title">{t('loadFailed')}</b>{' '}
          {query.error?.message ?? ''}
        </span>
      </div>
    );
  }
  const items = query.data ? query.data.items : [];

  // While any download or delete is in flight, decline the action
  // buttons on every row. TanStack's mutation state is per-mutation
  // (not per-variable), so we can't tell which row is still pending —
  // declining all of them avoids the misleading "row A's spinner is
  // gone" effect when row B is fired before A resolves.
  const anyBusy = downloadMutation.isPending || deleteMutation.isPending;

  return (
    <>
      {actionError ? (
        <div className="detail-alert" role="alert">
          <IconAlertCircle
            className="detail-alert-icon"
            size={20}
            stroke={1.75}
            aria-hidden
          />
          <span>{actionError}</span>
          <button
            type="button"
            className="detail-alert-dismiss"
            aria-label={t('upload.errors.dismiss')}
            onClick={() => setActionError(null)}
          >
            <IconX size={16} stroke={1.75} aria-hidden />
          </button>
        </div>
      ) : null}

      {items.length === 0 && !pendingName ? (
        // sk-285.6.8 — NOT Mantine's `c="dimmed"`. That token is only
        // re-pointed at our palette under [data-theme='dark']; in light
        // it stays Mantine's #868e96 and painted this line at 3.32:1,
        // under the 4.5:1 AA floor. `.attachments-empty` uses --ink-2
        // (7.73:1 light / 5.58:1 dark) like every other empty state.
        //
        // Unreachable from the card, which collapses the whole section
        // when the count is 0 — this is the legacy page's line and the
        // one a `pendingName`-only list must NOT show.
        <div className="attachments-empty" role="status" aria-live="polite">
          {t('empty')}
        </div>
      ) : (
        <ul
          className="detail-list"
          data-dimmed={dimmed ? 'true' : undefined}
          aria-label={t('listAria')}
        >
          {items.map((a) => (
            <AttachmentRow
              key={a.id}
              attachment={a}
              readOnly={!!readOnly}
              onOpen={
                openAttachment && isViewableExtension(a.filename)
                  ? () => openAttachment!(a.id)
                  : null
              }
              onDownload={() => downloadMutation.mutate(a.id)}
              onDelete={() => setPendingDelete(a)}
              busyDownload={
                downloadMutation.isPending && downloadMutation.variables === a.id
              }
              busyDelete={deleteMutation.isPending && deleteMutation.variables === a.id}
              declined={anyBusy}
            />
          ))}
          {pendingName ? <PendingRow filename={pendingName} /> : null}
        </ul>
      )}

      <ConfirmDialog
        opened={pendingDelete !== null}
        title={t('confirmDelete.title')}
        message={t('confirmDelete.message', {
          filename: pendingDelete?.filename ?? '',
        })}
        danger
        confirmLabel={t('confirmDelete.confirm')}
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (pendingDelete) {
            deleteMutation.mutate(pendingDelete.id);
          }
        }}
        onCancel={() => {
          if (!deleteMutation.isPending) setPendingDelete(null);
        }}
      />
    </>
  );
}

/**
 * The badge that opens a file row: the extension, upper-cased, in the
 * mono face. `aria-hidden` because the filename one column to the right
 * already carries it — a screen reader announcing «csv, statement-2026
 * -08.csv» is reading the same fact twice.
 *
 * A file with no extension gets the plate and no letters rather than an
 * invented mark: the badge is a fast visual sort, and a `?` in it would
 * read as an error about the file.
 */
function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0 || dot === filename.length - 1) return '';
  // Four characters is what the 32px plate holds at 11px mono; longer
  // suffixes (`.markdown`) are cut rather than shrunk, and the full
  // name is one column away.
  return filename.slice(dot + 1, dot + 5).toLowerCase();
}

interface AttachmentRowProps {
  attachment: Attachment;
  readOnly: boolean;
  /**
   * sk-41 — row-level click handler for viewable attachments. Null
   * when the file isn't viewable (PDFs, images, binaries) OR when
   * the layout provider isn't mounted (legacy pages). When null,
   * the filename area is non-interactive and download stays the
   * primary affordance.
   */
  onOpen: (() => void) | null;
  onDownload: () => void;
  onDelete: () => void;
  busyDownload: boolean;
  busyDelete: boolean;
  /**
   * Something else on the list is in flight, so this row's actions
   * decline the press. `aria-disabled`, not `disabled` — see the
   * comment on `.detail-row-btn[aria-disabled]` in index.css: a
   * `disabled` button leaves the accessible tree and drops the keyboard
   * user onto <body> for the second the request takes.
   */
  declined: boolean;
}

function AttachmentRow({
  attachment, readOnly, onOpen, onDownload, onDelete, busyDownload, busyDelete, declined,
}: AttachmentRowProps) {
  const { t } = useTranslation('attachments');
  const meta = [
    formatSize(attachment.sizeBytes),
    attachment.uploadedByUsername ?? '?',
    // sk-285.6.7 — the row said `2026-08-31 07:01 UTC` while every list
    // beside it said "9 days ago". One label now, exact stamp on hover.
    formatRelative(attachment.uploadedAt),
  ].join(' · ');

  // sk-41 — render the filename as a button when the row is viewable,
  // a plain text node otherwise. Button is keyboard-accessible
  // (Enter/Space) and screen readers announce the visible filename
  // followed by "open in viewer" (WCAG 2.5.3 Label in Name —
  // accessible name starts with the visible label, review HC-W12).
  // The download icon is OUTSIDE the button so a click on the icon
  // always downloads, never opens.
  const nameNode = onOpen ? (
    <button
      type="button"
      className="detail-row-name attachment-row-name"
      onClick={onOpen}
      title={`open ${attachment.filename}`}
      aria-label={`${attachment.filename} — open in viewer`}
    >
      {attachment.filename}
    </button>
  ) : (
    <span className="detail-row-name" title={attachment.filename}>
      {attachment.filename}
    </span>
  );

  return (
    <li className="detail-row detail-row--file" aria-label={attachment.filename}>
      <span className="ext-badge" aria-hidden>
        {extensionOf(attachment.filename)}
      </span>
      <span className="detail-row-main">
        {nameNode}
        <span
          className="detail-row-meta"
          title={formatTimestamp(attachment.uploadedAt)}
        >
          {meta}
        </span>
      </span>
      {/* sk-285.1.12 — 44×44 (WCAG 2.5.5 AAA); "md" used to render 32px,
          which is a fat-finger risk right beside the destructive delete
          button. sk-41 — the download icon ALWAYS downloads, independent
          of the row click target above. */}
      <span className="detail-row-actions">
        <button
          type="button"
          className="detail-row-btn"
          onClick={() => {
            if (declined) return;
            onDownload();
          }}
          aria-disabled={declined || undefined}
          aria-label={t('downloadAria', { filename: attachment.filename })}
          title={t('downloadTitle')}
        >
          {busyDownload ? (
            <span className="detail-spinner" aria-hidden />
          ) : (
            // sk-285.7.2.88 — this control's ENTIRE content was the
            // character U+2193: an icon button whose icon is a letter.
            // sk-414.3 moves it to `download`, which is what artboard 4b
            // draws — the row saves a file, it does not scroll one.
            <IconDownload size={20} stroke={1.75} aria-hidden />
          )}
        </button>
        {!readOnly ? (
          <button
            type="button"
            className="detail-row-btn detail-row-btn--danger"
            onClick={() => {
              if (declined) return;
              onDelete();
            }}
            aria-disabled={declined || undefined}
            aria-label={t('deleteAria', { filename: attachment.filename })}
            title={t('deleteTitle')}
          >
            {busyDelete ? (
              <span className="detail-spinner" aria-hidden />
            ) : (
              // sk-285.7.2.88 — was U+00D7. sk-414.3 — `trash`, artboard
              // 4b: `x` on a row means «unlink», and this deletes bytes.
              <IconTrash size={20} stroke={1.75} aria-hidden />
            )}
          </button>
        ) : null}
      </span>
    </li>
  );
}

/**
 * The file that is going up right now (artboard 4b, "pending row").
 *
 * Same 56px grid as a finished row so the list does not re-flow when
 * the upload confirms and the real row replaces this one — only the
 * contents differ: the badge slot is dashed and empty because the row
 * has no confirmed type yet, the name is muted, the metadata says what
 * is happening instead of how big it is, and there is nothing to
 * download or delete.
 *
 * `role="status"` on the badge is what announces it: the list itself is
 * not a live region, and the progress card below carries the numbers.
 */
function PendingRow({ filename }: { filename: string }) {
  const { t } = useTranslation('attachments');
  return (
    <li className="detail-row detail-row--file" aria-label={filename}>
      <span
        className="ext-badge ext-badge--pending"
        role="status"
        aria-label={t('upload.uploading', { filename })}
      >
        <span className="detail-spinner" aria-hidden />
      </span>
      <span className="detail-row-main">
        <span className="detail-row-name detail-row-name-muted" title={filename}>
          {filename}
        </span>
        <span className="detail-row-meta">{t('upload.pendingMeta')}</span>
      </span>
      <span className="detail-row-spacer" aria-hidden />
    </li>
  );
}
