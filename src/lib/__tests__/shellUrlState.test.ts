/**
 * sk-303.13 (T027, test matrix row 41) — the search-parameter
 * arithmetic behind the addressable tab and lens.
 *
 * This is the pure half of the row: what `updateSearch` keeps and what
 * it drops, what counts as an unknown value, and what
 * `normalizeShellSearch` proposes as the correction. The routed half
 * (the correction being applied with `replace`, so it adds no history
 * entry) lives in `shellUrlNormalization.test.tsx` — the two files split
 * along the line where a router becomes necessary.
 *
 * Row 40 (`shellAddressability.test.tsx`) owns "the address beats
 * storage"; nothing here repeats it.
 */

import { describe, expect, test } from 'vitest';

import {
  DEFAULT_TAB,
  FILE_PARAM,
  INBOX_TABS,
  LENSES,
  LENS_PARAM,
  SELECTS,
  SELECT_PARAM,
  TAB_PARAM,
  normalizeShellSearch,
  parseLens,
  parseSelect,
  parseSpaceHandle,
  parseTab,
  spaceHandle,
  spacePath,
  updateSearch,
  type InboxTab,
  type Lens,
} from '../shellUrlState';

describe('parseTab / parseLens — what the address is allowed to say', () => {
  for (const tab of INBOX_TABS) {
    test(`"${tab}" is a tab the app can honour`, () => {
      expect(parseTab(tab)).toBe(tab);
    });
  }

  for (const lens of LENSES) {
    test(`"${lens}" is a lens the app can honour`, () => {
      expect(parseLens(lens)).toBe(lens);
    });
  }

  test.each([
    ['', 'an empty value'],
    ['INBOX', 'the right word in the wrong case'],
    ['outbox-2', 'a near miss'],
    ['a-tab-that-was-removed', 'a tab that no longer exists'],
  ])('%s (%s) is not a tab', (raw) => {
    expect(parseTab(raw)).toBeNull();
  });

  test.each([
    ['', 'an empty value'],
    ['onme', 'the value without its hyphen'],
    ['delegated ', 'a trailing space'],
    ['reminders', 'the lens under its old name'],
  ])('%s (%s) is not a lens', (raw) => {
    expect(parseLens(raw)).toBeNull();
  });

  test('a missing parameter is not an error — it is silence', () => {
    expect(parseTab(null)).toBeNull();
    expect(parseLens(null)).toBeNull();
    expect(parseTab(undefined)).toBeNull();
    expect(parseLens(undefined)).toBeNull();
  });

  test('the fallback tab is one of the tabs that exist', () => {
    expect(INBOX_TABS).toContain(DEFAULT_TAB);
  });
});

