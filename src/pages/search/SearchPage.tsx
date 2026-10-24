import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { IconSearch } from '@tabler/icons-react';

import { globalSearch, type SearchItem, type SearchKind } from '../../api/search';
import type { MySpace } from '../../api/spaces';
import { Attribute } from '../../components/Attribute';
import { SpaceFilter, useSpaceFilter, useSpaceName } from '../../components/SpaceFilter';
import { SearchHighlight } from '../../components/SearchHighlight';
import { TimeLabel } from '../../components/TimeLabel';

/**
 * sk-401 — global search: tasks, comments, projects, components.
 *
 * ─── Where the page came from ──────────────────────────────────────
 *
 * The legacy `/search` page and the result card were removed by the sk-303.15
 * run together with the whole old interface (commit `f765d2f`, "no
 * feature carried over"). The API is alive, though: `globalSearch` still
 * runs the hybrid task search for the Tasks column. The maintainers' decision
 * (2026-09-20): search comes back — as a NEW surface, not as a
 * restoration of the old one.
 *
 * ─── Why a route, not an overlay and not a column ──────────────────
 *
 * A separate address `/search?q=…` makes the result a LINK: it can be
 * shared, "back" leads to it, it can be opened in a new tab. The removed page
 * lived by the same decision, and it is behavioural, not
 * stylistic — so it was taken, while the look was built anew, in the redesign's language.
 *
 * An overlay would need a focus trap and its own history on top of the
 * browser history; a fifth column — row space that is not there at the layout
 * floor (`lib/widthBudget.ts` counts it to the pixel). The page
 * lives under `<AppChrome>`, like `/activity`: the header comes ready-made, and
 * no control is added to the header — its rail has 6px of slack at the floor
 * (`HeaderBar.tsx`, the section about the view settings panel).
 *
 * Entry — from the Tasks column search field: while search is active, next to the
 * "in filters" / "all projects" modes there is a link "Search everywhere"
 * carrying the same query here (`TaskFilters.tsx#task-search-everywhere`).
 *
 * ─── State is in the address ───────────────────────────────────────
 *
 *   ?q=…                       — the query (trimmed at the edges);
 *   ?kind=issue,comment,…      — narrowing by kinds; no parameter = all;
 *   ?space=<short id>          — sk-674.18 T056: one space; no
 *                                parameter = all (screens 1.11).
 *
 * The address is the only source: the input field changes it on submit, not
 * on every key, otherwise browser history would get clogged with letters.
 *
 * ─── The boundary, named out loud ──────────────────────────────────
 *
 * A comment result leads to the PARENT task, without scrolling to
 * the comment itself: the new shell's comment feed has no `#c-<id>`
 * anchors, and a link with such a tail would promise a jump that
 * will not happen.
 */

/** Page size: enough to see the answer, and not so much as to wait. */
const PAGE_SIZE = 25;

const KINDS: readonly SearchKind[] = ['issue', 'comment', 'project', 'component'];

/** `?kind=` → set of kinds; empty or garbage — all four. */
export function parseKinds(raw: string | null): SearchKind[] {
  if (!raw) return [];
  const picked = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is SearchKind => (KINDS as readonly string[]).includes(s));
  return [...new Set(picked)];
}

/**
 * Where a result leads. `null` — nowhere to lead: a row without data for
 * navigation is drawn as text, not as a link to nowhere.
 *
 * A project is addressed by UUID: the shell resolves both the alias, the
 * prefix and the identifier into `/projects/:alias` (`useLayoutState`, "backend resolves all
 * three"). A component in the new shell has its own route — it is more precise than the
 * former `?tab=components`.
 */
export function resultHref(item: SearchItem): string | null {
  switch (item.kind) {
    case 'issue':
      return item.projectId
        ? `/projects/${item.projectId}/issues/${encodeURIComponent(item.id)}`
        : `/issues/${encodeURIComponent(item.id)}`;
    case 'comment':
      if (!item.parentIssueId) return null;
      return item.projectId
        ? `/projects/${item.projectId}/issues/${encodeURIComponent(item.parentIssueId)}`
        : `/issues/${encodeURIComponent(item.parentIssueId)}`;
    case 'project':
      return `/projects/${item.id}`;
    case 'component':
      return item.projectId ? `/projects/${item.projectId}/components/${item.id}` : null;
    default:
      return null;
  }
}

