import { useCallback, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useLayoutState } from '../../lib/useLayoutState';
import { useQueueBreakdown, useZoneCounts } from '../../lib/useZoneCounts';
import { measureSplitDrag, pxToSplit } from '../../lib/navResize';
import { InboxColumn } from './InboxColumn';
import { ProjectsColumn } from './ProjectsColumn';
import { ResizeHandle } from './ResizeHandle';

interface Props {
  /**
   * The width to draw, px: the stored width of this width mode, already
   * limited on a tablet by the live limit (`navResize.ts#
   * navColumnWidthOnScreen`). Ignored while the column is a sliver.
   */
  width: number;
}

/** The two section bodies of a column root. */
function bodiesOf(root: HTMLElement | null): [Element | null, Element | null] {
  if (root === null) return [null, null];
  return [
    root.querySelector('.nav-section--projects > .nav-section-body'),
    root.querySelector('.nav-section--queues > .nav-section-body'),
  ];
}

/**
 * sk-551.8 — the sections column: "Projects" above "Queues" in one
 * navigation column (US-2), the way VS Code's Explorer stacks its views.
 *
 *   - Both sections open: the bodies share the height by the stored split
 *     (`--nav-split`, D2), with a horizontal handle between them (US-4):
 *     its bounds are live (both bodies ≥ 200 px, over the sum of the two
 *     bodies only), a double click sets equal bodies. One section or none
 *     open — no handle; a folded section is its header only (US-3).
 *   - "Collapse column" folds the whole column into a 44 px sliver
 *     (US-6) with both names and both counts — the SAME numbers the
 *     section headers print (INV-6) — and an accessible name that speaks
 *     the project count, the queue total and the per-queue split. A click
 *     on the sliver opens the column, the sections as they were.
 *   - While a shared file is shown (layer 1, US-11) the column draws the
 *     temporary picture: Projects hidden, Queues open, "Collapse column"
 *     in the Queues header, the sliver about the queues only.
 *
 * Under the sliver and under a folded section everything stays MOUNTED
 * (plan P7): search, filter, marks, scroll and the published counts
 * survive; the stylesheet gives them no size, and they are out of the
 * keyboard order and the accessibility tree. If focus was inside the
 * column when it folded, it moves to the sliver (US-6).
 *
 * Every fold goes through the layout provider's fold rules
 * (`toggleNavSection`, `setNavCollapsed`), never straight into storage.
 */
export function NavColumn({ width }: Props) {
  const { t } = useTranslation('shell');
  const {
    navSplit,
    navSectionsCollapsed,
    navColumnCollapsed,
    navTemp,
    toggleNavSection,
    setNavCollapsed,
    setNavSplit,
    resetNavSplit,
  } = useLayoutState();
  const counts = useZoneCounts();
  const breakdown = useQueueBreakdown();

  // The picture to draw: the temporary one while a shared file is shown.
  const fileShown = navTemp !== null;
  const columnCollapsed = fileShown ? navTemp.columnCollapsed : navColumnCollapsed;
  const projectsFolded = navSectionsCollapsed.projects;
  const queuesFolded = fileShown ? navTemp.queuesCollapsed : navSectionsCollapsed.queues;
  const bothOpen = !fileShown && !projectsFolded && !queuesFolded;

  const rootRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (content === null) return;
    if (columnCollapsed) {
      // Focus first, `inert` second (an inert subtree drops its focus).
      if (content.contains(document.activeElement)) stripRef.current?.focus();
      content.setAttribute('inert', '');
    } else {
      content.removeAttribute('inert');
    }
  }, [columnCollapsed]);

  const liveSplit = useCallback(() => {
    const [top, bottom] = bodiesOf(rootRef.current);
    return measureSplitDrag(top, bottom);
  }, []);
  const commitSplit = useCallback(
    (topPx: number) => {
      const [top, bottom] = bodiesOf(rootRef.current);
      const sum =
        (top?.getBoundingClientRect().height ?? 0) + (bottom?.getBoundingClientRect().height ?? 0);
      setNavSplit(pxToSplit(topPx, sum));
    },
    [setNavSplit],
  );

  const queuesTotal = counts.queues ?? 0;
  const projectsTotal = counts.projects ?? 0;
  const split = {
    total: queuesTotal,
    inbox: breakdown?.inbox ?? 0,
    mentions: breakdown?.mentions ?? 0,
    watching: breakdown?.watching ?? 0,
  };
  const stripName = fileShown
    ? t('nav.expandColumnQueuesOnly', split)
    : t('nav.expandColumnWithCounts', { ...split, projects: projectsTotal });

  const style = {
    '--nav-split': String(navSplit),
    ...(columnCollapsed ? {} : { width, flex: `0 0 ${width}px` }),
  } as CSSProperties;

  return (
    <div
      ref={rootRef}
      className="nav-column"
      data-nav-column
      data-collapsed={columnCollapsed ? 'true' : 'false'}
      data-file={fileShown ? 'true' : undefined}
      style={style}
    >
      {columnCollapsed ? (
        <button
          ref={stripRef}
          type="button"
          className="nav-strip"
          aria-expanded={false}
          aria-label={stripName}
          onClick={() => setNavCollapsed(false)}
        >
          {fileShown ? null : (
            <span className="nav-strip-label">
              {t('nav.projects')}
              <span
                className={
                  projectsTotal === 0 ? 'nav-strip-count col-count-empty' : 'nav-strip-count'
                }
              >
                {projectsTotal}
              </span>
            </span>
          )}
          <span className="nav-strip-label">
            {t('nav.queues')}
            <span
              className={queuesTotal === 0 ? 'nav-strip-count col-count-empty' : 'nav-strip-count'}
            >
              {queuesTotal}
            </span>
          </span>
        </button>
      ) : null}
      <div
        ref={contentRef}
        className="nav-column-content"
        aria-hidden={columnCollapsed ? true : undefined}
      >
        <ProjectsColumn
          width={null}
          collapsed={false}
          section={{
            collapsed: projectsFolded,
            onToggle: () => {
              toggleNavSection('projects');
            },
            onCollapseColumn: fileShown
              ? undefined
              : () => {
                  setNavCollapsed(true);
                },
            hidden: fileShown,
          }}
        />
        {bothOpen ? (
          <ResizeHandle
            orientation="horizontal"
            variant="plain"
            label={t('nav.resizeSplit')}
            min={0}
            max={0}
            width={null}
            liveBounds={liveSplit}
            onResize={commitSplit}
            onReset={resetNavSplit}
          />
        ) : null}
        <InboxColumn
          width={null}
          collapsed={false}
          section={{
            collapsed: queuesFolded,
            onToggle: () => {
              toggleNavSection('queues');
            },
            onCollapseColumn: fileShown
              ? () => {
                  setNavCollapsed(true);
                }
              : undefined,
          }}
        />
      </div>
    </div>
  );
}