describe('updateSearch — a functional update keeps everything it did not name', () => {
  test('writing the tab does not disturb the attachment viewer', () => {
    const next = updateSearch('?file=att-1', { [TAB_PARAM]: 'mentions' });
    const params = new URLSearchParams(next);
    expect(params.get(FILE_PARAM)).toBe('att-1');
    expect(params.get(TAB_PARAM)).toBe('mentions');
  });

  test('writing the lens does not disturb the tab, and vice versa', () => {
    let search = updateSearch('', { [TAB_PARAM]: 'watching' });
    search = updateSearch(search, { [LENS_PARAM]: 'budilnik' });
    expect(new URLSearchParams(search).get(TAB_PARAM)).toBe('watching');

    search = updateSearch(search, { [TAB_PARAM]: 'inbox' });
    expect(new URLSearchParams(search).get(LENS_PARAM)).toBe('budilnik');
  });

  test('parameters nobody here knows about survive untouched', () => {
    // The point of the functional update: a parameter added by some
    // future surface must not be collateral damage of a tab click.
    const next = updateSearch('?file=att-1&q=urgent&sort=due', {
      [TAB_PARAM]: 'inbox',
    });
    const params = new URLSearchParams(next);
    expect(params.get('q')).toBe('urgent');
    expect(params.get('sort')).toBe('due');
    expect(params.get(FILE_PARAM)).toBe('att-1');
  });

  test('repeated keys are not multiplied — the value is replaced', () => {
    const next = updateSearch('?tab=inbox&tab=mentions', { [TAB_PARAM]: 'watching' });
    expect(new URLSearchParams(next).getAll(TAB_PARAM)).toEqual(['watching']);
  });

  test('null deletes exactly one key and leaves the rest', () => {
    const next = updateSearch('?tab=inbox&file=att-1&q=urgent', {
      [FILE_PARAM]: null,
    });
    const params = new URLSearchParams(next);
    expect(params.has(FILE_PARAM)).toBe(false);
    expect(params.get(TAB_PARAM)).toBe('inbox');
    expect(params.get('q')).toBe('urgent');
  });

  test('several keys can move in one update (the lens cycle does exactly this)', () => {
    const next = updateSearch('?tab=mentions&file=att-1', {
      [LENS_PARAM]: 'on-me',
      [FILE_PARAM]: null,
    });
    const params = new URLSearchParams(next);
    expect(params.get(LENS_PARAM)).toBe('on-me');
    expect(params.has(FILE_PARAM)).toBe(false);
    expect(params.get(TAB_PARAM)).toBe('mentions');
  });

  test('an empty result is "", not a bare "?"', () => {
    expect(updateSearch('?tab=inbox', { [TAB_PARAM]: null })).toBe('');
    expect(updateSearch('', {})).toBe('');
  });

  test('a non-empty result carries its leading "?" so callers can pass it straight on', () => {
    expect(updateSearch('', { [TAB_PARAM]: 'inbox' }).startsWith('?')).toBe(true);
  });

  test('values are encoded, not concatenated', () => {
    const next = updateSearch('', { [FILE_PARAM]: 'a b&c=d' });
    expect(new URLSearchParams(next).get(FILE_PARAM)).toBe('a b&c=d');
  });

  test('a URLSearchParams is accepted as the starting point', () => {
    const next = updateSearch(new URLSearchParams('file=att-1'), {
      [LENS_PARAM]: 'delegated',
    });
    const params = new URLSearchParams(next);
    expect(params.get(FILE_PARAM)).toBe('att-1');
    expect(params.get(LENS_PARAM)).toBe('delegated');
  });
});

describe('every tab × lens combination round-trips through the address', () => {
  const lensOptions: (Lens | null)[] = [...LENSES, null];
  for (const tab of INBOX_TABS as readonly InboxTab[]) {
    for (const lens of lensOptions) {
      test(`tab=${tab} + lens=${lens ?? '(none)'} survives with ?file= alongside`, () => {
        let search = updateSearch('?file=att-1', { [TAB_PARAM]: tab });
        search = updateSearch(search, { [LENS_PARAM]: lens });
        const params = new URLSearchParams(search);

        expect(parseTab(params.get(TAB_PARAM))).toBe(tab);
        expect(parseLens(params.get(LENS_PARAM))).toBe(lens);
        expect(params.get(FILE_PARAM)).toBe('att-1');
        // A combination the app can honour is never "corrected".
        expect(normalizeShellSearch(search)).toBeNull();
      });
    }
  }
});

describe('normalizeShellSearch — only a value the app cannot honour is corrected', () => {
  test('an address the app understands needs no correction', () => {
    expect(normalizeShellSearch('?tab=inbox&lens=on-me&file=att-1')).toBeNull();
    expect(normalizeShellSearch('')).toBeNull();
    expect(normalizeShellSearch('?file=att-1')).toBeNull();
  });

  test('an unknown tab is dropped, everything else stays', () => {
    const next = normalizeShellSearch('?tab=bogus&lens=on-me&file=att-1');
    expect(next).not.toBeNull();
    const params = new URLSearchParams(next!);
    expect(params.has(TAB_PARAM)).toBe(false);
    expect(params.get(LENS_PARAM)).toBe('on-me');
    expect(params.get(FILE_PARAM)).toBe('att-1');
  });

  test('a tab that was removed from the product is an unknown tab', () => {
    // The Outbox surface is on its way out (US-9). The day its entry
    // leaves INBOX_TABS, every saved `?tab=outbox` link becomes this
    // case — and lands on Inbox instead of on an empty screen.
    const removed = 'a-tab-that-was-removed';
    expect(parseTab(removed)).toBeNull();
    const next = normalizeShellSearch(`?tab=${removed}`);
    expect(next).toBe('');
  });

  test('an unknown lens is dropped, the tab stays', () => {
    const next = normalizeShellSearch('?tab=watching&lens=nope');
    const params = new URLSearchParams(next!);
    expect(params.has(LENS_PARAM)).toBe(false);
    expect(params.get(TAB_PARAM)).toBe('watching');
  });

  test('both unknown at once are dropped in one correction', () => {
    expect(normalizeShellSearch('?tab=bogus&lens=nope')).toBe('');
  });

  test('an emptied value counts as unknown', () => {
    expect(normalizeShellSearch('?tab=')).toBe('');
    expect(normalizeShellSearch('?lens=')).toBe('');
  });

  test('the correction is idempotent — normalising it again proposes nothing', () => {
    const once = normalizeShellSearch('?tab=bogus&lens=nope&file=att-1');
    expect(normalizeShellSearch(once!)).toBeNull();
  });
});

