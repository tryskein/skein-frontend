/**
 * Where each pre-redesign role's saved value goes (sk-285.7 T010).
 *
 * A saved theme is a flat snapshot keyed by ROLE NAME. The redesign
 * replaced the dictionary, so migrating one means answering, for every
 * name the snapshot can contain, "which role owns this value now?" —
 * and that question is keyed by the OLD name. This module is that
 * answer, and nothing more: T011 does the actual migrating.
 *
 * ── Why a hand-written table and not `invert(registry)` ─────────────
 *
 * The same relation is already declared in `themeTokens.ts`, on the
 * other side: each new role lists the old names it succeeds
 * (`predecessors`), and `RETIRED_ROLES` names the ones with no
 * successor. Deriving this table from those two would give one source
 * of truth and no drift — and would also make every check of it
 * vacuous, since a derived table agrees with its source by
 * construction, including when the source is wrong.
 *
 * The thing that has to be right here is not internal consistency. It
 * is that each of 61 old roles points at the role a HUMAN agrees it
 * points at, because the failure mode is silent: a wrong successor does
 * not throw, it moves a colour someone chose on purpose onto a role
 * that paints something else, and the user finds out by looking at
 * their theme. That judgement is reviewable when the mapping is written
 * out per line, in the order the old dictionary declared it, and is not
 * reviewable at all when it is a `flatMap` over a registry.
 *
 * So: written out, and `themeMigration.test.ts` holds it against the
 * registry — two independently authored statements of the same relation,
 * which is what makes the comparison capable of failing.
 *
 * ── Reading the table ───────────────────────────────────────────────
 *
 *   `'--old': '--new'`  the value carries over to `--new`. What HAPPENS
 *                       to it there depends on the successor's ownership
 *                       class (INV-11) and is T011's business: a user
 *                       role keeps the saved value, a structural role
 *                       keeps it only when it still equals the OLD
 *                       default (`LEGACY_DEFAULTS`) and is re-seeded
 *                       otherwise.
 *
 *   `'--old': null`     the role is retired: the new language offers no
 *                       counterpart, `RETIRED_ROLES` says why, and the
 *                       saved value is dropped rather than guessed onto
 *                       a near-enough role.
 *
 * The table is TOTAL over `LEGACY_TOKEN_KEYS` — every old name has an
 * entry, so T011 never has to decide what an absent key means. New
 * roles that are genuinely new (no predecessor) do not appear here at
 * all: they are seeded from their own base's builtin value (INV-9),
 * which is a different step and a different rule.
 *
 * ── Collapses ──────────────────────────────────────────────────────
 *
 * The relation is many-to-one in SEVEN places — the ink ramp folding
 * five steps into three accounts for two of them, the three brand
 * grades onto one primary for another, and the elevated/hover surfaces,
 * the two selection tints, the two cyans plus the standing status, and
 * the two ambers for the rest. Two or three old values then arrive at
 * one new role and T011 has to say which one wins; that is a real
 * decision and not a detail, so the groups are pinned as a list in the
 * test and cannot grow silently.
 */

import { ALL_TOKENS, type TokenDef } from './themeTokens';
import { LEGACY_DEFAULTS, LEGACY_TOKEN_KEYS } from './themeTokensLegacy';

/**
 * Old role name → new role name, or `null` when the role was retired.
 *
 * Keyed by the OLD name and ordered as `LEGACY_TOKEN_KEYS` declares
 * them, section comments included, so this file can be read against the
 * snapshot line by line.
 */
