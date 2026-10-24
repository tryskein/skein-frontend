import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { IconAlertCircle, IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import { SearchHighlight } from '../../components/SearchHighlight';
import { ProjectInfoButton } from './ProjectInfoButton';
import { highlightMatch } from '../../lib/highlightMatch';
import { useLayoutState } from '../../lib/useLayoutState';
import type { ProjectListItem } from '../../api/projects';

/**
 * One row in the Projects column (F3, Sc3). Two flavours:
 *
 *   1. Real project — `project` is non-null. Renders idPrefix and name,
 *      with `<SearchHighlight>` wrapping match substrings (yellow per
 *      Q9 / Q10), plus right-aligned issue counts.
 *   2. "All projects" pseudo-row — `project === null`. Pinned at top of
 *      the list, slightly bolder/dimmer styling. No handle and no
 *      counts — the title carries the row on its own (sk-406). Click
 *      clears the project selection (Shell shows tasks across all
 *      visible projects, F4 surface).
 *
 * Selection state drives `var(--primary-t)` background + a brand-
 * coloured left stripe via the `.selected` modifier.
 *
 * sk-285.1.2 — the row owns a collapse caret for its component subtree.
 * It is a real `<button>` (keyboard-reachable, `aria-expanded` +
 * `aria-label`), a SIBLING of the row body rather than a child, because
 * HTML forbids nested buttons: clicking the caret must fold the subtree
 * WITHOUT selecting the project. The caret renders only when the parent
 * passes `onToggleCollapsed`; the "All projects" pseudo-row, a project
 * with no components (sk-551.52 — the column omits the callback when
 * `componentsCount === 0`), and any standalone render get an equal-width
 * spacer instead, so every row in the column keeps the same left edge.
 *
 * Hover / selection paint on the `.project-row-shell` wrapper so the
 * brand stripe spans the caret slot too — a stripe on the body alone
 * would start 44px in and read as a stray line.
 *
 * The decorative `•` bullet is gone — the idPrefix handle is enough of a
 * visual anchor.
 */
export interface ProjectRowProps {
  /** null = "All projects" pseudo-row (always pinned to top by parent). */
  project: ProjectListItem | null;
  selected: boolean;
  searchQuery: string;
  onSelect: () => void;
  /**
   * sk-285.1.2 — true when this project's component subtree is folded
   * away. Only meaningful together with `onToggleCollapsed`; default
   * false (expanded).
   */
  collapsed?: boolean;
  /**
   * sk-285.1.2 — flip the subtree. Omit to render the row without a
   * caret (pseudo-row, standalone use); the spacer keeps the alignment.
   */
  onToggleCollapsed?: () => void;
}

export function ProjectRow({
  project,
  selected,
  searchQuery,
  onSelect,
  collapsed = false,
  onToggleCollapsed,
}: ProjectRowProps) {
  const { t } = useTranslation('projects');
  const isPseudo = project === null;
  const displayName = isPseudo ? t('allProjects') : project!.name;

  // outboxMode + onMeMode are the global header lens toggles (mutex
  // upstream — both never ON at the same time). When outboxMode is ON
  // the row swaps to the parallel `myOutbox*Count` fields; when
  // onMeMode is ON it swaps to `onMe*Count`. Both OFF → unscoped
  // `*Count` (the default). sk-30.
  const { outboxMode, onMeMode } = useLayoutState();

  const nameHtml = useMemo(
    () => highlightMatch(displayName, isPseudo ? '' : searchQuery),
    [displayName, searchQuery, isPseudo],
  );
  /**
   * sk-406 — `null` on the pseudo-row, and that is the whole change the
   * owner asked for: "remove all text at the start, one
   * heading is enough". The handle slot carries an IDENTIFIER (a project's
   * `idPrefix`), and the «all projects» surface has none — it is
   * `selectedProject === null` and the URL `/`, so the word `'all'` this
   * used to print was a label pretending to be a key. Nothing reads it:
   * it was a local constant, rendered and never compared.
   *
   * `null` rather than an empty string because the element is dropped
   * entirely — an empty span still spends the row's `gap` and pushes the
   * title off the left edge every other row's text starts from.
   */
  const handleHtml = useMemo(
    () => (project === null ? null : highlightMatch(project.idPrefix, searchQuery)),
    [project, searchQuery],
  );

  const counts = isPseudo
    ? null
    : {
        open: onMeMode
          ? project!.onMeOpenCount ?? 0
          : outboxMode
            ? project!.myOutboxOpenCount
            : project!.openCount,
        inProgress: onMeMode
          ? project!.onMeInProgressCount ?? 0
          : outboxMode
            ? project!.myOutboxInProgressCount
            : project!.inProgressCount,
        blocked: onMeMode
          ? project!.onMeBlockedCount ?? 0
          : outboxMode
            ? project!.myOutboxBlockedCount
            : project!.blockedCount,
        // sk-118 — the Standing aggregate. MUST respect the outboxMode
        // invariant (CLAUDE.md): flip to the outbox-scoped
        // `myOutboxStandingCount` when the Delegated lens (outboxMode) is
        // ON. The On-me lens has no standing counterpart server-side (a
        // perpetual obligation is never "on me" — it's acted on via
        // children), so it reads 0 there and the chip hides.
        standing: onMeMode
          ? 0
          : outboxMode
            ? project!.myOutboxStandingCount ?? 0
            : project!.standingCount ?? 0,
      };

  // Tooltip wraps the body button — it's a stable, leaf-level anchor so
  // Floating UI's position calc doesn't churn on sibling re-renders.
  return (
    <div
      className={`project-row-shell${selected ? ' selected' : ''}${isPseudo ? ' project-row-shell-pseudo' : ''}`}
    >
      {onToggleCollapsed ? (
        <button
          type="button"
          className="project-collapse-toggle"
          aria-expanded={!collapsed}
          aria-label={
            collapsed
              ? t('expandComponents', { name: displayName })
              : t('collapseComponents', { name: displayName })
          }
          onClick={onToggleCollapsed}
        >
          {/* sk-285.7 T027 — 16, the inline step of FR-003 / handoff §8
              ("chevron 16" in §6 "Projects"). It was 14, which is on no
              icon scale the language has. */}
          {collapsed ? (
            <IconChevronRight size={16} stroke={1.75} aria-hidden />
          ) : (
            <IconChevronDown size={16} stroke={1.75} aria-hidden />
          )}
        </button>
      ) : (
        <span className="project-row-caret-spacer" aria-hidden />
      )}
      {/* sk-551.15 — the whole-row hover card is gone (it popped up on
          every row the mouse crossed and covered the Tasks column); the
          project card lives behind the ⓘ at the row's end instead. */}
        <button
          type="button"
          className={`project-row-body${isPseudo ? ' project-row-pseudo' : ''}`}
          aria-label={
            isPseudo ? t('selectAll') : t('select', { name: displayName })
          }
          /*
            sk-285.7.2.40 (audit A4) — «selected» has to be readable
            without seeing the colour.
            Handoff §7: "the state of an interactive element must be
            expressed programmatically". The paint alone (`--primary-t` plus a
            3px `--primary` stripe, both on `.project-row-shell`) says
            nothing to a screen reader, and the label does not either —
            it flips between "select X" and "deselect X", which is the
            NEXT action rather than the current state.

            `aria-pressed`, and not `aria-current`, because the sibling
            row one indent level down — `.component-row-body`, the same
            gesture over the same list — already uses `aria-pressed`.
            Two spellings of one state across two rows of one tree is
            the inconsistency §7 is about; the audit measured 12 stops
            on component rows carrying the attribute and 6 on project
            rows carrying nothing, the SELECTED pseudo-row among them.

            The pseudo-row "All projects" gets it too: it is the row
            that is pressed whenever no project is picked, so leaving it
            out would drop the attribute from exactly the row that most
            often carries `true`.
          */
          aria-pressed={selected}
          onClick={onSelect}
        >
          {handleHtml === null ? null : (
            <span className="project-row-handle">
              <SearchHighlight html={handleHtml} />
            </span>
          )}
          <span className="project-row-name">
            <SearchHighlight html={nameHtml} />
          </span>
          {counts ? (
            <span
              className="project-row-counts"
              aria-label={
                counts.standing > 0
                  ? t('countsAriaWithStanding', counts)
                  : t('countsAria', counts)
              }
            >
              {/*
                sk-368 — handoff §6 "open/prog counters (green/blue)".
                Each number takes the role §3 maps its STATUS to, so the
                pair is colour-coded the way every other status surface
                in the product is. They are two spans rather than one
                string because the colours differ; the separator stays
                in the muted step of the wrapper so the pair still reads
                as one counter. The row's `aria-label` above already
                spells both numbers out, so nothing here is
                colour-only information.
              */}
              <span className="project-row-count-open">{counts.open}</span>
              {' / '}
              <span className="project-row-count-prog">{counts.inProgress}</span>
              {counts.blocked > 0 ? (
                <span className="project-row-blocked-warn" aria-hidden>
                  {counts.blocked}
                  <IconAlertCircle size={16} stroke={1.75} aria-hidden />
                </span>
              ) : null}
              {counts.standing > 0 ? (
                <span
                  className="project-row-standing"
                  title={t('standingTitle', { count: counts.standing })}
                  aria-hidden
                >
                  {' '}∞{counts.standing}
                </span>
              ) : null}
            </span>
          ) : null}
        </button>
      {isPseudo ? null : <ProjectInfoButton project={project!} name={displayName} />}
    </div>
  );
}
