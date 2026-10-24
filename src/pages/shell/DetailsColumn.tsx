import {
  Component,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useTranslation, withTranslation, type WithTranslation } from 'react-i18next';
import { IconArrowLeft, IconChevronDown, IconX } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import type { IssueDetail } from '../../api/issues';
import { issueDetailKey } from '../../lib/useIssueDetail';
import { useLayoutState } from '../../lib/useLayoutState';
import { useDialogFocusTrap } from '../../lib/useDialogFocusTrap';
import { nextTaskId, taskPosition, useTasksOutlet } from '../../lib/useTasksOutlet';
import { IssueDetailPanel } from './details/IssueDetailPanel';

// sk-41 — viewer panel is lazy-loaded so Shiki (themes + langs + wasm
// engine) only enters the JS graph when an attachment is actually
// opened. Vite chunks `./details/FileViewerPanel` and everything it
// pulls in (shiki/core, oniguruma engine, theme + lang bundles, the
// markdown-it shiki plugin) into separate dynamic chunks; the initial
// payload stays unchanged.
const FileViewerPanel = lazy(() =>
  import('./details/FileViewerPanel').then((m) => ({ default: m.FileViewerPanel })),
);

/**
 * sk-41 (review TS-W3) — class-based ErrorBoundary that catches
 * (a) a dynamic-import failure on the viewer chunk (network drop, bad
 * deploy) and (b) any render-time throw from Shiki / DOMPurify on a
 * pathological input. Suspense only catches the throw-a-promise
 * loading pattern; render errors thrown by the resolved component
 * propagate and would otherwise crash the whole Details column.
 *
 * Renders a small "viewer failed" notice with a Close button that
 * resets the file param via the parent's `onClose`.
 */
