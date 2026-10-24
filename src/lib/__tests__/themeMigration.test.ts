/**
 * The theme migration (sk-285.7 T010 / T011).
 *
 * `migrateThemeVariables` rewrites the themes of live users. A wrong
 * successor throws nothing — it moves a colour someone chose onto a role
 * that paints something else — so the function is tested here from its
 * invariants, on hand-built snapshots.
 */
import { describe, expect, test } from 'vitest';

import {
  ALL_TOKENS,
  ALL_TOKEN_KEYS,
  defaultVariablesForBase,
} from '../themeTokens';
import { LEGACY_DEFAULTS, LEGACY_TOKEN_KEYS } from '../themeTokensLegacy';
import {
  COLLAPSE_PRIORITY,
  LEGACY_TO_NEW,
  ORDER_DECIDES,
  migrateThemeVariables,
  needsMigration,
  resolveReferences,
  sourcesFor,
  successorOf,
} from '../themeMigration';

describe('successorOf', () => {
  test('successorOf refuses a name that is not a pre-redesign role', () => {
    expect(() => successorOf('--ink')).toThrow(/not a pre-redesign role/);
    expect(() => successorOf('--not-a-role-at-all')).toThrow(/not a pre-redesign role/);
    expect(successorOf('--bg-base')).toBe('--bg');
    expect(successorOf('--font-size-body')).toBeNull();
  });
});

/* ══════════════════ T011 — the migration function itself ═════════════ */

/**
 * `migrateThemeVariables` rewrites the themes of live users, and every
 * way it can be wrong is silent: a value goes to the wrong role, or a
 * setting someone chose is replaced by a default, and nothing throws.
 * So the tests below are written from the invariants (INV-9 / INV-11 /
 * INV-13 and the plan's R5 / R6), not from a reading of the
 * implementation, and each fixture is a hand-built snapshot rather than
 * something the module produced.
 *
 * Both sides of every comparison are independent: expected values are
 * either literals taken from the frozen snapshot / the registry, or
 * quantities derived from a DIFFERENT source than the one under test.
 */

/** A full pre-redesign snapshot for `base`, exactly as saved. */
const untouchedSnapshot = (base: 'light' | 'dark'): Record<string, string> => ({
  ...LEGACY_DEFAULTS[base],
});

/** The builtin value of one new role on one base. */
const builtin = (key: string, base: 'light' | 'dark'): string => {
  const def = ALL_TOKENS.find((t) => t.key === key);
  if (!def) throw new Error(`${key} is not a role of the new registry`);
  return base === 'dark' ? def.dark : def.light;
};

const ownerOf = (key: string): 'user' | 'structural' => {
  const def = ALL_TOKENS.find((t) => t.key === key);
  if (!def) throw new Error(`${key} is not a role of the new registry`);
  return def.owner;
};

describe('INV-9 — every role of the new dictionary comes out with a value', () => {
  test.each([
    ['a full pre-redesign snapshot', untouchedSnapshot('light')],
    ['an EMPTY theme', {}],
    ['a theme of nothing but names no dictionary knows', { '--not-a-role': 'red' }],
    ['a partial theme', { '--brand': '#010203' }],
  ])('%s yields exactly the new key set', (_what, vars) => {
    const out = migrateThemeVariables(vars, 'light');
    expect(Object.keys(out).sort()).toEqual([...ALL_TOKEN_KEYS].sort());
    expect(Object.values(out).every((v) => typeof v === 'string' && v.length > 0)).toBe(true);
  });

  test('a role with no predecessor is seeded from the theme\'s own base', () => {
    // `--radius-card` is new: the old sheet had two radii and cut cards
    // with whichever was nearer, so there is nothing to carry.
    const light = migrateThemeVariables(untouchedSnapshot('light'), 'light');
    const dark = migrateThemeVariables(untouchedSnapshot('dark'), 'dark');
    expect(light['--radius-card']).toBe(builtin('--radius-card', 'light'));
    expect(dark['--radius-card']).toBe(builtin('--radius-card', 'dark'));
  });

  test('keys the new dictionary does not know are dropped, not carried', () => {
    const out = migrateThemeVariables(
      { ...untouchedSnapshot('light'), '--brand': '#010203', '--totally-made-up': 'red' },
      'light',
    );
    expect(out['--totally-made-up']).toBeUndefined();
    // …and no OLD name survives either, which is the same claim from
    // the side that actually has candidates.
    const survivors = LEGACY_TOKEN_KEYS.filter((k) => !ALL_TOKEN_KEYS.includes(k) && k in out);
    expect(survivors).toEqual([]);
    // The unknown key did not derail the rest.
    expect(out['--primary']).toBe('#010203');
  });
});