// ────── sk-303.14 (T024) — the selection parameter, same arithmetic ──────

describe('parseSelect — the second axis beside the lens', () => {
  for (const value of SELECTS) {
    test(`"${value}" is a selection the app can honour`, () => {
      expect(parseSelect(value)).toBe(value);
    });
  }

  test('an unknown value is no opinion, not an error', () => {
    // Same contract as tab and lens: a typo or a selection removed in a
    // later release reads as "the address says nothing", so a stale
    // bookmark opens the surface instead of an error screen.
    expect(parseSelect('reviewed')).toBeNull();
    expect(parseSelect('')).toBeNull();
    expect(parseSelect(null)).toBeNull();
    expect(parseSelect(undefined)).toBeNull();
  });

  test('the lens value is not a selection value, and vice versa', () => {
    // Two axes, two vocabularies. Crossing them would let one address
    // mean two different things depending on which parser read it.
    expect(parseSelect('delegated')).toBeNull();
    expect(parseLens('unreviewed')).toBeNull();
  });
});

describe('normalizeShellSearch — the selection is normalised like the rest', () => {
  test('an unknown selection value is stripped, the rest of the address survives', () => {
    const out = normalizeShellSearch(
      `?${TAB_PARAM}=inbox&${LENS_PARAM}=delegated&${SELECT_PARAM}=nonsense&${FILE_PARAM}=att-1`,
    );
    expect(out).not.toBeNull();
    const params = new URLSearchParams(out!);
    expect(params.get(SELECT_PARAM)).toBeNull();
    expect(params.get(TAB_PARAM)).toBe('inbox');
    expect(params.get(LENS_PARAM)).toBe('delegated');
    expect(params.get(FILE_PARAM)).toBe('att-1');
  });

  test('a known selection is left alone — a clean address needs no correction', () => {
    expect(
      normalizeShellSearch(`?${LENS_PARAM}=delegated&${SELECT_PARAM}=unreviewed`),
    ).toBeNull();
  });

  test('a missing selection is not an error', () => {
    expect(normalizeShellSearch(`?${LENS_PARAM}=delegated`)).toBeNull();
  });

  // ── B/1 review W1 — the one cross-parameter rule in this function ──
  //
  // The selection narrows exactly one surface, so an address that does not
  // NAME that surface cannot honour the parameter. Leaving it in place is
  // what gave `?select=` a storage fallback: the effective lens can come
  // from localStorage, and a value the address never spoke would then
  // decide whether the parameter applied. Stripping it here keeps the
  // parameter what its docstring says it is — reproducible from the URL
  // alone.

  test('`select` with no lens in the address is stripped', () => {
    expect(normalizeShellSearch(`?${SELECT_PARAM}=unreviewed`)).toBe('');
  });

  test('`select` beside another lens is stripped, that lens survives', () => {
    const out = normalizeShellSearch(
      `?${LENS_PARAM}=on-me&${SELECT_PARAM}=unreviewed&${FILE_PARAM}=att-1`,
    );
    const params = new URLSearchParams(out!);
    expect(params.get(SELECT_PARAM)).toBeNull();
    expect(params.get(LENS_PARAM)).toBe('on-me');
    expect(params.get(FILE_PARAM)).toBe('att-1');
  });

  test('an unknown lens takes the selection down with it, in one correction', () => {
    // Both corrections land in the same patch — a `?lens=nope` that leaves
    // `?select=` behind would need a second normalisation pass, and the
    // effect that applies these replaces the entry each time.
    expect(normalizeShellSearch(`?${LENS_PARAM}=nope&${SELECT_PARAM}=unreviewed`))
      .toBe('');
  });

  test('the pair the app can honour is still left alone', () => {
    expect(
      normalizeShellSearch(
        `?${LENS_PARAM}=delegated&${SELECT_PARAM}=unreviewed&${TAB_PARAM}=inbox`,
      ),
    ).toBeNull();
  });

  test('the correction is idempotent for the selection too', () => {
    const once = normalizeShellSearch(
      `?${LENS_PARAM}=on-me&${SELECT_PARAM}=unreviewed`,
    );
    expect(normalizeShellSearch(once!)).toBeNull();
  });
});