export const LEGACY_TO_NEW: Record<string, string | null> = {
  // Surfaces
  '--bg-base': '--bg',
  '--bg-elevated': '--elev',
  '--bg-selected': '--primary-t',
  '--bg-hover': '--elev',
  '--border': '--line-2',
  '--border-subtle': '--line',
  '--radius-default': '--radius-control',
  '--radius-dialog': '--radius-panel',
  '--shadow-elevation-1': '--shadow-segment',
  '--shadow-elevation-2': '--shadow-popover',
  // Text
  '--fg-high': '--ink',
  '--fg-base': '--ink-2',
  '--fg-low': '--ink-2',
  '--fg-muted': '--ink-3',
  '--fg-emphasis': '--ink',
  // Brand
  '--brand': '--primary',
  '--brand-text': '--primary',
  '--brand-fill': '--primary',
  '--brand-hover': '--primary-h',
  '--brand-muted': '--primary-t',
  // Accents
  '--accent-blue': '--info',
  '--accent-cyan': '--secondary',
  '--accent-cyan-fill': '--secondary',
  '--status-standing': '--secondary',
  '--accent-green': '--ok',
  '--accent-magenta': null,
  '--accent-magenta-tint': null,
  '--accent-orange': null,
  '--accent-red': '--err',
  '--accent-violet': '--violet',
  '--accent-yellow': null,
  '--accent-amber': '--warn',
  '--accent-amber-fill': '--warn',
  '--accent-amber-tint': '--warn-t',
  // Search
  '--match-bg': '--mark',
  '--match-fg': '--on-mark',
  // Geometry
  '--space-xs': null,
  '--space-sm': '--space-1',
  '--space-md': '--space-2',
  '--space-lg': '--space-3',
  '--space-xl': '--space-4',
  '--width-sliver': '--width-sliver',
  '--width-resize': '--width-resize',
  '--transition-fast': '--transition-fast',
  // Type
  '--font-ui': '--font-ui',
  '--font-mono': '--font-mono',
  '--font-xs': '--font-xs',
  '--font-sm': '--font-sm',
  '--font-base': '--font-base',
  '--font-lg': '--font-lg',
  '--font-xl': '--font-xl',
  '--line-tight': '--line-h4',
  '--line-base': '--line-body',
  '--font-weight-normal': '--font-weight-normal',
  '--font-weight-medium': '--font-weight-medium',
  '--font-weight-semibold': '--font-weight-semibold',
  '--font-weight-bold': '--font-weight-bold',
  '--font-size-meta': null,
  '--font-size-body': null,
  '--font-size-title': null,
  '--font-size-heading': null,
};

/**
 * The successor of `key`, or `null` when the role was retired.
 *
 * Throws on a name that is not a pre-redesign role at all. The table is
 * total over `LEGACY_TOKEN_KEYS` (the test proves it), so `undefined`
 * from a lookup can only mean the caller asked about something else —
 * a new role, a typo, a name from a third dictionary — and answering
 * "retired" to that would silently drop a value that was never this
 * module's to drop.
 */
export function successorOf(key: string): string | null {
  if (!(key in LEGACY_TO_NEW)) {
    throw new Error(`${key} is not a pre-redesign role — nothing here maps it`);
  }
  return LEGACY_TO_NEW[key];
}

/**
 * Old roles whose value is dropped rather than carried over.
 *
 * Derived from the table so it cannot disagree with it; the test pins it
 * against `RETIRED_ROLES`, which is the independent statement.
 */
export const DROPPED_ROLES: readonly string[] = LEGACY_TOKEN_KEYS.filter(
  (key) => LEGACY_TO_NEW[key] === null,
);

/* ══════════════════════ T011 — the migration itself ═══════════════════ */

/** Which builtin column a saved theme is read against. */
export type ThemeBase = 'light' | 'dark';

const NEW_KEYS: ReadonlySet<string> = new Set(ALL_TOKENS.map((t) => t.key));
const LEGACY_KEYS: ReadonlySet<string> = new Set(LEGACY_TOKEN_KEYS);

/**
 * WHICH OLD VALUE WINS when several old roles land on one new one.
 *
 * ── Why this table exists at all ────────────────────────────────────
 *
 * `LEGACY_TO_NEW` is many-to-one in seven places, so a snapshot can
 * offer two or three DIFFERENT values for one new role — the ink ramp
 * folded five steps into three, the brand three grades into one, and so
 * on. Something has to choose, and the one thing that must not choose
 * is the order `Object.keys()` happens to return: that would make the
 * user's palette depend on the order their theme was serialised in,
 * which is neither reviewable nor reproducible. This is a decision
 * about DISCARDING somebody's colour, so it is written down, per group,
 * with the reason.
 *
 * ── The rule, in three tiers ────────────────────────────────────────
 *
 *   1. Only ONE of the group's roles is present in the snapshot → it
 *      wins. No judgement needed and none is made.
 *   2. Several are present → the ones the user actually TOUCHED decide,
 *      i.e. those whose value differs from that role's own pre-redesign
 *      default. This is not a new idea: plan decision R5 already
 *      establishes "value ≠ old default" as THE available signal of a
 *      deliberate setting, because the storage format is a flat
 *      snapshot with no record of what was edited. Reusing it here
 *      means the colour someone chose beats a default that came along
 *      for the ride — which is the case that would otherwise hurt most
 *      (a user who retuned only `--brand-fill` would have lost it to an
 *      untouched `--brand`).
 *   3. Still ambiguous — several touched and disagreeing, or none
 *      touched at all — → the order below decides, first entry first.
 *
 * Tier 2 is suspended for the groups named in {@link ORDER_DECIDES},
 * where the sources differ in KIND rather than in grade and «touched»
 * is therefore not evidence about the role at all. Read that block
 * before adding a group here.
 *
 * The order below is authored here, per group, and is NOT read out of
 * `TokenDef.predecessors`: that field declares WHICH old roles a new
 * one succeeds and says nothing about rank, so borrowing its order
 * would be inventing a meaning for someone else's list. It agrees with
 * that order everywhere today, which is worth knowing — two
 * independently written statements landing on the same answer — and is
 * not what makes it right.
 *
 * ── What is NOT decided here ────────────────────────────────────────
 *
 * Whether the winner is then carried at all: a STRUCTURAL role is
 * re-seeded when untouched no matter which source won (INV-11). Today
 * every collapse group is user-owned, so the two rules never meet; the
 * code keeps them separate anyway, because a future collapse among
 * structural roles must not silently inherit this table's semantics.
 */
