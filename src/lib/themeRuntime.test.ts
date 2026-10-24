/**
 * sk-285.7 T014 — INV-12 at the level of the two functions that own the
 * document: what `applyVariables` writes, `stripAppliedVariables`
 * removes, whatever dictionary the name belongs to.
 *
 * ── Why the inputs here are LEGACY names ────────────────────────────
 *
 * The invariant names three populations — "neither the old dictionary nor
 * roles that are absent from the applied theme" — and only one of them is
 * interesting to test at this level. A role of the CURRENT registry is
 * removed by the same loop as any other key, so pinning it would pin
 * nothing extra; what is worth an assertion is the claim that the strip
 * does not consult a dictionary at all. So the maps applied below are
 * built from `LEGACY_TOKEN_KEYS` minus the current registry (names the
 * new dictionary has never heard of) and from a name that was never in
 * either. If the strip were keyed on the registry, every one of these
 * would survive it.
 *
 * Each such test states the size of the set it iterates: a "nothing
 * survived" assertion over an empty input is a tautology, and this run
 * has produced seven degenerate guards already (see the run's retro
 * notes) — every one of them a loop with no input.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { applyVariables, stripAppliedVariables } from './themeRuntime';
import { ALL_TOKEN_KEYS } from './themeTokens';
import { LEGACY_TOKEN_KEYS } from './themeTokensLegacy';

/**
 * Names the PRE-redesign dictionary declared and the current one does
 * not — `--brand`, `--accent-magenta`, `--font-size-body`, …
 *
 * This is the population INV-12 calls "the old dictionary", and it is
 * non-empty by construction of the redesign (the dictionary was
 * replaced, not extended). The test below refuses to run on an empty
 * one rather than passing vacuously if that ever stops being true.
 */
const LEGACY_ONLY: readonly string[] = LEGACY_TOKEN_KEYS.filter(
  (key) => !ALL_TOKEN_KEYS.includes(key),
);

/** A name no dictionary has ever declared — a preview can carry one. */
const FOREIGN_KEY = '--sk-not-a-role-at-all';

/** Every custom property currently inline on `<html>`, by name. */
function inlineCustomProperties(): string[] {
  const style = document.documentElement.style;
  const names: string[] = [];
  for (let i = 0; i < style.length; i += 1) {
    const name = style.item(i);
    if (name.startsWith('--')) names.push(name);
  }
  return names.sort();
}

function clearDocument(): void {
  document.documentElement.removeAttribute('style');
  // The module's own bookkeeping is not reset by removing the
  // attribute, so drop it through the public door — otherwise keys from
  // one test are still "owned" in the next.
  stripAppliedVariables();
  document.documentElement.removeAttribute('style');
}

beforeEach(clearDocument);
afterEach(clearDocument);

describe('T014 — the fixture is a real population', () => {
  test('the pre-redesign dictionary has names the current one dropped', () => {
    // Every claim below is "these keys were removed"; all of them are
    // vacuous if the list is empty.
    expect(LEGACY_ONLY.length).toBeGreaterThan(0);
    expect(ALL_TOKEN_KEYS).not.toContain(FOREIGN_KEY);
    expect(LEGACY_TOKEN_KEYS).not.toContain(FOREIGN_KEY);
  });
});

