/**
 * sk-421.2.8 T010 (US-1, US-2, US-3, US-6, INV-6, SC-001, SC-002, SC-007,
 * UD-S) — the blockers sub-row under a child row of the epic section.
 *
 * ─── Where it lives (R-10) ─────────────────────────────────────────
 *
 * The component is a SIBLING of the child row, not part of it: a button in a button
 * is invalid, and the sub-row text in the row name would change the accessible name
 * of the row (sk-421.2 SC-013). "List" and "Tree" render it after
 * `EpicChildRow` the same way — so the sub-row looks the same in both
 * modes and at any tree level (US-1).
 *
 * ─── When it is shown ──────────────────────────────────────────────
 *
 * There is ONE predicate and it is defined here — `shouldShowEpicChildBlockers`; the modes
 * cite it, they do not rewrite it. The child is not a stub, the status is non-empty,
 * the shared `isDerivedBlocked` (the server flag and a status that is not "closed" nor
 * "permanent" — the same rule by which the row highlights the status), and
 * the list is non-empty. An old server (no field), an empty list, the field on a
 * closed one — nothing, without an error.
 *
 * ─── Expanding "+N" (R-11) ─────────────────────────────────────────
 *
 * Local state. The rows of both modes are keyed by the child id, so
 * a refetch of the section keeps it, while a mode switch and folding an
 * ancestor unmount the component and reset it. When "+N" disappears (entries become
 * ≤3 or the display is removed) the expansion is reset, and when "+N" comes back the list is
 * folded.
 *
 * ─── An inaccessible entry (INV-6) — an old api only ───────────────
 *
 * A lock and the word "unavailable"; no identifier, no title, no status
 * — neither in the text, nor in attributes, nor in the React key (the key is by position, R-15),
 * nor in the screen reader description. Not a button and not in the focus order.
 *
 * sk-479 (contract sk-423): an api since sk-423 does not send hidden entries at all —
 * a link to a task beyond the reader's horizon is no longer a blocker and arrives as
 * the number `unavailableBlockingLinks` of the node. The hidden-entry branch is kept
 * for an api older than sk-423: there such an entry is included in `item.isBlocked` of the same
 * row, and without it the sub-row would lie about the blockers of the highlighted
 * row. The frontend does not derive the blocked flag from the entries or the number —
 * only `isDerivedBlocked` from the server `item.isBlocked`.
 *
 * ─── The unavailable links sub-row (sk-479) ────────────────────────
 *
 * `EpicChildUnavailableLinks` — a separate sub-row after the blockers
 * sub-row, in the same `li` / `treeitem`: "link to N tasks from inaccessible
 * projects". Not part of the blockers sub-row and without its prefix
 * "blocked:" — this is a fact of a link, not a block; the tone is the same
 * muted. The number is `lib/unavailableLinks.ts#unavailableLinksToShow`:
 * the node field is above zero, the row is visible, not a reference, not closed
 * and not permanent. An old api does not send the field — no sub-row. The screen reader description of
 * the mode row is assembled by `epicChildDescribedBy` — one for both modes.
 *
 * ─── Screen reader (R-16) ──────────────────────────────────────────
 *
 * Visually hidden text with the id from `epicChildBlockersDescriptionId` —
 * the mode row refers to it with `aria-describedby`. Folded: the prefix,
 * three entries and "N more"; expanded: all entries. "+N" is a button with
 * `aria-expanded` and `aria-controls`.
 *
 * ─── Navigation (R-17) ─────────────────────────────────────────────
 *
 * `navigate('/projects/<entry project>/issues/<id>')` — the same path shape
 * as "Blocked" and "Dependencies". NOT `layout.setSelectedIssue`:
 * it carries over the component segment of the current route (sk-421.1 F-3).
 */