class FileViewerErrorBoundaryBase extends Component<
  { children: ReactNode; onClose: () => void } & WithTranslation,
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }
  componentDidCatch(error: Error): void {
    // Stay visible in the console so operators can grab the trace.
    // eslint-disable-next-line no-console
    console.error('FileViewerPanel render failed:', error);
  }
  render(): ReactNode {
    // Class components can't use hooks — `withTranslation` injects `t`
    // as a prop instead (see the wrapped export below).
    const { t } = this.props;
    if (this.state.error !== null) {
      return (
        <div className="file-viewer-panel">
          <div className="file-viewer-header">
            <h2 className="file-viewer-filename">
              {t('details:fileViewer.errorTitle')}
            </h2>
            <button
              type="button"
              className="file-viewer-action"
              onClick={this.props.onClose}
              aria-label={t('details:fileViewer.closeAria')}
              title={t('details:fileViewer.closeTitle')}
            >
              {/* sk-285.7.2.88 — `x`, which §8 names. This is the
                  ERROR branch of the file viewer; `FileViewerPanel.tsx`
                  draws the same `.file-viewer-action` control on the
                  success path, and both were the character U+00D7 in a
                  44×44 box. Fixing one branch and not the other would
                  give the viewer a close button that changes shape
                  depending on whether the file loaded, so both moved in
                  this commit. 20 is §8's in-control step. */}
              <IconX size={20} stroke={1.75} aria-hidden />
            </button>
          </div>
          <div className="file-viewer-body">
            <div className="file-viewer-error">
              <p>{t('details:fileViewer.loadFailed')}</p>
              <p className="file-viewer-error-hint">{this.state.error.message}</p>
              <button type="button" onClick={this.props.onClose}>
                {t('details:fileViewer.closeViewer')}
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const FileViewerErrorBoundary = withTranslation('details')(
  FileViewerErrorBoundaryBase,
);

interface Props {
  issueId: string | null;
  /**
   * sk-285.7 T019 — render as the mobile FULL-SCREEN SHEET rather than
   * as one column of a row.
   *
   * Below the mobile threshold the four zones cannot sit side by side,
   * so the description is not a column at all: it covers the screen and
   * the zone strip behind it. That makes a way back mandatory — US-6's
   * acceptance says "from the description sheet there is a way back to the list", and on a
   * phone there is no second column to look at and no Esc key to press.
   * The sheet therefore grows a header of its own: a back control that
   * closes the issue, and the positional counter (INV-10).
   *
   * A prop rather than a `useWidthMode()` call of its own: the mode is
   * one decision, `Shell` makes it for the whole layout, and a second
   * reader could disagree with it for a frame.
   */
  sheet?: boolean;
  /**
   * sk-551.5 — draw the open issue as a centred MODAL WINDOW over the
   * view instead of as a column of the row: the person turned the pop-up
   * window on for the current view (Appearance → «Open the issue in a
   * pop-up window»). `Shell` decides it, for the same reason it decides
   * `sheet`; the phone never asks for it (the sheet wins).
   *
   * No effect without an open issue: the window shows an issue, and an
   * empty «select a task» window would be a dead end.
   */
  modal?: boolean;
}

/**
 * The open issue's title, read from the query cache the panel fills — the
 * modal window's accessible name (sk-551.5: "the dialog name is the task
 * heading").
 *
 * A cache SUBSCRIPTION, not a second `useQuery` on the same key: an
 * observer with its own options would become one of the query's option
 * sources, and the panel's `useIssueDetail` must stay the only one that
 * says how the issue is fetched. `null` until the panel's read lands.
 */
function useCachedIssueTitle(issueId: string | null): string | null {
  const qc = useQueryClient();
  const subscribe = useCallback(
    (onChange: () => void) => qc.getQueryCache().subscribe(onChange),
    [qc],
  );
  return useSyncExternalStore(subscribe, () =>
    issueId === null
      ? null
      : (qc.getQueryData<IssueDetail>(issueDetailKey(issueId))?.title ?? null),
  );
}

/**
 * `<input>` types that take no typed text: Esc has no native job on them,
 * so it belongs to the shell (close the viewer / the task).
 */
const NON_TEXT_INPUT_TYPES = new Set([
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'image',
  'range',
  'color',
  'file',
]);

/**
 * sk-551.8 (D1) — is the Esc's target a field the person types into?
 *
 * The guard used to skip EVERY `<input>`. The account menu holds radio
 * inputs (density, left panel): after switching the left-panel layout,
 * focus stays on the clicked radio, and the Esc that closes the menu
 * reached this handler with that radio as its target — so the menu
 * closed and the task stayed open. Only text entry keeps Esc for itself.
 */
function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(target.type);
  return false;
}

/**
 * Details column (F5).
 *
 * Empty state when no issue is selected; otherwise mounts
 * `IssueDetailPanel` which owns the sticky header + scrolling sections.
 *
 * sk-41 — when `?file=<attachmentId>` is on the URL, the column also
 * renders `FileViewerPanel`. Two visual modes:
 *
 *   - `selfOpenedFile === true` (user clicked an attachment row inside
 *     an open card): viewer replaces the card in this column. Single
 *     pane, full width.
 *   - `selfOpenedFile !== true` (shared-link load or back-button into
 *     a `?file=` URL): the column renders a 50/50 split with the
 *     IssueDetailPanel on the left and FileViewerPanel on the right.
 *     Shell.tsx independently activates inbox-overlay (Projects+Tasks
 *     hidden) so this column gets the full right pane to split.
 *
 * The project handle for the panel comes from `useLayoutState`'s
 * `selectedProject` — same source the Tasks column uses to resolve
 * the alias. When the URL is the inbox-overlay shape `/issues/:id`
 * (no project context), `selectedProject` is null and the panel
 * falls back to the issue's echoed `projectId` after the GET lands.
 */
export function DetailsColumn({ issueId, sheet = false, modal = false }: Props) {
  const { t } = useTranslation('details');
  const {
    selectedProject,
    clearSelectedIssue,
    setSelectedIssue,
    selectedAttachment,
    selfOpenedFile,
    closeAttachment,
  } = useLayoutState();
  const outlet = useTasksOutlet();
  const position = taskPosition(outlet, issueId);
  const nextIssue = nextTaskId(outlet, issueId);
  const asModal = modal && !sheet && issueId !== null;
  const issueTitle = useCachedIssueTitle(asModal ? issueId : null);
  const frameRef = useRef<HTMLDivElement>(null);
  useDialogFocusTrap(frameRef, asModal);

  // Esc closes the open issue / viewer. Two-stage priority (sk-41):
  //   1. Viewer is open → ESC closes the viewer first. The card stays.
  //   2. No viewer → ESC clears the selected issue (legacy behaviour).
  //
  // Skipped when the user is typing in a text field (title textarea,
  // comment composer, etc.) so Esc still does its native job there
  // (clear focus / cancel autocompletes); the ESC interception is
  // constrained to plain document-level keydowns. A radio, a checkbox or
  // a button-like `<input>` is not typing and Esc has no job of its own
  // there — see `isTextEntryTarget`.
  useEffect(() => {
    if (!issueId && !selectedAttachment) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isTextEntryTarget(e.target)) return;
      // Modal/Menu Esc handlers run first because they `stopPropagation`;
      // if we got here the modal isn't intercepting.
      if (selectedAttachment) {
        closeAttachment();
        return;
      }
      clearSelectedIssue();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [issueId, selectedAttachment, clearSelectedIssue, closeAttachment]);

  /**
   * The frame around a rendered column: the mobile sheet, or — on every
   * wider layout — a pair of wrappers that are in the DOM and out of the
   * layout.
   *
   * ONE wrapper for all four render branches (empty, panel, viewer,
   * viewer-split) rather than a sheet branch of its own, because the
   * thing that differs on a phone is the FRAME, not the content: the
   * card, the file viewer and the split all need the same "how do I get
   * back" affordance, and a sheet that grew it for only the common case
   * would be a dead end on the other three (US-6: "from the description
   * sheet there is a way back to the list").
   *
   * ── sk-366 — why the wrapper is UNCONDITIONAL ──────────────────────
   *
   * It used to open with `if (!sheet) return content;`, so the wrapper
   * appeared and disappeared with the width mode — which moves `content`
   * from the top of this function's output to inside two new elements.
   * React reconciles host nodes by POSITION: a subtree that changes
   * depth is not reused, it is unmounted and mounted afresh. Measured,
   * not assumed — `.col-details` came back as a different node object
   * after one crossing — and the user pays for it with everything the
   * instance held: an unsent comment draft, a half-typed title edit,
   * which sections were open, the panel's scroll offset, in-flight
   * queries. The spec's NFR line names exactly this: "Changing the width mode
   * does not lose state (scroll position, selected task,
   * typed text)".
   *
   * So both elements are always rendered and only their CLASSES change.
   * Off the sheet they are `display: contents` (`.details-frame` /
   * `.details-frame-body` in `index.css`): present in the DOM, absent
   * from layout, so `.col-details` stays the flex item of the column row
   * it has always been. The sheet HEADER stays conditional — it sits
   * BESIDE `{content}`, never around it, so its arrival and departure
   * cannot move the panel. It occupies its own child slot either way
   * (`{sheet ? … : null}`), which is what keeps `{content}` at index 1
   * in both modes.
   *
   * The one thing `display: contents` does NOT do is leave the DOM tree
   * flat: `.col-details` is a grandchild of `.shell-columns` now, in
   * every mode. Rules that reached it with a child combinator were
   * retargeted in the same change — see the note on `.details-frame`.
   */
  /*
   * ── sk-551.5 — the modal window is the same frame, renamed ─────────
   *
   * The pop-up window is a THIRD name for the same two wrappers, exactly
   * as the sheet is the second: `.details-modal` / `.details-modal-body`.
   * Nothing moves in the tree when the window opens or closes over a view
   * — the backdrop is a SIBLING slot before the frame (always present,
   * `null` when unused), and the focus trap (`useDialogFocusTrap`) is a
   * hook, not a wrapper. So switching between a view with the
   * window and one without, with an issue open, keeps the panel mounted
   * and its unsent draft (sk-366); stepping to another issue inside the
   * window only changes `issueId` on the same `IssueDetailPanel`.
   *
   * WHY NOT Mantine `Modal`: it portals to `document.body` (the
   * `.shell-columns … .col-details` rules stop seeing the panel), it owns
   * Esc (the two-stage Esc below would lose its first stage), it draws a
   * second ✕ beside the one `DetailsHeader` has, and it locks the page
   * scroll. Of what it bundles, only the focus trap is wanted (and see
   * `lib/useDialogFocusTrap.ts` for why it is not Mantine's `FocusTrap`).
   *
   * The backdrop closes NOTHING on click — the owner named the ✕ and Esc
   * only, and a stray click must not take an unsent comment with it. Its
   * `mousedown` is cancelled so the click does not drop focus to `<body>`
   * either: from there the next Tab would leave the trap for the page
   * behind. It covers the view, so a drag on the board cannot start while
   * the window is open.
   *
   * Opening the window focuses the window ITSELF (`tabIndex=-1`), so it
   * is announced by its name — the issue title — rather than by whichever
   * control happens to come first in the header (review C2).
   */
  const frame = (content: ReactNode): ReactNode => {
    const frameClass = sheet ? 'details-sheet' : asModal ? 'details-modal' : 'details-frame';
    const bodyClass = sheet
      ? 'details-sheet-body'
      : asModal
        ? 'details-modal-body'
        : 'details-frame-body';
    return (
      <>
        {asModal ? (
          <div
            className="details-modal-backdrop"
            aria-hidden="true"
            onMouseDown={(e) => e.preventDefault()}
          />
        ) : null}
        <div
          ref={frameRef}
          className={frameClass}
          tabIndex={asModal ? -1 : undefined}
          role={sheet || asModal ? 'dialog' : undefined}
          aria-modal={asModal ? true : undefined}
          aria-label={sheet ? t('sheet.title') : asModal ? (issueTitle ?? issueId ?? undefined) : undefined}
        >
          {sheet ? (
            <div className="details-sheet-header">
              {/* The way back. A real <button>, not a swipe or a browser
                  gesture: the sheet covers the zone strip, so this is the
                  ONLY control on screen that returns to the list, and it
                  has to be reachable by keyboard and by a screen reader
                  too. It clears the selected issue — the same verb Esc
                  performs on desktop — so the phone and the desktop agree
                  on what "close" means. */}
              <button
                type="button"
                className="details-sheet-back"
                onClick={clearSelectedIssue}
                aria-label={t('sheet.backAria')}
              >
                {/* sk-285.7.2.78 — a Tabler glyph, not the character
                    U+2190. §8 names `arrow-left` among the set and fixes
                    stroke 1.75 and the 16/20/24 scale; a text arrow has
                    none of those — its weight and its shape come from
                    whatever face the system resolves, and it sat in the
                    same 56px band as the `chevron-down` beside it, drawn
                    by a different set. 20px is the CONTROL step, the same
                    one `.details-sheet-next` spends. */}
                <IconArrowLeft size={20} stroke={1.75} aria-hidden />
                {t('sheet.back')}
              </button>
              {/* INV-10 — the positional counter, and it is ABSENT rather
                  than zeroed when there is no honest answer: an issue
                  opened from the Queues column is not in the Tasks query,
                  and "1 / 17" would be an invented place in a list it is
                  not in. The numbers come from the lensed result the Tasks
                  column published, so turning any lens on moves them. */}
              {/* sk-285.7.2.74 (audit M-2) — the counter and the way
                  FORWARD are one group, pushed to the trailing edge, which
                  is how `1g-mobile-390` frame 2 draws them: «4 of 49» with
                  the chevron immediately after it, both against the right
                  margin. They share a wrapper rather than being two
                  children of a `space-between` row because two children
                  would spread them to opposite ends of a 390px band. */}
              {position !== null && (
                <span className="details-sheet-nav">
                  <span className="details-sheet-position">
                    {t('sheet.position', {
                      position: position.position,
                      total: position.total,
                    })}
                  </span>
                  {/* §5 lists it in the same breath as the counter —
                      "header 56px with "← Tasks", the `4 of 49` counter, the next
                      task button" — and it is bound to the counter by
                      more than the drawing: both read the list the Tasks
                      column published, so a lens that renumbers «4 of 49»
                      also changes where this goes (INV-10).

                      Rendered whenever the counter is, DISABLED when there
                      is no next id. The two states say different things
                      and both are true: «this issue is in the list» is
                      what puts the pair on screen, «the list ends here» is
                      what greys the chevron. Dropping the button on the
                      last row instead would move the counter under the
                      reader's thumb on the one row where nothing else
                      changed. */}
                  <button
                    type="button"
                    className="details-sheet-next"
                    onClick={() => {
                      if (nextIssue !== null) setSelectedIssue(nextIssue, selectedProject ?? '');
                    }}
                    disabled={nextIssue === null}
                    aria-label={t('sheet.nextAria')}
                    title={t('sheet.nextAria')}
                  >
                    <IconChevronDown size={20} stroke={1.75} aria-hidden />
                  </button>
                </span>
              )}
            </div>
          ) : null}
          <div className={bodyClass}>
            {content}
          </div>
        </div>
      </>
    );
  };

  if (!issueId) {
    return frame(<div className="col-details col-details-empty">{t('empty')}</div>);
  }

  // sk-41 — three branches:
  //
  //   (a) no attachment selected → current behaviour, panel only.
  //   (b) attachment + selfOpenedFile === true → viewer replaces card.
  //   (c) attachment + selfOpenedFile !== true → split layout, card on
  //       the left and viewer on the right inside the same column.
  if (selectedAttachment && selfOpenedFile) {
    return frame(
      <div className="col-details col-details-viewer">
        <FileViewerErrorBoundary onClose={closeAttachment}>
          <Suspense
            fallback={<div className="file-viewer-loading">{t('common:loading')}</div>}
          >
            <FileViewerPanel
              issueId={issueId}
              attachmentId={selectedAttachment}
              onClose={closeAttachment}
            />
          </Suspense>
        </FileViewerErrorBoundary>
      </div>,
    );
  }

  if (selectedAttachment) {
    return frame(
      <div className="col-details has-file-split">
        <div className="col-details-card-pane">
          <IssueDetailPanel issueId={issueId} projectHandle={selectedProject} />
        </div>
        <div className="col-details-viewer-pane">
          <FileViewerErrorBoundary onClose={closeAttachment}>
            <Suspense
            fallback={<div className="file-viewer-loading">{t('common:loading')}</div>}
          >
              <FileViewerPanel
                issueId={issueId}
                attachmentId={selectedAttachment}
                onClose={closeAttachment}
              />
            </Suspense>
          </FileViewerErrorBoundary>
        </div>
      </div>,
    );
  }

  return frame(
    <div className="col-details">
      <IssueDetailPanel issueId={issueId} projectHandle={selectedProject} />
    </div>,
  );
}