describe('INV-11 — colours are the user\'s, structure is the system\'s', () => {
  test('a user role carries its saved value verbatim, on both bases', () => {
    const light = migrateThemeVariables({ '--brand': '#010203' }, 'light');
    expect(light['--primary']).toBe('#010203');
    const dark = migrateThemeVariables({ '--brand': '#040506' }, 'dark');
    expect(dark['--primary']).toBe('#040506');
  });

  test('a user role carries even a value equal to the OLD default', () => {
    // INV-2: a saved theme IS the authored artefact, so its colours
    // survive whether or not they were edited away from the default.
    const out = migrateThemeVariables(untouchedSnapshot('light'), 'light');
    expect(out['--primary']).toBe(LEGACY_DEFAULTS.light['--brand']);
    expect(out['--primary']).not.toBe(builtin('--primary', 'light'));
  });

  test('an UNTOUCHED structural role is re-seeded with the new default', () => {
    const out = migrateThemeVariables(untouchedSnapshot('light'), 'light');
    expect(out['--font-sm']).toBe(builtin('--font-sm', 'light'));
    expect(out['--font-sm']).not.toBe(LEGACY_DEFAULTS.light['--font-sm']);
    expect(out['--radius-control']).toBe(builtin('--radius-control', 'light'));
    expect(out['--radius-control']).not.toBe(LEGACY_DEFAULTS.light['--radius-default']);
  });

  test('a TOUCHED structural role keeps what the user set', () => {
    // R5, and the failure US-3 exists to prevent: a deliberate size
    // must not be "returned" by the redesign.
    const out = migrateThemeVariables(
      { ...untouchedSnapshot('light'), '--font-sm': '19px', '--radius-default': '3px' },
      'light',
    );
    expect(out['--font-sm']).toBe('19px');
    expect(out['--radius-control']).toBe('3px');
  });

  test('"touched" is judged against the OLD default, not the new one', () => {
    // The whole point of the frozen snapshot, stated on the ONE input
    // where the two candidate rules give different answers.
    //
    // `--radius-default` was 2px and `--radius-control` is 6px. A user
    // sitting on 2px never touched it, so it must be re-seeded to 6px.
    // A rule that compared against the NEW default would read 2 ≠ 6 as
    // "deliberate" and pin that theme at 2px forever — the pre-redesign
    // geometry surviving under a new name, which is the failure this
    // whole task exists to prevent.
    const old = LEGACY_DEFAULTS.light['--radius-default'];
    const fresh = builtin('--radius-control', 'light');
    expect(old, 'the two defaults must differ or this proves nothing').not.toBe(fresh);

    expect(migrateThemeVariables({ '--radius-default': old }, 'light')['--radius-control']).toBe(
      fresh,
    );
    // The mirror case: a user who HAD set it stays where they set it,
    // including when they had set it to what is now the new default.
    expect(migrateThemeVariables({ '--radius-default': '3px' }, 'light')['--radius-control']).toBe(
      '3px',
    );
    expect(migrateThemeVariables({ '--radius-default': fresh }, 'light')['--radius-control']).toBe(
      fresh,
    );
  });

  test('a dark theme is filled from the DARK column, never the light one', () => {
    // The base is not decoration: it picks both the seed for a role the
    // snapshot cannot supply and the column a "did the user touch this"
    // comparison is made against. An empty theme isolates the first
    // half — whatever comes out is entirely seed.
    const seedLight = migrateThemeVariables({}, 'light');
    const seedDark = migrateThemeVariables({}, 'dark');
    expect(seedLight).toEqual(defaultVariablesForBase('light'));
    expect(seedDark).toEqual(defaultVariablesForBase('dark'));

    // Non-vacuous: the two columns really do differ, and on many roles —
    // otherwise the two assertions above would be one assertion twice.
    const differing = ALL_TOKEN_KEYS.filter((k) => seedLight[k] !== seedDark[k]);
    expect(differing.length).toBeGreaterThan(10);

    // …and a value CARRIED from a dark snapshot is the dark one. Both
    // pairs below are roles the two columns genuinely disagree on —
    // `--brand` would prove nothing here, it is #cb4b16 on both.
    const carried = migrateThemeVariables(untouchedSnapshot('dark'), 'dark');
    expect(LEGACY_DEFAULTS.dark['--fg-high']).not.toBe(LEGACY_DEFAULTS.light['--fg-high']);
    expect(carried['--ink']).toBe(LEGACY_DEFAULTS.dark['--fg-high']);
    expect(carried['--bg']).toBe(LEGACY_DEFAULTS.dark['--bg-base']);
    expect(carried['--bg']).not.toBe(LEGACY_DEFAULTS.light['--bg-base']);
  });

  test('the touched test is per BASE — a dark theme is judged against dark defaults', () => {
    // `--brand-text` is #b0400f light and #ed7951 dark. Reading a dark
    // theme against the light column would call an untouched value
    // touched and vice versa. Structural roles are where it decides an
    // outcome, and the two bases share those values — so the honest
    // check is that the base picks the SEED, which differs.
    const out = migrateThemeVariables(untouchedSnapshot('dark'), 'dark');
    expect(out['--bg']).toBe(LEGACY_DEFAULTS.dark['--bg-base']);
    expect(out['--radius-card']).toBe(builtin('--radius-card', 'dark'));
    expect(out['--n-900']).toBe(builtin('--n-900', 'dark'));
    expect(out['--n-900']).not.toBe(builtin('--n-900', 'light'));
  });
});

