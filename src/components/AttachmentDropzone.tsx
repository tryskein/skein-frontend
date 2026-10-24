import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconAlertCircle,
  IconFilePlus,
  IconUpload,
  IconX,
} from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ATTACHMENT_MAX_BYTES,
  formatSize,
  isAttachmentLimitExceeded,
  isFileTooLarge,
  isMimeBlocked,
  uploadAttachment,
} from '../api/attachments';
import { BusinessError } from '../api/client';
import { SpaceErrorCode } from '../api/spaces';

/**
 * AttachmentDropzone — drag-and-drop / click-to-pick uploader.
 * Artboard 4b, states "dropzone · idle", "dragover", "upload
 * in progress" and "upload error".
 *
 * Implementation choices (vs. @mantine/dropzone):
 *   - We don't ship the @mantine/dropzone package — keeps the dep
 *     surface small. The native HTML5 drag/drop API plus a hidden
 *     <input type="file"> is enough for our needs.
 *   - One file per drop. Multi-select needs ordered progress + per-file
 *     state and is deferred to a later slice — and the zone SAYS so, in
 *     its own prompt, rather than only refusing the second file.
 *
 * Upload pipeline:
 *   1. requestUploadURL → POST .../upload-url (creates pending row).
 *   2. uploadFileToS3   → multipart POST direct to MinIO with the
 *                          presigned policy.
 *   3. confirmAttachment → POST /attachments/{id}/confirm; emits
 *                          attachment.added event + fan-out.
 *   4. Invalidate ['issues', issueId, 'attachments'] so the sibling
 *      AttachmentList refetches.
 *
 * Live update: when SignalR delivers attachment.added for this issue,
 * liveEventInvalidation.ts triggers the same query refetch — so other
 * browsers see the file appear within ~1s without polling.
 *
 * ─── The three states this component OWNS ──────────────────────────
 *
 * The API never shows a file that is still going up (`status='ready'`
 * only), so everything about an upload in flight is local state here:
 * the progress card with its byte counter and Cancel, the typed
 * failures, and — through `onUploadingChange` — the pending ROW the
 * sibling list draws. That last one is the epic's decision 1 written
 * as a prop: this component is the only place that knows, so it is the
 * only place that can say.
 *
 * Accessibility:
 *   - Outer trigger is a real <button>; keyboard activation is handled
 *     by the browser.
 *   - The hidden file input has an accessible name and accepts any
 *     MIME (no allow-list at the OS picker level).
 *   - Progress + error live in role="status" / role="alert" regions
 *     so screen readers announce upload state changes (WCAG 4.1.3).
 *   - dragenter/dragleave use a counter so flicker over inner children
 *     doesn't toggle the dragOver state per pointer move.
 */
export interface AttachmentDropzoneProps {
  issueId: string;
  /** Disable interaction during e.g. issue load. */
  disabled?: boolean;
  /**
   * sk-285.6.9 — this zone was just unfolded BY A DELIBERATE PRESS on
   * a "+ Upload file" button that has now unmounted itself. Two things
   * follow from that press and neither may be lost to the fold:
   *
   *   - the picker opens straight away, so choosing a file still costs
   *     ONE click rather than "click to reveal, click again to pick";
   *   - focus moves onto this trigger, because the element the user
   *     had focused no longer exists — without it a keyboard user is
   *     dumped back on <body> and has to tab the whole card again
   *     (WCAG 2.4.3), and the OS dialog would have nowhere to return
   *     focus to when it closes.
   *
   * Only for the press. A zone unfolded by an incoming DRAG must NOT
   * set this: the user is already holding the file, and an OS dialog
   * on top of a drag is the worst thing we could do.
   */
  autoOpen?: boolean;
  /**
   * A file is being dragged over the CARD — not merely over this
   * element. Artboard 4b arms the target as soon as the file crosses
   * the card, because a zone that only lights up under the cursor is a
   * target the user has to find before they can aim at it. The card
   * watch (`useFileDragWatch`, read by `IssueDetailPanel`) is what
   * knows; this prop carries it down.
   */
  armed?: boolean;
  /**
   * Reports the filename of the upload in flight, or null when there
   * is none. The section lifts it one level so the sibling list can
   * draw the pending row — see the docblock above.
   */
  onUploadingChange?: (filename: string | null) => void;
}

/** A failure ready to paint: the bold opening, and the line after it. */
type UploadError = { titleKey: string; detail: string };