export const COLLAPSE_PRIORITY: Record<string, readonly string[]> = {
  // A PLATE beats a WASH. `--bg-elevated` was a solid surface colour;
  // `--bg-hover` was a translucent film laid over one, and a film used
  // as a plate paints a see-through panel.
  '--elev': ['--bg-elevated', '--bg-hover'],

  // The step that painted most of the glyphs beats the one-notch-darker
  // accent a handful of surfaces used. Note this is NOT the "closest by
  // value" answer — `--ink`'s new default is the darkest ramp step and
  // `--fg-emphasis` was the darker of the two — and it is deliberate:
  // the migration carries what the author TUNED, and an author tuning
  // "the text colour" tuned the one the body copy was drawn in.
  '--ink': ['--fg-high', '--fg-emphasis'],

  // Same shape one step down: `--fg-base` was the running-text ink,
  // `--fg-low` the quieter grade beneath it.
  '--ink-2': ['--fg-base', '--fg-low'],

  // The family's base grade beats the two grades DERIVED from it. The
  // new role is explicitly "one grade for text AND fill", so neither
  // specialisation is a better statement of it than the root.
  '--primary': ['--brand', '--brand-text', '--brand-fill'],

  // `--primary-t` is a member of the primary family — its name, and its
  // default, are the primary at low alpha — so the brand's own tint is
  // the closer statement than a surface STATE that happened to be
  // painted in it. (The two old light defaults are byte-identical, so
  // this only bites on the dark base or on an edited theme.)
  '--primary-t': ['--brand-muted', '--bg-selected'],

  // Base hue, then its solid variant, then the role that was a
  // REFERENCE to the base hue by default (`--status-standing` was
  // literally `var(--accent-cyan)`) — a derived role is the weakest
  // evidence of an intended colour, so it goes last.
  '--secondary': ['--accent-cyan', '--accent-cyan-fill', '--status-standing'],

  // Base grade before its fill variant, as with the brand.
  '--warn': ['--accent-amber', '--accent-amber-fill'],
};

/**
 * Collapse groups where tier 2 does NOT apply — order alone decides.
 *
 * ── The contradiction this resolves ─────────────────────────────────
 *
 * `--elev`'s entry above justifies its order by KIND: «a PLATE beats a
 * WASH… a film used as a plate paints a see-through panel». Tier 2 then
 * overrode that order whenever the user had touched the film, so a
 * snapshot with only `--bg-hover` retuned produced
 * `--elev: rgba(0, 90, 255, 0.08)` — a translucent value on an opaque
 * role, i.e. exactly the see-through panel the entry calls out as the
 * thing to avoid. The code and its own stated reason disagreed, and the
 * disagreement fired on an ordinary snapshot.
 *
 * ── Why `--elev` and nothing else ───────────────────────────────────
 *
 * Of the seven collapses, six fold a HOMOGENEOUS family — three grades
 * of one brand, two steps of one ink ramp, a hue and its fill. Any
 * member of such a group is a legitimate statement of the group's role,
 * so «the one the user touched» is strictly better evidence than a
 * static order, and tier 2 is right there.
 *
 * `--elev` is the one group whose sources differ in KIND rather than in
 * grade: `--bg-elevated` was an opaque surface colour, `--bg-hover` a
 * translucent film laid over one. A deliberate choice of a FILM is not a
 * statement about the PLATE — the author was tuning what a hover looks
 * like on top of a surface, not what the surface is — so promoting it
 * over the plate carries an alpha channel onto a role the redesign
 * draws as a solid surface. Losing that tweak is the smaller loss, and
 * it is a loss the film's own successor cannot avoid either way:
 * `--bg-hover` maps HERE and nowhere else, so under the old default it
 * was already discarded whenever `--bg-elevated` was present.
 *
 * ── What this does NOT promise ──────────────────────────────────────
 *
 * It is a rule for CHOOSING BETWEEN two present sources, not a
 * guarantee that `--elev` comes out opaque. Tier 1 sits above every
 * tier this set touches: a snapshot carrying `--bg-hover` and NOT
 * `--bg-elevated` has one source for the group, so the film is carried
 * unopposed and `--elev` really does end up translucent
 * (`{'--bg-hover': 'rgba(1,2,3,0.5)'}` migrates to
 * `--elev: rgba(1,2,3,0.5)` — the suite pins exactly that). The trade
 * above is deliberate and so is this: with one source there is no
 * judgement to make, and inventing one would mean discarding the only
 * colour the author left about this surface. "Opaque" is what the
 * redesign's own default is, not an invariant the migration enforces.
 *
 * INV-11 is untouched by this: a structural role nobody touched is still
 * re-seeded, whatever the group's rule. Today every collapse group is
 * user-owned, so the two never meet; the code keeps them separate anyway.
 */