export function SearchPage() {
  const { t } = useTranslation('search');
  const [params, setParams] = useSearchParams();

  const q = (params.get('q') ?? '').trim();
  const kinds = useMemo(() => parseKinds(params.get('kind')), [params]);

  // The draft in the field lives separately from the address and catches up with it when the address
  // changes from outside — "back", following the "Search everywhere" link.
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);

  // sk-674.18 T056 — space choice (screens 1.11): a filter of this page
  // only. With one space it is absent, and the rows have no labels.
  const spaceFilter = useSpaceFilter();
  const spacesById = useMemo(
    () =>
      spaceFilter.spaces === null
        ? null
        : new Map<string, MySpace>(spaceFilter.spaces.map((sp) => [sp.id, sp])),
    [spaceFilter.spaces],
  );

  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // An empty query — they came to search: the cursor goes straight into the field.
    if (q === '') inputRef.current?.focus();
  }, [q]);

  const query = useInfiniteQuery({
    // The space is in the key: the cursor of one result list does not continue another.
    queryKey: ['search', 'global', q, kinds.join(','), spaceFilter.space],
    queryFn: ({ pageParam }) =>
      globalSearch({
        q,
        kind: kinds.length ? kinds : undefined,
        limit: PAGE_SIZE,
        cursor: pageParam ?? undefined,
        space: spaceFilter.space,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasMore ? last.nextCursor ?? undefined : undefined),
    // An address naming a space waits for «my spaces».
    enabled: q !== '' && spaceFilter.ready,
    staleTime: 30_000,
  });

  const items = useMemo(
    () => (query.data?.pages ?? []).flatMap((p) => p.items),
    [query.data],
  );
  // Degradation is a property of the response, not of the request: one page could have come
  // without vector search, another with it. We say so if even one came without.
  const degraded = (query.data?.pages ?? []).some((p) => p.degraded);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams(params);
    const trimmed = draft.trim();
    if (trimmed) next.set('q', trimmed);
    else next.delete('q');
    setParams(next);
  };

  const toggleKind = (kind: SearchKind) => {
    // An empty `kinds` means "all" and is drawn with all pressed — so
    // releasing must also go from all four: a pressed button must be released, not
    // become the only one.
    const set = new Set(kinds.length ? kinds : KINDS);
    if (set.has(kind)) set.delete(kind);
    else set.add(kind);
    const next = new URLSearchParams(params);
    // All four selected is the same as none: the parameter is removed so that
    // one and the same search does not have two addresses.
    if (set.size === 0 || set.size === KINDS.length) next.delete('kind');
    else next.set('kind', KINDS.filter((k) => set.has(k)).join(','));
    setParams(next);
  };

  return (
    <main className="search-page" aria-labelledby="search-title">
      <h1 id="search-title" className="search-page-title">
        {t('title')}
      </h1>

      <form className="search-page-form" role="search" onSubmit={submit}>
        <IconSearch size={20} stroke={1.75} aria-hidden className="search-page-form-icon" />
        <input
          ref={inputRef}
          type="search"
          className="search-page-input"
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          placeholder={t('placeholder')}
          aria-label={t('inputAria')}
          maxLength={500}
        />
        <button type="submit" className="action-button primary">
          {t('submit')}
        </button>
      </form>

      {spaceFilter.spaces !== null ? (
        <SpaceFilter
          spaces={spaceFilter.spaces}
          value={spaceFilter.space}
          onChange={spaceFilter.select}
          allLabel={t('common:spaceFilter.all')}
          className="search-page-space"
        />
      ) : null}

      <div className="search-page-kinds" role="group" aria-label={t('kindsAria')}>
        {KINDS.map((kind) => {
          // None selected — we search everywhere, and then all are marked
          // active: an empty row would read as "we search for nothing".
          const on = kinds.length === 0 || kinds.includes(kind);
          return (
            <button
              key={kind}
              type="button"
              className={`search-page-kind${on ? ' active' : ''}`}
              aria-pressed={on}
              onClick={() => toggleKind(kind)}
            >
              <Attribute kind="search-kind" value={kind} />
              <span>{t(`kind.${kind}`)}</span>
            </button>
          );
        })}
      </div>

      {degraded ? (
        <p className="search-page-degraded" role="status">
          {t('degraded')}
        </p>
      ) : null}

      <SearchResults
        q={q}
        items={items}
        isLoading={query.isLoading}
        isError={query.isError}
        onRetry={() => void query.refetch()}
        spacesById={spacesById}
      />

      {query.hasNextPage ? (
        <div className="search-page-more">
          <button
            type="button"
            className="action-button"
            onClick={() => void query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            {query.isFetchingNextPage ? t('loadingMore') : t('more')}
          </button>
        </div>
      ) : null}
    </main>
  );
}