export function AttachmentDropzone({
  issueId,
  disabled,
  autoOpen,
  armed,
  onUploadingChange,
}: AttachmentDropzoneProps) {
  const { t } = useTranslation('attachments');
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const autoOpened = useRef(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({ loaded: 0, total: 0 });
  const [error, setError] = useState<UploadError | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Counter pattern: dragenter increments, dragleave decrements. dragOver
  // is true iff the counter > 0. Without this, crossing into a child
  // element fires dragleave on the parent and the border flickers.
  const dragDepth = useRef(0);
  const statusId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  // True while the control the user was standing on is about to
  // unmount — see the effect below.
  const handFocusOn = useRef<'cancel' | 'trigger' | null>(null);

  // Kept in a ref so the effect below depends on the VALUE it reports
  // and not on the identity of a callback the parent re-creates every
  // render — the latter would fire the report on every render instead
  // of on every change.
  const reportRef = useRef(onUploadingChange);
  reportRef.current = onUploadingChange;
  const reported = uploading ? filename : null;
  useEffect(() => {
    reportRef.current?.(reported);
  }, [reported]);

  // ─── The zone and the progress card swap places under the user ────
  //
  // Starting an upload unmounts the trigger and mounts Cancel; finishing
  // it does the reverse. Whichever of the two the keyboard user was
  // standing on, the swap takes it away — and an element removed while
  // focused drops focus to <body>, so the reader is thrown back to the
  // top of the card and has to tab the whole panel again (WCAG 2.4.3).
  // That is the same defect `autoOpen` exists to prevent one step
  // earlier, and it is repaired the same way: the vanishing control
  // hands focus to the one that replaces it.
  //
  // Only when it WAS focused. Picking through the OS dialog returns
  // focus to the trigger, so the hand-off is right; a drop leaves focus
  // wherever the user's pointer left it, and stealing it there would be
  // the bug rather than the fix.
  useEffect(() => {
    const hand = handFocusOn.current;
    if (!hand) return;
    handFocusOn.current = null;
    const raf = requestAnimationFrame(() => {
      if (hand === 'cancel') cancelRef.current?.focus();
      else triggerRef.current?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [uploading]);

  // Abort any in-flight upload when the component unmounts. Without
  // this, switching tabs / navigating away mid-upload leaks the XHR and
  // (worse) fires setState calls on an unmounted tree.
  useEffect(() => () => {
    abortRef.current?.abort();
    reportRef.current?.(null);
  }, []);

  // Unfolded by a press: take the focus the vanished button gave up and
  // open the picker. requestAnimationFrame defers both until after
  // React has committed this mount (same trick as EditableTextSection's
  // enterEdit) — a .focus() on an element React has not attached yet is
  // a silent no-op. The click still counts as a user gesture: browsers
  // keep transient activation alive for seconds after the press, far
  // longer than one frame.
  useEffect(() => {
    if (!autoOpen || autoOpened.current) return;
    autoOpened.current = true;
    const raf = requestAnimationFrame(() => {
      triggerRef.current?.focus();
      inputRef.current?.click();
    });
    return () => cancelAnimationFrame(raf);
  }, [autoOpen]);

  const handleFiles = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file) return;
    if (uploading) return; // single-file at a time

    // Client-side size guard — short-circuits before we round-trip
    // MinIO. Server still enforces the canonical limit; this just
    // saves a multi-minute upload on hopeless files.
    if (file.size > ATTACHMENT_MAX_BYTES) {
      setError({
        titleKey: 'upload.errors.tooLarge',
        detail: t('upload.errors.tooLargeDetail', {
          filename: file.name,
          size: formatSize(file.size),
          limit: formatSize(ATTACHMENT_MAX_BYTES),
        }),
      });
      setFilename(null);
      // Reset the input so re-selecting the same file fires onChange.
      if (inputRef.current) inputRef.current.value = '';
      return;
    }

    setError(null);
    setFilename(file.name);
    setProgress({ loaded: 0, total: file.size });
    if (document.activeElement === triggerRef.current) {
      handFocusOn.current = 'cancel';
    }
    setUploading(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      await uploadAttachment(
        issueId,
        file,
        (loaded, total) => setProgress({ loaded, total }),
        ctrl.signal,
      );
      // The bytes arrived, so the row exists server-side WHOEVER this
      // upload now belongs to — the list is told first, unconditionally,
      // and before the staleness check below can return.
      void qc.invalidateQueries({ queryKey: ['issues', issueId, 'attachments'] });
      // …and only then does this continuation touch the shared state,
      // and only while it still owns it. `abort()` is a request, not a
      // rollback: an XHR that already reached `load` resolves anyway, so
      // a cancelled upload can arrive here AFTER the user started the
      // next one. Clearing `uploading` / `filename` / the input from
      // here would then tear down a live upload's card, its Cancel and
      // the pending row the section draws from `onUploadingChange`.
      // The error branch has always guarded this; the success branch is
      // the same guard on the other side (sk-416, review finding 1).
      if (abortRef.current !== ctrl) return;
      // The flag drops without waiting for the refetch — the upload
      // itself is done, and holding "uploading…" on screen until the
      // next list fetch settles would report the list's latency as the
      // upload's (hence the un-awaited `void` above).
      if (document.activeElement === cancelRef.current) {
        handFocusOn.current = 'trigger';
      }
      setUploading(false);
      setFilename(null);
      abortRef.current = null;
      if (inputRef.current) inputRef.current.value = '';
    } catch (err: unknown) {
      // AbortError on unmount is expected — don't paint an error.
      // A failure that belongs to a superseded upload is equally none of
      // this one's business: painting its plaque would blame the file
      // the user is currently uploading for a request they cancelled.
      if (ctrl.signal.aborted || abortRef.current !== ctrl) {
        return;
      }
      const described = describeError(err, file);
      if (document.activeElement === cancelRef.current) {
        handFocusOn.current = 'trigger';
      }
      setError({
        titleKey: described.titleKey,
        detail: described.detailKey
          ? t(described.detailKey, described.params)
          : err instanceof Error
            ? err.message
            : '',
      });
      setUploading(false);
      setFilename(null);
      abortRef.current = null;
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const onPick = () => {
    if (disabled || uploading) return;
    inputRef.current?.click();
  };

  const onCancel = () => {
    abortRef.current?.abort();
    // The press came from Cancel itself, so the hand-off is
    // unconditional here — that button is on its way out.
    handFocusOn.current = 'trigger';
    setUploading(false);
    setFilename(null);
    abortRef.current = null;
    if (inputRef.current) inputRef.current.value = '';
  };

  // `armed` is the card-level drag; `dragOver` is this element's own.
  // Either one paints the target — the first is what unfolded the zone,
  // the second is what happens once the pointer arrives on it.
  const over = !!armed || dragOver;
  const dataState = disabled || uploading
    ? 'disabled'
    : over
      ? 'dragover'
      : 'idle';

  const percent =
    progress.total > 0 ? Math.round((progress.loaded / progress.total) * 100) : 0;

  return (
    <div className="attachments-upload">
      {error ? (
        <div className="detail-alert" role="alert">
          <IconAlertCircle
            className="detail-alert-icon"
            size={20}
            stroke={1.75}
            aria-hidden
          />
          <span>
            <b className="detail-alert-title">{t(error.titleKey)}</b>{' '}
            <span className="detail-alert-detail">{error.detail}</span>
          </span>
          <button
            type="button"
            className="detail-alert-dismiss"
            aria-label={t('upload.errors.dismiss')}
            onClick={() => setError(null)}
          >
            <IconX size={16} stroke={1.75} aria-hidden />
          </button>
        </div>
      ) : null}

      {/* Live status region — announces upload-in-progress + progress
          updates to assistive tech. role="status" implies
          aria-live="polite". The id is referenced by the trigger via
          aria-describedby. */}
      <div id={statusId} role="status" aria-live="polite">
        {uploading ? (
          <div className="detail-upload">
            <div className="detail-upload-head">
              <span className="ext-badge" aria-hidden>
                {extensionOf(filename ?? '')}
              </span>
              <span className="detail-row-main">
                <span className="detail-row-name" title={filename ?? undefined}>
                  {filename ?? t('upload.fallbackName')}
                </span>
                <span className="detail-row-meta">
                  {t('upload.progressPercent', {
                    loaded: formatSize(progress.loaded),
                    total: formatSize(progress.total),
                    percent,
                  })}
                </span>
              </span>
              <button
                ref={cancelRef}
                type="button"
                className="action-button"
                onClick={onCancel}
              >
                {t('upload.cancel')}
              </button>
            </div>
            {/* The bar repeats what the line above states in words, so
                it is decoration: a second `progressbar` in a live region
                makes a screen reader read the same percentage twice. */}
            <div className="detail-upload-bar" aria-hidden="true">
              <span
                className="detail-upload-bar-fill"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        ) : null}
      </div>

      {/* The zone stays mounted through an error and through a drop —
          see AttachmentsSection's latch. It is the button; the state
          attribute is what the stylesheet paints from. */}
      {!uploading ? (
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          aria-label={t('upload.triggerAria')}
          aria-describedby={statusId}
          className="detail-dropzone"
          data-state={dataState}
          onClick={onPick}
          onDragOver={(e) => {
            e.preventDefault();
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            dragDepth.current += 1;
            if (dragDepth.current > 0) setDragOver(true);
          }}
          onDragLeave={() => {
            dragDepth.current = Math.max(0, dragDepth.current - 1);
            if (dragDepth.current === 0) setDragOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            dragDepth.current = 0;
            setDragOver(false);
            if (disabled || uploading) return;
            void handleFiles(e.dataTransfer.files);
          }}
        >
          {/* pointer-events:none keeps dragenter/leave events on the
              wrapping button rather than firing again as the cursor
              crosses into the inner text. `aria-hidden` on the icon: the
              button's accessible name is its aria-label. */}
          {over ? (
            <IconFilePlus
              className="detail-dropzone-icon"
              size={20}
              stroke={1.75}
              aria-hidden
            />
          ) : (
            <IconUpload
              className="detail-dropzone-icon"
              size={20}
              stroke={1.75}
              aria-hidden
            />
          )}
          <span>
            {over ? (
              // The target names the issue it will attach to. A card can
              // be open beside a list of other cards, and "release to
              // attach" without an id is an invitation to guess.
              t('upload.dropHere', { id: issueId })
            ) : error ? (
              t('upload.retry')
            ) : (
              <>
                {t('upload.pick')}{' '}
                <span className="detail-dropzone-hint">
                  {t('upload.limitHint', {
                    limit: formatSize(ATTACHMENT_MAX_BYTES),
                  })}
                </span>
              </>
            )}
          </span>
        </button>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept="*/*"
        aria-label={t('upload.inputAria')}
        className="skein-sr-only"
        data-testid="attachment-file-input"
        onChange={(e) => {
          const f = e.target.files;
          if (f) void handleFiles(f);
        }}
      />
    </div>
  );
}

/** The extension badge's letters — see `AttachmentList.extensionOf`. */
function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0 || dot === filename.length - 1) return '';
  return filename.slice(dot + 1, dot + 5).toLowerCase();
}

/**
 * Which of the three typed failures this is, and with which detail —
 * as KEYS, so the caller resolves them in the reader's language.
 *
 * Until sk-414.2 laid the `upload.errors.*` block down, these three
 * sentences were English literals in this file and were shown to a
 * Russian reader untranslated. The fourth case keeps the server's own
 * message as the detail: an untyped failure has nothing better to say
 * than what it said.
 */
function describeError(
  err: unknown,
  file: { name: string; size: number },
): { titleKey: string; detailKey: string | null; params: Record<string, string> } {
  const params = {
    filename: file.name,
    size: formatSize(file.size),
    limit: formatSize(ATTACHMENT_MAX_BYTES),
  };
  if (isMimeBlocked(err)) {
    return {
      titleKey: 'upload.errors.mimeBlocked',
      detailKey: 'upload.errors.mimeBlockedDetail',
      params,
    };
  }
  if (isFileTooLarge(err)) {
    return {
      titleKey: 'upload.errors.tooLarge',
      detailKey: 'upload.errors.tooLargeDetail',
      params,
    };
  }
  if (isAttachmentLimitExceeded(err)) {
    return {
      titleKey: 'upload.errors.limitReached',
      detailKey: 'upload.errors.limitReachedDetail',
      params,
    };
  }
  // sk-674.18 T055 (US-14, screens 1.10) — the space's attachment quota is
  // used up: told at the zone, with the quota when the refusal names it.
  // The quota is soft — the file that crossed it was accepted; every later
  // one is refused until files are deleted. Reading and deleting stay.
  if (err instanceof BusinessError && err.code === SpaceErrorCode.StorageQuota) {
    const quota = err.extra.storageQuotaBytes;
    return typeof quota === 'number'
      ? {
          titleKey: 'upload.errors.storageQuota',
          detailKey: 'upload.errors.storageQuotaDetail',
          params: { ...params, quota: formatSize(quota) },
        }
      : {
          titleKey: 'upload.errors.storageQuota',
          detailKey: 'upload.errors.storageQuotaDetailBare',
          params,
        };
  }
  return { titleKey: 'upload.errors.generic', detailKey: null, params };
}
