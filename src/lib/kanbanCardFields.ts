/**
 * sk-285.2.5 — which properties a board card prints.
 *
 * The model is Linear's «display properties», deliberately and not
 * YouTrack's «Cards» tab: a flat list of switches, no ordering, no
 * per-field short names, no drag-to-arrange. The research
 * picked the
 * simpler of the two on purpose — the need is "stop showing me the
 * thing I don't care about", and a field CONSTRUCTOR answers a question
 * nobody asked while costing a whole second layout language.
 *
 * Three rules hold this file together.
 *
 * 1. **A field exists only if the wire carries it.** Every entry below
 *    is a property of `IssueSummary`, the shape the board's list query
 *    actually returns. `dueAt`, `commentsCount` and attachment counts
 *    are on `IssueDetail` only — the list endpoint does not project
 *    them (`skein-api/internal/issues/types.go`, `IssueSummary`) — so
 *    they are NOT offered here. A switch that turns on a field the card
 *    can never fill is worse than a missing switch: it teaches the user
 *    that the setting is broken.
 *
 * 2. **The default set IS the board as it shipped.** Turning the
 *    feature on must not redraw a board for someone who never opens
 *    the switches, so {@link KANBAN_DEFAULT_CARD_FIELDS} reproduces
 *    exactly what sk-285.2.3/2.4 painted: id, type, priority, the
 *    status chip and the assignee line (each still subject to the axis
 *    rule below), plus the derived blocked marker.
 *
 * 3. **The axis still wins over the switch, in one direction only.** A
 *    card never repeats what its own column already says — the rule
 *    sk-285.2.3 introduced for status and assignee. The switch can
 *    therefore turn a field OFF but cannot force it ON in the column
 *    that already states it. See {@link KANBAN_AXIS_SUPPRESSED}.
 *
 * The visible set is handed to the card as a BITMASK rather than as a
 * `Set`: `KanbanCard` is `memo()`d and the board re-renders on every
 * query tick and every drag frame, so a fresh `Set` per render would
 * silently kill that memo (the same prop-stability contract `TaskCard`
 * documents). A number compares by value and costs nothing.
 */

import type { KanbanAxis } from './kanbanBoard';

/**
 * One switchable property of a board card.
 *
 * Names are the UI's own vocabulary, not the wire's: `components` /
 * `labels` are plural because the card prints the whole list, and
 * `delegated` names what the ★ MEANS (`iAssigned` on the wire) rather
 * than the flag's spelling.
 */
export type KanbanCardField =
  | 'id'
  | 'type'
  | 'status'
  | 'priority'
  | 'assignee'
  | 'components'
  | 'labels'
  | 'updated'
  | 'created'
  | 'blocked'
  | 'delegated';

/**
 * Switch order — top to bottom in the picker, and the order the card
 * paints them in.
 *
 * Grouped by where they land on the card (identity → chips → people →
 * taxonomy → dates → marks) so the list reads as the card does.
 */
export const KANBAN_CARD_FIELDS: readonly KanbanCardField[] = [
  'id',
  'type',
  'status',
  'priority',
  'assignee',
  'components',
  'labels',
  'updated',
  'created',
  'blocked',
  'delegated',
];

/**
 * The board as it was before this setting existed.
 *
 * `blocked` is in here because the shipped card ALWAYS showed the
 * derived blocked marker, including on the status axis where the plain
 * status chip is suppressed — blocked-ness comes from the dependency
 * graph and is never what a column says.
 */
export const KANBAN_DEFAULT_CARD_FIELDS: readonly KanbanCardField[] = [
  'id',
  'type',
  'status',
  'priority',
  'assignee',
  'blocked',
];

/**
 * Which field each axis already states, and therefore hides.
 *
 * Only four entries, and that is deliberate. `status` and `assignee`
 * are the two the board shipped with; `components` / `labels` are their
 * exact analogue on the two multi-value axes, where the column head
 * already names one value and the "also in …" line names the rest.
 *
 * `priority` and `type` are POINTEDLY absent even though a priority
 * board repeats the priority chip on every card of a column. That was
 * sk-285.2.4's call and this task does not overturn it — and it no
 * longer needs overturning, because the user now has the switch: one
 * click turns the repeated chip off, and unlike a hard-coded rule the
 * click is reversible.
 */
export const KANBAN_AXIS_SUPPRESSED: Readonly<
  Partial<Record<KanbanAxis, KanbanCardField>>
> = {
  status: 'status',
  assignee: 'assignee',
  component: 'components',
  label: 'labels',
};

/** Bit per field. Order-independent; only uniqueness matters. */
const FIELD_BIT: Record<KanbanCardField, number> = {
  id: 1 << 0,
  type: 1 << 1,
  status: 1 << 2,
  priority: 1 << 3,
  assignee: 1 << 4,
  components: 1 << 5,
  labels: 1 << 6,
  updated: 1 << 7,
  created: 1 << 8,
  blocked: 1 << 9,
  delegated: 1 << 10,
};

/** Pack a field set into the bitmask the card reads. */
export function cardFieldsMask(fields: Iterable<KanbanCardField>): number {
  let mask = 0;
  for (const f of fields) mask |= FIELD_BIT[f];
  return mask;
}

/**
 * What THIS card, on THIS axis, is allowed to print.
 *
 * The user's set minus the one field the column already states. One
 * function so the paint and any future consumer cannot disagree about
 * the rule.
 */
export function visibleCardFieldsMask(
  fields: Iterable<KanbanCardField>,
  axis: KanbanAxis,
): number {
  const suppressed = KANBAN_AXIS_SUPPRESSED[axis];
  const mask = cardFieldsMask(fields);
  return suppressed === undefined ? mask : mask & ~FIELD_BIT[suppressed];
}

/** Is this field on in the packed mask? */
export function hasCardField(mask: number, field: KanbanCardField): boolean {
  return (mask & FIELD_BIT[field]) !== 0;
}

/**
 * Storage encoding: comma-separated field names.
 *
 * An EMPTY SET IS A LEGAL CHOICE — a card of nothing but its title is a
 * reasonable thing to want — so it must survive a reload. That is why
 * the empty selection serialises to `''` and `parseCardFields` returns
 * `null` (meaning "no stored preference, use the defaults") ONLY for a
 * missing key. Storing JSON would work equally well; a bare CSV keeps
 * the value legible in devtools, which matters for a preference users
 * will report as "my board looks wrong".
 */
export function serializeCardFields(fields: Iterable<KanbanCardField>): string {
  const set = new Set(fields);
  return KANBAN_CARD_FIELDS.filter((f) => set.has(f)).join(',');
}

/**
 * Decode a stored value.
 *
 * `null` in → `null` out ("nothing stored", caller falls back to the
 * defaults). Unknown names are dropped rather than rejected: a value
 * written by a newer build that offered one more field must still load
 * here, minus the field this build does not know.
 */
export function parseCardFields(
  raw: string | null | undefined,
): ReadonlySet<KanbanCardField> | null {
  if (raw === null || raw === undefined) return null;
  const known = new Set<string>(KANBAN_CARD_FIELDS);
  const out = new Set<KanbanCardField>();
  for (const part of raw.split(',')) {
    const name = part.trim();
    if (known.has(name)) out.add(name as KanbanCardField);
  }
  return out;
}