describe('collapses — which of several arriving values wins', () => {
  test('one source present — it wins, no judgement made', () => {
    const out = migrateThemeVariables({ '--brand-fill': '#0a0b0c' }, 'light');
    expect(out['--primary']).toBe('#0a0b0c');
  });

  test('CONFLICT: several present with different values, exactly one touched → the touched one', () => {
    // The case the priority order alone would get wrong: the user
    // retuned the fill and left the other two grades alone.
    const out = migrateThemeVariables(
      { ...untouchedSnapshot('light'), '--brand-fill': '#0a0b0c' },
      'light',
    );
    expect(out['--primary']).toBe('#0a0b0c');
    expect(out['--primary']).not.toBe(LEGACY_DEFAULTS.light['--brand']);
  });

  test('CONFLICT: several TOUCHED and disagreeing → the declared order decides', () => {
    const out = migrateThemeVariables(
      {
        ...untouchedSnapshot('light'),
        '--brand': '#111111',
        '--brand-text': '#222222',
        '--brand-fill': '#333333',
      },
      'light',
    );
    expect(COLLAPSE_PRIORITY['--primary'][0]).toBe('--brand');
    expect(out['--primary']).toBe('#111111');
  });

  test('CONFLICT: none touched → the declared order decides, and it is not key order', () => {
    // The whole snapshot, so all three brand grades arrive at their old
    // defaults and differ from one another.
    const out = migrateThemeVariables(untouchedSnapshot('light'), 'light');
    expect(out['--primary']).toBe(LEGACY_DEFAULTS.light['--brand']);

    // …and the answer does not move when the input is serialised in a
    // different order, which is the property "deterministic" means here.
    const reversed = Object.fromEntries(Object.entries(untouchedSnapshot('light')).reverse());
    expect(migrateThemeVariables(reversed, 'light')['--primary']).toBe(out['--primary']);
    expect(migrateThemeVariables(reversed, 'light')).toEqual(out);
  });

  test('the group whose declared order is NOT the snapshot\'s order behaves as declared', () => {
    // `--primary-t` takes `--brand-muted` over `--bg-selected`, which
    // the frozen snapshot declares the other way round — so this is the
    // one group where "first in the old dictionary" and "first here"
    // disagree, and reading the answer off key order would show.
    expect(COLLAPSE_PRIORITY['--primary-t'][0]).toBe('--brand-muted');
    expect(LEGACY_TOKEN_KEYS.indexOf('--bg-selected')).toBeLessThan(
      LEGACY_TOKEN_KEYS.indexOf('--brand-muted'),
    );
    const out = migrateThemeVariables(untouchedSnapshot('dark'), 'dark');
    expect(out['--primary-t']).toBe(LEGACY_DEFAULTS.dark['--brand-muted']);
    expect(out['--primary-t']).not.toBe(LEGACY_DEFAULTS.dark['--bg-selected']);
  });
});