import { Fragment, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { IconLock } from '@tabler/icons-react';
import type {
  IssueStatus,
  IssueTreeRowItem,
  TreeBlockerRef,
  TreeBlockerRefVisible,
} from '../../../../api/issues';
import { isDerivedBlocked, statusChipText } from '../../../../components/Attribute';
import { isUnavailableChild } from '../../../../lib/epicChildCategories';
import { unavailableLinksToShow } from '../../../../lib/unavailableLinks';

/** How many entries the sub-row shows before "+N" (US-1). */
const INLINE_LIMIT = 3;

/** Separator of the parts inside an entry. */
const PART_SEP = ' · ';
/** Separator of entries from each other. */
const ENTRY_SEP = ', ';

/**
 * Whether the sub-row is shown for a child row. The only definition of
 * the rule: "List" and "Tree" (T011, T013) ask it, they do not
 * rewrite it.
 */
export function shouldShowEpicChildBlockers(
  item: IssueTreeRowItem,
  isReference: boolean,
  blockers: readonly TreeBlockerRef[] | undefined,
): boolean {
  if (isUnavailableChild(item, isReference)) return false;
  if (item.status === '') return false;
  if (!isDerivedBlocked(item.status, item.isBlocked)) return false;
  return blockers !== undefined && blockers.length > 0;
}

/**
 * id of the visually hidden description of the sub-row — the `aria-describedby` target
 * of the child row. Built from the id of the child ITSELF: it is visible (a stub
 * has no sub-row), and the mode row computes the same id without waiting for
 * the sub-row to render.
 */
export function epicChildBlockersDescriptionId(childId: string): string {
  return `epic-child-blockers-desc-${childId}`;
}

/**
 * sk-479 — how many unavailable links the child row sub-row shows;
 * 0 — no sub-row. A stub and a reference row — 0 (the server does not send them the field
 * anyway, but the rule does not rely on that).
 */
export function epicChildUnavailableLinksCount(
  item: IssueTreeRowItem,
  isReference: boolean,
  unavailableBlockingLinks: number | undefined,
): number {
  if (isReference || isUnavailableChild(item, isReference)) return 0;
  return unavailableLinksToShow(item.status, unavailableBlockingLinks);
}

/** id of the unavailable links sub-row — the second `aria-describedby` target. */
export function epicChildUnavailableLinksId(childId: string): string {
  return `epic-child-unavailable-links-${childId}`;
}

/**
 * sk-479 — the `aria-describedby` of the child row: the description of the blockers sub-row
 * and the unavailable links sub-row, each — when rendered. One for both
 * modes, so that "List" and "Tree" do not diverge. `undefined` — nothing
 * to describe.
 */
export function epicChildDescribedBy(
  item: IssueTreeRowItem,
  isReference: boolean,
  blockers: readonly TreeBlockerRef[] | undefined,
  unavailableBlockingLinks: number | undefined,
): string | undefined {
  const ids: string[] = [];
  if (shouldShowEpicChildBlockers(item, isReference, blockers)) {
    ids.push(epicChildBlockersDescriptionId(item.id));
  }
  if (epicChildUnavailableLinksCount(item, isReference, unavailableBlockingLinks) > 0) {
    ids.push(epicChildUnavailableLinksId(item.id));
  }
  return ids.length > 0 ? ids.join(' ') : undefined;
}

/**
 * sk-479 — the sub-row "link to N tasks from inaccessible projects" under
 * the child row. Not a button, not in the focus traversal; it decides itself
 * whether to render.
 */
export function EpicChildUnavailableLinks({
  item,
  isReference,
  unavailableBlockingLinks,
}: {
  item: IssueTreeRowItem;
  isReference: boolean;
  unavailableBlockingLinks: number | undefined;
}) {
  const { t } = useTranslation('details');
  const count = epicChildUnavailableLinksCount(item, isReference, unavailableBlockingLinks);
  if (count === 0) return null;
  return (
    <div id={epicChildUnavailableLinksId(item.id)} className="epic-child-unavailable-links">
      {/* 16 — the product icon scale; the same "no access" lock. */}
      <IconLock size={16} stroke={1.75} aria-hidden />
      {t('unavailableLinks.row', { count })}
    </div>
  );
}

/** id of the expanded list — the `aria-controls` target of "+N". */
function expandedListId(childId: string): string {
  return `epic-child-blockers-list-${childId}`;
}

/** The place of a sub-row element: the sub-row itself or the expanded list (R-15). */
export type EpicChildBlockersPlace = 'inline' | 'expanded';

/** The key of the "+N" element of a row (R-15: "the '+N' of the same row"). */
export const EPIC_CHILD_BLOCKERS_MORE_KEY = 'more';

function isVisible(entry: TreeBlockerRef): entry is TreeBlockerRefVisible {
  return entry.redacted !== true;
}

/**
 * Entry keys per R-15. A visible one — `id` and the ordinal among entries with
 * the same `id`: `blocks`/`waits-for` duplicates to one task are indistinguishable by
 * content, and the ordinal is equivalent to the link type, while a shift of neighbouring
 * entries does not change the key. A hidden one — position only: its `id` must not
 * get into either the key or the markup (INV-6).
 */
function entryKeys(entries: readonly TreeBlockerRef[]): string[] {
  const seen = new Map<string, number>();
  return entries.map((entry, index) => {
    if (!isVisible(entry)) return `hidden:${index}`;
    const ordinal = seen.get(entry.id) ?? 0;
    seen.set(entry.id, ordinal + 1);
    return `blocker:${entry.id}:${ordinal}`;
  });
}

export interface EpicChildBlockersProps {
  /** A row of the tree response — the child itself. */
  item: IssueTreeRowItem;
  /** A reference row (lives on the node, not on `item`). */
  isReference: boolean;
  /** The `blockers` field of the node; `undefined` — the server did not send it. */
  blockers: readonly TreeBlockerRef[] | undefined;
  /**
   * Whether the sub-row elements are in the sequential traversal: "List" —
   * always, "Tree" — only on the active row (R-12, R-16).
   */
  tabbable: boolean;
  /**
   * A click on any sub-row element — so that "Tree" makes the row
   * active without moving focus. Keyboard activation of the button also
   * arrives here: a native button turns Enter and space into a click.
   */
  onActivate?: () => void;
}

export function EpicChildBlockers({
  item,
  isReference,
  blockers,
  tabbable,
  onActivate,
}: EpicChildBlockersProps) {
  const { t } = useTranslation('details');
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const shown = shouldShowEpicChildBlockers(item, isReference, blockers);
  const entries: readonly TreeBlockerRef[] = shown && blockers ? blockers : [];
  const overflow = entries.length - INLINE_LIMIT;
  const hasMore = overflow > 0;

  // R-11 — "+N" disappeared: the expansion is reset and is not restored when it
  // comes back. The render below would not show the list without
  // "+N" even without the effect (`open` requires `hasMore`); the effect erases the state itself.
  useEffect(() => {
    if (!hasMore && expanded) setExpanded(false);
  }, [hasMore, expanded]);

  if (!shown) return null;

  const open = expanded && hasMore;
  const keys = entryKeys(entries);
  const inline = entries.slice(0, INLINE_LIMIT);
  const linkTabIndex = tabbable ? 0 : -1;
  // With "+N" expanded, entries 1–3 of the sub-row leave the traversal so as not to
  // duplicate the entries of the expanded list, but stay clickable (R-16).
  const inlineLinkTabIndex = open ? -1 : linkTabIndex;

  const openBlocker = (entry: TreeBlockerRefVisible) => {
    onActivate?.();
    navigate(
      `/projects/${encodeURIComponent(entry.projectId)}/issues/${encodeURIComponent(entry.id)}`,
    );
  };

  const toggle = () => {
    onActivate?.();
    if (open) {
      // Folding with the mouse while focus is inside the expanded list: the list
      // is about to disappear together with the focus, so the focus moves to "+N".
      const active = document.activeElement;
      if (active && listRef.current?.contains(active)) moreRef.current?.focus();
      setExpanded(false);
    } else {
      setExpanded(true);
    }
  };

  const unavailable = t('blocked.unavailable');

  const recordText = (entry: TreeBlockerRef, withTitle: boolean): string =>
    isVisible(entry)
      ? [entry.id, ...(withTitle ? [entry.title] : []), statusChipText(entry.status)].join(
          PART_SEP,
        )
      : unavailable;

  const describedEntries = open
    ? entries.map((entry) => recordText(entry, true))
    : [
        ...inline.map((entry) => recordText(entry, false)),
        ...(hasMore ? [t('epic.blockersMoreDescription', { count: overflow })] : []),
      ];
  const description = `${t('epic.blockersPrefix')} ${describedEntries.join(ENTRY_SEP)}`;

  return (
    <div className="epic-child-blockers">
      <div className="epic-child-blockers-line">
        <span className="epic-child-blockers-prefix">{t('epic.blockersPrefix')}</span>{' '}
        {inline.map((entry, index) => (
          <Fragment key={`inline:${keys[index]}`}>
            {index > 0 ? ENTRY_SEP : null}
            {isVisible(entry) ? (
              <span className="epic-child-blocker">
                <button
                  type="button"
                  className="detail-row-link"
                  tabIndex={inlineLinkTabIndex}
                  data-epic-blocker-el={`inline:${keys[index]}`}
                  onClick={() => openBlocker(entry)}
                >
                  {entry.id}
                </button>
                {PART_SEP}
                <StatusChip status={entry.status} />
              </span>
            ) : (
              <span className="epic-child-blocker">
                <UnavailableChip label={unavailable} />
              </span>
            )}
          </Fragment>
        ))}
        {hasMore ? (
          <>
            {' '}
            <button
              ref={moreRef}
              type="button"
              className="detail-row-link"
              tabIndex={linkTabIndex}
              aria-expanded={open}
              // A reference to the expanded list — only while it is rendered: with
              // "+N" folded there is no list in the document, and the id would be dangling
              // (sk-421.2.8 row 48).
              aria-controls={open ? expandedListId(item.id) : undefined}
              data-epic-blocker-el={EPIC_CHILD_BLOCKERS_MORE_KEY}
              onClick={toggle}
            >
              {t('epic.blockersMore', { count: overflow })}
            </button>
          </>
        ) : null}
      </div>

      {open ? (
        <ul
          ref={listRef}
          id={expandedListId(item.id)}
          className="epic-child-blockers-list"
          aria-label={t('epic.blockersList')}
        >
          {entries.map((entry, index) => (
            <li key={`expanded:${keys[index]}`} className="epic-child-blockers-entry">
              {isVisible(entry) ? (
                <>
                  <button
                    type="button"
                    className="detail-row-link"
                    tabIndex={linkTabIndex}
                    data-epic-blocker-el={`expanded:${keys[index]}`}
                    onClick={() => openBlocker(entry)}
                  >
                    {entry.id}
                  </button>
                  {PART_SEP}
                  {/* The title is not truncated — it wraps in full (US-1). */}
                  <span className="epic-child-blockers-title">{entry.title}</span>
                  {PART_SEP}
                  <StatusChip status={entry.status} />
                </>
              ) : (
                <UnavailableChip label={unavailable} />
              )}
            </li>
          ))}
        </ul>
      ) : null}

      <span id={epicChildBlockersDescriptionId(item.id)} className="sr-only">
        {description}
      </span>
    </div>
  );
}

/**
 * The blocker status is the chip value without localization ("in progress"), in
 * the `status-chip` styling, as in "Blocked" (UD-S).
 */
function StatusChip({ status }: { status: IssueStatus }) {
  return (
    <span className="status-chip" data-status={status}>
      <span className="status-chip-dot" aria-hidden />
      {statusChipText(status)}
    </span>
  );
}

/** An inaccessible entry: a lock and a word; the icon is not the only carrier of meaning. */
function UnavailableChip({ label }: { label: string }) {
  return (
    <span className="dep-chip dep-chip--redacted">
      {/* 16 — the product icon scale, the same lock as in "Blocked". */}
      <IconLock size={16} stroke={1.75} aria-hidden />
      {label}
    </span>
  );
}
