/**
 * Which attributes a LIST card prints.
 *
 * The third and last surface to get a «display properties» switch list,
 * and deliberately the same model as the two that came before it —
 * `lib/kanbanCardFields.ts` (the board) and `lib/treeColumns.ts` (the
 * tree table): a flat list of switches in Linear's sense, no ordering,
 * no per-field renaming, no drag-to-arrange. There is no fourth way to
 * say "show me this field" in this app, and there must not be a third
 * spelling of the same one.
 *
 * Why a separate module rather than a share of one of the other two:
 *
 *   • **The three surfaces are three preferences.** A user narrowing
 *     their board must not silently narrow their list, and vice versa.
 *     `useTasksUiState` keeps all three in separate state under separate
 *     storage keys, and `listCardFieldsPersist.test.tsx` pins that none
 *     of the three can leak into another.
 *
 *   • **The sets are not the same set.** The board has no epic-progress
 *     rollup; the tree has no delegated ★ (it paints that mark inside
 *     its structural first column). The list card has both. Wiring the
 *     list to either of the other registries would have offered a switch
 *     for a thing the card cannot draw, or hidden one it does.
 *
 * ## What is NOT switchable
 *
 * The TITLE, for the reason the tree gives for its first column: a card
 * with no title is not a narrowed card, it is an unreadable one — the
 * title is the row's identity and its click target's accessible name.
 * It is therefore not a member of {@link ListCardField} at all, so
 * "turn the title off" does not type-check and cannot arrive from a
 * hand-edited storage value either.
 *
 * Three more marks stay outside the set on the same principle — they are
 * not properties of the task, they are states of the ROW:
 *
 *   • the search-only relevance badge (`score`), which exists only on
 *     rows that came back from `/search` and is a property of the query,
 *     not of the issue;
 *   • the ringing-reminder flag (🔔), which is the caller's own reminder
 *     going off — hiding it would hide an alarm;
 *   • the has-parent marker of the dep-icon strip, which says where the
 *     row sits in the hierarchy. The ⊘ blocked glyph beside it IS
 *     switchable (see `blocked` below) because it is a fact about the
 *     task; the hierarchy marker is the same "structural, not a
 *     property" call the tree makes for its title column.
 *
 * ## Which fields exist
 *
 * A field exists only if the row ALREADY HAS the data — every entry
 * below is a property of `IssueSummary`, the shape the Tasks list query
 * returns (`api/issues.ts`). Nothing here needs a second fetch, so a
 * switch can never turn on a field the card cannot fill. `dueAt` and the
 * comment / attachment counts live on `IssueDetail` only and are
 * therefore NOT offered, exactly as on the board.
 *
 * ## Order
 *
 * FIXED, by {@link LIST_CARD_FIELDS} — the user picks WHICH fields,
 * never WHERE. Same two reasons as the tree: arranging is a whole second
 * interaction nobody asked for, and the order below is a reading order
 * that matches how the card paints (identity → state → people →
 * taxonomy → rollups → time → marks), so two people pairing at one desk
 * see the same card.
 */

/**
 * One switchable attribute of a list card.
 *
 * Names are the UI's vocabulary, not the wire's: `components` / `labels`
 * are plural because the card prints the whole list, `updated` /
 * `created` drop the `At` suffix, `progress` names what the segment
 * MEANS (done/counted children of an epic — sk-489 INV-5: children
 * closed without work leave the denominator) rather than the wire's
 * `epicProgress`, and `delegated` names what the ★ means rather than the
 * flag's spelling (`iAssigned`).
 *
 * Why each one is here — what the card draws for it today:
 *
 *   • `id`        — the id badge on its own line under the title.
 *   • `blocked`   — the ⊘ glyph in the dep-icon strip, plus the blocked
 *                   marker the status chip folds in. A SEPARATE switch
 *                   from `status` because it is not a status: it is
 *                   derived from the dependency graph (`isBlocked`), and
 *                   a reader scanning for "what is stuck" wants it even
 *                   with the status chip off. Same call as on the board
 *                   and in the tree.
 *   • `status`    — the status chip.
 *   • `priority`  — the P0…P4 chip.
 *   • `type`      — the bug / feature / epic chip.
 *   • `assignee`  — "who has this", or «unassigned».
 *   • `components`— the component name (or «N components» when there is
 *                   more than one, or no name cached).
 *   • `labels`    — NOT printed today, but carried on every row
 *                   (`labels: string[]`) and already a switch on the
 *                   board. Being new information it is OFF by default —
 *                   see {@link LIST_DEFAULT_CARD_FIELDS}.
 *   • `progress`  — the epic rollup (done/counted). Empty on non-epics
 *                   by construction: the server computes it for epics
 *                   only.
 *   • `updated`   — the relative date at the end of the meta line.
 *   • `created`   — NOT printed today, carried on every row, already a
 *                   switch on the board, and the one date that answers
 *                   "how long has this been sitting here". Off by
 *                   default.
 *   • `delegated` — the ★ (and the tint that goes with it) on tasks the
 *                   caller created and handed to someone else.
 */
export type ListCardField =
  | 'id'
  | 'blocked'
  | 'status'
  | 'priority'
  | 'type'
  | 'assignee'
  | 'components'
  | 'labels'
  | 'progress'
  | 'updated'
  | 'created'
  | 'delegated';

/**
 * The switch list — top to bottom in the picker, and the order the card
 * paints them in.
 *
 * identity → state → people → taxonomy → rollups → time → marks. See
 * «Order» in the module doc for why this is fixed.
 */
