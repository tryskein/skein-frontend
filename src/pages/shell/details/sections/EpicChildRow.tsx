/**
 * sk-421.2 T018 (US-2 "row view", R-8, SC-010, SC-016, F-1, F-20) —
 * ONE epic section row for both modes, "List" and "Tree".
 *
 * The modes answer one question, "who are the children of this epic", and must
 * draw the row the same way (R-8). So there is one row here, and the modes
 * differ only in what surrounds it: level indentation and collapsing
 * in "Tree", a flat list in "List".
 *
 * ─── The blocked marker is drawn SEPARATELY from the status ───────
 *
 * The shared status chip can replace the status with the word `blocked` if it
 * is given `isBlocked`
 * (`Attribute.tsx#derivedBlocked ? 'blocked' : props.value`). Here this is
 * forbidden (F-20): under the tails of the progress row "in progress A" and "deferred Z"
 * there must be rows WITH SUCH statuses, not rows whose
 * status is replaced. So the chip gets the task's own status and does NOT
 * get `isBlocked`, and the blocked marker is drawn next to it as a separate
 * element available to a screen reader.
 *
 * The row does NOT redefine the rule "when a row counts as blocked":
 * it ASKS the shared `isDerivedBlocked` (blocked
 * if there is a blocker and the status is neither "closed" nor "standing"). Rewriting
 * the condition here would mean making a second copy of the rule, which sooner or
 * later diverges from the first, exactly what the `isDerivedBlocked` docblock
 * warns against. The shared chip component does not change: it is read by
 * the Tasks column and the kanban (F-20).
 *
 * ─── The chip prints ONLY a value the client knows ────────────────
 *
 * sk-463 (PK-2 item 1) — the chip gets a status only when the value
 * is among the known five (`isKnownEpicChildStatus`). The reason is the same
 * as why "Tree" does not paint the left edge mark: the shared `statusFill` map
 * answers anything with a default branch, and that answer
 * (`--ink-2`) coincides with the tone of the known status `deferred`, so
 * called for a foreign value it would paint it with the tone of a known one.
 *
 * sk-460.9 separated `deferred` and `closed` (`--ink-2` versus `--ink-3`), and
 * the overlap with the default branch narrowed from two statuses to one,
 * but did NOT disappear, and the requirement did not weaken one bit. The rule
 * here is built on the map not being called for a foreign value
 * AT ALL, not on its answers being pairwise distinct.
 *
 * What is muted is the MAP'S TONE, not the information: the value that came over the wire
 * is printed by the row, just as "List" prints the label of a tail
 * category without drawing a carrier dot for it. Not calling the map is
 * an answer, not an omission; but a word always has a colour, and which one it is
 * is decided by the foreign value's own neutral rule (sk-476, the paragraph
 * below), not by inheritance.
 *
 * ─── The SHAPE of the status carrier depends on the mode (sk-460.10) ──
 *
 * The design draws the status differently on the two boards: in "List" it is a pill,
 * in "Tree" a plain coloured
 * WORD without a pill next to the type chip. Hence the fork on `treeMode`.
 *
 * The SHAPE changes, not the encoding: in both shapes the tone comes from one
 * shared map (`statusFill`), and no second map is made next to it. The
 * sk-463 rule applies LITERALLY the same as for the chip: only the
 * known-value branch calls the map (PK-2 item 1, INV-6, SC-006).
 *
 * sk-476 — "do not call the map" turned out to be half of the ban. Before, here stood
 * "a foreign value is printed WITHOUT a tone, it has no tone carrier
 * at all", but text always has a colour: without a rule of its own the foreign
 * word inherited the section body's `--ink-2`, which is the map's answer for
 * `deferred`, and on screen matched it byte for byte. So a
 * foreign value now has ITS OWN neutral tone, `--ink`, the only
 * neutral text role outside the set of the map's answers, and the same font size
 * as a known one in both modes. They are set by the stylesheet rule
 * (`index.css#.epic-child-foreign`), not by calling the map: the rule has no
 * input through which a value could pick a tone for itself, so
 * the ban on a false colour still holds by construction. The derivation of the role and the reason
 * "tone, not shape" are recorded there too.
 *
 * The pill goes away, while the MARKERS stay. A standing task keeps "∞" and
 * both of its labels, a blocked one its extended name: these are channels
 * ON TOP of colour, and removing them along with the pill would pay for
 * the shape with meaning. The labels are the same ones the shared chip reads; no second
 * text about the same fact is made.
 *
 * ─── An unavailable task is recognised NOT by the title ───────────
 *
 * The placeholder predicate here is membership in the unavailable set:
 * a reference row with EMPTY status and type (INV-2). The row does not rely on the
 * `<hidden>` title (R-4, F-6), unlike the tree row of
 * the Tasks column (`TaskTreeNode.tsx#item.title === '<hidden>'`), which
 * historically looks at the
 * title. The divergence is deliberate: a visible task with a title
 * matching the placeholder text must remain an ordinary row.
 *
 * ─── "No access" is focusable but not announced as a button ───────
 *
 * A keyboard and screen reader user must reach these rows: the tail
 * "unavailable W" points at them. But promising an action that does not exist is
 * worse than silence, so the row is NOT a button or a link: `role="group"` +
 * `aria-label` + `tabIndex={0}` is the same approach as DetailBlock in
 * ActivitySection. A disabled button would not do: a screen reader still
 * announces it as a button, just an unavailable one.
 */

