import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { SegmentedControl, Select } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { SkeinTooltip } from '../../components/SkeinTooltip';
import { WATCHING_STATES, type WatchingState } from '../../api/notifications';

/**
 * sk-551.10 — the Open / Closed / All filter of the Watching queue, and
 * the line that says how many subscriptions the chosen variant holds.
 *
 *   ( Open | Closed | All )
 *   Open: 2 716 · shown 100 · what watching is ⓘ
 *
 * It replaces the old «Showing 100 of N subscriptions» line above the
 * cards: the number now belongs to the filter on screen, and «showing
 * 100» stands next to it only when the list is cut.
 *
 * Width. The segment needs about 210–220 px in Russian at the shell's
 * small step; the Queues column is 264 px by default and 200 px at its
 * minimum, so in Russian it fits only just — and not at all at the
 * minimum. Numbers are therefore never put INSIDE the segments, and when
 * the column is narrower than the segment's natural width the same
 * choice is offered as a compact dropdown. The decision follows the
 * COLUMN's width (a ResizeObserver on this block), not the window's —
 * the column is resized by its own handle without the window changing.
 */

export interface WatchingFilterProps {
  state: WatchingState;
  onChange: (state: WatchingState) => void;
  /** Uncapped size of the selected variant. */
  stateTotal: number;
  /** How many cards the list actually carries. */
  shown: number;
  /** The list is a prefix of `stateTotal`. */
  truncated: boolean;
  /**
   * The filter the NUMBERS belong to — the response's, which lags the
   * control while a newly chosen filter loads. Defaults to `state`.
   */
  summaryState?: WatchingState;
  /**
   * sk-551.33 — a control at the END of the summary line (the select-mode
   * icon), pushed to its right edge.
   */
  summaryAction?: ReactNode;
  /** Extra controls under the summary line (bulk actions). */
  children?: ReactNode;
}

/**
 * Does a control of natural width `needed` fit the CONTENT box of a
 * container whose `clientWidth` (padding box) is `clientWidth`? The real
 * control is `width: 100%` of the content box, so the padding is not room
 * for it (sk-551.10 review: comparing with the padding box let a segment
 * up to 16 px too wide through, to be squeezed with ellipsis).
 * `null` — not measurable yet (no layout), keep the current decision.
 */
export function fitsContentBox(
  clientWidth: number,
  paddingLeft: number,
  paddingRight: number,
  needed: number,
): boolean | null {
  const available = clientWidth - paddingLeft - paddingRight;
  if (available <= 0 || needed <= 0) return null;
  return needed <= available;
}

/**
 * Whether the natural width of `measureRef` fits into `containerRef`,
 * re-evaluated whenever either one changes size. `true` until the first
 * real measurement: a layout-less environment (or a hidden column)
 * reports zero widths, and the full control is the default the plan asks
 * for, not the fallback.
 */
export function useFitsWidth(
  containerRef: RefObject<HTMLElement>,
  measureRef: RefObject<HTMLElement>,
): boolean {
  const [fits, setFits] = useState(true);
  useLayoutEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;
    const evaluate = () => {
      const style = window.getComputedStyle(container);
      const verdict = fitsContentBox(
        container.clientWidth,
        parseFloat(style.paddingLeft) || 0,
        parseFloat(style.paddingRight) || 0,
        measure.scrollWidth,
      );
      if (verdict !== null) setFits(verdict);
    };
    evaluate();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(evaluate);
    ro.observe(container);
    ro.observe(measure);
    return () => ro.disconnect();
  }, [containerRef, measureRef]);
  return fits;
}

/**
 * Put keyboard focus on the filter's visible control inside `root`: the
 * selected segment, or the compact dropdown when the column is narrow.
 * Returns false when there is no filter to focus. Used when the control
 * that had focus disappears (sk-551.10 review — a bulk unwatch that
 * emptied the list leaves no «Select» button to return to).
 */
export function focusWatchingFilter(root: ParentNode | null): boolean {
  const target = root?.querySelector<HTMLElement>(
    '.watching-filter-segments input:checked, .watching-filter-select input',
  );
  if (!target) return false;
  target.focus();
  return true;
}

export function WatchingFilter({
  state,
  onChange,
  stateTotal,
  shown,
  truncated,
  summaryState,
  summaryAction,
  children,
}: WatchingFilterProps) {
  const { t, i18n } = useTranslation('inbox');
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const fits = useFitsWidth(containerRef, measureRef);
  const fmt = new Intl.NumberFormat(i18n.language);

  const data = WATCHING_STATES.map((value) => ({
    value,
    label: t(`watching.filter.${value}`),
  }));
  const select = (v: string | null) => {
    if (v === 'open' || v === 'closed' || v === 'all') onChange(v);
  };

  return (
    <div className="watching-filter" ref={containerRef}>
      {/* The measurer: the same segmented control at its natural width,
          out of flow and invisible (so neither focusable nor announced).
          Its width is what the real one would need. */}
      <div className="watching-filter-measure" ref={measureRef} aria-hidden="true">
        <SegmentedControl
          className="watching-filter-type"
          size="xs"
          data={data}
          value={state}
          readOnly
        />
      </div>
      {fits ? (
        <SegmentedControl
          className="watching-filter-segments watching-filter-type"
          size="xs"
          fullWidth
          data={data}
          value={state}
          onChange={select}
          aria-label={t('watching.filter.aria')}
        />
      ) : (
        <Select
          className="watching-filter-select watching-filter-type"
          size="xs"
          data={data}
          value={state}
          onChange={select}
          allowDeselect={false}
          aria-label={t('watching.filter.aria')}
          comboboxProps={{ withinPortal: true }}
        />
      )}
      <div className="watching-filter-summary">
        {/* Only the numbers are the live region; the ⓘ button next to them
            is not re-announced on every filter change. */}
        <span role="status">
        <span className="watching-filter-total">
          {t(`watching.filter.summary.${summaryState ?? state}`, { total: fmt.format(stateTotal) })}
        </span>
        {truncated ? (
          <span className="watching-filter-shown">
            {' · '}
            {t('watching.filter.shown', { shown: fmt.format(shown) })}
          </span>
        ) : null}
        </span>
        <span aria-hidden="true">{' · '}</span>
        <SkeinTooltip content={t('watching.filter.explain')} position="bottom" width={260}>
          <button type="button" className="watching-filter-explain">
            {t('watching.filter.explainLink')}
            <IconInfoCircle size={16} stroke={1.75} aria-hidden />
          </button>
        </SkeinTooltip>
        {summaryAction ? (
          <span className="watching-filter-summary-action">{summaryAction}</span>
        ) : null}
      </div>
      {children}
    </div>
  );
}
