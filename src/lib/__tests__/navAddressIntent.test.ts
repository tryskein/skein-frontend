/**
 * sk-551.8 F5 — "reveal by address" as pure functions (plan P3, P12,
 * variant (a); spec "Concepts", US-12).
 *
 * Reference: the conjunction of source (a) — Navigation Timing `navigate`
 * + the router's initial entry + once per document + this tab's
 * sessionStorage not having seen the href — and source (b) — a PUSH with
 * a nonce not handled yet. Every row breaks exactly one part of the
 * conjunction, so a single-signal implementation goes red.
 *
 * jsdom has no navigation entry; the document's type is given by stubbing
 * `performance.getEntriesByType`, the same way the provider test does
 * (F8(6)). The module keeps a once-per-document flag, so each case loads
 * a fresh copy of it (`vi.resetModules`) — a fresh document.
 */
import { NavigationType } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type IntentModule = typeof import('../navAddressIntent');

async function freshDocument(navType: string | null): Promise<IntentModule> {
  vi.resetModules();
  vi.spyOn(performance, 'getEntriesByType').mockImplementation((kind: string) =>
    kind === 'navigation' && navType !== null
      ? ([{ type: navType }] as unknown as PerformanceEntryList)
      : [],
  );
  return import('../navAddressIntent');
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/?tab=mentions');
});

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe('source (a) — the initial load of the document', () => {
  it.each([
    ['/?tab=mentions', true],
    ['/', false],
    ['/?view=kanban', false],
  ])('navigate on the initial entry at %s → %s (a queue must be named in the address)', async (path, expected) => {
    window.history.replaceState(null, '', path);
    const m = await freshDocument('navigate');
    expect(m.readInitialLoadIntent('default')).toBe(expected);
    if (!expected) expect(window.sessionStorage.length).toBe(0);
  });

  it('navigate on the initial entry opens once per document', async () => {
    const m = await freshDocument('navigate');
    expect(m.readInitialLoadIntent('default')).toBe(true);
    expect(m.readInitialLoadIntent('default')).toBe(false);
  });

  it.each([['reload'], ['back_forward'], ['prerender'], [null]])(
    'Navigation Timing type %s does not open',
    async (navType) => {
      const m = await freshDocument(navType);
      expect(m.readInitialLoadIntent('default')).toBe(false);
    },
  );

  it('a second SPA entry (not the initial key) does not open, and uses up the document’s ask', async () => {
    const m = await freshDocument('navigate');
    expect(m.readInitialLoadIntent('k3x9a1')).toBe(false);
    expect(m.readInitialLoadIntent('default')).toBe(false);
  });

  it('the same href already recorded in this tab’s sessionStorage (duplicate, restore) does not open', async () => {
    const first = await freshDocument('navigate');
    expect(first.readInitialLoadIntent('default')).toBe(true);
    // A duplicated or restored tab: a new document, the same sessionStorage
    // and href, and a browser that copied the type `navigate`.
    const duplicate = await freshDocument('navigate');
    expect(duplicate.readInitialLoadIntent('default')).toBe(false);
  });

  it('another href in the same tab still opens', async () => {
    const first = await freshDocument('navigate');
    expect(first.readInitialLoadIntent('default')).toBe(true);
    window.history.replaceState(null, '', '/?tab=watching');
    const next = await freshDocument('navigate');
    expect(next.readInitialLoadIntent('default')).toBe(true);
  });
});

describe('source (b) — a deliberate move inside the app', () => {
  it.each<{ name: string; type: NavigationType; handledOwn: boolean; expected: boolean }>([
    { name: 'PUSH with a new nonce', type: NavigationType.Push, handledOwn: false, expected: true },
    { name: 'POP with the nonce (Back/Forward)', type: NavigationType.Pop, handledOwn: false, expected: false },
    { name: 'REPLACE with the nonce', type: NavigationType.Replace, handledOwn: false, expected: false },
    { name: 'PUSH with a nonce already handled', type: NavigationType.Push, handledOwn: true, expected: false },
  ])('$name → $expected', async ({ type, handledOwn, expected }) => {
    const m = await freshDocument('navigate');
    const state = m.withReveal({ selfOpenedFile: true });
    const nonce = m.readRevealNonce(state);
    expect(nonce).not.toBeNull();
    const handled = new Set<number>(handledOwn && nonce !== null ? [nonce] : []);
    expect(m.isIntentNavigation({ state }, type, handled)).toBe(expected);
  });

  it('a PUSH without the nonce is not one', async () => {
    const m = await freshDocument('navigate');
    expect(m.isIntentNavigation({ state: { selfOpenedFile: true } }, NavigationType.Push, new Set())).toBe(false);
    expect(m.isIntentNavigation({ state: null }, NavigationType.Push, new Set())).toBe(false);
  });

  it('an ordinary move carrying a revealed state does not inherit the nonce', async () => {
    const m = await freshDocument('navigate');
    const revealed = m.withReveal({ selfOpenedFile: true });
    const carried = m.carryState(revealed);
    expect(m.isIntentNavigation({ state: carried }, NavigationType.Push, new Set())).toBe(false);
  });

  it('each targeted move gets its own nonce', async () => {
    const m = await freshDocument('navigate');
    const a = m.readRevealNonce(m.withReveal(undefined));
    const b = m.readRevealNonce(m.withReveal(undefined));
    expect(a).not.toBeNull();
    expect(b).not.toBe(a);
  });
});

describe('carryState / withReveal keep the rest of location.state', () => {
  it('carryState keeps selfOpenedFile and cuts queueReveal', async () => {
    const m = await freshDocument('navigate');
    expect(m.carryState({ selfOpenedFile: true, queueReveal: 7 })).toEqual({ selfOpenedFile: true });
  });

  it('withReveal keeps selfOpenedFile and adds a nonce', async () => {
    const m = await freshDocument('navigate');
    const next = m.withReveal({ selfOpenedFile: true, queueReveal: 7 }) as Record<string, unknown>;
    expect(next.selfOpenedFile).toBe(true);
    expect(m.readRevealNonce(next)).not.toBeNull();
    expect(m.readRevealNonce(next)).not.toBe(7);
  });
});
