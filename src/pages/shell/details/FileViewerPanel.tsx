import { useEffect, useId, useMemo, useState } from 'react';
import { useMantineColorScheme } from '@mantine/core';
import { IconArrowDown, IconX } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import DOMPurify from 'dompurify';
import {
  Attachment,
  AttachmentList as AttachmentListResp,
  formatSize,
  getDownloadURL,
  listAttachments,
} from '../../../api/attachments';
import {
  FILE_VIEWER_MAX_BYTES,
  getViewableKind,
} from '../../../lib/fileViewerSupport';
import {
  SHIKI_DARK_THEME,
  SHIKI_LIGHT_THEME,
  getHighlighter,
} from '../../../lib/shiki';
import { MarkdownView } from './MarkdownView';

/**
 * sk-41 — in-card file viewer.
 *
 * Responsibilities:
 *   - Resolve attachment metadata (filename + size) from the parent
 *     issue's attachment list. We deliberately reuse the same
 *     `['issues', issueId, 'attachments']` TanStack cache the
 *     AttachmentList already populates so the metadata is usually
 *     instant on the in-card open path and only one network round-
 *     trip on the shared-link path.
 *   - Fetch a presigned GET URL via `getDownloadURL()` (the same
 *     endpoint AttachmentList downloads from).
 *   - `fetch(presignedUrl)` the raw bytes and decode as text.
 *   - Dispatch to MarkdownView / `<pre>` / Shiki by extension via
 *     `getViewableKind()`.
 *
 * Render budget:
 *   - 2 MiB hard cap (`FILE_VIEWER_MAX_BYTES`). Larger files refuse
 *     to render and offer a download button.
 *
 * Theme tracking:
 *   - Subscribes to Mantine's `colorScheme` and re-renders the Shiki
 *     output when the user flips between light and dark.
 *
 * Error reporting:
 *   - Metadata miss / network failure / aborted fetch all surface
 *     a "retry" affordance.
 *   - CORS errors are detected heuristically (TypeError + no
 *     `response.ok`) and labelled distinctly so the operator can
 *     verify MinIO's CORS allow-list.
 */
export interface FileViewerPanelProps {
  /** Hierarchical issue id — used to look up the parent's attachment list. */
  issueId: string;
  /** UUID of the attachment to render. */
  attachmentId: string;
  /** Invoked on × button / `Escape` press. */
  onClose: () => void;
}

