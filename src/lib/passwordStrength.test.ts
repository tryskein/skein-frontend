/**
 * sk-303.20 review (grok Warning) — `getZxcvbn()` memoizes the dynamic
 * `import()` chain in a module-level `factoryPromise` so the (comparatively
 * heavy) dictionary load only happens once. Before this fix, a FAILED load
 * (offline mid-navigation, a stale chunk 404'ing after a deploy) latched
 * that promise to its rejection forever: every later `scorePassword()` call
 * would await the same already-rejected promise and re-throw immediately,
 * with no way to recover short of a full page reload. This file proves the
 * fix — a failed call resets the memo so the NEXT call gets a fresh retry —
 * in isolation from the real zxcvbn package (mocked here; the "never sends
 * the password to the server" claim is proven against the REAL package in
 * PasswordPage.test.tsx instead, which is a different property than the
 * one this file tests).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

let factoryCallCount = 0;
let failNextFactoryCall = false;

/** What the factory was built with — the translation language and the dictionary composition (sk-403). */
interface FactoryOptions {
  translations: { lang?: string };
  dictionary: Record<string, unknown>;
}
const factoryOptions: FactoryOptions[] = [];

vi.mock('@zxcvbn-ts/core', () => ({
  ZxcvbnFactory: vi.fn().mockImplementation((options: unknown) => {
    factoryCallCount += 1;
    factoryOptions.push(options as FactoryOptions);
    if (failNextFactoryCall) {
      failNextFactoryCall = false;
      throw new Error('simulated dictionary/factory init failure');
    }
    return {
      check: (password: string) => ({
        score: password.length >= 12 ? 4 : 0,
        feedback: { warning: password.length >= 12 ? '' : 'too short', suggestions: [] },
      }),
    };
  }),
}));
vi.mock('@zxcvbn-ts/language-common', () => ({ adjacencyGraphs: {}, dictionary: {} }));
vi.mock('@zxcvbn-ts/language-en', () => ({
  translations: { lang: 'en' },
  dictionary: { 'commonWords-en': ['password'] },
}));
vi.mock('@zxcvbn-ts/language-ru', () => ({
  translations: { lang: 'ru' },
  dictionary: { 'commonWords-ru': ['парол'] },
}));

// Imported AFTER the mocks so the mocked modules are wired in, and via a
// dynamic import per test (vi.resetModules() below) so each test gets its
// own fresh, unmemoized `factoryPromise` module-level variable.
async function freshScorePassword() {
  vi.resetModules();
  const mod = await import('./passwordStrength');
  return mod.scorePassword;
}

beforeEach(() => {
  factoryCallCount = 0;
  failNextFactoryCall = false;
  factoryOptions.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('scorePassword — factory memoization survives a failed load', () => {
  test('happy path: scores without needing more than one factory build', async () => {
    const scorePassword = await freshScorePassword();
    const result = await scorePassword('a-decently-long-password', 'en');
    expect(result.score).toBe(4);
    expect(factoryCallCount).toBe(1);

    // A second call reuses the memoized factory — no rebuild.
    await scorePassword('another-long-one-here', 'en');
    expect(factoryCallCount).toBe(1);
  });

  test('a failed factory build rejects, but does NOT wedge the next call to the same rejection', async () => {
    const scorePassword = await freshScorePassword();
    failNextFactoryCall = true;

    await expect(scorePassword('whatever', 'en')).rejects.toThrow(
      'simulated dictionary/factory init failure',
    );
    expect(factoryCallCount).toBe(1);

    // Without the fix, this second call would await the SAME (already
    // rejected) memoized promise and reject again with the identical
    // error, without ever calling ZxcvbnFactory a second time.
    const result = await scorePassword('a-decently-long-password', 'en');
    expect(result.score).toBe(4);
    expect(factoryCallCount).toBe(2);
  });
});

/**
 * sk-403 — the language of the estimator.
 *
 * What is checked is what cannot be seen from the rendered string: WHAT the
 * factory was built with. The feedback is written by the library itself, the translation package is chosen
 * in the constructor, and "it looked Russian" on a mocked core does not mean
 * anything — while "the Russian package went into the constructor, and it went in AGAIN after the
 * language change" means exactly the requirement of the card.
 */
describe('sk-403 — the translation package follows the language, the dictionary does not', () => {
  test('the Russian language builds the factory with Russian translations', async () => {
    const scorePassword = await freshScorePassword();
    await scorePassword('a-decently-long-password', 'ru');
    expect(factoryOptions).toHaveLength(1);
    expect(factoryOptions[0].translations.lang).toBe('ru');
  });

  test('a code with a region (`ru-RU`) is Russian too, `en-GB` is English', async () => {
    // i18next returns `i18n.language` as is, and it may be `ru-RU`:
    // comparing by the full code would silently return English.
    const scorePassword = await freshScorePassword();
    await scorePassword('a-decently-long-password', 'ru-RU');
    expect(factoryOptions[0].translations.lang).toBe('ru');
    await scorePassword('a-decently-long-password', 'en-GB');
    expect(factoryOptions[1].translations.lang).toBe('en');
  });

  test('a language change REBUILDS the factory, and the same language does not', async () => {
    // The heart of the defect: the factory was memoized for the life of the tab, and the first
    // run decided forever what language the feedback would be in.
    const scorePassword = await freshScorePassword();
    await scorePassword('a-decently-long-password', 'en');
    expect(factoryCallCount).toBe(1);

    await scorePassword('a-decently-long-password', 'ru');
    expect(factoryCallCount).toBe(2);
    expect(factoryOptions[1].translations.lang).toBe('ru');

    // ...and the memo still works: a repeat in the same language does not rebuild.
    await scorePassword('another-long-one-here', 'ru');
    expect(factoryCallCount).toBe(2);
  });

  test('the dictionary carries BOTH languages for any interface language', async () => {
    // The sk-403 decision, written as an assertion: the dictionary is the list of the
    // attacker's words, not a caption for the reader. Under a dictionary of one
    // language a Russian word for "password" would get an inflated score from a person who
    // simply switched the interface.
    const scorePassword = await freshScorePassword();
    await scorePassword('a-decently-long-password', 'en');
    expect(Object.keys(factoryOptions[0].dictionary).sort()).toEqual([
      'commonWords-en',
      'commonWords-ru',
    ]);
  });
});
