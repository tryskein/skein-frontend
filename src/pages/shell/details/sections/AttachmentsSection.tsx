import { useEffect, useRef, useState } from 'react';
import { IconPlus } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import type { Attachment } from '../../../../api/attachments';
import { AttachmentDropzone } from '../../../../components/AttachmentDropzone';
import { AttachmentList } from '../../../../components/AttachmentList';
import { Section } from '../Section';

export interface AttachmentsSectionProps {
  issueId: string;
  /**
   * The issue's attachments, or `undefined` while the list query is in
   * flight (or has failed). The distinction is load-bearing: a section
   * that treats "not known yet" as "none" collapses to the word "none"
   * and never mounts the list, so the list's own loading and error
   * states become unreachable and a failed fetch reads as an empty one.
   * Same guard as `dependencies` in DependenciesSection and `watchers`
   * in WatchersSection.
   */
  attachments: Attachment[] | undefined;
  /**
   * sk-285.6.9 — a file is being dragged over the card right now. The
   * panel watches the drag (see IssueDetailPanel) and raises this so
   * the drop target unfolds BEFORE the user lets go: a one-line button
   * is not a target you can aim a file at.
   */
  dragActive?: boolean;
  /**
   * Monotonic count of drops the card has received (`useFileDragWatch`).
   * Read together with `dragActive` it says WHY the drag ended — see the
   * latch below, which is the difference between an upload that runs and
   * one that dies on the flush that started it.
   */
  dropCount?: number;
}

/**
 * Attachments section — composes the existing dropzone + list. Both
 * components own their own TanStack queries keyed off the issue id.
 * Deletions and uploads invalidate via live events from skein-api.
 *
 * ─── sk-285.6.9 — the uploader is folded away at rest ──────────────
 *
 * The dashed ~70px "click to pick a file, or drag one here" rectangle
 * used to sit in every card forever, with "no attachments yet" printed
 * underneath it: one place saying the same thing twice. It now unfolds
 * on demand and only ever exists in ONE of the two states:
 *
 *   empty  → the whole section is a collapsed row ("Attachments —
 *            none  [+ Upload file]"). No list is mounted, so the
 *            duplicate empty line is gone by construction.
 *   filled → the list renders, with the same one-line upload button
 *            under it; the dropzone unfolds when it is pressed.
 *
 * "Empty" means the list came back with nothing — NOT that it hasn't
 * come back. While it is unknown the section stays expanded and the
 * list is mounted, so its own "loading…" / "could not load" frames are
 * what the reader sees.
 *
 * Two things the folding must not cost, both of which it did cost when
 * this was first written:
 *
 *   ONE CLICK, ONE DIALOG. Pressing "+ Upload file" hands `autoOpen`
 *   to the dropzone, which opens the file picker itself and takes
 *   focus. Without it the press only revealed a zone that then had to
 *   be pressed AGAIN, and the keyboard user's focus fell to <body>
 *   when the button unmounted under them.
 *
 *   THE ZONE SURVIVES ITS OWN DROP. A drop is delivered to the zone
 *   (which starts the upload) and then bubbles to the card, where the
 *   drag watch clears `dragActive` — in the same flush. Folding on
 *   that flush unmounts the zone mid-upload and its cleanup aborts the
 *   request, silently: a pending row on the server, no file, no error
 *   on screen. So the drag LATCHES the zone open (`dragOpen`), and the
 *   latch is only released when the drag ends WITHOUT a drop.
 */
export function AttachmentsSection({
  issueId,
  attachments,
  dragActive,
  dropCount,
}: AttachmentsSectionProps) {
  const { t } = useTranslation('details');
  const [open, setOpen] = useState(false);
  const [dragOpen, setDragOpen] = useState(false);
  /**
   * sk-414.3 — the filename of the upload the dropzone is running, or
   * null. It is lifted to this level for one reason: the LIST draws the
   * pending row, and the list cannot learn about it any other way. The
   * API returns `status='ready'` rows only (epic decision 1: the
   * backend is not touched by this epic), so a file on its way up
   * exists nowhere but in the zone's own state.
   */
  const [pendingName, setPendingName] = useState<string | null>(null);
  // Drops already accounted for. Compared, never truthiness-tested —
  // the counter is monotonic across issues.
  const dropsSeen = useRef(0);

  // Fold back up when the card switches to another issue — `open` is a
  // transient intent about THIS issue's uploader, not a preference.
  useEffect(() => {
    setOpen(false);
    setDragOpen(false);
    // The zone unmounts with the switch and its upload is aborted, so
    // the pending row must go with it or it would advertise an upload
    // that is no longer running — on a different issue.
    setPendingName(null);
  }, [issueId]);

  useEffect(() => {
    const drops = dropCount ?? 0;
    if (dragActive) {
      // A gesture is in progress: everything before it is history, so
      // only a drop from THIS gesture can hold the zone open later.
      dropsSeen.current = drops;
      setDragOpen(true);
      return;
    }
    if (drops > dropsSeen.current) {
      // The file landed. Keep the zone mounted — it is running the
      // upload, and it is where progress, cancel and errors live.
      dropsSeen.current = drops;
      return;
    }
    setDragOpen(false);
  }, [dragActive, dropCount]);

  const known = attachments !== undefined;
  const count = attachments?.length ?? 0;
  const showDropzone = open || !!dragActive || dragOpen;
  // The list is mounted while the answer is unknown (its own loading /
  // error frames live there), while it holds rows, and while a file is
  // going up — the pending row is a row of THIS list, and without the
  // third case the first upload onto an empty issue would have nowhere
  // to draw it.
  const showList = !known || count > 0 || pendingName !== null;

  const uploadButton = showDropzone ? null : (
    <button
      type="button"
      className="empty-section-add"
      aria-label={t('addAttachment')}
      onClick={() => setOpen(true)}
    >
      {/* sk-285.7.2.55 — see `EditableTextSection`: one-word visible
          label beside `ti-plus`, the full phrase as the accessible
          name. */}
      <IconPlus size={16} stroke={1.75} aria-hidden />
      {t('emptyAdd.upload')}
    </button>
  );

  return (
    <Section
      title={t('sectionsMore.attachments')}
      count={attachments?.length}
      empty={known && count === 0 && !showDropzone && pendingName === null}
      emptyAction={uploadButton}
    >
      <div className="attachments-stack">
        {/* Mounted while the list is unknown too — that is the only
            place its loading / error frames can render. */}
        {showList ? (
          <AttachmentList
            issueId={issueId}
            pendingName={pendingName}
            // A file over the card dims the list so the target below it
            // is the only live-looking thing on screen (artboard 4b).
            dimmed={!!dragActive}
          />
        ) : null}
        {showDropzone ? (
          <AttachmentDropzone
            issueId={issueId}
            autoOpen={open}
            armed={!!dragActive}
            onUploadingChange={setPendingName}
          />
        ) : (
          uploadButton
        )}
      </div>
    </Section>
  );
}