interface SearchResultsProps {
  q: string;
  items: SearchItem[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  /** My spaces by id — with two or more; null — no labels. */
  spacesById: Map<string, MySpace> | null;
}

function SearchResults({ q, items, isLoading, isError, onRetry, spacesById }: SearchResultsProps) {
  const { t } = useTranslation('search');

  if (q === '') {
    return <p className="search-page-note">{t('prompt')}</p>;
  }
  if (isLoading) {
    return (
      <p className="search-page-note" role="status">
        {t('loading')}
      </p>
    );
  }
  if (isError) {
    return (
      <div className="search-page-note" role="alert">
        <p>{t('failed')}</p>
        <button type="button" className="action-button" onClick={onRetry}>
          {t('retry')}
        </button>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <p className="search-page-note" role="status">
        {t('empty', { q })}
      </p>
    );
  }
  return (
    <ol className="search-results" aria-label={t('resultsAria', { q })}>
      {items.map((item) => (
        <SearchResultRow
          key={`${item.kind}:${item.id}`}
          item={item}
          space={spacesById !== null && item.spaceId !== undefined ? spacesById.get(item.spaceId) ?? null : null}
        />
      ))}
    </ol>
  );
}

/**
 * `space` — the row's space, when a label is needed (two or more
 * spaces, the row came with the `spaceId` of one of mine): "Acme ·
 * Website" before the time; for a project row, where the project name is the title,
 * just the space name. Without it the row is as before.
 */
function SearchResultRow({ item, space }: { item: SearchItem; space: MySpace | null }) {
  const { t } = useTranslation('search');
  const spaceName = useSpaceName();
  const href = resultHref(item);
  const title = item.title || t('untitled');

  return (
    <li className={`search-result${item.exactMatch ? ' is-exact' : ''}`}>
      <div className="search-result-head">
        {/* The kind badge is decorative (`aria-hidden` inside Attribute): it has
            a letter, not a word. The kind is announced to the screen reader by the text next to it. */}
        <Attribute kind="search-kind" value={item.kind} />
        <span className="sr-only">{t(`kind.${item.kind}`)}: </span>
        {href ? (
          <Link to={href} className="search-result-title">
            {title}
          </Link>
        ) : (
          <span className="search-result-title">{title}</span>
        )}
        {item.kind === 'issue' || item.kind === 'comment' ? (
          <span className="search-result-id">
            {item.kind === 'comment' ? item.parentIssueId : item.id}
          </span>
        ) : null}
      </div>

      {item.snippet ? (
        <SearchHighlight html={item.snippet} className="search-result-snippet" />
      ) : null}

      <div className="search-result-meta">
        {item.kind === 'issue' && item.status ? (
          <Attribute kind="status" value={item.status} pinned={item.pinned} />
        ) : null}
        {item.kind === 'issue' && item.priority !== undefined ? (
          <Attribute kind="priority" value={item.priority} />
        ) : null}
        {item.kind !== 'project' ? (
          <span className="search-result-project">
            {space !== null
              ? t('spaceProject', { space: spaceName(space), project: item.projectName })
              : item.projectName}
          </span>
        ) : space !== null ? (
          <span className="search-result-project">{spaceName(space)}</span>
        ) : null}
        {item.kind === 'comment' && item.authorUsername ? (
          <span className="search-result-author">{item.authorUsername}</span>
        ) : null}
        <TimeLabel iso={item.updatedAt} className="search-result-time" />
      </div>
    </li>
  );
}
