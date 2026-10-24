/**
 * sk-392 — the dependency row is drawn with classes and roles, not with
 * inline styles and the pre-reform bridge.
 *
 * ─── What was and what is not in the tree ──────────────────────────
 *
 * The task statement describes `DependencyRow.tsx` as it was before the redesign:
 * colours from `var(--skein-fg-muted)` / `var(--skein-border)` /
 * `var(--skein-fg)`, layout by inline styles on Mantine
 * `Group`/`Text` (`padding: '4px 0'`, `minHeight: 32`, `width: 14`),
 * placeholder of an inaccessible task `░ hidden (no access) ░` and the arrows
 * `→` / `←` in a monospace column 14px wide.
 *
 * None of these signs is in the tree: the row moved to
 * artboard 4c (`.detail-row--dep`, `.dep-chip`, `.status-chip` in
 * `index.css`), the placeholder became words plus `IconLock`, and the arrows
 * were removed together with the very notion of a per-row direction — it is named by
 * the group heading. The changes were made by sk-414.2 and sk-414.4.
 *
 * What was not done — a guard. The component was covered by NO test at all
 * (checked by enumeration: three files of the tree mention `DependencyRow`, and
 * all three are not tests), so exactly the defect the card describes
 * can silently come back. This file is its regression.
 *
 * Tone and geometry are not checked here (sk-540.11, owner decision):
 * what a person sees is not asserted from markup or stylesheet text.
 */

import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render, fireEvent } from '@testing-library/react';

import { DependencyRow } from './DependencyRow';
import { statusChipText } from './Attribute';
import { DEP_TYPE_GLYPHS } from '../lib/depTypeIcons';
import { en } from '../i18n/locales/en';
import { ru } from '../i18n/locales/ru';
import type { DependencyEdge, DepType } from '../api/dependencies';
import type { IssueStatus } from '../api/issues';

afterEach(() => cleanup());

/** Edges sufficient to reach the distinguishing case. */
function edge(over: Partial<DependencyEdge> = {}): DependencyEdge {
  return {
    fromId: 'sk-1',
    toId: 'sk-2',
    version: 1,
    createdAt: '2026-05-01T10:00:00Z',
    type: 'blocks',
    metadata: {},
    issue: {
      id: 'sk-2',
      projectId: 'p',
      title: 'Partial refund does not reduce the order total',
      status: 'in_progress' as IssueStatus,
      priority: 1,
      type: 'bug',
    },
    ...over,
  } as DependencyEdge;
}

function row(over: Partial<DependencyEdge> = {}, props: Record<string, unknown> = {}) {
  const { container } = render(
    <ul>
      <DependencyRow edge={edge(over)} {...props} />
    </ul>,
  );
  const li = container.querySelector('li.detail-row--dep');
  expect(li, 'the row was not rendered as `.detail-row--dep`').not.toBeNull();
  return li as HTMLElement;
}

/* ══════════════════════════════════════════════════════════════════
 * 2. Direction: it is named by the group, not by the row
 * ══════════════════════════════════════════════════════════════════ */

describe('sk-392 — the row does not draw the edge direction', () => {
  /** The per-row direction arrows the row used to draw. */
  const DIRECTION_ARROWS = ['→', '←'];

  test.each([
    'blocks',
    'waits-for',
    'related',
    'discovered-from',
    'supersedes',
    'duplicates',
    'parent-child',
  ] as DepType[])('%s: the row draws no direction arrow', (type) => {
    const li = row({ type, metadata: {} } as Partial<DependencyEdge>, { onRemove: () => {} });
    const text = li.textContent ?? '';
    expect(DIRECTION_ARROWS.filter((a) => text.includes(a))).toEqual([]);
  });

  test('`direction` is no longer passed to the component — and it does not draw it', () => {
    // The prop was removed from the interface (the direction is named by the group heading).
    // Passed through spread, it must not resurrect the arrow.
    const li = row({}, { direction: 'outgoing' });
    expect(li.textContent ?? '').not.toContain('→');
    expect(li.textContent ?? '').not.toContain('←');
  });
});