export const LIST_CARD_FIELDS: readonly ListCardField[] = [
  'id',
  'blocked',
  'status',
  'priority',
  'type',
  'assignee',
  'components',
  'labels',
  'progress',
  'updated',
  'created',
  'delegated',
];

/**
 * The card as it reads TODAY.
 *
 * Same rule as `KANBAN_DEFAULT_CARD_FIELDS` and `TREE_DEFAULT_COLUMNS`:
 * turning this feature on must not redraw the list for someone who never
 * opens the picker — not one attribute more, not one less. `TaskCard`
 * prints the id line, the dep-icon strip, the status chip (with the
 * blocked marker folded in), priority, type, the epic rollup, the
 * component segment, the assignee, a relative `updatedAt` and the
 * delegated ★ — so exactly those are on.
 *
 * `labels` and `created` are the only two entries NOT in this set: the
 * card never showed them, so switching this on must not start.
 */
export const LIST_DEFAULT_CARD_FIELDS: readonly ListCardField[] = [
  'id',
  'blocked',
  'status',
  'priority',
  'type',
  'assignee',
  'components',
  'progress',
  'updated',
  'delegated',
];

/** The stored / in-memory shape of the preference. */
export type ListCardFieldSet = ReadonlySet<ListCardField>;

/** Bit per field. Order-independent; only uniqueness matters. */
const FIELD_BIT: Record<ListCardField, number> = {
  id: 1 << 0,
  blocked: 1 << 1,
  status: 1 << 2,
  priority: 1 << 3,
  type: 1 << 4,
  assignee: 1 << 5,
  components: 1 << 6,
  labels: 1 << 7,
  progress: 1 << 8,
  updated: 1 << 9,
  created: 1 << 10,
  delegated: 1 << 11,
};

/**
 * Pack a field set into a bitmask.
 *
 * `TaskCard` is `memo()`d and the list re-renders on every query tick and
 * every keystroke in the search box (the box lives above the list), so a
 * row taking the `Set` as a prop would re-render on every parent tick —
 * a fresh `Set` per render breaks memo by identity, which is the whole
 * prop-stability contract `TaskCard`'s doc comment spells out. A number
 * compares by value and costs nothing. Same contract, same reason, as
 * `cardFieldsMask` and `treeColumnsMask`.
 */
export function listCardFieldsMask(fields: Iterable<ListCardField>): number {
  let mask = 0;
  for (const f of fields) mask |= FIELD_BIT[f];
  return mask;
}

/** Is this field on in the packed mask? */
export function hasListCardField(mask: number, field: ListCardField): boolean {
  return (mask & FIELD_BIT[field]) !== 0;
}

/**
 * Storage encoding: comma-separated field names, registry order.
 *
 * AN EMPTY SET IS A LEGAL CHOICE (a card of nothing but its title), so it
 * serialises to `''`, and only a MISSING key means "no preference". A
 * bare CSV rather than JSON keeps the value legible in devtools, which
 * matters for a preference users report as "my list looks wrong".
 */
export function serializeListCardFields(
  fields: Iterable<ListCardField>,
): string {
  const on = new Set(fields);
  return LIST_CARD_FIELDS.filter((f) => on.has(f)).join(',');
}

/**
 * Decode a stored value. THREE outcomes, and the difference between the
 * last two is the whole point of this function — it is the corrected
 * reader `parseTreeColumns` documents, not the older `parseCardFields`
 * one:
 *
 *   • a MISSING key (`null` / `undefined`) → `null`, "no preference",
 *     and the caller falls back to {@link LIST_DEFAULT_CARD_FIELDS};
 *   • an EMPTY value (`''`, the output of `serializeListCardFields([])`)
 *     → the EMPTY SET. Turning every attribute off is a legal,
 *     deliberate choice — a list of bare titles — and it has to come
 *     back as one;
 *   • a value this reader cannot read → `null` as well, i.e. the
 *     defaults.
 *
 * That last case is why "always return a set, however damaged the input"
 * is wrong. A hand-edited or half-written value with no field name in it
 * (`'{"fields":["id"]}'`, a JSON blob from some other key) would parse as
 * the empty set — INDISTINGUISHABLE from the deliberate «titles only»
 * choice. The list would then draw nothing but titles and the
 * write-through would store `''` over the damaged value, promoting an
 * accident into a permanent preference nobody chose.
 *
 * Degrading is still PARTIAL wherever it can be: as long as one name is
 * recognised, unknown names are dropped silently rather than rejecting
 * the value, so a set written by a newer build that offered one more
 * field still loads here, minus the field this build cannot draw.
 * `title` is one such unknown name — it is not a member of the
 * switchable set, so it is dropped like any other, and the card paints
 * its title regardless.
 *
 * Whitespace around the empty value is tolerated (`'   '` reads as the
 * empty choice) for the same reason it is trimmed around names: the
 * values this has to survive are hand-edited by people.
 */
export function parseListCardFields(
  raw: string | null | undefined,
): ListCardFieldSet | null {
  if (raw === null || raw === undefined) return null;
  // The empty CHOICE — stated explicitly, before any parsing, so it can
  // never be confused with "parsed and nothing came out".
  if (raw.trim() === '') return new Set<ListCardField>();
  const known = new Set<string>(LIST_CARD_FIELDS);
  const out = new Set<ListCardField>();
  for (const part of raw.split(',')) {
    const name = part.trim();
    if (known.has(name)) out.add(name as ListCardField);
  }
  // Not empty, and not one recognisable field name in it: this is not a
  // narrowed selection, it is a value this build cannot read. Say so.
  if (out.size === 0) return null;
  return out;
}