export const ORDER_DECIDES: ReadonlySet<string> = new Set(['--elev']);

/**
 * The two static tables `sourcesFor` reads, as one argument.
 *
 * Injectable so the two throws below are REACHABLE. On the live tables
 * neither can fire — every many-to-one group has a `COLLAPSE_PRIORITY`
 * entry and every entry covers its group — so a test that only ever
 * calls `sourcesFor` with those tables leaves both branches unexecuted,
 * and a mutation that deletes either one stays green. They are not
 * decoration: they are what stops a future edit of these tables from
 * silently letting key order pick whose colour is discarded, which is
 * the failure this whole module exists to prevent. A guard nothing can
 * execute guards nothing, so the tables come in through the door.
 */
export interface CollapseTables {
  /** Old role name → new role name, or `null` when retired. */
  map: Record<string, string | null>;
  /** New role name → the old roles that land on it, ranked. */
  priority: Record<string, readonly string[]>;
  /** The old dictionary's names, in declaration order. */
  legacyKeys: readonly string[];
}

const LIVE_TABLES: CollapseTables = {
  map: LEGACY_TO_NEW,
  priority: COLLAPSE_PRIORITY,
  legacyKeys: LEGACY_TOKEN_KEYS,
};

/**
 * Old roles whose value lands on `newKey`, in the order they are
 * consulted.
 *
 * Throws when a group has more than one source and no declared
 * priority, and when a declared priority does not cover its group.
 * Either is a programmer error in the two static tables of this file
 * and the alternative is the thing this module exists to prevent — a
 * silent pick — so it fails loudly on the first call rather than
 * choosing on its own. `themeMigration.test.ts` is what keeps it from
 * ever shipping, and reaches both throws through {@link CollapseTables}.
 */
export function sourcesFor(
  newKey: string,
  tables: CollapseTables = LIVE_TABLES,
): readonly string[] {
  const found = tables.legacyKeys.filter((old) => tables.map[old] === newKey);
  if (found.length <= 1) return found;
  const declared = tables.priority[newKey];
  if (!declared) {
    throw new Error(
      `${newKey} now collapses ${found.join(', ')} and COLLAPSE_PRIORITY does not say which wins — ` +
        'declare the order (and the reason) rather than letting key order decide',
    );
  }
  const ordered = declared.filter((old) => found.includes(old));
  if (ordered.length !== found.length) {
    throw new Error(
      `COLLAPSE_PRIORITY[${newKey}] does not cover ${found.filter((o) => !declared.includes(o)).join(', ')}`,
    );
  }
  return ordered;
}

/** The builtin value of `def` on `base` — the INV-9 seed. */
function builtinValue(def: TokenDef, base: ThemeBase): string {
  return base === 'dark' ? def.dark : def.light;
}

declare const RESOLVED_BRAND: unique symbol;

/**
 * A value {@link resolveReferences} has already been through.
 *
 * A phantom brand, erased at compile time and costing nothing at
 * runtime. It exists so the dependency in {@link referencesSelf}'s
 * docblock below is carried by the SIGNATURE rather than by prose: that
 * function is only correct on output of `resolveReferences`, the
 * argument that says so is a paragraph, and a paragraph does not fail
 * the build when a future caller hands it a raw string. This type does.
 */
export type ResolvedValue = string & { readonly [RESOLVED_BRAND]: true };

/**
 * Does `value` reference `key` — i.e. would the role point at itself?
 *
 * Matches lower-case `var(` only, and that is safe rather than lucky:
 * the input is the OUTPUT of {@link resolveReferences}, which re-emits
 * every reference it finds — `VAR(`, `Var(`, any casing — through one
 * lower-case `wrap()`. A value that still holds an upper-case `VAR(` at
 * this point is a value `resolveReferences` did not see, and it did not
 * see it only when there was nothing there to see. An `i` flag here
 * would therefore be a branch no input can reach; the casing question is
 * answered one step earlier, where it is reachable, and
 * `themeMigration.test.ts` pins the normalisation that makes this true.
 * The ROLE name stays case-sensitive, because custom property names are.
 *
 * That reasoning holds ONLY for a value that went through
 * `resolveReferences` first, so the parameter is typed
 * {@link ResolvedValue} and not `string`: a caller reaching for this
 * with a raw snapshot value — the shape on which the missing `i` flag
 * really would be a bug — does not compile. Being module-private was
 * never enough on its own; the next function added to this file is
 * inside the module too.
 */
