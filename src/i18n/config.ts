/**
 * i18n bootstrap (sk-285.1.17).
 *
 * Single i18next instance, wired to React through `initReactI18next`.
 * Importing this module initialises the instance as a side effect —
 * `main.tsx` imports it before rendering, and `src/test/setup.ts`
 * imports it so component tests render the same strings the app does.
 *
 * Design decisions:
 *  - Resources are BUNDLED (no http backend). The dictionaries are a
 *    few kilobytes and shipping them inline removes a network round
 *    trip on first paint plus a whole class of "translation flashed
 *    in English then swapped" bugs.
 *  - `fallbackLng: 'en'` and `lng` defaults to 'en' — English is the
 *    product's default language; Russian is opt-in.
 *  - The choice is persisted in localStorage under `skein.lang`
 *    ONLY. The backend is not involved: language is a per-device
 *    preference, not part of the user profile.
 *  - `escapeValue: false` — React already escapes interpolated values;
 *    double-escaping would render `&amp;` in the UI.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './locales/en';
import { ru } from './locales/ru';

/** localStorage key holding the user's language choice. */
export const LANG_STORAGE_KEY = 'skein.lang';

/** Languages the UI ships dictionaries for. */
export const SUPPORTED_LANGUAGES = ['en', 'ru'] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** Default language when nothing is stored (or the stored value is junk). */
export const DEFAULT_LANGUAGE: SupportedLanguage = 'en';

export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return (
    typeof value === 'string' &&
    (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
  );
}

/**
 * Read the stored language. Never throws — a disabled/blocked
 * localStorage (Safari private mode, embedded webview) must not stop
 * the app from booting, it just means "no preference, use the default".
 */
export function readStoredLanguage(): SupportedLanguage {
  try {
    const raw = localStorage.getItem(LANG_STORAGE_KEY);
    return isSupportedLanguage(raw) ? raw : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

/** Persist the language choice. Silently ignores storage failures. */
export function storeLanguage(lang: SupportedLanguage): void {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    /* storage unavailable — the in-memory choice still applies */
  }
}

/**
 * Namespaces. Coarse-grained on purpose: one per UI surface family, so
 * a key reads as `<surface>:<area>.<thing>` and a translator can work
 * through one screen at a time.
 */
export const resources = { en, ru } as const;

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources,
    lng: readStoredLanguage(),
    fallbackLng: DEFAULT_LANGUAGE,
    defaultNS: 'common',
    ns: Object.keys(en),
    interpolation: { escapeValue: false },
    returnNull: false,
  });
}

/**
 * Switch the active UI language and persist the choice.
 * Exported so the drawer's language switcher (and tests) drive the
 * same code path.
 */
export function setLanguage(lang: SupportedLanguage): void {
  storeLanguage(lang);
  void i18n.changeLanguage(lang);
}

export default i18n;
