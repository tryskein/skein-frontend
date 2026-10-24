/**
 * FR-001, second half: "Geist / Geist Mono become the defaults; **the
 * previous pair remains a preset**" (sk-285.7, test-plan row 4a).
 *
 * Row 4 covers the first half — the default stacks are byte-identical to
 * their preset entries. Nothing covered the second half: T001's gate
 * checks the build and the absence of `googleFamily`, neither of which
 * notices Inter or JetBrains Mono being dropped from the pickers while
 * the new defaults are wired in. A user who deliberately chose the old
 * pair would silently lose the option.
 *
 * Deliberately NOT asserted here: which preset the registry picks as the
 * default. That is row 4's job — asserting it in both places would make
 * this file fail for a reason it does not own.
 */
import { describe, expect, test } from 'vitest';
import {
  MONO_FONT_PRESETS,
  UI_FONT_PRESETS,
  findPreset,
  type FontPreset,
} from '../themePresets';

/**
 * A stack is only usable if something can render when the leading family
 * is unavailable — blocked download, offline install, a glyph the face
 * does not carry. "Non-empty fallback tail" therefore means: at least one
 * more family after the first comma, and it must not be another quoted
 * family with no generic behind it.
 */
function fallbackTail(stack: string): string[] {
  return stack
    .split(',')
    .slice(1)
    .map((s) => s.trim())
    .filter(Boolean);
}

const GENERIC_FAMILIES = [
  'sans-serif',
  'serif',
  'monospace',
  'system-ui',
  'ui-monospace',
  'ui-sans-serif',
  'ui-serif',
  'cursive',
  'fantasy',
];

describe('FR-001 — the pre-redesign font pair survives as a preset', () => {
  test('UI_FONT_PRESETS still offers Inter', () => {
    const inter = UI_FONT_PRESETS.find((p) => p.id === 'inter');
    expect(inter).toBeDefined();
    expect(inter!.stack).toContain('Inter');
  });

  test('MONO_FONT_PRESETS still offers JetBrains Mono', () => {
    const jb = MONO_FONT_PRESETS.find((p) => p.id === 'jetbrains-mono');
    expect(jb).toBeDefined();
    expect(jb!.stack).toContain('JetBrains Mono');
  });

  test.each([
    ['UI', UI_FONT_PRESETS, 'inter'],
    ['mono', MONO_FONT_PRESETS, 'jetbrains-mono'],
  ] as const)(
    '%s preset for the old pair carries a usable fallback tail',
    (_zone, presets: readonly FontPreset[], id: string) => {
      const preset = presets.find((p) => p.id === id)!;
      const tail = fallbackTail(preset.stack);
      expect(tail.length).toBeGreaterThan(0);
      // …and the tail actually ends somewhere the browser can always
      // resolve, rather than in another optional named family.
      expect(tail.some((f) => GENERIC_FAMILIES.includes(f))).toBe(true);
    },
  );

  test('both old-pair stacks remain resolvable through findPreset', () => {
    // findPreset is an exact string match and is what the editor uses to
    // decide between "a known preset" and "Custom". A theme still holding
    // the old pair must keep reading as the named preset, not as Custom.
    const inter = UI_FONT_PRESETS.find((p) => p.id === 'inter')!;
    const jb = MONO_FONT_PRESETS.find((p) => p.id === 'jetbrains-mono')!;
    expect(findPreset(inter.stack, UI_FONT_PRESETS)?.id).toBe('inter');
    expect(findPreset(jb.stack, MONO_FONT_PRESETS)?.id).toBe('jetbrains-mono');
  });

  test('preset ids are unique within each list', () => {
    // Adding the new pair must not shadow an existing entry: the editor's
    // <Select> keys on `id`, so a duplicate makes one of the two options
    // unreachable — the same loss this file exists to prevent.
    for (const presets of [UI_FONT_PRESETS, MONO_FONT_PRESETS]) {
      const ids = presets.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
