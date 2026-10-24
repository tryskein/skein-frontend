/**
 * sk-421.2 T019 (US-2, US-3, R-3, R-7, R-8, INV-7, INV-8, SC-005, SC-017) —
 * the "List" mode of the epic section: direct children of the epic in one level.
 *
 * ─── What is here and what is not ─────────────────────────────────
 *
 * The component owns ONLY the list body: the messages about loading, about
 * the "set too large" refusal, about a load error, and the rows themselves.
 * The counters, the bar and the switch live above, in the section, and stay in place
 * under any of these messages: a refusal to show the rows does not cancel
 * the fact that the numbers are known (INV-7 lists the refusal and the error as explicit
 * exceptions to the identity "rows = summary").
 *
 * ─── The row order is the server's ─────────────────────────────────
 *
 * The list does NOT re-sort: the server already gave the children by the id
 * order rule (US-6), and a second sort on the frontend could diverge from it on
 * the same data. The rows go in the order they came.
 *
 * ─── Unavailable children are shown, not hidden ────────────────────
 *
 * A child from an invisible project is the same list row, only "no
 * access" (R-8). Hiding it would mean that the "unavailable W" tail in the
 * progress row points at children that are nowhere.
 *
 * ─── sk-421.2.8 T011 — the blockers sub-row (US-1, US-6, R-10, R-16) ─
 *
 * Under the row of a child whose blocking is shown there is the sub-row
 * `EpicChildBlockers`, ADJACENT to the row button (not inside it). The
 * single predicate `shouldShowEpicChildBlockers` decides whether to show it; when the
 * predicate is false the sub-row is not mounted at all, and its expansion is reset
 * along with the unmounting (R-11). The row button gets
 * `aria-describedby` to the sub-row description; the accessible name of the row is unchanged.
 * In "List" the sub-row elements are always in the sequential traversal; the row button
 * and the "no access" placeholder too, as in sk-421.2 US-2.
 *
 * ─── Focus memory (R-14, the approach for "List"; sk-444) ───────────
 *
 * The focused element may disappear on a re-read: the blocking display
 * is removed, "+N" is gone, the child is no more, the row moved to another
 * category. By the time of the effect the unmounted button has already given focus to
 * `body`, and `document.activeElement` does not show the loss. So the list
 * remembers the last focused element: a sub-row element (row +
 * key R-15 + the element itself) or a focusable element of the row itself (the child
 * button, the "no access" placeholder; row + the element itself):
 *   - `focusin` on such an element writes the memory, on any other
 *     list element it erases it;
 *   - `focusout` from the remembered element checks lazily: the remembered
 *     element is not active and the memory is not overwritten, so focus left on its own
 *     (for example by a click on a non-focusable area in `body`), and the memory
 *     is erased. A focus loss caused by rendering is repaired by the restore effect
 *     in the same commit, earlier than this check, which is why it is LAYERED
 *     (`useLayoutEffect`);
 *   - on every commit with a new set of rows or a grouping change:
 *     if focus is on the remembered element, it is not touched; if it is lost and stands in
 *     `body`, it goes to the same sub-row element if it is redrawn, otherwise to
 *     the row button of the same child (including one that moved to another
 *     category), and if there is no row, by the shared fallback target rule
 *     of sk-421.2 US-2 (`resolveEpicFocusTarget`): the nearest row above in
 *     the SERVER order (sk-421.3 PK-2 item 3), the first row, and
 *     the switch and "Add child" are handled by the section via
 *     `onFocusFallback`;
 *   - a change of the section's epic erases the memory: the section and the "List" survive a card
 *     change without remounting, and the old memory would carry focus into the new
 *     card.
 */