import { useTranslation } from 'react-i18next';
import {
  Attribute,
  isDerivedBlocked,
} from '../../../../components/Attribute';
import { IssueIDBadge } from '../../../../components/IssueIDBadge';
import { closeOutcomeLabelKey, isDoneOutcome } from '../../../../lib/closeOutcome';
import { branchFillPercent } from '../../../../lib/epicBranchFill';
import { progressCaption, progressNumbers } from '../../../../lib/progressNumbers';
import {
  isKnownEpicChildStatus,
  isUnavailableChild,
} from '../../../../lib/epicChildCategories';
import type { IssueTreeRowItem } from '../../../../api/issues';

export interface EpicChildRowProps {
  /** A tree response row: status and type may be empty (INV-2). */
  item: IssueTreeRowItem;
  /**
   * A reference row. Lives on the response NODE (`IssueTreeNode.isReference`),
   * not on `item`, so it comes as a separate prop.
   */
  isReference: boolean;
  /**
   * Open the card of this task. Takes the project of the row ITSELF: a child
   * may lie in another visible project, and opening it by the project
   * selected in the shell is an error (F-1).
   */
  onOpen: (id: string, projectId: string) => void;
  /**
   * sk-421.2 T020 — whether to print the type chip. Yes by default.
   *
   * sk-460.13 — today BOTH modes print the type (the design draws the chip in
   * both "List" and "Tree"), and nobody switches the prop off. It stays not "just
   * in case": it is the only handle with which a mode can remove the
   * field WITHOUT making a second row markup, and a second markup
   * would diverge from the first at the first edit. The differential guard
   * in the row suite keeps both halves of the handle working.
   */
  showType?: boolean;
  /**
   * sk-421.2.8 T011 (R-16) — id of the blockers sub-row description. The row button
   * gets `aria-describedby`: a screen reader announces the sub-row as a DESCRIPTION after
   * the row name, while the accessible name (`epic.openChild`) does not change.
   */
  describedBy?: string;
  /**
   * sk-421.2.8 T012 (sk-441, UD-T, R-12) — the row lives inside a `treeitem`
   * of the "Tree" mode. There is one sequential traversal point there, the
   * `treeitem` itself with `tabIndex 0` (and the sub-row elements of the active row,
   * T013); so the row button gets `tabIndex -1`, and the "no
   * access" placeholder carries no `tabIndex` at all: arrow keys reach it as a
   * `treeitem`. By default (`false`) it is the "List" mode: the button and the placeholder
   * stay in the traversal, as in sk-421.2 US-2.
   */
  treeMode?: boolean;
  /**
   * sk-421.2.8 T012 (R-16) — id of the row root (for the placeholder, of the
   * placeholder itself). Needed by T013: the `treeitem` gets `aria-labelledby` to
   * today's name sources, and the row is one of them. It is put on the
   * root, not on a wrapper outside: a wrapper would break the row's flex
   * layout.
   */
  id?: string;
}

