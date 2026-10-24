import { useEffect, useId, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconChevronDown,
  IconChevronRight,
  IconLayoutSidebarLeftCollapse,
} from '@tabler/icons-react';

/**
 * sk-551.8 — how the sections column draws one of its two sections
 * (`ProjectsColumn` / `InboxColumn` with the `section` prop). Without the
 * prop those columns keep their own column markup, untouched (INV-1).
 */
export interface NavSectionProps {
  /** Drawn folded: the stored folding, or the temporary picture of a shared file. */
  collapsed: boolean;
  /** The chevron: Enter / Space / ← / → (US-3). */
  onToggle: () => void;
  /**
   * "Collapse column" in this section's header — on Projects, and on
   * Queues while a shared file hides Projects (US-11).
   */
  onCollapseColumn?: () => void;
  /** The whole section is hidden but stays mounted (Projects during a shared file, US-11). */
  hidden?: boolean;
}

interface NavSectionFrameProps extends NavSectionProps {
  /** `projects` / `queues` — the modifier class and the section's identity. */
  kind: 'projects' | 'queues';
  /** The section name, the header's text and the region's name. */
  title: string;
  /** The header's count, printed at every value (zero dim, as in the column headers). */
  count: number;
  /** The accessible name of the count, when the number alone is ambiguous. */
  countLabel?: string;
  children: ReactNode;
}

/**
 * One section: a header (chevron + name + count [+ "Collapse column"])
 * and a body that is a named region.
 *
 *   - The chevron reports `aria-expanded` and controls the body. Enter and
 *     Space toggle (a button), ← folds, → unfolds, ↑ / ↓ move focus to the
 *     other section's chevron. The tree and the queue list below never see
 *     these keys: they are handled on the chevron only.
 *   - A folded body stays MOUNTED (plan P7: search, filter, marks and
 *     scroll survive) and is taken out of the keyboard order and the
 *     accessibility tree (`inert`, `aria-hidden`); the stylesheet gives it
 *     no height.
 *   - If focus was inside the body when it folded — by the chevron or by
 *     the queue running dry (US-10) — it moves to the chevron (US-3).
 */
export function NavSectionFrame({
  kind,
  title,
  count,
  countLabel,
  collapsed,
  onToggle,
  onCollapseColumn,
  hidden = false,
  children,
}: NavSectionFrameProps) {
  const { t } = useTranslation('shell');
  const titleId = useId();
  const bodyId = useId();
  const chevronRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;

  // Folding: focus first, `inert` second — an inert subtree drops the
  // focus it holds, after which nothing would say it had been inside
  // (US-3). A layout effect, so the chevron has focus in the same frame.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (body === null) return;
    if (collapsed) {
      if (body.contains(document.activeElement)) chevronRef.current?.focus();
      body.setAttribute('inert', '');
    } else if (!hidden) {
      body.removeAttribute('inert');
    }
  }, [collapsed, hidden]);
  // Hidden by a shared file (US-11): `inert` is set in a PASSIVE effect on
  // purpose. Every layout effect of the commit runs before it — among
  // them the shell's, which moves focus that was in here to "Collapse
  // column" in the Queues header — so focus has left before the subtree
  // goes inert, whatever the browser does with focus on inert.
  useEffect(() => {
    const body = bodyRef.current;
    if (body === null || !hidden) return;
    body.setAttribute('inert', '');
    return () => {
      if (!collapsedRef.current) body.removeAttribute('inert');
    };
  }, [hidden]);

  const onChevronKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      if ((event.key === 'ArrowLeft') !== collapsed) onToggle();
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const scope = event.currentTarget.closest('[data-nav-column]') ?? document;
      const chevrons = Array.from(scope.querySelectorAll<HTMLElement>('[data-nav-chevron]'));
      const other = chevrons.find((c) => c !== event.currentTarget);
      other?.focus();
    }
  };

  const Chevron = collapsed ? IconChevronRight : IconChevronDown;

  return (
    <div
      className={`nav-section nav-section--${kind}`}
      data-collapsed={collapsed ? 'true' : 'false'}
      data-hidden={hidden ? 'true' : undefined}
      aria-hidden={hidden ? true : undefined}
    >
      <div className="col-header nav-section-header">
        <button
          ref={chevronRef}
          type="button"
          className="nav-section-chevron"
          data-nav-chevron={kind}
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={onToggle}
          onKeyDown={onChevronKeyDown}
        >
          <Chevron size={20} stroke={1.75} aria-hidden />
          <span id={titleId} className="nav-section-title">
            {title}
          </span>
        </button>
        <span
          className={count === 0 ? 'col-header-count col-count-empty' : 'col-header-count'}
          aria-label={countLabel}
        >
          {count}
        </span>
        {onCollapseColumn ? (
          <button
            type="button"
            className="col-header-btn"
            aria-expanded
            aria-label={t('nav.collapseColumn')}
            onClick={onCollapseColumn}
          >
            <IconLayoutSidebarLeftCollapse size={20} stroke={1.75} aria-hidden />
          </button>
        ) : null}
      </div>
      <div
        ref={bodyRef}
        id={bodyId}
        className="nav-section-body"
        role="region"
        aria-labelledby={titleId}
        aria-hidden={collapsed ? true : undefined}
      >
        {children}
      </div>
    </div>
  );
}