describe('updateSearch — the selection rides along like every other parameter', () => {
  test('changing the lens keeps an unrelated parameter, and can drop the selection in the same patch', () => {
    // One patch, one history entry: the lens change and the selection it
    // takes with it are never two addresses in a row.
    const out = updateSearch(
      `?${LENS_PARAM}=delegated&${SELECT_PARAM}=unreviewed&${TAB_PARAM}=mentions`,
      { [LENS_PARAM]: 'on-me', [SELECT_PARAM]: null },
    );
    const params = new URLSearchParams(out);
    expect(params.get(LENS_PARAM)).toBe('on-me');
    expect(params.get(SELECT_PARAM)).toBeNull();
    expect(params.get(TAB_PARAM)).toBe('mentions');
  });

  test('a path change that names neither parameter carries both', () => {
    const out = updateSearch(
      `?${LENS_PARAM}=delegated&${SELECT_PARAM}=unreviewed`,
      { [FILE_PARAM]: null },
    );
    const params = new URLSearchParams(out);
    expect(params.get(LENS_PARAM)).toBe('delegated');
    expect(params.get(SELECT_PARAM)).toBe('unreviewed');
  });
});

// ──────── sk-674.18 T052, matrix row 236 — the address of the place «space» ────────
//
// Reference: screens 1.16 (`/spaces/:space`, `/spaces/:space/issues/:id`,
// `:space` = `<id>-<slug>`, "look up by id") and the spaces contract
// (skein-api `internal/spaces/contract.go`: the slug "is never looked up: a
// route finds the space by id alone, so a stale slug still resolves"; the
// id is an 8-character base32 short id).

describe('parseSpaceHandle — the id names the space, the slug does not', () => {
  test.each([
    ['k3x9p2qa-acme', 'k3x9p2qa'],
    // A renamed space: the old slug still finds it.
    ['k3x9p2qa-old-name', 'k3x9p2qa'],
    // A slug with dashes of its own does not bleed into the id.
    ['k3x9p2qa-acme-ltd-2', 'k3x9p2qa'],
    // No slug at all.
    ['k3x9p2qa', 'k3x9p2qa'],
  ])('"%s" names %s', (segment, id) => {
    expect(parseSpaceHandle(segment)).toBe(id);
  });

  test('two segments that differ only in the slug name the same space', () => {
    expect(parseSpaceHandle('k3x9p2qa-acme')).toBe(parseSpaceHandle('k3x9p2qa-something-else'));
  });

  test.each([
    ['an empty segment', ''],
    ['a slug without an id', '-acme'],
    ['no segment', null],
    ['undefined', undefined],
  ])('%s names no space', (_label, segment) => {
    expect(parseSpaceHandle(segment)).toBeNull();
  });
});

describe('spaceHandle / spacePath — the address built for a space', () => {
  test('the segment is `<id>-<slug>`', () => {
    expect(spaceHandle({ id: 'k3x9p2qa', slug: 'acme' })).toBe('k3x9p2qa-acme');
  });

  test('the place, and an issue open in it', () => {
    expect(spacePath('k3x9p2qa-acme')).toBe('/spaces/k3x9p2qa-acme');
    expect(spacePath('k3x9p2qa-acme', 'sk-12')).toBe('/spaces/k3x9p2qa-acme/issues/sk-12');
  });

  test('a built segment parses back to the same id', () => {
    const handle = spaceHandle({ id: 'k3x9p2qa', slug: 'acme-ltd' });
    expect(parseSpaceHandle(handle)).toBe('k3x9p2qa');
  });

  test('the path segments are URL-encoded', () => {
    expect(spacePath('k3x9p2qa-äcme', 'a/b')).toBe('/spaces/k3x9p2qa-%C3%A4cme/issues/a%2Fb');
  });
});
