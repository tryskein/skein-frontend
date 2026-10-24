/**
 * sk-514 (9) — the project popup speaks the interface language.
 *
 * The complaint was «the project popup is hard to read». The cause was
 * language, not paint: every label of the popup («id prefix», «assigned
 * to me», «git repos») was an English literal that bypassed the
 * dictionary, so under a Russian interface the popup stayed foreign text.
 *
 * The popup is rendered under `ru`, and its labels are read off the DOM.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n, { DEFAULT_LANGUAGE } from '../../i18n/config';
import { ru } from '../../i18n/locales/ru';
import { en } from '../../i18n/locales/en';
import type { ProjectListItem } from '../../api/projects';

vi.mock('../../api/projects', async (importActual) => {
  const actual = await importActual<typeof import('../../api/projects')>();
  // The background detail query never answers: the first paint is what
  // is read, and it is built from the list item alone.
  return { ...actual, getProject: () => new Promise(() => {}) };
});

import { ProjectTooltip } from '../ProjectTooltip';

const PROJECT = {
  id: 'p-1',
  name: 'shop',
  idPrefix: 'shop',
  description: 'a project with a description',
  createdAt: '2026-05-01T10:00:00Z',
  updatedAt: '2026-05-02T10:00:00Z',
  openCount: 1,
  inProgressCount: 0,
  blockedCount: 0,
} as unknown as ProjectListItem;

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage(DEFAULT_LANGUAGE);
});

function cardTextUnder(lang: 'ru' | 'en'): Promise<string> {
  return i18n.changeLanguage(lang).then(() => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={qc}>
        <ProjectTooltip project={PROJECT} />
      </QueryClientProvider>,
    );
    // sk-551.15 — the compact card has no `dt` labels any more: the
    // status counts read «1 open · 0 in progress · 0 blocked» on one line,
    // so the words are read off that line.
    return container.querySelector('.project-tooltip-line')?.textContent ?? '';
  });
}

describe('sk-514 (9) — the project popup labels come from the dictionary', () => {
  test('under ru the counts line speaks the ru dictionary, not the en one', async () => {
    const line = await cardTextUnder('ru');
    // Without this, «no en word» would pass on an empty card.
    expect(line, 'the card rendered no counts line').not.toBe('');
    for (const key of ['open', 'inProgress', 'blocked'] as const) {
      expect(line).toContain(ru.projects.tooltip[key]);
    }
    expect(line).not.toContain(en.projects.tooltip.inProgress);
  });

  test('the same card under en shows the en words — the language is live', async () => {
    const line = await cardTextUnder('en');
    expect(line).toContain(en.projects.tooltip.inProgress);
    expect(line).not.toContain(ru.projects.tooltip.inProgress);
  });

  test('the Russian labels are really Russian, not a copy of the English ones', () => {
    // Key parity proves nothing by itself: a dictionary into which
    // English strings were copied passes it. Cyrillic is required —
    // except for labels that are not obliged to have it.
    const tooltip = ru.projects.tooltip as Record<string, string>;
    const latinByDesign = new Set(['gitRepos']);
    for (const [key, value] of Object.entries(tooltip)) {
      if (latinByDesign.has(key)) continue;
      expect(/[а-яё]/i.test(value), `ru: label "${key}" = "${value}" is not in Russian`).toBe(true);
    }
  });
});
