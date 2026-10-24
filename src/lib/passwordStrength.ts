/**
 * sk-303.20 — client-side password strength estimate via zxcvbn-ts.
 *
 * Runs entirely in the browser: `zxcvbn.check()` is a synchronous, pure
 * function over the candidate string — it never touches the network. That
 * is the actual acceptance criterion this module exists to satisfy ("the
 * strength estimate never sends the password to the server"), not merely
 * an implementation detail — see PasswordPage.test.tsx for the assertion
 * that proves it (mocked `fetch`, asserted never called on this path).
 *
 * The factory (`ZxcvbnFactory` + its dictionaries) is built once, lazily,
 * on first call — not at module scope, so importing this file doesn't pull
 * `@zxcvbn-ts/core` and its dictionaries into the app's main bundle. The
 * caller (PasswordPage) itself only reaches this module via `import()`
 * from inside the page component, so the whole cost — factory init and
 * the estimator's own bundle weight — is paid only by someone who actually
 * opens /settings/password.
 *
 * ─── sk-403: the estimator language ────────────────────────────────
 *
 * `feedback.warning` and `feedback.suggestions` are user-facing text,
 * and it is born INSIDE the library: the translation package is chosen at the moment
 * the factory is built, not at render time, so `t()` does not help here.
 * Previously English was hard-wired into the constructor, and under the Russian interface
 * the strength line read half in Russian, half in English.
 * Now the factory is MEMOIZED PER LANGUAGE: a change of the tab language rebuilds
 * it instead of returning the old one. The language comes as a parameter — the module knows nothing about
 * i18next and stays testable without it.
 *
 * ─── sk-403: the dictionary — BOTH languages, always ───────────────
 *
 * `dictionary` is the list of the ATTACKER's words, not a caption for the reader, and
 * therefore it does not follow the interface language. A person who switched the UI to
 * English keeps inventing passwords in Russian: under a dictionary of one
 * language a Russian "password" or "iloveyou" would get an inflated score, that is,
 * the estimator would lie towards safety — exactly the mistake for which
 * it is shown. The price is the weight of a lazy chunk of ONE page: measured on
 * `dist/*.mjs` of the packages, gzip — common ≈ 220 KB, en ≈ 602 KB, ru ≈ 464 KB.
 * Only those who opened /settings/password pay.
 */
import type { ZxcvbnFactory as ZxcvbnFactoryType } from '@zxcvbn-ts/core';

/** Languages for which we have an estimator translation package. */
export type StrengthLanguage = 'en' | 'ru';

/**
 * Reduce an i18next language code (`ru`, `ru-RU`, `en-GB`, …) to a translation package.
 * An unknown language is English: it is the product's default language.
 */
export function strengthLanguage(language: string): StrengthLanguage {
  return language.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

let cached: { lang: StrengthLanguage; promise: Promise<ZxcvbnFactoryType> } | null = null;

async function getZxcvbn(lang: StrengthLanguage): Promise<ZxcvbnFactoryType> {
  if (cached && cached.lang === lang) return cached.promise;

  const promise = (async () => {
    const [{ ZxcvbnFactory }, zxcvbnCommon, zxcvbnEn, zxcvbnRu] = await Promise.all([
      import('@zxcvbn-ts/core'),
      import('@zxcvbn-ts/language-common'),
      import('@zxcvbn-ts/language-en'),
      import('@zxcvbn-ts/language-ru'),
    ]);
    return new ZxcvbnFactory({
      translations: lang === 'ru' ? zxcvbnRu.translations : zxcvbnEn.translations,
      graphs: zxcvbnCommon.adjacencyGraphs,
      // Both language dictionaries, regardless of the interface language — see the header.
      dictionary: {
        ...zxcvbnCommon.dictionary,
        ...zxcvbnEn.dictionary,
        ...zxcvbnRu.dictionary,
      },
    });
  })();

  cached = { lang, promise };

  // sk-303.20 review (grok Warning) — a failed dynamic import (offline
  // mid-navigation, a stale chunk 404'ing after a deploy) used to latch
  // this memoized promise to the SAME rejection forever: every later
  // scorePassword() call would await the already-rejected promise and
  // re-throw immediately, with no way to recover short of a full page
  // reload. Drop the memo so the next call retries the import instead of
  // replaying a cached failure. The handler is attached here rather than
  // in the chain returned to the caller, so a rejection is never
  // "unhandled" merely because the memo was hit before anyone awaited it.
  promise.catch(() => {
    if (cached?.promise === promise) cached = null;
  });

  return promise;
}

/** Result shape PasswordPage renders — a trimmed view of zxcvbn's output. */
export interface PasswordStrength {
  /** 0 (very weak) .. 4 (very strong), zxcvbn's own scale. */
  score: 0 | 1 | 2 | 3 | 4;
  /** Human-readable warning about the specific weakness found, or ''. */
  warning: string;
  /** Concrete suggestions to strengthen the password; may be empty. */
  suggestions: string[];
}

/**
 * Score `password` in the browser. Never sends `password` anywhere — see
 * module doc. Safe to call on every keystroke (the caller debounces for UI
 * smoothness, not for privacy — unlike the pwned check, there is no
 * network cost here to economise).
 *
 * `language` — the interface language code (`i18n.language`). It decides ONLY the
 * language of the feedback text; the dictionary is always the same (see the header).
 * The argument is required on purpose: a default value would bring back exactly
 * the defect sk-403 fixes — a call silently estimating
 * in English.
 */
export async function scorePassword(
  password: string,
  language: string,
): Promise<PasswordStrength> {
  const zxcvbn = await getZxcvbn(strengthLanguage(language));
  const result = zxcvbn.check(password);
  return {
    score: result.score,
    warning: result.feedback.warning ?? '',
    suggestions: result.feedback.suggestions,
  };
}
