/**
 * sk-285.1.17 — i18n wiring.
 *
 * Two things are pinned here, because each of them silently degrades
 * the whole feature when it breaks:
 *
 *   1. The stored-language contract: default `en`, unknown/absent values
 *      fall back to `en`, and a switch writes localStorage.
 *   2. The header rail's language switcher actually drives `i18n`, and
 *      the surrounding UI re-renders in the new language.
 *
 * Every test restores `en` afterwards — `src/test/setup.ts` pins the
 * product default per file, but within a file a leaked `ru` would make
 * later assertions read the wrong dictionary.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { useTranslation } from 'react-i18next';

import i18n, {
  DEFAULT_LANGUAGE,
  LANG_STORAGE_KEY,
  isSupportedLanguage,
  readStoredLanguage,
  setLanguage,
} from './config';
import { en } from './locales/en';
import { ru } from './locales/ru';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

afterEach(async () => {
  cleanup();
  localStorage.removeItem(LANG_STORAGE_KEY);
  if (i18n.language !== DEFAULT_LANGUAGE) {
    await i18n.changeLanguage(DEFAULT_LANGUAGE);
  }
});

describe('i18n dictionaries', () => {
  test('cross-namespace lookups resolve (`common:` prefix)', () => {
    // 20+ call sites reach into `common` from another namespace's `t`.
    // A misconfigured nsSeparator would render the literal key instead of
    // the string, everywhere, with no error — so pin it.
    expect(i18n.t('common:cancel')).toBe('Cancel');
    expect(i18n.getFixedT(null, 'tasks')('common:unassigned')).toBe('unassigned');
  });

  test('plural forms resolve per language', () => {
    expect(i18n.t('tasks:card.components', { count: 1 })).toBe('1 component');
    expect(i18n.t('tasks:card.components', { count: 5 })).toBe('5 components');
  });

  // sk-421.2.8 row 49 (US-6) — the labels of the blockers sub-line. The parity
  // of keys and placeholders above covers them without a change, but an empty value
  // passes both: the key is in both dictionaries, the placeholders match, and
  // the screen reader announces emptiness. So the values are checked separately.
  test('blockers sub-line labels are non-empty in both languages and resolve', () => {
    const NEW_KEYS = [
      'epic.blockersPrefix',
      'epic.blockersMore',
      'epic.blockersMoreDescription',
      'epic.blockersList',
      // sk-421.3 T07 — the labels of the grouping organ. They carry no placeholders,
      // so they are checked here too: resolving with `{count: 2}` does not
      // get in their way (unlike `epic.categoryAria`, which also has
      // `{{label}}` — it is checked by its own block below).
      'epic.groupByStatus',
      'epic.ungroup',
      // sk-421.3 T16 — the labels of the bulk-collapse organ. Also without
      // placeholders, so they are checked here too (P-101): every new
      // label must exist in BOTH dictionaries, otherwise one language
      // silently falls back to English.
      'epic.collapseAll',
      'epic.expandAll',
    ] as const;
    const valueAt = (dict: unknown, dotted: string): unknown =>
      dotted.split('.').reduce<unknown>(
        (node, part) =>
          node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
        dict,
      );

    for (const [lang, dict] of [
      ['en', en],
      ['ru', ru],
    ] as const) {
      const t = i18n.getFixedT(lang, 'details');
      for (const key of NEW_KEYS) {
        const raw = valueAt((dict as Record<string, unknown>).details, key);
        expect(typeof raw, `${lang} details.${key} is not a string`).toBe('string');
        expect((raw as string).trim(), `${lang} details.${key} is empty`).not.toBe('');
        // Through i18next as well: a resolved key renders its value, not
        // the key path, with the count filled in where one is expected.
        const resolved = t(key, { count: 2 });
        expect(resolved, `${lang} details.${key} does not resolve`).not.toBe(key);
        expect(resolved.trim()).not.toBe('');
        expect(resolved).not.toContain('{{');
      }
      // The hidden record reuses the existing word — it must resolve too.
      const unavailable = t('blocked.unavailable');
      expect(unavailable, `${lang} details:blocked.unavailable does not resolve`).not.toBe(
        'blocked.unavailable',
      );
      expect(unavailable.trim()).not.toBe('');
    }
  });

  // sk-489 (test plan, row 53) — the dictionary of the close outcome.
  //
  // The key parity above would catch a key created in one dictionary. It does
  // NOT catch an empty string and does not catch a key that nobody created
  // in either: the surface would then silently print the key path. And
  // the list here is also an assertion about the COMPOSITION: four outcomes, "without
  // work", "without work: N", "done X/Y" on both progress
  // surfaces, the modal and control labels (SC-008).
  //
  // A block of its own, not an addition to `NEW_KEYS` above: `closeOutcome.editAria`
  // has the placeholder `{{id}}`, and resolving with a bare `{ count: 2 }` would leave
  // it unsubstituted — that is, this very block would go red.
  test('sk-489 close-outcome vocabulary exists, is non-empty and resolves in both languages', () => {
    const KEYS: ReadonlyArray<{ ns: string; key: string; params: Record<string, unknown> }> = [
      // Four outcomes.
      { ns: 'details', key: 'closeOutcome.done', params: {} },
      { ns: 'details', key: 'closeOutcome.wontDo', params: {} },
      { ns: 'details', key: 'closeOutcome.duplicate', params: {} },
      { ns: 'details', key: 'closeOutcome.superseded', params: {} },
      // sk-540.5 — "excluded from scope: N" and the short "excluded: N".
      { ns: 'details', key: 'closeOutcome.excludedCount', params: { count: 2 } },
      { ns: 'details', key: 'closeOutcome.excludedShort', params: { count: 2 } },
      // Close modal labels (US-1, US-2).
      { ns: 'details', key: 'closeOutcome.modalLabel', params: {} },
      { ns: 'details', key: 'closeOutcome.modalTargetLabel', params: {} },
      { ns: 'details', key: 'closeOutcome.modalTargetPlaceholder', params: {} },
      { ns: 'details', key: 'closeOutcome.modalTargetDescription', params: {} },
      // Card control labels (US-12).
      { ns: 'details', key: 'closeOutcome.editLabel', params: {} },
      { ns: 'details', key: 'closeOutcome.editAria', params: { id: 'sk-42' } },
      // sk-489 · review F/1: the control's accessible name carries the value too —
      // otherwise the outcome is not announced by screen reading at all.
      {
        ns: 'details',
        key: 'closeOutcome.editAriaCurrent',
        params: { id: 'sk-42', outcome: 'done' },
      },
      // "done X/Y" — both progress surfaces (US-6).
      { ns: 'details', key: 'epic.branchDone', params: { done: 2, counted: 3 } },
      { ns: 'tasks', key: 'card.epicProgressDone', params: { done: 2, counted: 3 } },
      // sk-540.3 — the same pair with the excluded tail on both surfaces.
      {
        ns: 'details',
        key: 'epic.branchDoneExcluded',
        params: { done: 2, counted: 3, excluded: 'x' },
      },
      {
        ns: 'tasks',
        key: 'card.epicProgressDoneExcluded',
        params: { done: 2, counted: 3, excluded: 'x' },
      },
    ];

    const valueAt = (dict: unknown, dotted: string): unknown =>
      dotted.split('.').reduce<unknown>(
        (node, part) =>
          node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
        dict,
      );

    for (const [lang, dict] of [
      ['en', en],
      ['ru', ru],
    ] as const) {
      for (const { ns, key, params } of KEYS) {
        const raw = valueAt((dict as Record<string, unknown>)[ns], key);
        expect(typeof raw, `${lang} ${ns}.${key} is not a string`).toBe('string');
        expect((raw as string).trim(), `${lang} ${ns}.${key} is empty`).not.toBe('');
        const resolved = i18n.getFixedT(lang, ns)(key, params);
        expect(resolved, `${lang} ${ns}.${key} does not resolve`).not.toBe(key);
        // Every placeholder is substituted: an unclosed `{{…}}` means the
        // surface will print it to the reader verbatim.
        expect(resolved, `${lang} ${ns}.${key} left a placeholder`).not.toContain('{{');
      }
    }
  });

  // sk-551.8 T030 — the dictionary of the sections mode: the layout switch of the left
  // panel (`header.navLayout.*`) and the sections column (`shell.nav.*`).
  //
  // Dictionary parity is held by the `Resources` type, but it does not catch an empty
  // string, a placeholder lost in translation and a key that nobody
  // created in either. The list is the full list of task sk-569.4.
  // The parameter values are deliberately distinguishable: each must get into the
  // string, otherwise the label silently lost, for example, the queue counter.
  // The exact text is not checked.
  test('sk-551.8 nav-layout vocabulary exists, is non-empty and resolves in both languages', () => {
    const KEYS: ReadonlyArray<{ ns: string; key: string; params: Record<string, string> }> = [
      { ns: 'header', key: 'navLayout.label', params: {} },
      { ns: 'header', key: 'navLayout.columns', params: {} },
      { ns: 'header', key: 'navLayout.sections', params: {} },
      { ns: 'header', key: 'navLayout.mobileHint', params: {} },
      { ns: 'header', key: 'navLayout.saveFailed', params: {} },
      { ns: 'shell', key: 'nav.projects', params: {} },
      { ns: 'shell', key: 'nav.queues', params: {} },
      { ns: 'shell', key: 'nav.expandSection', params: { section: 'SECTION-X' } },
      { ns: 'shell', key: 'nav.collapseSection', params: { section: 'SECTION-X' } },
      { ns: 'shell', key: 'nav.collapseColumn', params: {} },
      {
        ns: 'shell',
        key: 'nav.expandColumnWithCounts',
        params: { projects: '701', total: '702', inbox: '703', mentions: '704', watching: '705' },
      },
      {
        ns: 'shell',
        key: 'nav.expandColumnQueuesOnly',
        params: { total: '702', inbox: '703', mentions: '704', watching: '705' },
      },
      { ns: 'shell', key: 'nav.resizeSplit', params: {} },
      { ns: 'shell', key: 'nav.resizeWidth', params: {} },
      { ns: 'shell', key: 'nav.sectionsWorkspaceHint', params: {} },
    ];

    const valueAt = (dict: unknown, dotted: string): unknown =>
      dotted.split('.').reduce<unknown>(
        (node, part) =>
          node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
        dict,
      );

    for (const [lang, dict] of [
      ['en', en],
      ['ru', ru],
    ] as const) {
      for (const { ns, key, params } of KEYS) {
        const raw = valueAt((dict as Record<string, unknown>)[ns], key);
        expect(typeof raw, `${lang} ${ns}.${key} is not a string`).toBe('string');
        expect((raw as string).trim(), `${lang} ${ns}.${key} is empty`).not.toBe('');
        const resolved = i18n.getFixedT(lang, ns)(key, params);
        expect(resolved, `${lang} ${ns}.${key} does not resolve`).not.toBe(key);
        expect(resolved.trim(), `${lang} ${ns}.${key} resolves empty`).not.toBe('');
        expect(resolved, `${lang} ${ns}.${key} left a placeholder`).not.toContain('{{');
        for (const [name, value] of Object.entries(params)) {
          expect(resolved, `${lang} ${ns}.${key} lost {{${name}}}`).toContain(value);
        }
      }
    }
  });

  // sk-565 T033 (US-8, matrix row 57) — the dictionary of the "Issue creation" panel
  // (`notifications.issueCreate.*`). The block proves only the presence of keys
  // in both dictionaries and their resolution; that the panel calls these keys is
  // row 56 (`NotificationsPage.test.tsx`). `ru` is not typed against `en`,
  // so a key lost in one dictionary is caught here, not by the build.
  // The exact text is not checked.
  test('sk-565 issue-create vocabulary exists, is non-empty and resolves in both languages', () => {
    const KEYS = [
      'issueCreate.title',
      'issueCreate.label',
      'issueCreate.description',
      'issueCreate.loadFailed',
      'issueCreate.saveFailed',
      'issueCreate.loading',
      'issueCreate.saving',
    ] as const;
    const valueAt = (dict: unknown, dotted: string): unknown =>
      dotted.split('.').reduce<unknown>(
        (node, part) =>
          node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
        dict,
      );

    for (const [lang, dict] of [
      ['en', en],
      ['ru', ru],
    ] as const) {
      const t = i18n.getFixedT(lang, 'notifications');
      for (const key of KEYS) {
        const raw = valueAt(dict.notifications, key);
        expect(typeof raw, `${lang} notifications.${key} is not a string`).toBe('string');
        expect((raw as string).trim(), `${lang} notifications.${key} is empty`).not.toBe('');
        const resolved = t(key);
        expect(resolved, `${lang} notifications.${key} does not resolve`).not.toBe(key);
        expect(resolved.trim(), `${lang} notifications.${key} resolves empty`).not.toBe('');
        expect(resolved, `${lang} notifications.${key} left a placeholder`).not.toContain('{{');
      }
    }
  });

  // sk-421.3 T06 (US-1, SC-005) — the labels of the "List" categories. As a separate
  // block, not an addition to `NEW_KEYS` above: that one resolves keys with
  // a bare `{ count: 2 }`, while the accessible name of the heading also carries
  // `{{label}}` — it would stay unsubstituted there, and the check
  // "no `{{` in the value" would go red on a correct dictionary.
  test('category labels of the epic List resolve in both languages', () => {
    // Keys with a PLAIN value. `epic.categoryAria` is not included here: since
    // m-8 it carries plural forms, and it has no bare value
    // in `en` any more — reading it from the dictionary would give
    // `undefined` on a correct dictionary. It is checked below, through i18next.
    const PLAIN_KEYS = ['epic.categoryUnavailable', 'epic.categoryNoStatus'] as const;
    const valueAt = (dict: unknown, dotted: string): unknown =>
      dotted.split('.').reduce<unknown>(
        (node, part) =>
          node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
        dict,
      );

    for (const [lang, dict] of [
      ['en', en],
      ['ru', ru],
    ] as const) {
      const t = i18n.getFixedT(lang, 'details');
      for (const key of PLAIN_KEYS) {
        const raw = valueAt((dict as Record<string, unknown>).details, key);
        expect(typeof raw, `${lang} details.${key} is not a string`).toBe('string');
        expect((raw as string).trim(), `${lang} details.${key} is empty`).not.toBe('');
        const resolved = t(key);
        expect(resolved, `${lang} details.${key} does not resolve`).not.toBe(key);
        expect(resolved.trim()).not.toBe('');
        expect(resolved, `${lang} details.${key} left a placeholder unfilled`).not.toContain('{{');
      }

      // The accessible name must carry BOTH parts: the label and the counter. Without
      // this pair "resolves" would hold true for a string that lost the
      // counter in translation. The numbers are of different categories — with
      // `count: 2` alone the singular form would not be checked.
      for (const count of [1, 2, 5]) {
        const aria = t('epic.categoryAria', { label: 'open', count });
        expect(aria, `${lang} categoryAria does not resolve at count=${count}`).not.toBe(
          'epic.categoryAria',
        );
        expect(aria, `${lang} categoryAria lost the label at count=${count}`).toContain('open');
        expect(aria, `${lang} categoryAria lost the count at count=${count}`).toContain(
          String(count),
        );
        expect(aria, `${lang} categoryAria left a placeholder at count=${count}`).not.toContain(
          '{{',
        );
      }
    }

    // m-8 — AGREEMENT with the number, not a number glued to a string.
    // A one-row category was announced as "open — 1 issues": such an
    // error is spoken aloud by the screen reader, while nobody sees it with eyes in the
    // interface, which is why it lived to the review. The forms are named in full —
    // `toContain` here would pass "1 issues", which contains "1 issue".
    const enT = i18n.getFixedT('en', 'details');
    expect(enT('epic.categoryAria', { label: 'open', count: 1 })).toBe('open — 1 issue');
    expect(enT('epic.categoryAria', { label: 'open', count: 2 })).toBe('open — 2 issues');
  });
});

describe('language preference', () => {
  test('default is English', () => {
    expect(DEFAULT_LANGUAGE).toBe('en');
    localStorage.removeItem(LANG_STORAGE_KEY);
    expect(readStoredLanguage()).toBe('en');
  });

  test('an unsupported stored value falls back to the default', () => {
    localStorage.setItem(LANG_STORAGE_KEY, 'klingon');
    expect(isSupportedLanguage('klingon')).toBe(false);
    expect(readStoredLanguage()).toBe('en');
  });

  test('a supported stored value is honoured', () => {
    localStorage.setItem(LANG_STORAGE_KEY, 'ru');
    expect(readStoredLanguage()).toBe('ru');
  });

  test('setLanguage persists the choice and flips the live instance', async () => {
    setLanguage('ru');
    expect(localStorage.getItem(LANG_STORAGE_KEY)).toBe('ru');
    // changeLanguage resolves asynchronously; the resources are bundled
    // so there is no fetch to wait on beyond the microtask.
    await i18n.changeLanguage('ru');
    expect(i18n.t('projects:title')).toBe('Проекты');
  });
});

/** Minimal consumer so the switch can be observed through a render. */
function Probe() {
  const { t } = useTranslation('projects');
  return <span data-testid="probe">{t('title')}</span>;
}

