import type { EmailLanguage } from '../api/auth';

/**
 * sk-674.18 — the language of a transactional email from the interface
 * language (i18next `language`: `ru`, `ru-RU`, `en-GB`, …). Spec US-9:
 * "The email language is the interface language passed in the request"; the invitation
 * email takes the inviter's. Anything not Russian is English, the
 * product's default language.
 */
export function emailLanguage(language: string): EmailLanguage {
  return language.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}