export function FileViewerPanel({ issueId, attachmentId, onClose }: FileViewerPanelProps) {
  const qc = useQueryClient();
  const { colorScheme } = useMantineColorScheme();
  const titleId = useId();

  // Mantine returns 'auto' when nothing is forced. Resolve via the
  // system preference and stay subscribed to OS theme changes so the
  // viewer re-highlights live when the user flips dark/light at the
  // OS level (review TS-W7).
  const [systemDark, setSystemDark] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    if (colorScheme !== 'auto') return; // only matters when Mantine defers
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [colorScheme]);
  const effectiveScheme = useMemo<'light' | 'dark'>(() => {
    if (colorScheme === 'light' || colorScheme === 'dark') return colorScheme;
    return systemDark ? 'dark' : 'light';
  }, [colorScheme, systemDark]);

  // ─────────────── Step 1: resolve the metadata row ───────────────
  //
  // Same cache key the AttachmentList populates. In the typical "user
  // clicked attachment row inside open card" path the data is already
  // hot; in the shared-link path TanStack fetches it once.
  const listQuery = useQuery<AttachmentListResp>({
    queryKey: ['issues', issueId, 'attachments'],
    queryFn: () => listAttachments(issueId),
  });
  const metadata: Attachment | undefined = listQuery.data?.items.find(
    (a) => a.id === attachmentId,
  );

  // ─────────────── Step 2: mint a presigned URL ───────────────
  //
  // The presigned URL is short-lived (10 min by default per the
  // attachment-handler doc-comment). We re-fetch on attachmentId
  // change but otherwise let TanStack's freshness window control
  // staleness — within the panel's lifetime one URL is plenty.
  const urlQuery = useQuery<{ url: string }, Error>({
    queryKey: ['attachment-download-url', attachmentId],
    queryFn: () => getDownloadURL(attachmentId),
    enabled: !!metadata && metadata.status === 'ready',
    staleTime: 5 * 60 * 1000,
  });

  // ─────────────── Step 3: fetch + decode ───────────────
  //
  // Manual fetch rather than another `useQuery` keeps the abort
  // semantics simple — we want a fresh AbortController per
  // attachmentId change, with cancellation on unmount. Storing the
  // text in component state matches the "render dispatch" shape
  // below.
  const [text, setText] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<{
    kind: 'network' | 'cors' | 'http' | 'aborted';
    message: string;
  } | null>(null);
  const [fetchPending, setFetchPending] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  const tooLarge =
    !!metadata && metadata.sizeBytes > FILE_VIEWER_MAX_BYTES;

  const presignedURL = urlQuery.data?.url ?? null;

  useEffect(() => {
    // Clear previous attachment's body BEFORE deciding whether to
    // fetch — guards against a momentary flash of the prior file when
    // the user opens a second attachment in quick succession.
    setText(null);
    setFetchError(null);
    if (!presignedURL || tooLarge) {
      setFetchPending(false);
      return;
    }
    const controller = new AbortController();
    setFetchPending(true);
    // review TS-W2 — compose user-cancel with a 30s timeout so a
    // wedged TCP connection (network drop, MinIO hang) doesn't leave
    // the panel stuck on "Loading file…". On modern browsers (and
    // jsdom 25+) `AbortSignal.any` is available; the timeout becomes
    // visible as a generic abort and surfaces through the catch path.
    const timeoutSignal: AbortSignal | null =
      typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(30_000)
        : null;
    const fetchSignal: AbortSignal =
      timeoutSignal !== null && typeof AbortSignal.any === 'function'
        ? AbortSignal.any([controller.signal, timeoutSignal])
        : controller.signal;
    // Detect the timeout-vs-user-abort distinction at catch time by
    // checking which signal fired.
    fetch(presignedURL, { signal: fetchSignal })
      .then(async (resp) => {
        if (!resp.ok) {
          throw Object.assign(new Error(`HTTP ${resp.status}`), {
            __viewerKind: 'http' as const,
          });
        }
        return resp.text();
      })
      .then((body) => {
        setText(body);
        setFetchError(null);
      })
      .catch((err: unknown) => {
        // code review info finding — narrow `unknown` rather than relying
        // on the typed-parameter assertion. Surface a useful kind even
        // when a non-Error value gets thrown by a polyfill.
        if (controller.signal.aborted) {
          // User-initiated cancel (tab nav / unmount) — silent.
          return;
        }
        if (timeoutSignal !== null && timeoutSignal.aborted) {
          // Composed AbortSignal.timeout fired — explicit timeout.
          setFetchError({ kind: 'network', message: 'Request timed out after 30 s' });
          return;
        }
        if (!(err instanceof Error)) {
          setFetchError({ kind: 'network', message: String(err) });
          return;
        }
        const viewerKind = (err as { __viewerKind?: 'http' }).__viewerKind;
        if (viewerKind === 'http') {
          setFetchError({ kind: 'http', message: err.message });
          return;
        }
        // Browsers report CORS failures as opaque "TypeError: Failed
        // to fetch" with no `response`. Heuristic: a TypeError on
        // `fetch()` to a cross-origin URL is a CORS preflight reject
        // (or a network failure — we can't tell them apart at the
        // JS layer). Surface the URL so the operator can verify
        // MinIO's CORS allow-list manually.
        if (err.name === 'TypeError') {
          setFetchError({
            kind: 'cors',
            message: `Could not fetch ${presignedURL} — likely a CORS or network failure`,
          });
          return;
        }
        setFetchError({ kind: 'network', message: err.message });
      })
      .finally(() => {
        if (!controller.signal.aborted) setFetchPending(false);
      });

    return () => {
      controller.abort();
    };
    // `retryTick` is intentionally part of the dep array so clicking
    // "retry" re-runs the effect even though the URL is unchanged.
  }, [presignedURL, tooLarge, retryTick]);

  // ─────────────── Download fallback (used by header icon + too-large CTA) ───────────────
  function triggerDownload() {
    if (!presignedURL) {
      // Mint a fresh URL via the API and follow it. Mirrors the path
      // AttachmentList uses for its `↓` icon. The browser's own
      // download dialog provides feedback for the success path; the
      // catch surfaces failures into the panel's error state instead
      // of leaving them as unhandled rejections (review TS-W1).
      void qc
        .fetchQuery({
          queryKey: ['attachment-download-url', attachmentId, 'download'],
          queryFn: () => getDownloadURL(attachmentId),
          staleTime: 0,
        })
        .then((resp) => {
          window.location.assign(resp.url);
        })
        .catch((err: unknown) => {
          setFetchError({
            kind: 'network',
            message:
              err instanceof Error
                ? `Download failed: ${err.message}`
                : `Download failed: ${String(err)}`,
          });
        });
      return;
    }
    window.location.assign(presignedURL);
  }

  // ─────────────── Body rendering ───────────────
  const viewKind = metadata ? getViewableKind(metadata.filename) : null;

  const body = (() => {
    if (listQuery.isLoading) {
      return <div className="file-viewer-loading">Loading metadata…</div>;
    }
    if (!metadata) {
      return (
        <div className="file-viewer-error">
          Attachment not found on this issue.
        </div>
      );
    }
    if (metadata.status !== 'ready') {
      return (
        <div className="file-viewer-error">
          This attachment is still uploading — try again in a moment.
        </div>
      );
    }
    if (tooLarge) {
      return (
        <div className="file-viewer-too-large">
          <p>
            File is {formatSize(metadata.sizeBytes)} — too large to preview
            (cap: {formatSize(FILE_VIEWER_MAX_BYTES)}).
          </p>
          <button type="button" onClick={triggerDownload}>
            Download instead
          </button>
        </div>
      );
    }
    if (!viewKind) {
      // Defensive — should not happen since AttachmentList only opens
      // viewable rows here, but a hand-pasted `?file=` URL could land
      // on a non-viewable attachment.
      return (
        <div className="file-viewer-error">
          This file type is not supported in the viewer.{' '}
          <button type="button" onClick={triggerDownload}>
            Download
          </button>{' '}
          to open in another app.
        </div>
      );
    }
    if (urlQuery.isError) {
      return (
        <div className="file-viewer-error">
          Failed to mint a download URL: {urlQuery.error?.message ?? 'unknown error'}
          <button
            type="button"
            onClick={() => {
              void urlQuery.refetch();
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    if (fetchError) {
      return (
        <div className={`file-viewer-error file-viewer-error-${fetchError.kind}`}>
          <p>
            {fetchError.kind === 'cors'
              ? 'The browser refused to fetch the file (possible CORS / network issue).'
              : `Failed to load file: ${fetchError.message}`}
          </p>
          {fetchError.kind === 'cors' ? (
            <p className="file-viewer-error-hint">{fetchError.message}</p>
          ) : null}
          <button
            type="button"
            onClick={() => setRetryTick((t) => t + 1)}
          >
            Retry
          </button>
        </div>
      );
    }
    if (urlQuery.isLoading || fetchPending || text === null) {
      return <div className="file-viewer-loading">Loading file…</div>;
    }

    if (viewKind.kind === 'markdown') {
      // Standalone .md context: no mentions to resolve.
      return (
        <div className="file-viewer-markdown">
          <MarkdownView text={text} />
        </div>
      );
    }
    if (viewKind.kind === 'text') {
      return (
        <pre className="file-viewer-text">
          {text}
        </pre>
      );
    }
    // viewKind.kind === 'code'
    return (
      <ShikiCodeBlock
        text={text}
        language={viewKind.language}
        scheme={effectiveScheme}
      />
    );
  })();

  const filename = metadata?.filename ?? 'attachment';
  return (
    // review HC-W9 — region labelled by the visible <h2> heading
    // (instead of duplicated aria-label) so screen-reader heading
    // navigation lands on the filename and the accessible name comes
    // from the visible text.
    <div className="file-viewer-panel" role="region" aria-labelledby={titleId}>
      <div className="file-viewer-header">
        <h2 className="file-viewer-filename" id={titleId} title={filename}>
          {filename}
        </h2>
        {metadata ? (
          <span className="file-viewer-size">{formatSize(metadata.sizeBytes)}</span>
        ) : null}
        <button
          type="button"
          className="file-viewer-action"
          onClick={triggerDownload}
          aria-label={`Download ${filename}`}
          title="Download"
          // Disable the download affordance while we still don't know
          // anything about the row — clicking would request a URL for
          // a not-yet-loaded attachment id and confuse the UX.
          disabled={!metadata}
        >
          {/* sk-285.7.2.88 — §8 names `arrow-down`; this was U+2193,
              the character. Decorative either way — the aria-label on
              the button owns the accessible name. 20 is the in-control
              step. */}
          <IconArrowDown size={20} stroke={1.75} aria-hidden />
        </button>
        <button
          type="button"
          className="file-viewer-action file-viewer-close"
          onClick={onClose}
          aria-label="Close file viewer"
          title="Close (Esc)"
        >
          {/* sk-285.7.2.88 — `x`, §8's name for it; was U+00D7. */}
          <IconX size={20} stroke={1.75} aria-hidden />
        </button>
      </div>
      <div className="file-viewer-body">{body}</div>
    </div>
  );
}

// ────────────────── Inner code-block component ──────────────────

interface ShikiCodeBlockProps {
  text: string;
  language: string;
  scheme: 'light' | 'dark';
}

/**
 * Shiki standalone render — separated so we can hold its
 * loading-state independently of the outer panel. Memoised by
 * `[text, language, scheme]`; flipping the colour scheme re-runs
 * `codeToHtml` with the matching single-theme name (the dual-theme
 * path is reserved for the markdown plugin, which paints both into
 * the same HTML and switches via CSS variables — for standalone
 * files a single-theme render is cheaper and the user's scheme is
 * already known).
 */
function ShikiCodeBlock({ text, language, scheme }: ShikiCodeBlockProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setHtml(null);
    getHighlighter()
      .then((highlighter) => {
        if (cancelled) return;
        try {
          const raw = highlighter.codeToHtml(text, {
            lang: language,
            theme: scheme === 'dark' ? SHIKI_DARK_THEME : SHIKI_LIGHT_THEME,
          });
          // DOMPurify wrap as defence-in-depth — Shiki's output is
          // already safe (escaped text + token styling), but the
          // whole pipeline treats user-controllable bytes as
          // untrusted by default.
          const cleaned = DOMPurify.sanitize(raw, {
            ALLOWED_TAGS: ['pre', 'code', 'span'],
            ALLOWED_ATTR: ['class', 'style'],
            KEEP_CONTENT: true,
          });
          setHtml(cleaned);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'highlight failed');
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [text, language, scheme]);

  if (error) {
    // Fallback to plain text — highlighting is best-effort.
    return (
      <pre className="file-viewer-text" aria-label="syntax highlighting unavailable">
        {text}
      </pre>
    );
  }
  if (html === null) {
    return <div className="file-viewer-loading">Highlighting…</div>;
  }
  return (
    <div
      className={`file-viewer-code file-viewer-code-${scheme}`}
      // eslint-disable-next-line react/no-danger -- DOMPurify-sanitised Shiki output
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