/**
 * sk-285.6.15 — the switcher is a rail control: a tag-only button that
 * opens a list of tag + name rows. Mantine's Popover needs its provider,
 * which the header supplies in the real tree.
 *
 * sk-285.7.2.38 replaced the two flag SVGs with §6's mono language tag,
 * so the assertions below moved from `svg.header-lang-flag` to
 * `.header-lang-code` — and gained one they could not make before: the
 * tag is TEXT, so what it says can be checked, and «EN» beside "English"
 * is the pair that makes it a recognition mark rather than decoration.
 */
function renderSwitcher() {
  return render(
    <MantineProvider>
      <LanguageSwitcher />
      <Probe />
    </MantineProvider>,
  );
}

describe('LanguageSwitcher', () => {
  test('the collapsed control shows the TAG alone, under a text name', () => {
    const { container } = renderSwitcher();

    const button = screen.getByRole('button', { name: 'Language: English' });
    const tag = button.querySelector('.header-lang-code');
    expect(tag, 'the rail control draws no language tag').not.toBeNull();
    // §6: "text "EN" … instead of a flag". The tag IS the whole control —
    // nothing else is drawn, which is the other half of the requirement.
    expect(button.textContent).toBe('en');
    // The tag repeats the button's own accessible name, so it is hidden
    // rather than announced twice — the same reason the flag was.
    expect(tag!.getAttribute('aria-hidden')).toBe('true');
    // Collapsed: exactly one tag in the document, the current one.
    expect(container.querySelectorAll('.header-lang-code')).toHaveLength(1);
    // No flag survived anywhere in the control.
    expect(container.querySelector('svg')).toBeNull();
  });

  test('the open list names every language in words beside its tag', () => {
    renderSwitcher();

    fireEvent.click(screen.getByRole('button', { name: 'Language: English' }));

    const rows = screen.getAllByRole('menuitemradio');
    expect(rows.map((r) => r.textContent)).toEqual(['enEnglish', 'ruРусский']);
    for (const row of rows) {
      const tag = row.querySelector('.header-lang-code');
      expect(tag, 'a language row draws no tag').not.toBeNull();
      // The tag is the language's own ISO code, not a translation of it:
      // «RU» stays «RU» in an English UI, which is what makes it a
      // stable mark for the thing it selects.
      expect(['en', 'ru']).toContain(tag!.textContent);
    }
    // The current language is the checked one — `aria-checked` on a
    // radio row, not `aria-pressed`: this is a choice among options.
    expect(rows[0].getAttribute('aria-checked')).toBe('true');
    expect(rows[1].getAttribute('aria-checked')).toBe('false');
  });

  test('picking a language switches the UI and persists the choice', async () => {
    renderSwitcher();

    expect(screen.getByTestId('probe').textContent).toBe('Projects');
    fireEvent.click(screen.getByRole('button', { name: 'Language: English' }));

    // The click flips i18next, which re-renders every subscribed
    // component — wrap it so React flushes those updates inside act().
    await act(async () => {
      fireEvent.click(
        screen.getByRole('menuitemradio', {
          name: 'Switch interface language to Русский',
        }),
      );
      await i18n.changeLanguage('ru');
    });

    expect(screen.getByTestId('probe').textContent).toBe('Проекты');
    expect(localStorage.getItem(LANG_STORAGE_KEY)).toBe('ru');
    // The control itself re-renders in the new language: its name is
    // translated and it now shows the other tag.
    expect(screen.getByRole('button', { name: 'Язык: Русский' })).toBeTruthy();
  });
});
