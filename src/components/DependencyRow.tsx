import { IconLock, IconX } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { DependencyEdge, Gate } from '../api/dependencies';
import { statusChipText } from './Attribute';
import { DEP_TYPE_GLYPHS } from '../lib/depTypeIcons';

/**
 * One row inside the Dependencies section — artboard 4c, drawn on the
 * card's shared row vocabulary (sk-414.2, `index.css`).
 *
 * Two storeys inside a 52px `.detail-row--dep`:
 *
 *   ⊘ blocks   pay-3   ● in progress   P1        [ × ]
 *   Partial refund does not reduce the order total
 *
 * ─── Direction is the GROUP's job now ──────────────────────────────
 *
 * The row used to open with `→` or `←` and the section labelled its two
 * lists in lowercase prose. Both said the same thing, and the arrow said
 * it once per row: a list of eight edges drew eight identical glyphs
 * down a 14px gutter. The direction is now stated once, by the heading
 * above the list, which is why this component no longer takes a
 * `direction` prop at all. What it still takes is `onRemove`, and the
 * section passes it on OUTGOING edges only — an incoming edge belongs to
 * the issue at the other end and has to be edited there.
 *
 * ─── Why not `<Attribute kind="dep-type">` ─────────────────────────
 *
 * Checked, and the two chips are deliberately different SHAPES rather
 * than one shape drawn twice. `Attribute` gives every type an OUTLINE
 * (sk-367: colour is spent on status and priority, and types are told
 * apart by form) because in a task-card badge row an issue type and a
 * status sit side by side and would collide on hue. This row has no
 * issue-type chip in it — the type here is an EDGE type — so that
 * collision does not arise, and artboard 4c draws the chip filled with
 * its own tint: `.dep-chip[data-dep-type]`, which is exactly what
 * sk-414.2 laid down for these two sections. Reusing the outline chip
 * would have meant repainting the tree, the board and the search
 * results to match a card the canvas draws differently.
 *
 * What IS shared, so the two surfaces cannot drift on the facts: the
 * glyph comes from `DEP_TYPE_GLYPHS` and the status word from
 * `statusChipText` — the same maps `Attribute` reads.
 *
 * ─── The redacted row ──────────────────────────────────────────────
 *
 * When the target lives in a project the caller cannot see, the edge is
 * still real and still known: the type and the direction are shown, and
 * the issue behind it is replaced by a dashed, locked chip that says so
 * in words. It is NOT an error state and NOT "no data" — and there is
 * nothing to click and nothing to remove, because removing an edge you
 * cannot see the far end of is not a decision this UI can offer.
 */
export interface DependencyRowProps {
  edge: DependencyEdge;
  onClickIssue?: (issueId: string, projectId: string) => void;
  /**
   * Pass ONLY on outgoing edges. Absent means the row draws no remove
   * button at all — the incoming half of the graph is owned by the
   * other issue.
   */
  onRemove?: () => void;
  removing?: boolean;
}

export function DependencyRow({
  edge,
  onClickIssue,
  onRemove,
  removing,
}: DependencyRowProps) {
  const { t } = useTranslation('details');
  const gate =
    edge.type === 'waits-for' && typeof edge.metadata?.gate === 'string'
      ? (edge.metadata.gate as Gate)
      : undefined;
  // The gate rides INSIDE the chip: it is part of what this edge type
  // means here ("waits for all children" is a different promise from
  // "any child"), and a second chip beside it would read as a second
  // attribute of the issue.
  const typeText = gate ? `${edge.type}: ${gate}` : edge.type;
  const glyph = DEP_TYPE_GLYPHS[edge.type];
  const redacted = edge.redacted || !edge.issue;

  return (
    <li className="detail-row detail-row--dep">
      <span className="detail-row-main">
        <span className="detail-row-line">
          <span className="dep-chip" data-dep-type={edge.type}>
            {/* `null` in the glyph map means "this type is drawn as an
                icon" — see `DEP_TYPE_ICONS`. The chip carries the WORD
                either way, so a type without a glyph loses decoration,
                not meaning. */}
            {glyph ? (
              <span className="dep-chip-glyph" aria-hidden>
                {glyph}
              </span>
            ) : null}
            {typeText}
          </span>

          {redacted ? (
            <span className="dep-chip dep-chip--redacted">
              {/* 16 — §8's inline-in-text step, which is what a chip
                  prefix is, and the size `Attribute` already gives the
                  one dep type it draws as an icon. The word beside it is
                  what carries the state; the padlock only sorts it. */}
              <IconLock size={16} stroke={1.75} aria-hidden />
              {t('deps.redacted')}
            </span>
          ) : (
            <>
              <button
                type="button"
                className="detail-row-link"
                onClick={() => onClickIssue?.(edge.issue!.id, edge.issue!.projectId)}
                title={edge.issue!.title}
              >
                {edge.issue!.id}
              </button>
              <span className="status-chip" data-status={edge.issue!.status}>
                <span className="status-chip-dot" aria-hidden />
                {statusChipText(edge.issue!.status)}
              </span>
              <span className="detail-row-prio">P{edge.issue!.priority}</span>
            </>
          )}
        </span>

        <span
          className="detail-row-title"
          title={redacted ? undefined : edge.issue!.title}
        >
          {redacted ? t('deps.redactedHint') : edge.issue!.title}
        </span>
      </span>

      {onRemove && !redacted ? (
        <span className="detail-row-actions">
          <button
            type="button"
            className="detail-row-btn detail-row-btn--quiet"
            onClick={() => {
              if (removing) return;
              onRemove();
            }}
            aria-disabled={removing || undefined}
            aria-label={t('deps.removeAria', { id: edge.issue?.id ?? edge.toId })}
          >
            {/* sk-414.3's spinner, for the same reason: the row's action
                answers where it was pressed rather than somewhere else
                on the card. */}
            {removing ? (
              <span className="detail-spinner" aria-hidden />
            ) : (
              <IconX size={20} stroke={1.75} aria-hidden />
            )}
          </button>
        </span>
      ) : null}
    </li>
  );
}