import {
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type FocusEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { EpicChildRow } from './EpicChildRow';
import {
  EpicChildBlockers,
  EpicChildUnavailableLinks,
  epicChildDescribedBy,
  shouldShowEpicChildBlockers,
} from './EpicChildBlockers';
import { statusChipText, statusFill } from '../../../../components/Attribute';
import { epicChildCategories } from '../../../../lib/epicChildCategories';
import type { IssueTreeNode } from '../../../../api/issues';
import { layeredToFlatRows, type FlatTreeRow } from '../../../../lib/flattenTree';
import { epicRowKeys, resolveEpicFocusTarget } from '../../../../lib/epicRowFocus';

export interface EpicChildrenListProps {
  /** First-level rows in the server order. */
  rows: IssueTreeNode[];
  isLoading: boolean;
  /** The server refused with "too large" (422). */
  tooLarge: boolean;
  /** Any other error loading the rows. */
  error: unknown;
  /** Open the child card by the project of the row ITSELF (F-1). */
  onOpen: (id: string, projectId: string) => void;
  /**
   * sk-421.2.8 T011 — the id of the section's epic: the ancestor of the first-level
   * rows for the fallback target rule and the trigger for resetting the focus memory.
   */
  epicId: string;
  /**
   * sk-421.2.8 T011 — move focus to the fallback target OUTSIDE the list
   * (the mode switch, otherwise "Add child"). These elements live
   * in the section, so the section performs it.
   */
  onFocusFallback?: () => void;
  /**
   * sk-421.3 T06 (US-1) — whether to gather rows into categories per PK-1.
   *
   * Off BY DEFAULT, and this is not caution: with grouping off the
   * markup must match today's letter for letter (SC-003), and
   * the default value is decided by the CONSUMER, the section, which has
   * a memory of the user's choice (there the default is "on", A1).
   */
  grouped?: boolean;
}

/**
 * Non-alphanumeric to an escape sequence, REVERSIBLY.
 *
 * Before, everything non-alphanumeric collapsed into a hyphen (m-10), and this
 * glued different keys into one identifier: `unknown:a-b` and
 * `unknown:a:b` gave one row, and with it two headings with one
 * `id` on the page. The value of an unknown status comes OVER THE WIRE,
 * so the client does not choose it, and "such values do not exist" is not
 * an argument here. Two elements with one `id` break `aria-labelledby`: a screen reader
 * will name both categories by the first heading.
 *
 * The mapping is injective: letters and digits stay themselves, everything else,
 * including `_` and `-`, becomes `_<code>_`, so different inputs give
 * different outputs, and the literal hyphen in the template below cannot coincide
 * with a hyphen from the data.
 */
function escapeForId(raw: string): string {
  return raw.replace(/[^A-Za-z0-9]/g, (ch) => `_${ch.codePointAt(0)!.toString(16)}_`);
}

/** The category heading identifier; the category `ul` refers to it. */
function categoryHeadId(epicId: string, key: string): string {
  return `epic-category-${escapeForId(epicId)}-${escapeForId(key)}`;
}

/**
 * What the list remembers about the last focused element: a sub-row element
 * (R-14) or a focusable element of the row itself (sk-444).
 */
interface ListFocusMemory {
  /**
   * The key of the ROW per sk-421.2 US-2 / PK-2 (`epicRowKeys`), not its id and not
   * its position. An ordinary row is `id:<id>`, a placeholder is "ancestor plus
   * number": the synthetic ids of placeholders are not stable between re-reads
   * (F-22), so the id as a marker does not work in principle.
   */
  rowKey: string;
  /**
   * The sub-row element key per R-15 (`data-epic-blocker-el`); `null` means focus
   * stood on the row itself (sk-444).
   */
  elKey: string | null;
  /** The element itself, to tell "lost by rendering" from "focus left on its own". */
  el: HTMLElement;
}

const BLOCKER_EL_ATTR = 'data-epic-blocker-el';

/** A section row marker (sk-421.3 T02). */
const ROW_ATTR = 'data-epic-row';

/** The section row key on the row itself (sk-421.3 T03). */
const ROW_KEY_ATTR = 'data-epic-row-key';

/** The focusable element of a row: the child button or the "no access" placeholder. */
function rowFocusable(li: Element | null | undefined): HTMLElement | null {
  return li?.querySelector<HTMLElement>('.epic-child-open, .epic-child-no-access') ?? null;
}

/** The sub-row element of row `li` with key `elKey`, if it is rendered. */
function sublineElement(li: Element | null | undefined, elKey: string): HTMLElement | null {
  if (!li) return null;
  for (const el of li.querySelectorAll<HTMLElement>(`[${BLOCKER_EL_ATTR}]`)) {
    if (el.getAttribute(BLOCKER_EL_ATTR) === elKey) return el;
  }
  return null;
}

/**
 * A section row by its key, wherever it lies.
 *
 * By comparing values, not by the `[attr="..."]` selector: the key carries
 * the colons and dots of the task identifier, and building a selector from it
 * would mean introducing escaping rules where they are not needed. The same
 * approach is already used by `sublineElement` above.
 */
function rowElementByKey(root: HTMLElement | null, key: string): HTMLElement | null {
  if (!root || key === '') return null;
  for (const el of root.querySelectorAll<HTMLElement>(`[${ROW_KEY_ATTR}]`)) {
    if (el.getAttribute(ROW_KEY_ATTR) === key) return el;
  }
  return null;
}

export function EpicChildrenList({
  rows,
  isLoading,
  tooLarge,
  error,
  onOpen,
  epicId,
  onFocusFallback,
  grouped = false,
}: EpicChildrenListProps) {
  const { t } = useTranslation('details');
  /**
   * sk-421.3 T03 — the COMMON ROOT of the list, not the single `ul`.
   *
   * The handlers and the row search hang here. Today the root is that very
   * `ul`, so the behaviour does not change; under the PL-1 markup there will be
   * several lists, and everything bound to one `ul` would
   * see exactly one of them: the focus memory would die in all
   * categories except the first. The row key does not cure this half: it
   * answers "which row is this", not "where to look for it".
   */
  const rootRef = useRef<HTMLElement | null>(null);
  const memoryRef = useRef<ListFocusMemory | null>(null);

  const flat = useMemo<FlatTreeRow[]>(() => layeredToFlatRows(rows), [rows]);
  const prevFlatRef = useRef<FlatTreeRow[]>(flat);

  /**
   * Row keys in one pass (T01). The order is the SERVER's, the same one in
   * which the rows come and are drawn; grouping does not change it,
   * and that is why the key stays the same when it is toggled (PK-2).
   */
  const keys = useMemo(() => epicRowKeys(flat, epicId), [flat, epicId]);

  /**
   * The key by the row ITSELF, not by its ordinal number.
   *
   * Under grouping the rows are laid out by category, and a row's number
   * in a category is no longer equal to its number in the set. The "row ->
   * key" correspondence is taken here once, while the order is still the server's.
   *
   * This component accepted the correspondence `rows[i] <-> flat[i]` before
   * (the restore effect indexed the `ul` children by the number from `flat`);
   * here it is only named aloud.
   */
  const keyOf = useMemo(() => {
    const map = new Map<IssueTreeNode, string>();
    rows.forEach((row, index) => map.set(row, keys[index] ?? ''));
    return map;
  }, [rows, keys]);

  // A change of the section's epic erases the memory. The effect is declared BEFORE the rows effect:
  // on the same commit as the epic change it runs first.
  // sk-444 — layered, like the rows effect: a passive one would run AFTER
  // it, and the old card's memory would manage to carry focus to a row of the new one.
  useLayoutEffect(() => {
    memoryRef.current = null;
  }, [epicId]);

  // sk-444 — layered, not passive: see "Focus memory" in the file header.
  useLayoutEffect(() => {
    // First load: there are no rows yet, nothing to judge; the previous set
    // stays the reference until the new one arrives.
    if (isLoading) return;
    const prev = prevFlatRef.current;
    prevFlatRef.current = flat;

    /**
     * sk-421.3 T08 — the ORDER OF CHECKS, and it is the heart of the matter here.
     *
     * Before, the early exit `prev === flat` stood first: "the set of rows did not
     * change, so there is nothing to do". Grouping breaks this reasoning:
     * toggling it does NOT change the set of rows (the same `rows`, `flat` is
     * the same reference from `useMemo`), but the rows move to other `ul`s,
     * React unmounts the subtrees, and the sub-row element that
     * had focus disappears. The memory then stayed hanging with a
     * detached element and fired on the NEXT real
     * re-read: focus moved late, in the middle of someone else's
     * action.
     *
     * Comparing the sets answers the question "did the data change" and has no
     * right to decide for it the question "is the element that had focus alive".
     * These are two different questions, and one used to answer both. So
     * the second is handled FIRST, and there is no early exit on set equality
     * any more at all.
     *
     * The second trigger alone (adding grouping to the dependencies)
     * would NOT have been enough: the effect would rerun and hit the same early
     * exit. Both halves are needed, and the second is this one.
     */
    const memory = memoryRef.current;
    // sk-444 — not "the node is detached" but "focus left it": moving a row
    // to another category and a reorder also drop focus, although the node
    // may stay in the document.
    if (!memory || document.activeElement === memory.el) return;
    memoryRef.current = null;
    // Focus already stands on something real: the user or other code put it there;
    // it must not be taken away.
    const active = document.activeElement;
    if (active && active !== document.body) return;

    const root = rootRef.current;
    // The row is searched BY KEY, not by an index among the container's children:
    // a row's position among the display nodes is not its marker (PK-2 item 1).
    if (keys.includes(memory.rowKey)) {
      const li = rowElementByKey(root, memory.rowKey);
      const target =
        (memory.elKey === null ? null : sublineElement(li, memory.elKey)) ?? rowFocusable(li);
      target?.focus();
      return;
    }

    // The child's row is gone: the shared fallback target rule. The keys
    // of the previous set are computed by the same rule, so "the same row"
    // means the same thing on both sides of the re-read.
    const prevIndex = epicRowKeys(prev, epicId).indexOf(memory.rowKey);
    const target = resolveEpicFocusTarget({
      prevRows: prev,
      prevIndex,
      nextRows: flat,
      epicId,
      // The switch lives in the section; whether it exists is decided by the section in
      // `onFocusFallback`; it is enough to hand it the request from here.
      hasSwitcher: true,
    });
    if (target.kind === 'row') {
      const focusable = rowFocusable(rowElementByKey(root, keys[target.index] ?? ''));
      if (focusable) {
        focusable.focus();
        return;
      }
    }
    onFocusFallback?.();
    // `grouped` is the second trigger (T08): toggling grouping does not change the set of
    // rows, so without it the effect simply would not run on it.
    // It works only together with the order of checks above.
  }, [flat, keys, grouped, isLoading, epicId, onFocusFallback]);

  const handleFocusIn = (e: FocusEvent<HTMLElement>) => {
    const root = rootRef.current;
    const target = e.target as HTMLElement;
    const blockerEl = target.closest<HTMLElement>(`[${BLOCKER_EL_ATTR}]`);
    if (!root || !blockerEl || !root.contains(blockerEl)) {
      // sk-444 — focus on the row itself: the child button or the placeholder.
      const rowEl = target.closest<HTMLElement>(`[${ROW_ATTR}]`);
      const rowKey = rowEl?.getAttribute(ROW_KEY_ATTR) ?? null;
      memoryRef.current =
        root && rowEl && root.contains(rowEl) && rowKey !== null && rowFocusable(rowEl) === target
          ? { rowKey, elKey: null, el: target }
          : null;
      return;
    }
    // The key is read from the NEAREST ancestor row. Before, this climbed
    // to a direct child of `ul` and took the row by its index, that is it
    // identified the row by position, and an extra wrapper level (grouping)
    // would point at someone else's row or at none.
    const rowEl = blockerEl.closest<HTMLElement>(`[${ROW_ATTR}]`);
    const rowKey = rowEl?.getAttribute(ROW_KEY_ATTR) ?? null;
    const elKey = blockerEl.getAttribute(BLOCKER_EL_ATTR);
    if (!rowEl || !root.contains(rowEl) || rowKey === null || elKey === null) {
      memoryRef.current = null;
      return;
    }
    memoryRef.current = { rowKey, elKey, el: blockerEl };
  };

  const handleFocusOut = (e: FocusEvent<HTMLElement>) => {
    const memory = memoryRef.current;
    if (!memory || e.target !== memory.el) return;
    // Lazily: a focus loss caused by rendering and a departure by the user's will both
    // look like `focusout`. The layered effect repairs the first in the same
    // commit, that is earlier than this check (sk-444).
    setTimeout(() => {
      if (memoryRef.current === memory && document.activeElement !== memory.el) {
        memoryRef.current = null;
      }
    }, 0);
  };

  if (isLoading) {
    return <div className="col-empty">{t('epic.loadingChildren')}</div>;
  }

  if (tooLarge) {
    // Its own label, not the shared `tasks:treeTooLarge`: that one advises narrowing the
    // set of filters, while the epic card has no filters, so the advice would be
    // impossible to follow. Here a fact is reported.
    return (
      <div className="col-empty col-error" role="alert" aria-live="polite">
        {t('epic.tooLargeList')}
      </div>
    );
  }

  if (error) {
    // W6 — role="alert" + aria-live="assertive", so that a screen reader announces
    // the failure the moment the area appears.
    return (
      <div className="col-empty col-error" role="alert" aria-live="assertive">
        {t('epic.loadChildrenFailed')}
      </div>
    );
  }

  if (rows.length === 0) return null;

  /**
   * One list row. Shared by both grouping modes deliberately:
   * two copies of this markup would diverge at the first edit, and then
   * "off means as today" (SC-003) would stop being true by itself rather
   * than by someone's decision.
   *
   * The key is taken by the ROW, not by its position in the category: under
   * grouping the position is different, and the key must stay the same (PK-2
   * item 1); the focus memory on toggling rests on that.
   */
  const renderRow = (row: IssueTreeNode) => {
    const showBlockers = shouldShowEpicChildBlockers(
      row.item,
      row.isReference,
      row.blockers,
    );
    return (
      // sk-421.3 T02 — `data-epic-row` identifies a SECTION ROW without depending
      // on whose direct child it turned out to be.
      <li key={row.item.id} data-epic-row="" data-epic-row-key={keyOf.get(row) ?? ''}>
        <EpicChildRow
          item={row.item}
          isReference={row.isReference}
          onOpen={onOpen}
          describedBy={epicChildDescribedBy(
            row.item,
            row.isReference,
            row.blockers,
            row.unavailableBlockingLinks,
          )}
        />
        {/* INV-3 — the sub-row stays in THE SAME `li` as the row.
            A category wraps a group of `li`s and does not break the pair
            "row + sub-row". */}
        {showBlockers ? (
          <EpicChildBlockers
            item={row.item}
            isReference={row.isReference}
            blockers={row.blockers}
            tabbable
          />
        ) : null}
        {/* sk-479 — the unavailable-links sub-row: after the blockers
            sub-row, in the same `li`; a link fact, not a blocking. */}
        <EpicChildUnavailableLinks
          item={row.item}
          isReference={row.isReference}
          unavailableBlockingLinks={row.unavailableBlockingLinks}
        />
      </li>
    );
  };

  // Grouping is off — exactly today's markup (SC-003).
  if (!grouped) {
    return (
      <ul
        ref={(el) => {
          rootRef.current = el;
        }}
        className="epic-children-list"
        onFocus={handleFocusIn}
        onBlur={handleFocusOut}
      >
        {rows.map(renderRow)}
      </ul>
    );
  }

  return (
    <div
      ref={(el) => {
        rootRef.current = el;
      }}
      className="epic-children-groups"
      onFocus={handleFocusIn}
      onBlur={handleFocusOut}
    >
      {epicChildCategories(rows).map((category) => {
        // The label of a STATUS category is taken from the shared `statusChipText`
        // (PL-9): it already turns `in_progress` into "in progress", and
        // a second spelling rule must not be made (INV-1, SC-005).
        // "Unavailable", "no status" and the accessible name of the heading
        // are localized; neither has anything to print as a value.
        const label =
          category.kind === 'status'
            ? statusChipText(category.status)
            : category.kind === 'unknown'
              ? category.value
              : category.kind === 'nostatus'
                ? t('epic.categoryNoStatus')
                : t('epic.categoryUnavailable');
        const headId = categoryHeadId(epicId, category.key);
        return (
          <div className="epic-category" key={category.key}>
            {/* The heading is NOT a traversal point (SC-010): the screen reader reads it
                through the list's `aria-labelledby`, not through its own tabIndex.
                The accessible name carries the label AND the counter (R-7, m-7). */}
            <div
              className="epic-category-head"
              id={headId}
              aria-label={t('epic.categoryAria', {
                label,
                count: category.rows.length,
              })}
              /* sk-460.4 (PL-2, INV-6, SC-006) — the tone carrier moved from the
                 dot to the HEADING, because the tone is now carried by TWO
                 elements: the dot (as background) and the label (as colour). The property
                 is inherited downwards, so one declaration on the ancestor
                 feeds both, while two declarations on two children would be
                 two answers to one question.

                 The condition did not change and cannot change: the tone is set
                 ONLY for a status category. `unknown`, `nostatus` and
                 `unavailable` have no status at all, so there is nothing to ask the map
                 about, and the tagged union will not let one forget it. Without
                 a carrier the dot is not drawn, and the label takes the rule's fallback
                 value and stays neutral. */
              style={
                category.kind === 'status'
                  ? ({
                      '--epic-mark': `var(${statusFill(category.status)})`,
                    } as CSSProperties)
                  : undefined
              }
            >
              {/* The tone carrier is ONLY on a status category (m-9).
                  Before, the dot was drawn unconditionally, including for
                  "unavailable", "no status" and the tail ones, to which INV-6
                  forbids a colour carrier: an empty carrier waiting for a
                  tone is a place where a tone will one day be put.

                  sk-421.3 T13 (PL-2, INV-6, SC-006) — the tone arrived, and
                  arrived THE SAME way as the "Tree" row mark:
                  by calling the shared `statusFill` map, via the custom
                  property `--epic-mark`, without a single selector
                  keyed by the status value. The map can be asked
                  only on the `status` branch: `unknown`, `nostatus` and
                  `unavailable` have no status at all, and forgetting this
                  is impossible: the tagged union will not let it compile.

                  This is exactly why the carrier is conditional. Painting "unavailable"
                  or a tail one with a neutral tone "just in case"
                  would mean saying with colour what the map does not say:
                  on an unknown value it answers `--ink-2`, the same
                  tone as for `deferred`, that is it would paint someone else's
                  status (PL-3). After sk-460.9 `closed` answers
                  `--ink-3`, and one coincidence is left; the argument is no
                  weaker for that, because it is about the absence of a call, not about
                  a difference of answers. The absence of a carrier is an answer, not an
                  omission. */}
              {category.kind === 'status' ? (
                /* sk-460.4 — the dot takes its tone from the HEADING (inheriting
                   `--epic-mark`), so it has no declaration of its own
                   any more. The display condition is as before and stays here:
                   the carrier is on a status category, the others have none. */
                <span className="epic-category-dot" aria-hidden />
              ) : null}
              <span className="epic-category-label">{label}</span>
              <span className="epic-category-count">{category.rows.length}</span>
              <span className="epic-category-rule" aria-hidden />
            </div>
            <ul className="epic-children-list" aria-labelledby={headId}>
              {category.rows.map(renderRow)}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
