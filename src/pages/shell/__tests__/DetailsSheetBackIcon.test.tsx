/**
 * sk-285.7.2.78 — the sheet's way back is DRAWN by an icon set, not
 * typed as a character.
 *
 * ── The finding ─────────────────────────────────────────────────────
 *
 * `.details-sheet-back` held `<span aria-hidden>←</span>` — U+2190 LEFT
 * ARROW, a text glyph. §8 lists `arrow-left` among the names the pack
 * uses. Its weight, its terminals and its optical size come
 * from whichever face the system resolves for U+2190, which is a
 * different one on every platform and is never the face the rest of the
 * band is drawn in. The band made that visible: sk-285.7.2.74 put a
 * Tabler `chevron-down` at the trailing edge of the SAME 56px header,
 * so one strip carried two arrows from two sets.
 *
 * ── Why the assertion is `svg`, and why the text scan is beside it ──
 *
 * This is the measurement type `DetailsPanelIcons.test.tsx` introduced
 * for D2B-1: a button drawn with `←` and a button drawn with an `<svg>`
 * differ in what the node CONTAINS, and that is what a render can see.
 *
 * The character scan sits next to the svg count for the reason audit
 * Q-2 recorded: adding an icon does not remove a glyph. There, an
 * `IconCheck` was added beside a `'✓ '` that stayed in the translation
 * and the button read `✓ ✓ Accept`. Both halves are asked of the SAME
 * mounted tree so they cannot disagree.
 */

import type { ReactNode } from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { LayoutProvider } from '../../../lib/useLayoutState';
import { DetailsColumn } from '../DetailsColumn';
import { en } from '../../../i18n/locales/en';
import { ru } from '../../../i18n/locales/ru';

/**
 * The characters that have stood in for icons on this shell, exactly as
 * `DetailsPanelIcons.test.tsx` lists them. Kept as its own copy rather
 * than imported: that file's list is scoped to the controls IT covers,
 * and coupling the two would make a narrowing there silently narrow the
 * claim here.
 */
const STAND_IN_GLYPHS = ['→', '←', '↑', '↓', '↪', '↻', '✓', '✗', '×', '\u{1F441}'];

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return (
    <MantineProvider forceColorScheme="dark">
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <LayoutProvider>{children}</LayoutProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
}

function mountSheet() {
  return render(
    <Wrapper>
      <DetailsColumn issueId={null} sheet />
    </Wrapper>,
  );
}

afterEach(cleanup);

describe('sk-285.7.2.78 — the back control in the mobile sheet header', () => {
  test('the harness really renders the sheet header (guard against a vacuous pass)', () => {
    // Every assertion below is a `querySelector` away from being about
    // nothing: `frame()` only builds the header when `sheet` is on, and
    // a missing node makes each of them either throw or read a null.
    // Pinned outright so a harness that stopped rendering the sheet
    // fails as a harness rather than as a claim about icons.
    const { container } = mountSheet();
    expect(container.querySelector('.details-sheet')).not.toBeNull();
    expect(container.querySelector('.details-sheet-header')).not.toBeNull();
    expect(container.querySelector('.details-sheet-back')).not.toBeNull();
  });

  test('it carries exactly one svg — the arrow is drawn, not typed', () => {
    const { container } = mountSheet();
    const back = container.querySelector('.details-sheet-back')!;
    // Exactly one, not «at least one»: a second glyph in a control whose
    // whole content is one arrow and one word would be a drawing nobody
    // asked for.
    expect(back.querySelectorAll('svg')).toHaveLength(1);
  });

  test('no stand-in character survives beside the icon (the Q-2 failure mode)', () => {
    const { container } = mountSheet();
    const back = container.querySelector('.details-sheet-back')!;
    const text = back.textContent ?? '';
    expect(STAND_IN_GLYPHS.filter((g) => text.includes(g))).toEqual([]);
    // …and the control still says something: an empty label would pass
    // the scan above for the wrong reason.
    expect(text.trim().length).toBeGreaterThan(0);
  });

  test('the accessible name is unchanged and comes from the label, not the content', () => {
    const { container } = mountSheet();
    const back = container.querySelector('.details-sheet-back')!;
    expect(back.getAttribute('aria-label')).toBe(en.details.sheet.backAria);
    // The icon must not be announced twice — it is decoration beside a
    // name the button already carries.
    expect(container.querySelector('.details-sheet-back svg')!.getAttribute('aria-hidden')).toBe(
      'true',
    );
  });

  test('neither locale re-introduces the arrow into the label itself', () => {
    // The DOM scan above covers the tree that is rendered; this covers
    // the source it is built from, in the locale the DOM scan does not
    // mount. A `'← Tasks'` re-added to `ru` would otherwise be invisible
    // here.
    const offenders: string[] = [];
    for (const [locale, dict] of [
      ['en', en],
      ['ru', ru],
    ] as const) {
      const sheet = dict.details.sheet as Record<string, string>;
      for (const key of ['back', 'backAria'] as const) {
        const value = sheet[key];
        expect(typeof value, `${locale}.details.sheet.${key} is missing`).toBe('string');
        for (const g of STAND_IN_GLYPHS) {
          if (value.includes(g)) offenders.push(`${locale}.details.sheet.${key} = ${value}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
