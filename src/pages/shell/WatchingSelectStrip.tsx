import { useRef } from 'react';
import { IconEyeOff, IconX } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { SkeinTooltip } from '../../components/SkeinTooltip';
import { useFitsWidth } from './WatchingFilter';

interface Props {
  /** How many cards are ticked on screen. */
  count: number;
  /** The bulk «stop watching» cannot run (nothing ticked, in flight, placeholder list). */
  disabled: boolean;
  onUnwatch: () => void;
  onCancel: () => void;
  /**
   * sk-622.21 (US-6) — what the ticked cards are: subscriptions only
   * (`unwatch`, the default), historical cards only (`remove` — there is
   * no subscription to stop), or both (`mixed`). One request serves all
   * three; only the words differ, so a historical card is never offered
   * an unsubscribe.
   */
  selectionKind?: WatchingSelectionKind;
}

export type WatchingSelectionKind = 'unwatch' | 'remove' | 'mixed';

const LABEL_KEYS: Record<WatchingSelectionKind, { label: string; hint: string }> = {
  unwatch: {
    label: 'watching.actions.unwatchSelectedN',
    hint: 'watching.actions.unwatchSelectedHint',
  },
  remove: {
    label: 'watching.actions.removeSelectedN',
    hint: 'watching.actions.removeSelectedHint',
  },
  mixed: {
    label: 'watching.actions.unwatchOrRemoveSelectedN',
    hint: 'watching.actions.unwatchOrRemoveSelectedHint',
  },
};

/**
 * sk-551.49 — the select-mode strip of the Watching queue, on ONE line at
 * every column width.
 *
 * sk-551.33 drew it as «Selected N · [Stop watching] · [Cancel]», which
 * wraps onto a second line in a narrow Queues column ("looks
 * very ugly"). Variant A:
 *   - the count lives inside the main button («Stop watching · N»); the
 *     separate «Selected N» stays only as a visually hidden live region,
 *     so a screen reader still hears the tally change;
 *   - Cancel is an × icon at the right end, its tooltip says Esc works too;
 *   - when even that does not fit, the main button folds to the icon and
 *     the number. The decision follows the strip's OWN width — a
 *     ResizeObserver via `useFitsWidth`, the same mechanism as the
 *     Open/Closed/All filter above (WatchingFilter.tsx) — measured against
 *     a hidden copy of the full-label line, so it is the natural width of
 *     the real controls and not a guessed number.
 *
 * Mounted only while select mode is on, so the measuring hook starts with
 * the strip on screen.
 */
export function WatchingSelectStrip({
  count,
  disabled,
  onUnwatch,
  onCancel,
  selectionKind = 'unwatch',
}: Props) {
  const { t } = useTranslation('inbox');
  const stripRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const fits = useFitsWidth(stripRef, measureRef);
  const keys = LABEL_KEYS[selectionKind];
  const label = t(keys.label, { n: count });

  return (
    <div className="watching-select-strip" ref={stripRef}>
      <span className="sr-only" role="status">
        {t('watching.actions.selected', { n: count })}
      </span>
      <SkeinTooltip content={t(keys.hint)} position="bottom">
        <button
          type="button"
          className={`action-button primary watching-unwatch-selected${fits ? '' : ' compact'}`}
          aria-label={label}
          disabled={disabled}
          onClick={onUnwatch}
        >
          <IconEyeOff size={16} stroke={1.75} aria-hidden />
          {fits ? <span>{label}</span> : <span aria-hidden="true">{count}</span>}
        </button>
      </SkeinTooltip>
      <SkeinTooltip content={t('watching.actions.cancelSelectHint')} position="bottom">
        <button
          type="button"
          className="watching-cancel-select"
          aria-label={t('watching.actions.cancelSelect')}
          onClick={onCancel}
        >
          <IconX size={16} stroke={1.75} aria-hidden />
        </button>
      </SkeinTooltip>
      {/* The full-label line, laid out but never shown: its width is what
          the strip needs for the unfolded button. */}
      <span className="watching-select-strip-measure" ref={measureRef} aria-hidden="true">
        <span className="action-button primary watching-unwatch-selected">
          <IconEyeOff size={16} stroke={1.75} aria-hidden />
          <span>{label}</span>
        </span>
        <span className="watching-cancel-select" />
      </span>
    </div>
  );
}
