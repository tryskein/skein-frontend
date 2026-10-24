import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { IconPencil, IconPlus, IconRefresh } from '@tabler/icons-react';
import type { IssueDetail, PatchIssueInput } from '../../../../api/issues';
import { useInlineEdit } from '../../../../lib/useInlineEdit';
import {
  isSaveFailure,
  type SaveFailure,
  type UpdateFieldOptions,
} from '../../../../lib/useIssueDetail';
import { saveFailureReason } from '../../../../lib/saveFailureReason';
import { sourceCaretFromClick } from '../../../../lib/caretFromClick';
import { MarkdownView } from '../MarkdownView';
import { Section } from '../Section';

/**
 * Generic editable long-text section (F5, Q12).
 *
 * Read mode: rendered markdown / plain text. Mouse-clicking anywhere
 * on the body enters edit mode — except when the click originates
 * from an `<a>` (mention link) so users can navigate without flipping
 * into the editor. An explicit "Edit" button gives keyboard parity
 * (the read-mode wrapper used to be a `role="button"` div containing
 * mention anchors — nested interactives, ARIA antipattern).
 *
 * Edit mode: textarea, controlled by `useInlineEdit`. The hook
 * debounces 2s + flushes on blur. We exit edit mode on blur but
 * KEEP the textarea mounted briefly until the flush settles so the
 * user sees their text persist on screen. The `[Save]` button is
 * deliberately absent per Q12 — the contract is "type, then move
 * on, the system saves".
 *
 * sk-285.1.3 — NO GEOMETRY JUMP between the two modes. Three rules:
 *
 *   1. Both modes render the same box: `.inline-edit-surface` carries
 *      the font, line-height, padding, border width and full width, so
 *      read and edit differ only in colour. The read wrapper no longer
 *      pulls itself out of flow with a negative margin.
 *   2. The textarea's height floor is MEASURED from the read surface
 *      at the moment of the click (`getBoundingClientRect().height`),
 *      then it auto-grows to its own scrollHeight. Rendered markdown
 *      wraps to more visual lines than the source has `\n`s, which is
 *      exactly why the old `rows={lines+1}` textarea came up short and
 *      the card visibly shrank on entry.
 *   3. A constant-height footer (`.inline-edit-foot`) carries the Edit
 *      button in read mode and the save status in edit mode, so the
 *      trailing row doesn't change height either. Leaving edit mode is
 *      symmetric: same surface, same footer, unchanged text → the card
 *      lands back on exactly the height it had.
 *
 * Caret: clicking a specific word puts the caret on that word instead
 * of at the end of the field — `sourceCaretFromClick` maps the click
 * point through the rendered DOM onto an index in the markdown source.
 * Browsers without the caret API (and jsdom) fall back to end-of-text.
 *
 * Empty body: sk-285.6.2 — the whole section collapses onto its
 * heading row and the "+ Add <field>" button rides on that row, so an
 * unfilled Notes / Acceptance-criteria costs ONE line instead of a
 * heading plus a body plus a button. Clicking still enters edit mode
 * with an empty draft in a single click; `editing` clears `isEmpty`, so
 * the section expands the moment the editor opens.
 *
 * sk-425 — A REFUSED SAVE KEEPS THE TEXT. `updateField` reports the
 * refusal (`SaveFailure`) and the save throws it into `useInlineEdit`,
 * whose contract is exactly "on error, keep the local value". The
 * editor then STAYS OPEN on the refused text even though focus left it
 * (`showEditor`), a line under it says why
 * (`saveFailureReason.ts#saveFailureReason` — for a claimed issue, who
 * holds the claim) and the heading row offers «Retry»; the text can be copied straight
 * out of the textarea. Every section on this component behaves the
 * same: "Description", "Acceptance criteria", "Notes", "Design".
 *
 * sk-492 — and the reason is said ONCE: the save asks `updateField` for
 * no toast (`reportsInline`), because the line under the editor already
 * says it, in the same `saveFailureReason` words.
 */