function referencesSelf(value: ResolvedValue, key: string): boolean {
  return new RegExp(`var\\(\\s*${key.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}\\s*[,)]`).test(value);
}

/** Guards `resolveReferences` against a cycle in the legacy defaults. */
const MAX_REFERENCE_DEPTH = 8;

/**
 * Rewrite every `var(--role)` inside `value` so it names a role of the
 * NEW dictionary, or return `null` when that cannot be done (INV-13,
 * plan decision R6).
 *
 * A saved snapshot copies reference values verbatim —
 * `--status-standing: var(--accent-cyan)`, `--font-size-meta:
 * var(--font-xs)` — so after the dictionary is replaced they point at
 * names nothing declares. A dangling reference does not throw: it falls
 * back to whatever the cascade has, which is the BUILTIN theme's value,
 * so the role silently deserts the user's theme while INV-9 and SC-004
 * both report success. Hence a step of its own.
 *
 * Three outcomes per reference, in order:
 *
 *   • the name is already a new role → left exactly as written, which
 *     is the point of preferring re-pointing to resolving: a value that
 *     was derived on purpose (`--on-mark` follows `--ink`) stays
 *     derived;
 *   • the name is an old role WITH a successor → renamed to it, keeping
 *     any `var()` fallback intact;
 *   • the name is a RETIRED old role → substituted with that role's own
 *     pre-redesign default for this base, which is then resolved in
 *     turn (`--font-size-meta` was `var(--font-xs)`, so one step of
 *     substitution lands on a role that still exists). Derivedness is
 *     lost here, and that is R6's stated trade: there is no successor
 *     to be derived FROM.
 *
 * Anything else — a name from no dictionary at all, an unbalanced
 * `var(`, a chain deeper than {@link MAX_REFERENCE_DEPTH} — returns
 * `null`. The caller then seeds the role from the builtin theme. That
 * loses a value, and it is the only honest option: there is nothing to
 * resolve the reference to, and keeping it would leave exactly the
 * dangling value INV-13 forbids.
 *
 * ── Why the scan is case-insensitive ────────────────────────────────
 *
 * CSS function names are ASCII case-insensitive, so `VAR(--accent-cyan)`
 * is the same call as `var(--accent-cyan)` and the browser resolves it
 * identically. A lower-case-only scan therefore does not «not find a
 * reference» — it finds a plain string and carries it across verbatim,
 * pointing at a name the new dictionary no longer declares. The role
 * then resolves to the guaranteed-invalid value and paints nothing,
 * while INV-9 and SC-004 both report success: the exact silent shape
 * this step exists to remove. It is reachable without any exotic input —
 * the theme editor takes free text for every role
 * (`ThemeEditorPage.tsx`) — and T013 writes the result back as the new
 * «original», so the damage would outlive the session that caused it.
 * The ROLE name is matched case-sensitively, because custom property
 * names are.
 *
 * ── The result can be LONGER than the input, and there is a cap ──────
 *
 * Rewriting a reference changes its length, and one rewrite grows it:
 * `var(--brand)` → `var(--primary)`, +2 characters. (Measured over the
 * whole of `LEGACY_TO_NEW` on both bases: that is the maximum, and every
 * other rewrite — renames and retired-role substitutions alike — is
 * shorter or equal.) `skein-api` caps a stored variable value at 256
 * characters (`internal/themes/validate.go`), so a value sitting at
 * exactly the cap that carries one such reference migrates to 258 and
 * the T013 write-back is refused with 422 `invalid_variables`.
 *
 * Nothing is done about it here, deliberately. The failure is narrow (a
 * value within 2 characters of a 256-character cap, containing a
 * `var(--brand)`), and it fails in the safe direction: the read path has
 * already painted the migrated value, so the SCREEN is right; only the
 * stored row stays stale, exactly as it does for every other refused
 * write. The one consequence worth knowing is that the refusal is
 * terminal for the page — `useTheme.ts` logs it and never retries for
 * the life of the tab — so the row waits for the next load, or for the
 * next save from the theme editor.
 */