describe('INV-13 / SC-010 — no value points at a role that does not exist', () => {
  /** Every `--role` named inside a `var()` in `value`. */
  const referenced = (value: string): string[] =>
    [...value.matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)/g)].map((m) => m[1]);

  test.each(['light', 'dark'] as const)(
    'a migrated %s snapshot references only roles of the new dictionary',
    (base) => {
      const out = migrateThemeVariables(untouchedSnapshot(base), base);
      const dangling = Object.entries(out).flatMap(([key, value]) =>
        referenced(value)
          .filter((name) => !ALL_TOKEN_KEYS.includes(name))
          .map((name) => `${key} → ${name}`),
      );
      expect(dangling).toEqual([]);
      // Non-vacuous: the snapshot really does contain references.
      expect(Object.values(out).some((v) => v.includes('var('))).toBe(true);
    },
  );

  test('a reference to a role WITH a successor is re-pointed, not flattened', () => {
    // R6 prefers re-pointing precisely so a value that was derived on
    // purpose stays derived.
    expect(resolveReferences('var(--accent-cyan)', 'light')).toBe('var(--secondary)');
    expect(resolveReferences('var(--fg-high)', 'light')).toBe('var(--ink)');
  });

  test('a reference to a RETIRED role is resolved to a value, and the chain is followed', () => {
    // `--font-size-meta` is retired and was `var(--font-xs)`, which
    // still exists — so one substitution lands on a live role rather
    // than on a literal.
    expect(resolveReferences('var(--font-size-meta)', 'light')).toBe('var(--font-xs)');
    // `--accent-magenta` is retired and was a literal.
    expect(resolveReferences('var(--accent-magenta)', 'light')).toBe(
      LEGACY_DEFAULTS.light['--accent-magenta'],
    );
    expect(resolveReferences('var(--accent-magenta)', 'dark')).toBe(
      LEGACY_DEFAULTS.dark['--accent-magenta'],
    );
  });

  test('a role already speaking the new dictionary is left exactly as written', () => {
    expect(resolveReferences('var(--ink)', 'light')).toBe('var(--ink)');
    expect(resolveReferences('color-mix(in srgb, var(--info) 14%, transparent)', 'light')).toBe(
      'color-mix(in srgb, var(--info) 14%, transparent)',
    );
  });

  test('references inside a compound value are rewritten in place', () => {
    expect(resolveReferences('1px solid var(--border-subtle)', 'light')).toBe(
      '1px solid var(--line)',
    );
    expect(resolveReferences('var(--fg-high) var(--accent-red)', 'light')).toBe(
      'var(--ink) var(--err)',
    );
  });

  test('a var() FALLBACK is resolved too, and a nested one does not confuse the scan', () => {
    // The fallback is re-emitted with the spacing it was written with —
    // only the NAMES move.
    expect(resolveReferences('var(--fg-high, var(--accent-red))', 'light')).toBe(
      'var(--ink, var(--err))',
    );
    // A retired name HAD a value, so its fallback was never reachable.
    expect(resolveReferences('var(--accent-yellow, red)', 'light')).toBe(
      LEGACY_DEFAULTS.light['--accent-yellow'],
    );
  });

  test('an unresolvable reference is refused, and the role falls back to the builtin', () => {
    expect(resolveReferences('var(--never-existed)', 'light')).toBeNull();
    expect(resolveReferences('var(--ink', 'light')).toBeNull();
    expect(resolveReferences('var(  )', 'light')).toBeNull();

    const out = migrateThemeVariables({ '--brand': 'var(--never-existed)' }, 'light');
    expect(out['--primary']).toBe(builtin('--primary', 'light'));
  });

  test('a collapse that would make a role point at ITSELF falls back instead', () => {
    // Not hypothetical: `--status-standing` defaulted to
    // `var(--accent-cyan)` and both roles now land on `--secondary`, so
    // naive re-pointing yields `--secondary: var(--secondary)` — a
    // cycle, which CSS resolves to nothing at all.
    const out = migrateThemeVariables({ '--status-standing': 'var(--accent-cyan)' }, 'light');
    expect(out['--secondary']).toBe(builtin('--secondary', 'light'));
    expect(out['--secondary']).not.toContain('var(--secondary)');
  });

  test('the full snapshot does NOT hit that case — the base hue wins first', () => {
    // The guard above must not be doing the work on ordinary input: on
    // a real snapshot `--accent-cyan` outranks `--status-standing`, so
    // the colour is carried rather than reset.
    const out = migrateThemeVariables(untouchedSnapshot('light'), 'light');
    expect(out['--secondary']).toBe(LEGACY_DEFAULTS.light['--accent-cyan']);
  });
});

describe('the fourteen names the redesign KEPT go round twice safely', () => {
  test('a kept structural name is judged by ownership, not waved through', () => {
    // `--font-xs` is both an old role and a new one. Read as "already
    // the new dictionary" it would bypass R5 entirely; read as an old
    // role it is re-seeded when untouched and kept when not.
    const kept = LEGACY_TOKEN_KEYS.filter((k) => ALL_TOKEN_KEYS.includes(k));
    expect(kept.length).toBeGreaterThan(0);
    // …and each of them maps to ITSELF, which is what makes reading
    // them as old roles the right call rather than a coincidence.
    expect(kept.filter((k) => LEGACY_TO_NEW[k] !== k)).toEqual([]);

    const untouched = migrateThemeVariables(untouchedSnapshot('light'), 'light');
    expect(untouched['--width-sliver']).toBe(builtin('--width-sliver', 'light'));
    expect(untouched['--width-sliver']).not.toBe(LEGACY_DEFAULTS.light['--width-sliver']);

    const touched = migrateThemeVariables(
      { ...untouchedSnapshot('light'), '--width-sliver': '30px' },
      'light',
    );
    expect(touched['--width-sliver']).toBe('30px');
  });

  test('a kept USER name carries across', () => {
    const out = migrateThemeVariables({ '--font-ui': "'Comic Sans MS', cursive" }, 'light');
    expect(out['--font-ui']).toBe("'Comic Sans MS', cursive");
  });
});

