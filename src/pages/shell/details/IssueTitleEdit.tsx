import { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useInlineEdit } from '../../../lib/useInlineEdit';
import { saveFailureReason } from '../../../lib/saveFailureReason';

/**
 * The issue title as a big page heading at the top of the details
 * body — previously lived inline in the sticky DetailsHeader where it
 * fought for horizontal space with badges and dropdowns. Now it's its
 * own row above the Description section, with breathing room.
 *
 * Implementation note: title is a `<textarea>` (NOT `<input>`) so it
 * wraps onto multiple lines for long titles instead of overflowing in
 * a single ellipsised line. We auto-grow the height to its scroll
 * height on every value change — no manual resize handle, no scroll.
 *
 * Same inline-edit semantics as the other editable sections: debounced
 * 2s flush + on-blur flush + post-save isDirty=false via `lastSaved`
 * ref. Empty save is dropped (server rejects empty title — surfacing
 * as a toast on every keystroke that produces empty would be noisy).
 *
 * sk-425 — `onSave` must REJECT on a refused save (the panel throws the
 * `updateField` failure): the hook then keeps the typed title, marks it
 * unsaved and shows why, the same reason text the text sections show.
 */
export interface IssueTitleEditProps {
  initial: string;
  onSave: (next: string) => Promise<unknown>;
  /** The card's claim holder, named in a `locked_by_other` refusal. */
  lockedByUsername?: string | null;
}

export function IssueTitleEdit({ initial, onSave, lockedByUsername }: IssueTitleEditProps) {
  const { t } = useTranslation('details');
  const edit = useInlineEdit<string>({
    initialValue: initial,
    onSave: async (v) => {
      const trimmed = v.trim();
      if (!trimmed) return;
      await onSave(trimmed);
    },
  });

  // Auto-grow: reset height then read scrollHeight (browser computes
  // the natural height needed for the current content); apply back as
  // explicit pixel height. Runs on every value mutation including the
  // initial mount — useLayoutEffect avoids one-frame flicker.
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [edit.value]);

  return (
    <div className="issue-title-edit">
      <textarea
        ref={ref}
        className="issue-title-input"
        rows={1}
        value={edit.value}
        onChange={(e) => edit.setValue(e.target.value)}
        onBlur={edit.onBlur}
        onKeyDown={(e) => {
          // Enter without Shift = flush + blur (the title is one
          // visual block; Enter shouldn't insert a literal newline
          // since we strip whitespace anyway). Shift+Enter still
          // wraps if the user really wants a manual break.
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        aria-label={t('title.aria')}
        placeholder={t('title.placeholder')}
      />
      {edit.isFlushing ? (
        <span className="inline-edit-saving" role="status" aria-live="polite">
          {t('title.saving')}
        </span>
      ) : null}
      {edit.error ? (
        <div className="inline-edit-error" role="alert">
          {t('title.saveFailed', {
            message: saveFailureReason(edit.error, t, lockedByUsername),
          })}
        </div>
      ) : null}
    </div>
  );
}