/* ══════════════════════════════════════════════════════════════════
 * 3. Placeholder of an inaccessible task — words, not `░`
 * ══════════════════════════════════════════════════════════════════ */

describe('sk-392 — a hidden task is named in words', () => {
  test('instead of `░ hidden (no access) ░` — a chip with a word and a lock', () => {
    const li = row({ issue: undefined, redacted: true });
    expect(li.textContent ?? '').not.toContain('░');
    const chip = li.querySelector('.dep-chip--redacted');
    expect(chip, 'the hidden row did not draw its chip').not.toBeNull();
    expect((chip!.textContent ?? '').trim()).toBe(en.details.deps.redacted);
    // The lock is an icon, not a symbol: §8 draws it 16px in the text.
    const svg = chip!.querySelector('svg');
    expect(svg, 'the lock is not drawn').not.toBeNull();
    expect(svg!.getAttribute('width')).toBe('16');
    expect(svg!.getAttribute('stroke')).toBe('currentColor');
  });

  test('a hidden row has neither a link nor a remove button', () => {
    // This interface does not offer to remove an edge whose far end
    // is not visible — and that is behaviour, not styling.
    const li = row({ issue: undefined, redacted: true }, { onRemove: () => {} });
    expect(li.querySelector('.detail-row-link')).toBeNull();
    expect(li.querySelector('.detail-row-actions')).toBeNull();
  });

  test('a visible row, conversely, gives both a link and a button', () => {
    // A guard against the check above passing on an empty row.
    const li = row({}, { onRemove: () => {} });
    expect(li.querySelector('.detail-row-link')?.textContent).toBe('sk-2');
    expect(li.querySelector('.detail-row-actions button')).not.toBeNull();
  });

  test('without `onRemove` there is no button — an incoming edge is edited on that side', () => {
    expect(row().querySelector('.detail-row-actions')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════
 * 4. Both surfaces read the SAME maps, and both locales are named
 * ══════════════════════════════════════════════════════════════════ */

describe('sk-392 — facts are taken from shared maps, not rewritten in the row', () => {
  const TYPES: DepType[] = [
    'blocks',
    'waits-for',
    'related',
    'discovered-from',
    'supersedes',
    'duplicates',
    'parent-child',
  ];

  test.each(TYPES)('%s: the chip carries the type as an attribute and the glyph from DEP_TYPE_GLYPHS', (type) => {
    const li = row({ type, metadata: {} } as Partial<DependencyEdge>);
    const chip = li.querySelector('.dep-chip')!;
    expect(chip.getAttribute('data-dep-type')).toBe(type);
    expect(chip.textContent).toContain(type);
    const glyph = DEP_TYPE_GLYPHS[type];
    const drawn = chip.querySelector('.dep-chip-glyph');
    if (glyph === null) {
      // `parent-child` is drawn by an icon — it has no glyph, and an empty
      // span would be a hole in the row.
      expect(drawn).toBeNull();
    } else {
      expect(drawn?.textContent).toBe(glyph);
    }
  });

  test('gate rides INSIDE the chip, not as a second chip beside it', () => {
    const li = row({ type: 'waits-for', metadata: { gate: 'all-children' } } as Partial<DependencyEdge>);
    const chips = li.querySelectorAll('.dep-chip');
    expect(chips.length).toBe(1);
    expect(chips[0].textContent).toContain('waits-for: all-children');
  });

  test.each(['open', 'in_progress', 'deferred', 'closed'] as IssueStatus[])(
    'status %s is taken from statusChipText',
    (status) => {
      const li = row({ issue: { ...edge().issue!, status } });
      const chip = li.querySelector('.status-chip')!;
      expect(chip.getAttribute('data-status')).toBe(status);
      expect((chip.textContent ?? '').trim()).toBe(statusChipText(status));
    },
  );

  test('the priority is drawn, and it is the one in the edge', () => {
    expect(row({ issue: { ...edge().issue!, priority: 4 } }).querySelector('.detail-row-prio')
      ?.textContent).toBe('P4');
  });

  test.each([
    ['en', en],
    ['ru', ru as unknown as typeof en],
  ] as const)('%s names the hidden task and the remove label', (locale, dict) => {
    for (const key of ['redacted', 'redactedHint', 'removeAria'] as const) {
      const value = (dict.details.deps as unknown as Record<string, string>)[key];
      expect(typeof value, `${locale}.details.deps.${key} is missing`).toBe('string');
      expect(value.trim().length, `${locale}.details.deps.${key} is empty`).toBeGreaterThan(0);
    }
    // The remove label must NAME the task — otherwise it is the "Close" from the
    // Mantine factory, the defect the label was introduced for.
    expect((dict.details.deps as unknown as Record<string, string>).removeAria).toContain('{{id}}');
  });

  test('the remove button names the identifier, not "Close"', () => {
    const li = row({}, { onRemove: () => {} });
    const btn = li.querySelector('.detail-row-actions button')!;
    expect(btn.getAttribute('aria-label')).toContain('sk-2');
    expect(btn.getAttribute('aria-label')).not.toBe('Close');
  });

  test('an ongoing removal draws a spinner and mutes a repeated press', () => {
    let calls = 0;
    const li = row({}, { onRemove: () => (calls += 1), removing: true });
    const btn = li.querySelector('.detail-row-actions button') as HTMLButtonElement;
    expect(li.querySelector('.detail-spinner')).not.toBeNull();
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(btn);
    expect(calls).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════
 * 4b. Distinguishing cases (sk-417)
 *
 * The sections above describe the row in its usual form. A mutation measurement
 * (36 mutants, 63.89) showed where the assertions about it rest on the
 * FIXTURE, not on the code: thirteen mutants survived, and twelve of
 * them — where the test never brought the row to the case that
 * tells correct code from incorrect. Below are exactly these cases,
 * one per reason.
 * ══════════════════════════════════════════════════════════════════ */

describe('sk-417 — gate gets into the chip only where it means something', () => {
  test('a foreign type with gate in metadata does NOT append it to the chip', () => {
    // `edge.type === 'waits-for' && …` — drop the left half, and any
    // row with `gate` in metadata starts lying: "blocks: all-children"
    // promises a gate that this type does not have. There was no fixture with such
    // an edge in the file, so nothing held the half of the condition.
    const li = row({ type: 'blocks', metadata: { gate: 'all-children' } } as Partial<DependencyEdge>);
    const chip = li.querySelector('.dep-chip')!;
    // The chip carries the type glyph before the word — compare with it, not with the bare
    // word, otherwise the test would fail on decoration instead of meaning.
    expect((chip.textContent ?? '').trim()).toBe(`${DEP_TYPE_GLYPHS.blocks ?? ''}blocks`);
    expect(chip.textContent ?? '').not.toContain('all-children');
  });

  test('`waits-for` without metadata at all is drawn, not crashed', () => {
    // `edge.metadata?.gate` — remove the question mark, and an edge without metadata
    // would crash the row. The server is not obliged to send metadata.
    const li = row({ type: 'waits-for', metadata: undefined } as Partial<DependencyEdge>);
    expect((li.querySelector('.dep-chip')!.textContent ?? '').trim()).toBe(
      `${DEP_TYPE_GLYPHS['waits-for'] ?? ''}waits-for`,
    );
  });

  test('gate that is not a string is not a gate', () => {
    // `typeof … === 'string'` — a removed type check would append to the chip
    // whatever came: "waits-for: 5" or "waits-for: [object Object]".
    for (const gate of [5, { all: true }, null] as unknown[]) {
      cleanup();
      const li = row({ type: 'waits-for', metadata: { gate } } as unknown as Partial<DependencyEdge>);
      expect((li.querySelector('.dep-chip')!.textContent ?? '').trim()).toBe(
        `${DEP_TYPE_GLYPHS['waits-for'] ?? ''}waits-for`,
      );
    }
  });
});

describe('sk-417 — a row is hidden for EACH of the two reasons, not for their sum', () => {
  // `edge.redacted || !edge.issue`: the fixture of a hidden row set both
  // signs at once, so `&&` instead of `||` passed unnoticed.
  // Each half is checked with its own edge.
  test('the `redacted` sign with a VISIBLE task still hides', () => {
    const li = row({ redacted: true });
    expect(li.querySelector('.dep-chip--redacted'), 'the redacted sign was ignored').not.toBeNull();
    expect(li.querySelector('.detail-row-link')).toBeNull();
  });

  test('the absence of a task WITHOUT the `redacted` sign hides too', () => {
    const li = row({ issue: undefined, redacted: false });
    expect(li.querySelector('.dep-chip--redacted'), 'an edge without a task was drawn as visible').not.toBeNull();
    expect(li.querySelector('.detail-row-link')).toBeNull();
  });
});

describe('sk-417 — the remove button: the press, not only its presence', () => {
  test('a press on a NOT ongoing removal calls the handler exactly once', () => {
    // Three mutants at once: the handler body emptied to `{}`;
    // `if (removing) return` with the condition replaced by `true`; and the
    // `onRemove()` call itself, which no test reached — Stryker
    // counted it not as survived but as NOT COVERED.
    let calls = 0;
    const li = row({}, { onRemove: () => (calls += 1) });
    const btn = li.querySelector('.detail-row-actions button') as HTMLButtonElement;
    fireEvent.click(btn);
    expect(calls, 'the remove button called nothing').toBe(1);
  });

  test('and does not declare itself disabled while no removal is ongoing', () => {
    // `removing || undefined`: replacing with `true` draws `aria-disabled`
    // on a working button — a screen reader will announce it as unavailable, yet it
    // is pressable. Only the second half (`removing: true`) was checked.
    const li = row({}, { onRemove: () => {} });
    const btn = li.querySelector('.detail-row-actions button')!;
    expect(btn.getAttribute('aria-disabled')).toBeNull();
    expect(li.querySelector('.detail-spinner')).toBeNull();
  });

  test('the label names the TASK, not the far end of the edge', () => {
    // In the shared fixture `issue.id` and `toId` coincide, so replacing
    // `??` with `&&` (which would give `toId`) read as the same
    // string. Here they differ, and it shows that the identifier
    // of the task is taken.
    const li = row(
      { toId: 'sk-999', issue: { ...edge().issue!, id: 'sk-2' } },
      { onRemove: () => {} },
    );
    const label = li.querySelector('.detail-row-actions button')!.getAttribute('aria-label') ?? '';
    expect(label).toContain('sk-2');
    expect(label, 'the label took toId instead of the task identifier').not.toContain('sk-999');
  });
});

describe('sk-417 — a task link without a handler does not crash the row', () => {
  test('a press without `onClickIssue` passes silently', () => {
    // `onClickIssue?.(…)` — a removed question mark turns a section that
    // draws rows without a handler into a crash on the very first press.
    //
    // Caught NOT via `expect(...).not.toThrow()`: React 18 does not
    // rethrow a handler error out of `fireEvent` but reports
    // it separately — as an `error` event on the window. A `toThrow` wrapper
    // would therefore pass on broken code too, and vitest would report
    // "Unhandled Error" outside the test (under a mutation run — a runner
    // crash instead of a killed mutant). The listener catches exactly that
    // message, `preventDefault` mutes it as handled, and
    // the assertion stays an assertion of the test.
    const errors: unknown[] = [];
    const onError = (e: ErrorEvent) => {
      e.preventDefault();
      errors.push(e.error ?? e.message);
    };
    window.addEventListener('error', onError);
    try {
      const li = row();
      fireEvent.click(li.querySelector('.detail-row-link') as HTMLButtonElement);
    } finally {
      window.removeEventListener('error', onError);
    }
    expect(errors.map(String), 'a row without a handler crashed on a press').toEqual([]);
  });

  test('…and with a handler calls it with the identifier and the project', () => {
    // A positive control to the check above: without it "did not crash" would
    // hold for a row that calls nothing at all.
    const seen: unknown[] = [];
    const li = row(
      { issue: { ...edge().issue!, id: 'sk-7', projectId: 'proj-x' } },
      { onClickIssue: (...args: unknown[]) => seen.push(args) },
    );
    fireEvent.click(li.querySelector('.detail-row-link') as HTMLButtonElement);
    expect(seen).toEqual([['sk-7', 'proj-x']]);
  });
});
