import { useTranslation } from 'react-i18next';
import { formatEventLine } from '../lib/formatEventLine';
import type { NotificationItem } from '../api/notifications';

/**
 * Render a single event line with colour-coded parts. The structured
 * breakdown comes from `formatEventLine`; each part lands in its own
 * `<span>` so the reader's eye can scan actor → verb → diff without
 * parsing a flat sentence.
 *
 * Colour recipe:
 *   - actor       — cyan (or dim grey when `system`, so the reaper
 *                   blends into the background instead of competing
 *                   with human-driven events for attention)
 *   - verb        — base text (unstyled prose)
 *   - field       — emphasis (slightly brighter than base)
 *   - oldValue    — dim (the "before" — less interesting)
 *   - arrow `→`   — dim
 *   - newValue    — orange (the "after" is what changed; eyes go here)
 *   - tail        — dim (parenthetical detail like "(stale)")
 *
 * Promoted here from byte-identical private copies in two shell cards
 * (sk-194 wave C dedup). One of the two, the Outbox card, has since been
 * removed with its surface (sk-303.13 / US-9); WatchingCard is the
 * remaining consumer. The component stays shared rather than being
 * folded back in: it is the only renderer of an event line, and the
 * `outbox-ev-*` class names it emits are the ones the stylesheet still
 * carries — renaming them would be a repaint, not a removal.
 *
 * sk-551.27 — the actor's login, the field name and the two sides of a
 * change are ATOMS: at the Queues column's 200px floor a long login used
 * to wrap mid-word («konstanti / n_vasilev / sky»). They now stay on one
 * line and are cut with an ellipsis (`.outbox-ev-atom` in `index.css`).
 * The cut is lifted — the row shows its whole text — while the row is
 * hovered or holds focus, and on a card in select mode while its head
 * holds focus (review, grok html: a native `title` opens late, never from
 * the keyboard and never on touch). The text nodes are never cut, so the
 * row button's accessible name is the full line.
 */
export function EventLineRender({ ev }: { ev: NotificationItem }) {
  // sk-551.24 — the line's own words come from `inbox:eventLine`.
  const { t } = useTranslation('inbox');
  const parts = formatEventLine(ev, t);
  return (
    <>
      <span
        className={
          parts.actorIsSystem
            ? 'outbox-ev-atom outbox-ev-actor system'
            : 'outbox-ev-atom outbox-ev-actor'
        }
      >
        {parts.actor}
      </span>
      {' '}
      <span className="outbox-ev-verb">{parts.verb}</span>
      {parts.field ? (
        <>
          {' '}
          <span className="outbox-ev-atom outbox-ev-field">
            {parts.field}
          </span>
        </>
      ) : null}
      {parts.oldValue !== undefined && parts.newValue !== undefined ? (
        <>
          {' '}
          <span className="outbox-ev-nobr">
            {'('}
            <span className="outbox-ev-atom outbox-ev-old">
              {parts.oldValue}
            </span>
          </span>
          {' '}
          <span className="outbox-ev-nobr">
            <span className="outbox-ev-arrow" aria-hidden="true">→</span>
            {' '}
            <span className="outbox-ev-atom outbox-ev-new">
              {parts.newValue}
            </span>
            {')'}
          </span>
        </>
      ) : null}
      {parts.tail ? (
        <>
          {' '}
          <span className="outbox-ev-tail">{parts.tail}</span>
        </>
      ) : null}
    </>
  );
}