describe('idempotence — the migration is once and for all', () => {
  const mixed = (base: 'light' | 'dark'): Record<string, string> => ({
    ...untouchedSnapshot(base),
    // a retuned colour, a retuned structural role, a reference, a
    // collapse conflict and a name from nowhere
    '--brand-fill': '#0a0b0c',
    '--font-sm': '19px',
    '--status-standing': 'var(--accent-blue)',
    '--fg-low': '#123456',
    '--not-a-role-at-all': 'red',
  });

  test.each(['light', 'dark'] as const)('migrate(migrate(x)) === migrate(x) on %s', (base) => {
    const once = migrateThemeVariables(mixed(base), base);
    const twice = migrateThemeVariables(once, base);
    expect(twice).toEqual(once);
    // Non-vacuous: the fixture really did change something, so the
    // equality above is not two copies of the builtin theme.
    const untouched = migrateThemeVariables(untouchedSnapshot(base), base);
    expect(once).not.toEqual(untouched);
    expect(once['--primary']).toBe('#0a0b0c');
    expect(once['--font-sm']).toBe('19px');
  });

  test('a third pass changes nothing either', () => {
    const once = migrateThemeVariables(mixed('light'), 'light');
    expect(migrateThemeVariables(migrateThemeVariables(once, 'light'), 'light')).toEqual(once);
  });

  test('the builtin theme is a fixed point', () => {
    for (const base of ['light', 'dark'] as const) {
      const seed = Object.fromEntries(ALL_TOKENS.map((t) => [t.key, base === 'dark' ? t.dark : t.light]));
      expect(migrateThemeVariables(seed, base)).toEqual(seed);
    }
  });
});

describe('purity — the function is a function', () => {
  test('the input is not mutated and two calls agree', () => {
    const input = mixedInput();
    const snapshot = JSON.parse(JSON.stringify(input));
    const a = migrateThemeVariables(input, 'light');
    const b = migrateThemeVariables(input, 'light');
    expect(input).toEqual(snapshot);
    expect(b).toEqual(a);
    // …and the output is a fresh object, not a view onto the input.
    a['--primary'] = 'mutated';
    expect(migrateThemeVariables(input, 'light')['--primary']).not.toBe('mutated');
  });
});

function mixedInput(): Record<string, string> {
  return { ...LEGACY_DEFAULTS.light, '--brand-fill': '#0a0b0c', '--font-sm': '19px' };
}

/* ═════════════ the review fixes, and what proves them ════ */