export function EpicChildRow({
  item,
  isReference,
  onOpen,
  showType = true,
  describedBy,
  treeMode = false,
  id,
}: EpicChildRowProps) {
  const { t } = useTranslation('details');

  if (isUnavailableChild(item, isReference)) {
    const label = t('epic.noAccess');
    return (
      <span
        id={id}
        // The row class is the EXISTING `.epic-children-row`, not its own:
        // flex, gap and `font-size: var(--font-base)` hang on it
        // (`index.css#.epic-children-row`), and `.epic-child-open` takes
        // `font: inherit`
        // exactly from here; the argument about the target size rests on this chain
        // (WCAG 2.5.8).
        // Its own parallel class would leave the row unstyled and quietly
        // make that argument wrong.
        //
        // There is deliberately no BEM-style `--` modifier here: `--no-access`
        // would read as a rule about the VALUE `no-access`,
        // which is not in the value registry and must not be.
        className="epic-children-row epic-child-no-access"
        role="group"
        aria-label={label}
        // sk-441 — in "Tree" the placeholder is not a traversal point: focus is held by
        // the `treeitem`, and arrow keys reach the placeholder.
        tabIndex={treeMode ? undefined : 0}
      >
        {label}
      </span>
    );
  }

  // Narrowed by VALUE: the status chip has the closed union `IssueStatus`,
  // while the row's status may be empty. A type cast here would be
  // a claim about the wire that is not there.
  const status = item.status === '' ? null : item.status;
  const type = item.type === '' ? null : item.type;

  // The status value AS IT CAME. A separate binding is needed not
  // for looks: the type promises the closed union `IssueStatus`, and for TS
  // the analysis here is already exhausted, while on the wire anything happens (a server
  // newer than the client is routine). The runtime check must see
  // a string, otherwise it has nothing to check by types.
  const wireStatus: string = item.status;
  const blocked = status !== null && isDerivedBlocked(status, item.isBlocked);

  // sk-460.10 — a standing task printed as a WORD, not a pill.
  //
  // In "List" the shared chip draws both of its labels; in "Tree" there is no chip
  // any more, and the labels must be taken over by whoever replaced it, otherwise
  // removing the pill would take with it a marker that has nothing to do
  // with colour. The place for them already exists: the status wrapper carries in just the same way
  // the extended name of a blocked row.
  const standingWord = treeMode && wireStatus === 'standing';

  // sk-421.3 T09 (US-3, deviation 7) — the visual language of the title.
  //
  // The shape is decided HERE, from the status value, exactly as the shared
  // chip already does (`Attribute.tsx#strike: display === 'closed'`), and
  // arrives as a class whose selector does NOT carry the value. Otherwise the stylesheet
  // would get a rule keyed by the status value, that is a second encoding
  // map next to the shared one.
  //
  // sk-460.11 — a closed one carries BOTH channels: SHAPE (strikethrough) and
  // TONE (dimming), as in the design
  // (`design0.jsx#titleColor: status === 'closed'`). Before, it carried only
  // the shape, and the ground was the wording "dimming is not forbidden but
  // not required either", that is the ABSENCE of a requirement, not a
  // reason to diverge from the design; the decision "the design wins" (sk-460.8)
  // cancelled such a ground.
  //
  // There are TWO dimmings, and they are DIFFERENT: a deferred one takes `--ink-2`, a closed
  // one `--ink-3`, a step lower. The order is taken from the design, which draws
  // a closed one LIGHTER than a deferred one (`#8a857c` versus `#6b6760`), and it
  // holds INV-9: dim both with one tone and telling the two states apart
  // would be left to the strikethrough alone.
  const struckTitle = status === 'closed';
  const dimmedTitle = status === 'deferred';
  // THE SAME predicate as for the strikethrough, but a DIFFERENT channel, and so its own
  // name. The channels are checked separately (INV-9), while one class carrying
  // both shape and tone would hide from the guard which of the two vanished.
  const fadedTitle = status === 'closed';

  // sk-489 T017 (US-7, INV-2, SC-008) — the OUTCOME MARK of a dropped child.
  //
  // ─── Why the mark is textual ───────────────────────────────────────
  //
  // A closed row already carries two channels, strikethrough and dimming
  // (the paragraph above), but both say "closed", not "how it ended".
  // A done child and a dropped one are indistinguishable today, and that is exactly
  // what US-7 forbids: distinguishability is required "not only by colour", that
  // is, TEXT must become the third channel. It also settles the second
  // half of the requirement, the accessible name: the word lies in the row, and the name
  // of a "Tree" row is assembled from its content
  // (`EpicChildrenTree.tsx#rowLabelId`), while in "List" the whole row
  // is read by a screen reader as the content of its `li`. So the mark has NO
  // `aria-label` of its own: its own text gives it the name, and a second voice
  // about one fact would be read by a screen reader as two, the same reason the
  // branch segment is hidden.
  //
  // ─── The display rule is the same as the card header's ─────────────
  //
  // "Done" is silent: the word "closed" next to it is already read as done,
  // and a label would repeat the status (US-7). A known value is printed
  // as a label, an UNFAMILIAR one as the string itself, without a tone and without being counted
  // among the dropped (INV-2, precedent: a foreign status two paragraphs below).
  // Both decisions are made by the shared primitives of `lib/closeOutcome.ts`
  // (`#isDoneOutcome`, `#closeOutcomeLabelKey`), the same ones the header
  // control assembles its label with
  // (`CloseOutcomeControl.tsx#shown`). That does not make it a copy of the rule:
  // a copy would be a second value table, and there is none here or there:
  // the list and the question "is the value known" live in one module.
  //
  // There is deliberately no STATUS condition here. An outcome exists if and only if
  // the task is closed (INV-1), and the server holds that; check
  // the status here too, and a row for which the api violated the invariant
  // would silently stay quiet instead of showing the value that came.
  const outcomeLabelKey = closeOutcomeLabelKey(item.closeOutcome);
  const outcomeMark =
    typeof item.closeOutcome === 'string' &&
    item.closeOutcome !== '' &&
    !isDoneOutcome(item.closeOutcome)
      ? outcomeLabelKey
        ? t(outcomeLabelKey)
        : item.closeOutcome
      : null;

  // sk-421.3 T14 (US-5, R-6, INV-7) — the share of closed out of the NODE summary's total.
  //
  // The frontend computes NOTHING: both numbers come in `item.epicProgress`,
  // and the only arithmetic here is the share for the segment width, that is
  // a conversion of the given numbers to percent, not counting them over rows.
  //
  // The meaning of the numbers is the progress of the COUNTED DIRECT children of the node, not
  // the completeness of the subtree: a nested epic with a single closed
  // direct child prints "1/1" even if an open grandchild hangs under that child.
  // Neither the label nor the styling claims branch completeness, so
  // the segment is one and has no label of its own.
  //
  // sk-421.3 T14a (PL-6a) — "nor the styling" is held by the EDGE RULE, not
  // by rounding. Before, here stood `Math.round(closed / total * 100)`,
  // and at 199 of 200 it gave 100: the bar was filled completely for an epic with
  // a live unclosed child, that is the styling claimed exactly
  // what is forbidden two paragraphs above. The rule lives in a separate module and
  // a separate function from the rule for PRINTING the percent in the ring: the branch
  // has no text, there is one meaning carrier here, the width, and clamping it
  // after the ring's pattern is not allowed (m-16).
  //
  // A zero total: there is no segment at all (nothing to divide by), and the two numbers
  // stay on screen in the former form. This is decided by the rule ITSELF, answering
  // "no segment" with a separate value, not by a second comparison with zero
  // here.
  //
  // sk-489 T016 (US-6, INV-5) — the share is computed from the PROGRESS DENOMINATOR,
  // not from the total: children closed without work are subtracted from it by the server.
  // It is read in one place, `lib/progressNumbers.ts`, the same one the
  // card chip and the tree cell read: one rule for three surfaces.
  const progress = item.epicProgress ?? null;
  const numbers = progress !== null ? progressNumbers(progress) : null;
  const branchPercent = numbers !== null ? branchFillPercent(numbers) : null;
  // sk-540.3 — the caption form (pair, pair + excluded tail, or the
  // empty-denominator caption) comes from the same rule as the list card
  // chip and the tree cell: `progressCaption`.
  const caption = numbers !== null ? progressCaption(numbers) : null;

  return (
    <span id={id} className="epic-children-row">
      <button
        type="button"
        className="epic-child-open"
        // sk-441 — in "Tree" the button is clickable but not a traversal point.
        tabIndex={treeMode ? -1 : undefined}
        onClick={() => onOpen(item.id, item.projectId)}
        aria-label={t('epic.openChild', { id: item.id, title: item.title })}
        aria-describedby={describedBy}
      >
        <IssueIDBadge id={item.id} copyable={false} />
        {/* sk-421.3 T14 — the title COLUMN: the title, and under it the
            branch indicator (geometry m-15). The column exists for the
            indicator: the row itself is a flex ROW, and without it the bar
            would stand to the right of the title, not under it. */}
        <span className="epic-child-titlecol">
          <span
            className={
              'epic-child-title' +
              (struckTitle ? ' epic-child-struck' : '') +
              (fadedTitle ? ' epic-child-faded' : '') +
              (dimmedTitle ? ' epic-child-dimmed' : '')
            }
          >
            {item.title}
          </span>
          {/* The segment is HIDDEN from the screen reader deliberately: the numbers next to it are already
              spoken in words, and a second voice about one fact would be read by a screen reader as
              two. It must also carry no text at all: the accessible name
              of a "Tree" row is assembled from its content and is pinned by
              the reference (`EpicChildrenTree.test.tsx`). */}
          {branchPercent !== null ? (
            <span className="epic-child-branch" aria-hidden>
              <span
                className="epic-child-branch-fill"
                style={{ width: `${branchPercent}%` }}
              />
            </span>
          ) : null}
        </span>
      </button>

      {/* The blocked marker is SEPARATE from the status value: the chip prints
          the task's own status, while the blocking lives in an EXTENDED
          accessible name. This needs no new labels: the existing
          `header.statusAriaBlocked` and
          `header.statusTitleBlocked` are used, the same ones the header reads; making
          a second text for the same fact would mean making a second copy,
          which would diverge from the first.

          ⚠ There are THREE channels, not two, and the third appeared late (sk-466).
          For a long time the rules `.epic-child-status` and
          `.epic-child-status.is-blocked` were NOT in the stylesheet AT ALL:
          the class was put on the element and checked by a test, but painted
          nothing, and a sighted user who does not hover never saw the marker.
          By the maintainers' decision the section got a VISIBLE channel, a
          dashed `--err` border around the status carrier
          (`index.css#.epic-child-status.is-blocked`), after the pattern of the header
          outline (`index.css#.header-status.is-blocked`) and of the blockers
          section title (`index.css#.blocked-by-title`).

          It is drawn AROUND the carrier, not instead of the value: the chip
          still prints the task's own status (F-20). The border
          is reserved transparent on an unblocked row too, so
          nothing jumps when the state changes, and the dashing is not a
          decoration but a non-colour duplicate: under forced-colors the tone
          is replaced with a system one, and the border pattern tells the states apart.

          `EpicChildRow.test.tsx#a blocked row lights the marker`
          proves that the class reaches the element and the status stays
          its own. The tone and its distinctness from both mutings
          are no longer checked automatically: sk-540.10 removed the
          contrast test (the project guidelines).
          The former argument, `EpicChildRow.test.tsx#closed and standing do not light the marker`,
          requires the class to be ABSENT on a closed and a standing one and so
          is not a guard of the marker itself: it is green even without painting. */}
      {status !== null ? (
        <span
          className={`epic-child-status${blocked ? ' is-blocked' : ''}`}
          aria-label={
            blocked
              ? t('header.statusAriaBlocked', { status })
              : standingWord
                ? t('common:attributes.standingAria')
                : undefined
          }
          title={
            blocked
              ? t('header.statusTitleBlocked', { status })
              : standingWord
                ? t('common:attributes.standingTitle')
                : undefined
          }
        >
          {/* sk-463 (PK-2 item 1, INV-6, SC-006) — a chip ONLY for a
              value the client knows.

              The shared `statusFill` map answers `--ink-2` for `deferred` and
              the same paint, the default branch, for anything else
              (after sk-460.9 `closed` moved to `--ink-3`, but the default
              branch stayed in place). So a chip called for a
              foreign value paints it with the tone of a known status, and
              PK-2 item 1 forbids this to the chip exactly as to the mark.
              The mark already complies
              (`EpicChildrenTree`: for an unknown value `statusFill`
              is NOT called AT ALL), and before sk-463 half of the requirement was
              met, yet the screen still told an untruth.

              It is fixed HERE, not in the map: `statusFill` is the product's shared map,
              read by the tasks column, the kanban and the card header,
              and a separate answer for an unknown value would change them
              all at once. That decision is made by the owner, not by this edit.
              The section does have a precedent of its own choice: it just as
              deliberately does not use the substitution with `blocked` that the
              shared chip can make (F-20, the paragraph above).

              The value is printed as it came, without `statusChipText`: the label of
              the "List" tail category is likewise taken raw.
              The writing rule (`in_progress` -> "in progress") is about the
              known contract values, and extending it to a foreign
              value would mean rewriting someone else's string to our own pattern. */}
          {isKnownEpicChildStatus(wireStatus) ? (
            /* sk-514 (7) — ONE badge shape in both modes, by a product
               decision. Before, the sk-460.10 fork stood here: "List"
               printed a pill, "Tree" a coloured word without it, per the design.
               The product decision cancelled this
               distinction: one entity in two looks makes the
               reader recognise the same status twice.
 
               The fork is removed entirely, not replaced with a condition: the pill
               (`Attribute`) itself calls `statusFill` inside the branch of a
               known value, so the ban on a false tone (sk-463,
               INV-6) stays met by construction, and now by one
               mechanism instead of two.
 
               A foreign value is NOT touched: it has its own reason (sk-476) and
               its own carrier `.epic-child-statusword`, which stays
               for the font size. A pill is not due to a foreign value: it
               means "the value is known". */
            <Attribute kind="status" value={wireStatus} />
          ) : (
            /* sk-476 — the font size of a foreign value is the same as that of a known one in
               BOTH modes, and the tone is its own neutral one, outside the set of
               the map's answers. Both are given by the `.epic-child-foreign` rule: in
               "List" a known value is printed by the `compact` chip (12px), and a bare
               `span` without the rule was set at the row's 16px; in "Tree" the font size
               comes from the word as well. Without a tone of its own the foreign word
               inherited the section body's `--ink-2`, the map's answer for
               `deferred`. A common font size is half the requirement: a word
               set larger than its neighbours would tell by its shape what is not known
               about it. */
            <span
              className={
                treeMode
                  ? 'epic-child-statusword epic-child-foreign'
                  : 'epic-child-foreign'
              }
            >
              {wireStatus}
            </span>
          )}
        </span>
      ) : null}

      {/* sk-489 T017 (US-7) — the outcome mark RIGHT AFTER THE STATUS, in both
          modes: the card puts the outcome next to the status
          (`CloseOutcomeControl.tsx#header-close-outcome`), and the section row
          reads in the same word order. The mark has no state
          carrier of its own: it appears exactly when there is
          something to say, which makes its absence a statement "the outcome
          'done' either did not come", not "the place is vacant". */}
      {outcomeMark !== null ? (
        <span className="epic-child-outcome">{outcomeMark}</span>
      ) : null}

      {/* sk-460.13 — the type is printed in BOTH modes (the design
          has the type pill on both boards). The prop stays a mode handle, but today nobody
          switches it off. */}
      {showType && type !== null ? (
        <Attribute kind="type" value={type} />
      ) : null}

      {/* sk-460.5 — the branch indicator caption in the DESIGN'S FORM
          (the design, the "children closed" caption):
          a pair of numbers, then "children closed".

          Before, `tasks:card.epicProgressPlain` was printed: "(1/2 closed)"
          in parentheses. The key was switched to ITS OWN (`details:epic.branchClosed`), not
          rewritten in place: the same text is printed by the task card
          (`TaskCard.tsx`) and the tree row of the Tasks column
          (`TaskTreeNode.tsx`), and an edit for the epic section would rewrite
          them too.

          The FORM was matched, not the literal string: the design is drawn
          in Russian, the interface language is English, and both locales got
          one form. The pair of numbers stays in the text: under `forced-colors`
          a share shown by a bar alone is unreadable, and the numbers are the
          meaning carrier that survives there.

          sk-489 T016 (US-6) — the same form, a different word: "done", not
          "closed", and the pair is computed from the progress denominator. The former
          key was NOT rewritten but stayed as the second leg: an api response that does not know about the
          outcome must print today's numbers in today's words for the whole
          rollout window (US-10), and the leg is chosen by `fromNewFields`,
          not by the presence of a number. */}
      {caption !== null ? (
        <span className="epic-child-progress">
          {caption.kind === 'allExcluded'
            ? t('closeOutcome.excludedCount', { count: caption.excluded })
            : caption.kind === 'plain'
              ? t('epic.branchClosed', { closed: caption.closed, total: caption.total })
              : caption.excluded === null
                ? t('epic.branchDone', { done: caption.done, counted: caption.counted })
                : t('epic.branchDoneExcluded', {
                    done: caption.done,
                    counted: caption.counted,
                    excluded: t('closeOutcome.excludedShort', { count: caption.excluded }),
                  })}
        </span>
      ) : null}
    </span>
  );
}
