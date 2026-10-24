import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Section wrapper used inside the Details panel (F5). Renders a
 * heading, optional count chip, and a body container.
 *
 * Matches the design tokens already in the new shell — no Mantine
 * Stack here, just CSS spacing via `.detail-section`.
 *
 * ─── sk-285.6.2 — an empty section costs ONE ROW ──────────────────
 *
 * A typical issue used to render six sections that held nothing but a
 * heading, the word "none" and a `+` button — measured 1754px of card
 * against a 732px viewport, most of it scaffolding for content that
 * was not there. Passing `empty` collapses the whole section onto a
 * single line: heading, the shared empty word and the add affordance
 * sit side by side and `children` are not rendered at all.
 *
 * Empty sections are NOT hidden. The heading has to stay visible or a
 * reader stops learning that a task can HAVE acceptance criteria —
 * the form is what advertises the field.
 *
 * ─── sk-285.6.11 — the two rules that give a section rank ─────────
 *
 * 1. HEADING WEIGHT. A filled section keeps the strong heading
 *    (`--font-lg` / 600 / `--ink`); an empty one steps down to
 *    `--font-base` / 500 / `--ink-2` on its collapsed row. So "where
 *    is there something" is answerable at a glance, without reading
 *    any body.
 *
 * 2. COUNT CHIP — the rule, in one sentence: **a count is shown only
 *    for a section whose body is a list, and only when that list has
 *    entries.** It is enforced here, not at the call sites: `count`
 *    is rendered iff it is greater than zero. Prose sections
 *    (Description, Acceptance criteria, Notes) simply never pass one.
 *    A "0" chip is noise — the collapsed row already says "none" — and
 *    it was exactly the inconsistency the review flagged, where
 *    "Dependencies 0" and "Commits 0" carried a zero while Attachments
 *    and Description carried nothing.
 */
export interface SectionProps {
  title: string;
  /**
   * Count of rows in a LIST-bodied section. Rendered only when > 0
   * (see rule 2 above) — pass it unconditionally and let the rule
   * decide.
   */
  count?: number;
  /** Optional id for anchor links — anchored deep-links land here. */
  id?: string;
  /**
   * Extra class on the `<section>` itself. Callers needing their own CSS
   * hook must use this instead of wrapping `<Section>` in a div: a wrapper
   * makes the `<section>` the first child of that div, so
   * `.detail-section:first-child` (which drops the top border and shrinks
   * the padding) matches even mid-panel and the separator above the block
   * disappears.
   */
  className?: string;
  /**
   * The section holds nothing. Collapses to one row and drops
   * `children` from the tree entirely (they are not merely hidden —
   * a display:none body still mounts its queries and its forms).
   */
  empty?: boolean;
  /**
   * Affordance placed on the collapsed row — normally the section's
   * own "+ Add …" button. Keeping it ON the row is what preserves
   * one-click adding: the collapsed state costs a line, not a click.
   */
  emptyAction?: ReactNode;
  /**
   * sk-285.7.2.53 → sk-285.7.2.54 — affordance on the heading row of a
   * FILLED section, right-aligned. §6 writes the Description section as
   * «Description (h3 14/600 + Edit ghost)» and `Sk Details.dc.html`
   * draws the pair as one `space-between` row.
   *
   * Deliberately a second prop rather than a reuse of `emptyAction`:
   * the two rows are different shapes (the collapsed one also carries
   * the word «none») and a section can legitimately supply one and not
   * the other. Rendered only when supplied, so a section without an
   * action keeps the bare `<h2>` it had.
   */
  headerAction?: ReactNode;
  /**
   * sk-285.7.2.56 — a muted aside INSIDE the heading, after the title.
   *
   * §6 / reference `1b` write the empty Comments heading as
   * «Comments · none yet», i.e. the emptiness is stated ON the heading
   * line rather than as a sentence under it. That is not the `count`
   * chip with a zero in it — rule 2 above still bans those, and this
   * carries a word rather than a number — and it is not `emptyAction`
   * either: a section can be EMPTY in the collapse sense (`empty`) or
   * merely hold nothing yet while still needing its body (the comment
   * composer), and Comments is the second kind.
   */
  note?: ReactNode;
  /**
   * sk-460.6 — THE BODY PRINTS THE HEADING, not `Section`.
   *
   * The maintainers' decision on the "Improvisation 50%" mock: in the epic section
   * the heading with its caption stand NEXT TO THE RING, inside the section header, and
   * not on a separate row above it. The heading must nevertheless stay
   * a real `<h2>` — screen readers navigate by it.
   *
   * Hence a prop, and not the epic section abandoning the shared `Section`: the wrapper
   * carries the card's frame, padding and hairline, and a copy of its own
   * would diverge from it on the first edit. And hence a PROP, and not "raise
   * the font size": the size would change the headings of ALL eleven sections
   * of the card, not of this one.
   *
   * ⚠ TWO HEADINGS MUST NOT BE PRINTED — the row would double both on screen and in
   * the accessibility tree. So the flag does not "add" a heading to the body, it
   * SUPPRESSES its own: `count` and `note`, which live on
   * the same row, go out with it, and the section that raised the flag must print the heading
   * itself.
   *
   * ⚠ IT DOES NOT COMBINE WITH `empty`, and this is decided here, not left to
   * luck: a folded section has no body at all (`children` are not
   * rendered), so there would be nobody to print the heading and the section
   * would stay WITHOUT a heading — exactly the defect the paragraph
   * above guards against, only from the other side. `empty` wins:
   * the folded row prints the heading itself.
   */
  bodyPrintsTitle?: boolean;
  children: ReactNode;
}

export function Section({
  title,
  count,
  id,
  className,
  empty,
  emptyAction,
  headerAction,
  note,
  bodyPrintsTitle,
  children,
}: SectionProps) {
  const { t } = useTranslation('details');
  const base = empty ? 'detail-section detail-section--empty' : 'detail-section';
  const cls = className ? `${base} ${className}` : base;

  if (empty) {
    return (
      <section className={cls} id={id}>
        <div className="detail-section-emptyrow">
          <h2 className="detail-section-title">{title}</h2>
          <span className="detail-section-empty-value">{t('emptyValue')}</span>
          {/* sk-285.7 T030 — §6 puts the affordance at the RIGHT edge of
              the row, so six collapsed sections line their `+ Add` up in
              one column. It needs a box of its own to be pushed there
              (`margin-left: auto` on the wrapper): the action is handed
              in as arbitrary children, and a rule aimed at "the last
              child of the row" would move the `none` label instead on
              any section that supplies no action. Rendered only when
              there IS one, so a section without an affordance does not
              carry an empty box. */}
          {emptyAction ? (
            <span className="detail-section-empty-action">{emptyAction}</span>
          ) : null}
        </div>
      </section>
    );
  }

  // sk-460.6 — a section that prints its heading ITSELF does not get its own:
  // `null`, not a hidden element. A hidden `<h2>` would remain in the document
  // tree as a second heading of the same section — a screen reader walks the
  // structure, not the picture.
  const heading = bodyPrintsTitle ? null : (
    <h2 className="detail-section-title">
      {title}
      {count !== undefined && count > 0 ? (
        <span className="detail-section-count">{count}</span>
      ) : null}
      {note ? <span className="detail-section-count">{note}</span> : null}
    </h2>
  );

  return (
    <section className={cls} id={id}>
      {headerAction ? (
        <div className="detail-section-head">
          {heading}
          <span className="detail-section-head-action">{headerAction}</span>
        </div>
      ) : (
        heading
      )}
      <div className="detail-section-body">{children}</div>
    </section>
  );
}