export interface EditableTextSectionProps {
  title: string;
  /** Field name on IssueDetail — e.g. 'description'. */
  field: keyof Pick<
    IssueDetail,
    'description' | 'acceptanceCriteria' | 'notes' | 'design'
  >;
  /** "+ Add description" placeholder for the empty-state button. */
  emptyAddLabel: string;
  issue: IssueDetail;
  updateField: (
    patch: PatchIssueInput,
    opts?: UpdateFieldOptions,
  ) => Promise<IssueDetail | SaveFailure>;
}

/** Rows the textarea opens with when the section had no text at all. */
const EMPTY_START_ROWS = 3;

export function EditableTextSection({
  title,
  field,
  emptyAddLabel,
  issue,
  updateField,
}: EditableTextSectionProps) {
  const { t } = useTranslation('details');
  const initialValue = (issue[field] as string) ?? '';
  const [editing, setEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const readRef = useRef<HTMLDivElement>(null);
  const focusRafRef = useRef<number | null>(null);
  const pendingCaretRef = useRef<number | null>(null);
  // Height floor for the textarea, measured off the read surface right
  // before the swap. null = no measurement (empty-state entry).
  const [minHeight, setMinHeight] = useState<number | null>(null);
  const minHeightRef = useRef<number | null>(null);
  minHeightRef.current = minHeight;
  const [startRows, setStartRows] = useState(1);

  const edit = useInlineEdit<string>({
    initialValue,
    onSave: async (v) => {
      // Build a patch shaped to the wire DTO. PatchIssueInput keys
      // mirror IssueDetail keys for these four fields, so the cast
      // is safe. We always send the trimmed value — empty string
      // becomes empty, not null.
      const patch: PatchIssueInput = { [field]: v } as PatchIssueInput;
      // sk-492 — the reason is printed under the editor; no toast.
      const result = await updateField(patch, { reportsInline: true });
      // sk-425 — a refusal must reach the hook as a rejection, or it
      // records the refused text as saved.
      if (isSaveFailure(result)) throw result.error;
    },
  });

  // sk-425 — a refused draft keeps the editor on screen after focus
  // left it: read mode would draw the SERVER value and the draft would
  // be invisible (and, to the reader, gone).
  const showEditor = editing || edit.error !== null;

  // Empty-state read mode: show "+ Add <field>" instead of a hollow
  // section. Click enters edit mode with an empty initial value.
  const isEmpty = !showEditor && initialValue.trim() === '';

  const enterEdit = (caretIndex: number | null = null) => {
    // Measure BEFORE the swap — once `editing` flips the read surface
    // is gone and there's nothing left to match.
    const read = readRef.current;
    const measured = read ? read.getBoundingClientRect().height : 0;
    setMinHeight(measured > 0 ? measured : null);
    setStartRows(measured > 0 ? 1 : EMPTY_START_ROWS);

    pendingCaretRef.current = caretIndex;
    setEditing(true);
    // Cancel any prior pending focus rAF — happens when the user
    // mashes the Edit button before paint lands.
    if (focusRafRef.current !== null) {
      cancelAnimationFrame(focusRafRef.current);
    }
    // Focus the textarea on next paint so the user can start typing
    // immediately. Without this React mounts the textarea but the
    // browser's focus doesn't follow.
    focusRafRef.current = requestAnimationFrame(() => {
      focusRafRef.current = null;
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      // Caret at the clicked character when we could map the click;
      // otherwise at the end (keyboard "Edit" button, or a browser
      // without the caret API).
      const len = el.value.length;
      const wanted = pendingCaretRef.current;
      const pos = wanted === null ? len : Math.max(0, Math.min(wanted, len));
      pendingCaretRef.current = null;
      el.setSelectionRange(pos, pos);
    });
  };

  // Cancel any pending focus rAF on unmount so the callback doesn't
  // run against a stale ref. Optional-chained .focus() is harmless,
  // but the cleanup matches the pattern in StatusChangeReasonModal.
  useEffect(() => {
    return () => {
      if (focusRafRef.current !== null) {
        cancelAnimationFrame(focusRafRef.current);
        focusRafRef.current = null;
      }
    };
  }, []);

  // Auto-grow — the textarea is never allowed to scroll, and never
  // allowed to sit below the measured read-mode height. Runs on entry
  // and on every keystroke; useLayoutEffect so the height lands in the
  // same frame as the swap (no one-frame flash of a short box).
  useLayoutEffect(() => {
    if (!editing) return;
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    // jsdom has no layout — scrollHeight is 0 there, and forcing a
    // 0px height would be worse than leaving the attribute-driven one.
    if (el.scrollHeight <= 0) return;
    // border-box sizing: scrollHeight covers content + padding, the
    // borders have to be added back or the box loses 2px each pass.
    const borders = Math.max(0, el.offsetHeight - el.clientHeight);
    const natural = el.scrollHeight + borders;
    el.style.height = `${Math.max(natural, minHeightRef.current ?? 0)}px`;
  }, [editing, edit.value]);

  const onBodyClick = (e: MouseEvent<HTMLDivElement>) => {
    // Don't enter edit mode when the click landed on a link — let
    // the user navigate to the mention instead.
    const target = e.target as HTMLElement | null;
    if (target?.closest('a')) return;
    const container = readRef.current;
    const caret = container
      ? sourceCaretFromClick(container, initialValue, e.clientX, e.clientY)
      : null;
    enterEdit(caret);
  };

  /**
   * The save status — «saving…», «unsaved», and «Retry» after a
   * refusal (sk-425; the refusal's reason is a line under the editor).
   *
   * sk-285.7.2.58 — it lives on the HEADING ROW now, beside Edit, and
   * the trailing footer it used to sit in is gone. See the docblock's
   * rule 3 for why the move rather than a deletion: the row still has
   * to exist in BOTH modes, or a flush that finishes after the editor
   * closed would have nowhere to report.
   *
   * Built once and mounted in whichever of the two heading rows the
   * section is currently drawing (the collapsed empty row, or the
   * ordinary head). Only ever one of them is in the tree, so the
   * `role="status"` live region is never duplicated.
   */
  const status = (
    <span className="inline-edit-status" role="status" aria-live="polite">
      {edit.isFlushing ? (
        <span className="inline-edit-saving">{t('editable.saving')}</span>
      ) : edit.isDirty ? (
        <span className="inline-edit-dirty">{t('editable.unsaved')}</span>
      ) : null}
      {/* sk-425 — the heading row carries only the short marks and the
          Retry button; the REASON is a sentence and goes under the
          editor (below), where it can wrap. In this row — `flex: none`
          beside the heading — a sentence pushed the details pane into
          a horizontal scroll (measured in Chromium, 1600px). */}
      {edit.error ? (
        <>
          <button
            type="button"
            className="empty-section-add inline-edit-retry-btn"
            onClick={() => edit.retry()}
            aria-label={t('editable.retryAria', { title })}
          >
            {/* Same chrome as «Edit» beside it: 16px icon + one word. */}
            <IconRefresh size={16} stroke={1.75} aria-hidden />
            {t('editable.retry')}
          </button>
        </>
      ) : null}
    </span>
  );

  return (
    <Section
      title={title}
      empty={isEmpty}
      // sk-285.7.2.54 — §6: «Description (h3 14/600 + Edit ghost)», and
      // `Sk Details.dc.html` draws the pair as ONE `space-between` row.
      // The button used to sit in the trailing footer, below the text
      // and flush LEFT, wearing the dashed outline of the «+ Add …»
      // affordance — a different control's chrome in a different place.
      // Nothing renders it while the section is empty (the collapsed row
      // carries «+ Add …» instead) or while the editor is open.
      // sk-285.7.2.58 — the slot is now filled in BOTH modes, and that
      // is what makes the swap free of a nudge. `.inline-edit-head-slot`
      // floors at `--height-control`, the same role the Edit button
      // floors at, so the row is one height whether it holds the button
      // (read) or only the status (edit). Before this it was `null`
      // while editing, the row collapsed onto the bare `<h2>`, and the
      // section measured 203px in read mode against 188 in edit —
      // everything below it moved by 15px on every entry and exit.
      headerAction={
        <span className="inline-edit-head-slot">
          {status}
          {!isEmpty && !showEditor ? (
            <button
              type="button"
              className="empty-section-add inline-edit-edit-btn"
              onClick={(e) => {
                e.stopPropagation();
                enterEdit();
              }}
              aria-label={t('editable.editAria', { title })}
            >
              <IconPencil size={16} stroke={1.75} aria-hidden />
              {t('editable.edit')}
            </button>
          ) : null}
        </span>
      }
      emptyAction={
        <span className="inline-edit-head-slot">
          {/* The collapsed row gets the status too. It could not before
              — the footer lived inside the `!isEmpty` branch — so a
              flush that finished after a section had been cleared to
              empty reported nowhere. */}
          {status}
        <button
          type="button"
          className="empty-section-add"
          aria-label={emptyAddLabel}
          onClick={() => enterEdit()}
        >
            {/* sk-285.7.2.55 — `ti-plus` 16px, and a ONE-WORD label.
                The section's heading sits on this same row, two elements
                to the left, and already names the field; the artboard
                therefore writes just «Add» / «Upload». The full phrase
                stays as the ACCESSIBLE name, because four buttons called
                «Add» on one panel are indistinguishable to a screen
                reader — and it contains the visible word, which is what
                WCAG 2.5.3 asks of a label that differs from its name. */}
            <IconPlus size={16} stroke={1.75} aria-hidden />
          {t('emptyAdd.add')}
          </button>
        </span>
      }
    >
      {isEmpty ? null : (
        <div className="inline-edit-field">
          {showEditor ? (
            <textarea
              ref={textareaRef}
              className="inline-edit-surface inline-edit-textarea"
              style={
                minHeight !== null ? { minHeight: `${minHeight}px` } : undefined
              }
              value={edit.value}
              onChange={(e) => edit.setValue(e.target.value)}
              // sk-425 — back into a refused draft: this is editing again,
              // so the editor must not vanish when typing clears the error.
              onFocus={() => setEditing(true)}
              onBlur={() => {
                edit.onBlur();
                setEditing(false);
                setMinHeight(null);
              }}
              rows={startRows}
              spellCheck
              aria-label={title}
              // Don't lose focus when the user clicks on the section
              // heading or padding — those don't dismiss the textarea.
            />
          ) : (
            // Read mode — content is plain markdown. Click-anywhere-to-edit
            // is preserved for mouse users via the wrapper's onClick, but
            // we deliberately removed `role="button" tabIndex={0}` from
            // the wrapper — it nested interactive descendants (mention
            // anchors), violating ARIA, and SR users had no way to know
            // "Tab into the body" meant "edit". A small explicit Edit
            // button in the footer gives keyboard parity.
            <div
              ref={readRef}
              className="inline-edit-surface markdown-clickable"
              onClick={onBodyClick}
            >
              <MarkdownView text={initialValue} mentions={issue.mentions} />
            </div>
          )}
          {edit.error ? (
            <div className="inline-edit-error inline-edit-error-line" role="alert">
              {t('editable.saveFailed', {
                message: saveFailureReason(edit.error, t, issue.lockedByUsername),
              })}
            </div>
          ) : null}
          {/* sk-285.7.2.58 — the trailing `.inline-edit-foot` is GONE.
              It existed to keep the swap nudge-free, and after
              sk-285.7.2.54 moved the Edit button up to the heading row
              it held nothing visible in read mode: 36px of empty band
              under every filled section. The promise it was carrying
              did not survive that move either — the HEADING row was
              doing the nudging instead (see `headerAction` above) — so
              the fix is one row, not two: the status went up to join
              the button, and the floor moved with it. */}
        </div>
      )}
    </Section>
  );
}
