/**
 * sk-407 (1) — what the Tasks search box says before you type.
 *
 * The maintainers' wording, verbatim from the request (typo repaired):
 * «Поиск по тексту или коду задачи» ("Search by task text or code"). The box searches BOTH — the task's
 * prose and its hierarchical id — and the placeholder that stood there
 * («поиск… или вставьте коды задач», "search… or paste task codes") named the paste path instead of the
 * second thing you can search BY, so a reader who wanted `sk-407` had no
 * way to learn from the field that typing it works.
 *
 * ── Why this is a render and not a dictionary lookup ────────────────
 *
 * A test that read `ru.filters.searchPlaceholder` off the object would
 * pass while the component asked for a DIFFERENT key — which is a real
 * failure mode here, because the panel holds three search-ish strings
 * (`filters.searchPlaceholder`, `projects.searchPlaceholder`, the epic
 * picker's) and they differ by namespace alone. So the panel is mounted
 * and the placeholder is read off the input the user actually types in.
 *
 * ── Both languages, and what «by meaning» is allowed to mean ────────
 *
 * The Russian is pinned character for character: it is the maintainers' own
 * sentence and there is nothing to derive. The English is NOT pinned to
 * a string — it is a translation, and pinning it here would make this
 * file the place English copy is edited. What it is held to is the pair
 * of claims the Russian makes: the field names the task's TEXT and the
 * task's CODE. That is checkable without being a transcription.
 */

import { afterEach, describe, expect, test } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { vi } from 'vitest';

import { TaskFilters, type TaskFiltersProps } from '../TaskFilters';
import i18n, { DEFAULT_LANGUAGE } from '../../../i18n/config';

/** The maintainers' sentence, sk-407. Repaired typo: «Поис» → «Поиск» ("Searc" → "Search"). */
const RU_PLACEHOLDER = 'Поиск по тексту или коду задачи';

function props(): TaskFiltersProps {
  return {
    search: '',
    onSearchChange: vi.fn(),
    statusFilter: 'all',
    onStatusChange: vi.fn(),
    originFilter: 'all',
    onOriginChange: vi.fn(),
    typeFilter: 'all',
    onTypeChange: vi.fn(),
    priorityFilter: 'all',
    onPriorityChange: vi.fn(),
    view: 'cards',
    sort: 'updated',
    onSortChange: vi.fn(),
    showAssigneeRow: false,
    assigneeOptions: [],
    assigneeFilter: null,
    onAssigneeChange: vi.fn(),
    searchActive: false,
    filtersEnabled: true,
    withinFilters: false,
    onWithinFiltersToggle: vi.fn(),
    allProjects: false,
    onAllProjectsToggle: vi.fn(),
    allProjectsDisabled: false,
    searchDegraded: false,
    onSearchPaste: vi.fn(),
    blobActive: false,
    collapsed: true,
    onToggleCollapsed: vi.fn(),
    filtersLayout: 'select',
    onFiltersLayoutChange: vi.fn(),
  };
}

/** The one input a reader types a query into. */
function placeholderOf(): string {
  render(
    <MantineProvider>
      <TaskFilters {...props()} />
    </MantineProvider>,
  );
  const box = screen.getByLabelText(
    i18n.t('filters:searchAria'),
  ) as HTMLInputElement;
  return box.placeholder;
}

afterEach(async () => {
  cleanup();
  if (i18n.language !== DEFAULT_LANGUAGE) {
    await act(async () => {
      await i18n.changeLanguage(DEFAULT_LANGUAGE);
    });
  }
});

describe('sk-407 — the Tasks search placeholder', () => {
  test('ru is the maintainers’ sentence, spelled the way they wrote it', async () => {
    await act(async () => {
      await i18n.changeLanguage('ru');
    });
    expect(placeholderOf()).toBe(RU_PLACEHOLDER);
  });

  test('ru no longer offers the paste path INSTEAD of the two search keys', async () => {
    // The specific regression: the old copy («поиск… или вставьте коды
    // задач») described what to do with a clipboard, not what the field
    // matches on. Pasting still works — `onSearchPaste` is untouched and
    // `blobPaste.test.tsx` pins it — it just stopped being the only
    // thing the empty field talks about.
    //
    // Read off the RENDER, not off `RU_PLACEHOLDER`: a claim about a
    // constant declared four lines up is a claim about this file.
    await act(async () => {
      await i18n.changeLanguage('ru');
    });
    const ru = placeholderOf();
    expect(ru).not.toContain('вставьте');
    expect(ru).toContain('коду');
  });

  test('en carries the same two claims — the task’s text and its code', () => {
    // Not a transcription: any English wording passes as long as it
    // names both routes, so this file never becomes the place English
    // copy is edited.
    const en = placeholderOf().toLowerCase();
    expect(en, 'the English placeholder must name the task text').toMatch(/text/);
    expect(en, 'the English placeholder must name the task code').toMatch(/code/);
  });
});

/**
 * The Russian text of a key, read from the Russian dictionary rather than
 * written out here (the wording is not a contract, §5), and required to
 * differ from the English one: a key missing from `ru.ts` resolves to the
 * English fallback and fails this.
 */
function ruOnly(ns: string, key: string, opts: Record<string, unknown> = {}): string {
  const ruText = i18n.getFixedT('ru', ns)(key, opts) as string;
  expect(ruText, `${ns}:${key}`).not.toBe(i18n.getFixedT('en', ns)(key, opts) as string);
  return ruText;
}

/**
 * sk-1048.76 — the Russian panel is found by its Russian accessible names.
 * A field's NAME is what a screen reader announces and what a speech-input
 * user says; the placeholder is a hint that disappears on typing, so an
 * empty name with a filled placeholder is a nameless field.
 */
describe('the Russian filter panel by accessible name', () => {
  test('search, status and assignee answer to their Russian names', async () => {
    await act(async () => {
      await i18n.changeLanguage('ru');
    });
    render(
      <MantineProvider>
        <TaskFilters
          {...props()}
          collapsed={false}
          showAssigneeRow
          assigneeOptions={[{ username: 'oleg', label: 'Oleg' }]}
        />
      </MantineProvider>,
    );

    const search = screen.getByRole('textbox', { name: ruOnly('filters', 'searchAria') }) as HTMLInputElement;
    expect(search.placeholder).toBe(RU_PLACEHOLDER);
    // The name is not the placeholder: both are announced, for different things.
    expect(search.getAttribute('aria-label')).not.toBe(search.placeholder);
    expect(screen.getByRole('textbox', { name: ruOnly('filters', 'labels.status') })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: ruOnly('filters', 'labels.assignee') })).toBeTruthy();
  });
});