describe('T014 / INV-12 — the strip is keyed on what was applied', () => {
  test('names only the OLD dictionary had are removed', () => {
    const legacyMap = Object.fromEntries(LEGACY_ONLY.map((key) => [key, '#010203']));
    applyVariables(legacyMap);

    // The input actually landed — otherwise "it is gone" says nothing.
    expect(inlineCustomProperties()).toEqual([...LEGACY_ONLY].sort());

    stripAppliedVariables();
    expect(inlineCustomProperties()).toEqual([]);
  });

  test('a name in NO dictionary is removed too', () => {
    // The case a registry-driven wipe cannot reach at all: a preview map
    // is arbitrary, and `applyVariables` writes whatever it is handed.
    applyVariables({ [FOREIGN_KEY]: '3px' });
    expect(document.documentElement.style.getPropertyValue(FOREIGN_KEY)).toBe('3px');

    stripAppliedVariables();
    expect(inlineCustomProperties()).toEqual([]);
  });

  test('the union of several applies is removed by one strip', () => {
    // `appliedKeys` accumulates across calls and is only emptied by the
    // strip — which is what makes it a complete record of the document
    // rather than a record of the last call.
    applyVariables({ [LEGACY_ONLY[0]]: '#111111' });
    applyVariables({ [FOREIGN_KEY]: '1px' });
    applyVariables({ [ALL_TOKEN_KEYS[0]]: '#222222' });
    expect(inlineCustomProperties().length).toBe(3);

    stripAppliedVariables();
    expect(inlineCustomProperties()).toEqual([]);
  });

  test('a second strip is a no-op rather than a throw', () => {
    applyVariables({ [FOREIGN_KEY]: '1px' });
    stripAppliedVariables();
    expect(() => stripAppliedVariables()).not.toThrow();
    expect(inlineCustomProperties()).toEqual([]);
  });

  test('a strip with nothing applied leaves foreign inline styles alone', () => {
    // The module's ownership rule: it removes what it wrote, not
    // whatever it finds. A property this module never set — here a
    // standard one, set the way `applyActive` sets `color-scheme` —
    // survives.
    document.documentElement.style.setProperty('color-scheme', 'dark');
    stripAppliedVariables();
    expect(document.documentElement.style.getPropertyValue('color-scheme')).toBe('dark');
    document.documentElement.style.removeProperty('color-scheme');
  });

  test('an empty map is applied without disturbing what is already there', () => {
    applyVariables({ [FOREIGN_KEY]: '1px' });
    applyVariables({});
    expect(document.documentElement.style.getPropertyValue(FOREIGN_KEY)).toBe('1px');
    stripAppliedVariables();
    expect(inlineCustomProperties()).toEqual([]);
  });
});

describe('T014 / INV-12 — the net behind the tracked set covers BOTH dictionaries', () => {
  /**
   * A role the CURRENT registry declares and the pre-redesign
   * dictionary never did — so removing it is `ALL_TOKEN_KEYS`'s work
   * and nothing else's.
   */
  const REGISTRY_ONLY: string | undefined = ALL_TOKEN_KEYS.find(
    (key) => !LEGACY_TOKEN_KEYS.includes(key),
  );

  test('the two name lists are distinguishable populations', () => {
    // Both assertions below rest on a key that only one list has. If
    // the dictionaries ever coincide, the per-pass claims stop being
    // separable and this file should be re-thought rather than pass
    // vacuously.
    expect(REGISTRY_ONLY).toBeDefined();
    expect(LEGACY_ONLY.length).toBeGreaterThan(0);
  });

  test('one strip clears a tracked key, an untracked registry role AND an untracked legacy role', () => {
    // The input on which each of the three passes executes and removes
    // something — the case a review asked for. A property
    // written straight onto `<html>`, bypassing `applyVariables`, is
    // exactly the shape `public/theme-boot.js` would have if it ever
    // inlined theme variables against FOUC: untracked, and therefore
    // reachable only by the name lists.
    const registryOnly = REGISTRY_ONLY as string;
    const legacyOnly = LEGACY_ONLY[0];

    applyVariables({ [FOREIGN_KEY]: '1px' }); // pass 1 — tracked
    document.documentElement.style.setProperty(registryOnly, '#010203'); // pass 2
    document.documentElement.style.setProperty(legacyOnly, '#040506'); // pass 3

    expect(inlineCustomProperties()).toEqual(
      [FOREIGN_KEY, registryOnly, legacyOnly].sort(),
    );

    stripAppliedVariables();
    expect(inlineCustomProperties()).toEqual([]);
  });

  test('dropping the legacy pass alone would be visible — the two are asserted separately', () => {
    // Stated as two independent strips so a reviewer can see which pass
    // each one depends on: neither key was ever handed to
    // `applyVariables`, so the tracked set is empty in both.
    const legacyOnly = LEGACY_ONLY[0];
    document.documentElement.style.setProperty(legacyOnly, '#040506');
    stripAppliedVariables();
    expect(document.documentElement.style.getPropertyValue(legacyOnly)).toBe('');

    const registryOnly = REGISTRY_ONLY as string;
    document.documentElement.style.setProperty(registryOnly, '#010203');
    stripAppliedVariables();
    expect(document.documentElement.style.getPropertyValue(registryOnly)).toBe('');
  });

  test('an untracked name in NEITHER dictionary survives — the net is two lists, not a wipe', () => {
    // The negative path that keeps the passes honest: `stripAppliedVariables`
    // removes what it OWNS (tracked) or what a dictionary NAMES — never
    // every custom property it happens to find. A foreign property set
    // by some other subsystem is not ours to delete.
    document.documentElement.style.setProperty(FOREIGN_KEY, '7px');
    stripAppliedVariables();
    expect(document.documentElement.style.getPropertyValue(FOREIGN_KEY)).toBe('7px');
  });
});