export function resolveReferences(
  value: string,
  base: ThemeBase,
  depth = 0,
): ResolvedValue | null {
  if (depth > MAX_REFERENCE_DEPTH) return null;
  // Positions are taken from a folded copy and applied to the original,
  // so casing inside the value survives untouched.
  const folded = value.toLowerCase();
  if (!folded.includes('var(')) return value as ResolvedValue;

  let out = '';
  let i = 0;
  while (i < value.length) {
    const at = folded.indexOf('var(', i);
    if (at === -1) {
      out += value.slice(i);
      break;
    }
    out += value.slice(i, at);

    // Scan to the `)` that closes THIS var(), not the first one: a
    // fallback may itself hold a var().
    let open = 1;
    let j = at + 'var('.length;
    while (j < value.length && open > 0) {
      if (value[j] === '(') open += 1;
      else if (value[j] === ')') open -= 1;
      j += 1;
    }
    if (open !== 0) return null;

    const inner = value.slice(at + 'var('.length, j - 1);
    const comma = inner.indexOf(',');
    const name = (comma === -1 ? inner : inner.slice(0, comma)).trim();
    const rawFallback = comma === -1 ? null : inner.slice(comma + 1);
    // No shape check on `name` here: it used to carry one, and the check
    // could not discriminate. A name that failed it — malformed, empty,
    // from a third dictionary — is by construction in neither
    // `NEW_KEYS` nor `LEGACY_KEYS`, so it reaches the final `else` below
    // and returns `null` there, on the same line as every other
    // unresolvable reference. Two spellings of one answer, the first of
    // which no input can reach first.

    let fallback: string | null = null;
    if (rawFallback !== null) {
      fallback = resolveReferences(rawFallback, base, depth + 1);
      if (fallback === null) return null;
    }
    const wrap = (n: string) => (fallback === null ? `var(${n})` : `var(${n},${fallback})`);

    if (NEW_KEYS.has(name)) {
      out += wrap(name);
    } else if (LEGACY_KEYS.has(name)) {
      const successor = LEGACY_TO_NEW[name];
      if (successor !== null) {
        out += wrap(successor);
      } else {
        // Retired: no successor to point at, so the reference becomes
        // the value it used to resolve to. `var(--x, fb)` is dropped
        // rather than kept — `--x` HAD a value, so the fallback was
        // never going to be used.
        const substituted = resolveReferences(LEGACY_DEFAULTS[base][name], base, depth + 1);
        if (substituted === null) return null;
        out += substituted;
      }
    } else {
      return null;
    }
    i = j;
  }
  return out as ResolvedValue;
}

/**
 * The snapshot as this function is able to READ it: a plain object with
 * string values, and nothing else.
 *
 * `Theme.variables` is typed `Record<string, string>`, and the type is
 * the contract the SERVER is supposed to keep — not a fact about the
 * bytes that arrive. This function sits on the React read path
 * (`useTheme`), so a row that breaks the contract must not throw there:
 * a `TypeError` inside a `useMemo` unmounts the tree the user is looking
 * at, which is a far worse answer than one role falling back to its
 * builtin value.
 *
 * Two shapes, both previously unhandled and in opposite directions:
 *
 *   • `null` / `undefined` / a non-object — `Object.entries(null)` threw.
 *     Now it reads as an empty snapshot, which the migration already
 *     handles: every role is seeded from the base (INV-9), i.e. the user
 *     gets a whole builtin theme rather than a blank screen.
 *   • a NON-STRING value — `{'--bg': ['red']}` used to pass straight
 *     through, so `applyVariables` called `setProperty('--bg',
 *     '[object Array]')` and the role painted nothing while claiming a
 *     value. Dropped here instead, which routes the role to its builtin
 *     seed.
 *
 * There is deliberately no `Array.isArray` arm. An array IS an object,
 * so it goes through the loop — and its own keys are the numeric
 * strings `"0"`, `"1"`, … , none of which is a role name, so it already
 * comes out as the empty snapshot a special case would have produced.
 * A branch that cannot change an answer is a branch no test can hold to
 * account.
 */