describe('A3 — `VAR(` is the same function call as `var(`', () => {
  // CSS function names are ASCII case-insensitive. A lower-case-only
  // scan does not "fail to find a reference" — it finds a plain string,
  // carries it across verbatim and leaves the role pointing at a name
  // the new dictionary no longer declares. Reachable without anything
  // exotic: the theme editor takes free text for every role, and T013
  // writes the result back as the new original.

  test('an upper-case reference is re-pointed, not carried through', () => {
    expect(resolveReferences('VAR(--accent-cyan)', 'light')).toBe('var(--secondary)');
    expect(resolveReferences('Var(--accent-cyan)', 'light')).toBe('var(--secondary)');
    expect(resolveReferences('vAr(  --accent-cyan  )', 'light')).toBe('var(--secondary)');
    // …and the lower-case answer is unchanged, so this is a widening.
    expect(resolveReferences('var(--accent-cyan)', 'light')).toBe('var(--secondary)');
  });

  test('the function name comes back NORMALISED, whatever went in', () => {
    // This is what lets `referencesSelf` stay case-sensitive: every
    // reference that survives this step has been re-emitted through one
    // lower-case `var(`. Drop the normalisation and the self-reference
    // check downstream goes blind again — so it is pinned here, where
    // the casing question is actually decided.
    for (const spelling of ['VAR(--accent-cyan)', 'Var(--accent-cyan)', 'vAR( --accent-cyan )']) {
      const out = resolveReferences(spelling, 'light');
      expect(out).not.toBeNull();
      expect(out).not.toMatch(/VAR\(/);
      expect(out).toMatch(/^var\(/);
    }
    // A value with no reference at all is handed back byte-for-byte, so
    // "normalised" is a claim about references and nothing else.
    expect(resolveReferences('CALC(1PX + 2PX)', 'light')).toBe('CALC(1PX + 2PX)');
  });

  test('a RETIRED role referenced in upper case is resolved to its value', () => {
    const out = migrateThemeVariables({ '--brand': 'VAR(--accent-magenta)' }, 'light');
    // The literal is the defect: it is what the role held before the fix.
    expect(out['--primary']).not.toBe('VAR(--accent-magenta)');
    expect(out['--primary']).toBe(LEGACY_DEFAULTS.light['--accent-magenta']);
  });

  test('an upper-case SELF-reference manufactured by a collapse is caught', () => {
    // `--status-standing` was `var(--accent-cyan)` and both land on
    // `--secondary`, so re-pointing yields `--secondary: var(--secondary)`
    // — a cycle CSS resolves to guaranteed-invalid, i.e. the role paints
    // nothing. `referencesSelf` has to see it whatever the casing.
    const out = migrateThemeVariables({ '--status-standing': 'VAR(--accent-cyan)' }, 'light');
    expect(out['--secondary']).toBe(builtin('--secondary', 'light'));
    expect(out['--secondary']).not.toMatch(/var\(/i);
  });

  test('no value of a snapshot written in upper case points at a dead name', () => {
    const known = new Set(ALL_TOKEN_KEYS);
    const out = migrateThemeVariables(
      {
        ...untouchedSnapshot('light'),
        '--brand': 'VAR(--accent-magenta)',
        '--accent-blue': 'VAR(--accent-cyan)',
        '--fg-high': 'VAR(--font-size-meta)',
      },
      'light',
    );
    const dangling: string[] = [];
    for (const [key, value] of Object.entries(out)) {
      for (const [, name] of value.matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)/gi)) {
        if (!known.has(name)) dangling.push(`${key} → ${name}`);
      }
    }
    expect(dangling).toEqual([]);
    // Non-vacuous: the fixture really did carry upper-case references.
    expect(untouchedSnapshot('light')['--brand']).not.toMatch(/var\(/i);
  });
});

describe('A4 — `--elev` is the one collapse where KIND outranks "touched"', () => {
  // `COLLAPSE_PRIORITY['--elev']` justifies its order by kind: a PLATE
  // beats a WASH, because a translucent film used as a plate paints a
  // see-through panel. Tier 2 overrode that whenever the user had
  // touched the film — so a snapshot with only `--bg-hover` retuned
  // produced a semi-transparent value on an opaque role, i.e. the exact
  // defect the entry names.

  test('the fixture really does differ in kind (an equal pair would prove nothing)', () => {
    for (const base of ['light', 'dark'] as const) {
      expect(LEGACY_DEFAULTS[base]['--bg-elevated']).not.toBe(LEGACY_DEFAULTS[base]['--bg-hover']);
      // The plate is opaque, the wash is not — that IS the divergence.
      expect(LEGACY_DEFAULTS[base]['--bg-elevated']).toMatch(/^#[0-9a-f]{6}$/i);
      expect(LEGACY_DEFAULTS[base]['--bg-hover']).toMatch(/^rgba\(/i);
    }
    expect(ownerOf('--elev')).toBe('user');
  });

  test.each(['light', 'dark'] as const)(
    'a retuned WASH does not become the plate on %s',
    (base) => {
      const retuned = base === 'light' ? 'rgba(0, 90, 255, 0.08)' : 'rgba(255, 90, 0, 0.08)';
      const out = migrateThemeVariables(
        { ...untouchedSnapshot(base), '--bg-hover': retuned },
        base,
      );
      expect(out['--elev']).toBe(LEGACY_DEFAULTS[base]['--bg-elevated']);
      expect(out['--elev']).not.toBe(retuned);
      // …and the plate it takes instead is opaque. Only for THIS input:
      // opacity is a property of the winning source, not a promise the
      // migration makes about `--elev` — with no plate saved the film is
      // carried unopposed, which the "no plate" case below pins.
      expect(out['--elev']).not.toMatch(/rgba\(/i);
    },
  );

  test('a retuned PLATE still wins, so the order is not simply "always the first"', () => {
    const out = migrateThemeVariables(
      { ...untouchedSnapshot('light'), '--bg-elevated': '#0a0b0c' },
      'light',
    );
    expect(out['--elev']).toBe('#0a0b0c');
  });

  test('the wash still supplies the role when no plate is saved', () => {
    // Suspending tier 2 must not mean discarding the only source there is.
    const out = migrateThemeVariables({ '--bg-hover': 'rgba(1, 2, 3, 0.5)' }, 'light');
    expect(out['--elev']).toBe('rgba(1, 2, 3, 0.5)');
  });

  test('every OTHER collapse group still lets "touched" win', () => {
    // The suspension is one group wide, and this is what says so: the
    // brand group's fill beats an untouched base grade, exactly as
    // before. Widening ORDER_DECIDES turns this red.
    expect([...ORDER_DECIDES]).toEqual(['--elev']);
    const out = migrateThemeVariables(
      { ...untouchedSnapshot('light'), '--brand-fill': '#0a0b0c' },
      'light',
    );
    expect(out['--primary']).toBe('#0a0b0c');
  });

  test('ORDER_DECIDES names only real collapse groups', () => {
    for (const key of ORDER_DECIDES) {
      expect(Object.keys(COLLAPSE_PRIORITY)).toContain(key);
    }
  });
});

describe('M1 — "touched" is exact string equality, and that is the decision', () => {
  // A default written with a stray space or in another case reads as
  // "the user set this", so the role keeps their text and never receives
  // the redesign's value. The direction is deliberate: the failure mode
  // of exact equality is "the user keeps what they typed", which they
  // can undo in the editor; the failure mode of normalising is "the user
  // silently loses a setting", which they cannot.

  // `--font-base` is structural, keeps its NAME across the redesign (so
  // it takes the ownership route rather than the "already new" one) and
  // moved 14px → 16px, which is what makes re-seeding observable.
  const STRUCTURAL = '--font-base';

  test('the role under test is structural, and re-seeding it is observable', () => {
    expect(LEGACY_TO_NEW[STRUCTURAL]).toBe(STRUCTURAL);
    expect(ownerOf(STRUCTURAL)).toBe('structural');
    expect(builtin(STRUCTURAL, 'light')).not.toBe(LEGACY_DEFAULTS.light[STRUCTURAL]);
  });

  test('the exact default is re-seeded', () => {
    const old = LEGACY_DEFAULTS.light[STRUCTURAL];
    const out = migrateThemeVariables({ [STRUCTURAL]: old }, 'light');
    expect(out[STRUCTURAL]).toBe(builtin(STRUCTURAL, 'light'));
  });

  test.each([' ', 'trailing', 'case'])(
    'the same default with a "%s" difference is kept, not re-seeded',
    (kind) => {
      const old = LEGACY_DEFAULTS.light[STRUCTURAL];
      const written = kind === ' ' ? ` ${old}` : kind === 'trailing' ? `${old} ` : old.toUpperCase();
      expect(written).not.toBe(old);
      const out = migrateThemeVariables({ [STRUCTURAL]: written }, 'light');
      expect(out[STRUCTURAL]).toBe(written);
    },
  );
});

describe('M2 — a row that breaks its own type does not break the render path', () => {
  // `Theme.variables` is typed `Record<string, string>`, which is what
  // the server is supposed to send, not a fact about the bytes that
  // arrive. This function runs inside a `useMemo`, so a throw here
  // unmounts the tree the user is looking at.

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 7],
    ['a string', 'not a map'],
    ['an array', ['--bg', '#fff']],
  ])('%s reads as an empty snapshot — a whole builtin theme, not a crash', (_name, input) => {
    expect(() => migrateThemeVariables(input as never, 'light')).not.toThrow();
    expect(migrateThemeVariables(input as never, 'light')).toEqual(defaultVariablesForBase('light'));
  });

  test('a NON-STRING value is dropped, not stringified onto the role', () => {
    // `['red']` used to pass straight through, so `setProperty` was
    // called with `'red'`-ish coercion and the role claimed a value it
    // did not have.
    const out = migrateThemeVariables(
      { '--brand': ['#ff0000'], '--bg-base': 42, '--fg-high': '#123456' } as never,
      'light',
    );
    expect(out['--primary']).toBe(builtin('--primary', 'light'));
    expect(out['--bg']).toBe(builtin('--bg', 'light'));
    // The one well-formed entry still lands.
    expect(out['--ink']).toBe('#123456');
    for (const value of Object.values(out)) expect(typeof value).toBe('string');
  });
});

describe('M3 — a base outside the union picks ONE column, and never half of two', () => {
  // The old code branched on `base === 'dark'` for the seed but indexed
  // `LEGACY_DEFAULTS[base]` for the "touched" comparison, so an
  // off-union value took the light seed and then threw on the first old
  // role it met — a crash on an empty snapshot's neighbour, a
  // half-migrated theme otherwise.

  test.each(['LIGHT', 'Dark', '', 'sepia'])('base "%s" is total and light-unless-dark', (bogus) => {
    expect(() => migrateThemeVariables(untouchedSnapshot('light'), bogus as never)).not.toThrow();
    expect(migrateThemeVariables(untouchedSnapshot('light'), bogus as never)).toEqual(
      migrateThemeVariables(untouchedSnapshot('light'), 'light'),
    );
  });

  test('the two real bases still disagree, so "total" is not "always light"', () => {
    expect(migrateThemeVariables(untouchedSnapshot('dark'), 'dark')).not.toEqual(
      migrateThemeVariables(untouchedSnapshot('light'), 'light'),
    );
  });
});

describe('M4/M5 — the guards that used to be unreachable', () => {
  test('an unresolvable reference name returns null through the last branch', () => {
    // The shape check on the name was removed: a name that failed it is
    // in neither dictionary, so it reached the final `else` and returned
    // null there anyway. These are the inputs that prove the remaining
    // branch answers for all of them.
    expect(resolveReferences('var(notaname)', 'light')).toBeNull();
    expect(resolveReferences('var()', 'light')).toBeNull();
    expect(resolveReferences('var(--from-nowhere)', 'light')).toBeNull();
    expect(resolveReferences('var(--bg', 'light')).toBeNull();
  });

  test('a collapse with no declared order throws rather than picking', () => {
    expect(() =>
      sourcesFor('--x', {
        map: { '--a': '--x', '--b': '--x' },
        priority: {},
        legacyKeys: ['--a', '--b'],
      }),
    ).toThrow(/does not say which wins/);
  });

  test('a declared order that does not cover its group throws', () => {
    expect(() =>
      sourcesFor('--x', {
        map: { '--a': '--x', '--b': '--x' },
        priority: { '--x': ['--a'] },
        legacyKeys: ['--a', '--b'],
      }),
    ).toThrow(/does not cover --b/);
  });

  test('a covered group returns the declared order, and a lone source needs none', () => {
    expect(
      sourcesFor('--x', {
        map: { '--a': '--x', '--b': '--x' },
        priority: { '--x': ['--b', '--a'] },
        legacyKeys: ['--a', '--b'],
      }),
    ).toEqual(['--b', '--a']);
    expect(
      sourcesFor('--x', { map: { '--a': '--x' }, priority: {}, legacyKeys: ['--a'] }),
    ).toEqual(['--a']);
    expect(sourcesFor('--x', { map: {}, priority: {}, legacyKeys: [] })).toEqual([]);
  });

  test('the live tables reach neither throw — which is why the ones above are synthetic', () => {
    for (const key of ALL_TOKEN_KEYS) expect(() => sourcesFor(key)).not.toThrow();
  });
});

describe('T013 — `needsMigration`: is the STORED row still the old dictionary?', () => {
  test.each(['light', 'dark'] as const)('a full pre-redesign snapshot on %s needs it', (base) => {
    expect(needsMigration(untouchedSnapshot(base))).toBe(true);
  });

  test('an empty map needs it — it lacks every role of the new dictionary', () => {
    expect(needsMigration({})).toBe(true);
  });

  test('a map missing exactly one new role needs it', () => {
    const full = defaultVariablesForBase('light');
    for (const key of ALL_TOKEN_KEYS.slice(0, 5)) {
      const { [key]: _dropped, ...rest } = full;
      expect(needsMigration(rest), `${key} missing`).toBe(true);
    }
  });

  test.each(['light', 'dark'] as const)(
    'the migration\'s own output on %s does NOT need it (this is what makes the write one-time)',
    (base) => {
      expect(needsMigration(migrateThemeVariables(untouchedSnapshot(base), base))).toBe(false);
      expect(needsMigration(migrateThemeVariables({}, base))).toBe(false);
      expect(needsMigration(defaultVariablesForBase(base))).toBe(false);
    },
  );

  test('the fourteen names the redesign KEPT do not make a migrated row look stale', () => {
    // The trap in the predicate as the plan words it. Read literally,
    // "contains a legacy key" is true of every migrated row forever —
    // `--font-xs`, `--width-sliver` and the four weights are in BOTH
    // dictionaries — which would turn the one-time write into a write
    // on every page load. Only names that are old and ONLY old count.
    const kept = LEGACY_TOKEN_KEYS.filter((k) => ALL_TOKEN_KEYS.includes(k));
    expect(kept.length).toBeGreaterThan(0);
    const migrated = migrateThemeVariables(untouchedSnapshot('light'), 'light');
    for (const key of kept) expect(migrated[key]).toBeDefined();
    expect(needsMigration(migrated)).toBe(false);
  });

  test('one old-ONLY name is enough, even in an otherwise complete map', () => {
    const retired = LEGACY_TOKEN_KEYS.filter((k) => !ALL_TOKEN_KEYS.includes(k));
    expect(retired.length).toBeGreaterThan(0);
    for (const key of retired.slice(0, 5)) {
      expect(needsMigration({ ...defaultVariablesForBase('light'), [key]: 'red' }), key).toBe(true);
    }
  });

  test('a key from NO dictionary does not by itself make a row stale', () => {
    // Stated because it is a boundary rather than an accident: the
    // predicate is about names the dictionaries know, so a complete
    // new-language row carrying one invention is left alone. The read
    // path drops it before anything is painted, so the screen is right
    // either way; only the stored row keeps a value nothing reads.
    expect(needsMigration({ ...defaultVariablesForBase('light'), '--not-a-role': 'red' })).toBe(
      false,
    );
  });

  test('an unreadable map reads as stale rather than throwing', () => {
    for (const bogus of [null, undefined, 7, 'nope', ['--bg']]) {
      expect(() => needsMigration(bogus as never)).not.toThrow();
      expect(needsMigration(bogus as never)).toBe(true);
    }
  });
});