function readableSnapshot(vars: unknown): Record<string, string> {
  if (vars === null || typeof vars !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars as Record<string, unknown>)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

/**
 * The builtin column this snapshot is read against.
 *
 * TypeScript keeps `base` inside the union at compile time, and the
 * value nonetheless comes out of a database row over HTTP, where the
 * type system has no vote. The old code branched on `base === 'dark'`
 * for the seed and indexed `LEGACY_DEFAULTS[base]` for the "did the
 * user touch this" comparison, so an off-union value took the LIGHT
 * seed and then threw on the first old role it met — a half-migrated
 * theme or a crash, depending on how empty the snapshot was.
 *
 * Total, and light-unless-dark: not because light is the better guess
 * for an unknown string, but because ONE defined column throughout is
 * the only outcome that is neither half-applied nor a crash on the
 * render path. A malformed base is a malformed row; the user still gets
 * a coherent theme.
 */
function normalizeBase(base: ThemeBase): ThemeBase {
  return base === 'dark' ? 'dark' : 'light';
}

/**
 * Migrate one saved theme's variable map onto the post-redesign
 * dictionary (sk-285.7 T011, US-3).
 *
 * Pure: same input, same output, no I/O, no clock, no globals. `vars`
 * is not mutated. `base` is the theme's OWN base — the builtin column a
 * missing role is seeded from and the column a "did the user touch
 * this" comparison is made against, so passing the wrong one silently
 * migrates a dark theme against light defaults.
 *
 * ── What comes out ──────────────────────────────────────────────────
 *
 * Exactly the keys of the new dictionary — every one of them, and
 * nothing else. That is INV-9 (no role left to be resolved by the
 * builtin cascade) and step 4 of the plan (keys the new dictionary does
 * not know are dropped) in one statement: the result is BUILT from
 * `ALL_TOKENS` rather than filtered down from the input, so an unknown
 * key cannot survive by being forgotten about.
 *
 * ── Where each role's value comes from, in order ────────────────────
 *
 *   1. THE ROLE'S OWN NAME, when the input already speaks the new
 *      dictionary. Only for names that are not ALSO old roles: the
 *      fourteen names the redesign kept (`--font-xs`, `--width-sliver`,
 *      the four weights …) are read as old roles instead, so that the
 *      ownership rule below still applies to them. Without that split a
 *      structural role would migrate under one rule on the first run
 *      and another on the second.
 *   2. THE OLD ROLES that map here, per `LEGACY_TO_NEW`, resolved by
 *      ownership:
 *        • `owner: 'user'` — colours, font stacks, shadows, durations:
 *          carried across verbatim. A saved value here is authorship.
 *        • `owner: 'structural'` — sizes, leadings, weights, spacing,
 *          radii, widths: carried ONLY when the saved value differs
 *          from that role's PRE-redesign default, i.e. when the user
 *          set it deliberately (INV-11, R5). Otherwise the role is
 *          re-seeded with the new builtin value — the redesign IS these
 *          numbers, and a theme that kept them all would simply not be
 *          migrated. Comparing against the NEW default instead would
 *          re-seed precisely the values someone chose on purpose.
 *      Several old roles landing here → {@link COLLAPSE_PRIORITY}, and
 *      {@link ORDER_DECIDES} for the one group where the declared order
 *      outranks the "touched" signal.
 *   3. THE BUILTIN VALUE for `base`, when the input says nothing usable
 *      about this role — a role the old dictionary did not have, a
 *      snapshot that never carried it, a structural role nobody
 *      touched, or a value whose references could not be made to point
 *      at anything real (including the self-reference a collapse can
 *      manufacture — see `carry` below).
 *
 * Every carried value then goes through {@link resolveReferences}
 * (INV-13). Builtin values do not: they are written against the current
 * dictionary by construction.
 *
 * ── Idempotence ─────────────────────────────────────────────────────
 *
 * `migrate(migrate(x))` equals `migrate(x)`, and it falls out of the
 * rules above rather than being enforced by a flag. On the second pass
 * there are no old names left, so route 2 is empty for every renamed
 * role and route 1 hands back what the first pass produced. The
 * fourteen kept names are the only ones that go round twice, and R5
 * makes them stable too: a role re-seeded on pass one now holds the NEW
 * default, which differs from the OLD one, so pass two reads it as
 * "touched" and carries it unchanged — the same value either way.
 */
export function migrateThemeVariables(
  vars: Readonly<Record<string, string>>,
  base: ThemeBase,
): Record<string, string> {
  const saved = readableSnapshot(vars);
  const column = normalizeBase(base);
  const out: Record<string, string> = {};

  for (const def of ALL_TOKENS) {
    const builtin = builtinValue(def, column);

    /**
     * A saved value, made to point at the current dictionary — or the
     * builtin, when it cannot be.
     *
     * The self-reference case is not hypothetical and is not the user's
     * doing: the collapses MANUFACTURE it. `--status-standing` was
     * `var(--accent-cyan)` by default and both roles now land on
     * `--secondary`, so re-pointing the reference yields
     * `--secondary: var(--secondary)` — a cycle, which CSS resolves to
     * the guaranteed-invalid value, i.e. the role paints nothing at
     * all. Seeding from the builtin instead is the only outcome that
     * leaves the role with a colour. Cycles running through OTHER roles
     * (`--a: var(--b)`, `--b: var(--a)`) are the theme author's own and
     * are neither created nor repaired here.
     */
    const carry = (value: string): string => {
      const resolved = resolveReferences(value, column);
      if (resolved === null) return builtin;
      return referencesSelf(resolved, def.key) ? builtin : resolved;
    };

    // 1. The role's own name, when it is not also an old role.
    const direct = LEGACY_KEYS.has(def.key) ? undefined : saved[def.key];
    if (direct !== undefined) {
      out[def.key] = carry(direct);
      continue;
    }

    // 2. The old roles that map here.
    const present = sourcesFor(def.key).filter((old) => saved[old] !== undefined);

    /**
     * The sources the user set DELIBERATELY, by the only signal the
     * storage format offers (plan decision R5): a value that is not the
     * role's own pre-redesign default.
     *
     * The comparison is exact string equality, and that is a decision
     * rather than an oversight. `2PX` reads as "touched", so a role
     * written that way keeps the user's value and never receives the
     * redesign's — for good, once T013 writes the migrated snapshot back
     * as the new original. Only the CASING half of that is live:
     * `ValidateVariables` in `skein-api` (`internal/themes/validate.go`)
     * runs `strings.TrimSpace` on every value before it is stored, so a
     * saved value cannot carry the edge whitespace that ` 2px` / `2px `
     * would need — that shape is unreachable through the API and is not
     * a case this comparison has to answer for. Normalising instead
     * would mean deciding, per role, what a "value equal to the default"
     * is — `#FFF` vs `#ffffff` vs `white` are one colour, `1e1px` and
     * `10px` one length — and every such rule is a rule for taking a
     * setting away from someone who typed it. The failure direction of
     * exact equality is "the user keeps what they wrote"; the failure
     * direction of normalising is "the user silently loses it". Only one
     * of those is recoverable by the user, in the editor, in one edit.
     */
    const touched = present.filter((old) => saved[old] !== LEGACY_DEFAULTS[column][old]);

    // A structural role nobody touched is re-seeded (INV-11), whatever
    // the group's own rule says; a user role falls back to what is there.
    const carryable = def.owner === 'structural' && touched.length === 0 ? [] : present;
    // Tier 2 — the touched sources outrank the declared order — except
    // in a group whose sources differ in KIND (see {@link ORDER_DECIDES}).
    const decisive = ORDER_DECIDES.has(def.key)
      ? carryable
      : touched.length > 0
        ? touched
        : carryable;

    // 3. Nothing to carry — the builtin value of this theme's base.
    if (decisive.length === 0) {
      out[def.key] = builtin;
      continue;
    }
    out[def.key] = carry(saved[decisive[0]]);
  }

  return out;
}

/* ═════════════ T013 — is this row still the old dictionary? ═══════════ */

/**
 * Old names that are ONLY old — the pre-redesign dictionary minus the
 * fourteen names the redesign kept.
 *
 * The subtraction is the whole point. "Does the snapshot contain a
 * legacy key" read literally is true of every migrated row forever
 * (`--font-xs`, `--width-sliver`, the four weights … are in both
 * dictionaries), which would make {@link needsMigration} a constant and
 * turn the one-time write into a write on every page load.
 */
const LEGACY_ONLY_KEYS: readonly string[] = LEGACY_TOKEN_KEYS.filter((key) => !NEW_KEYS.has(key));

/**
 * Is this saved snapshot still, in part, the pre-redesign dictionary
 * (sk-285.7 T013, US-3)?
 *
 * True when the map holds a name only the old dictionary had, or lacks
 * a name the new one declares. Either way {@link migrateThemeVariables}
 * has real work to do and the row on the server is out of date.
 *
 * ── Why it is written as a predicate and not as `migrate(x) ≠ x` ─────
 *
 * Because the two answer different questions and only one of them is
 * cheap to defend. This one is about the SHAPE of the row — the set of
 * names it carries — and that is what the one-time write exists to fix:
 * a row keyed by names nothing declares any more. `migrate(x) ≠ x`
 * would additionally fire on rows whose names are all current but whose
 * VALUES the migration would still touch, and the plan does not ask for
 * that.
 *
 * What that leaves uncaught, stated rather than left to be discovered:
 * a row whose keys are all current but that holds, say, `--primary:
 * var(--accent-magenta)` — a reference to a retired role, written by
 * hand in the editor. `needsMigration` says no, so the row is not
 * rewritten. **The screen is still correct**: the read path (T012)
 * migrates every load regardless of this predicate, so the reference is
 * resolved before anything is painted. Only the stored row stays stale,
 * and the next save from the theme editor — which seeds its draft
 * through this same migration — normalises it. Nothing silently paints
 * wrong; a row is simply written back later than it could have been.
 *
 * ── Idempotence ─────────────────────────────────────────────────────
 *
 * `needsMigration(migrateThemeVariables(x, base))` is false for every
 * `x`: the migration builds its output from `ALL_TOKENS`, so the result
 * carries every new name and no old-only one, which is the exact
 * negation of both clauses. That is what makes the write happen once —
 * structurally, not by remembering that it happened.
 */
export function needsMigration(vars: Readonly<Record<string, string>>): boolean {
  const saved = readableSnapshot(vars);
  if (LEGACY_ONLY_KEYS.some((key) => saved[key] !== undefined)) return true;
  return ALL_TOKENS.some((def) => saved[def.key] === undefined);
}
