/**
 * sk-47.2 — "paste-a-blob" mode coordinator for the Tasks column.
 *
 * A DISTINCT input mode from the normal typed search. The Tasks search box
 * intercepts a PASTE event: if the pasted text contains ≥1 issue code
 * (see `extractIssueCodes`), we enter blob mode — the wall of text is NOT
 * dumped into the input (the caller `preventDefault()`s), the extracted
 * codes are resolved in ONE batch call, and the column renders a chip row
 * (clickable found chips + dimmed not-found chips) above the matched task
 * cards.
 *
 * Isolation from the typed-search path: blob mode is keyed entirely on the
 * `codes` array this hook holds. While `codes.length > 0` the column
 * renders the blob panel INSTEAD of the normal `useTasks` board; the
 * typed-search machinery (`useTaskSearchModes` / `useTasks` / the debounced
 * `ui.search`) is untouched. We deliberately do NOT push the blob text
 * into `ui.search` — that would route it through the RRF typed-search path
 * and defeat the whole point. Clearing the input (or the panel ×) calls
 * `exit()`, which empties `codes` and drops us back to the normal board.
 *
 * Resolution is filter-agnostic and cross-project: the batch endpoint
 * spans every visible project (pasted codes are frequently cross-project),
 * so the board's status / type / origin / project filters never narrow it.
 */

import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { lookupIdBatch, type SearchItem } from '../api/search';
import { searchItemToSummary } from './useTasks';
import type { IssueSummary } from '../api/issues';

export interface BlobChip {
  /** The requested issue code (canonical lowercase). */
  code: string;
  /** True when the batch lookup returned a row for this code. */
  found: boolean;
  /**
   * The resolved row, present iff `found`. Carried so a found chip can
   * navigate without a second fetch, and so the matched-tasks list can be
   * rendered straight from the same query result.
   */
  item: SearchItem | null;
}

export interface UseBlobModeResult {
  /**
   * The extracted codes currently driving blob mode. Empty array = NOT in
   * blob mode (the column renders the normal typed-search board).
   */
  codes: string[];
  /** True iff `codes.length > 0` — the column branches on this. */
  active: boolean;
  /**
   * Enter (or replace) blob mode with a fresh set of de-duplicated codes.
   * Called by the onPaste handler when ≥1 code was extracted. Passing an
   * empty array is a no-op (the caller already gated on ≥1 code, but we
   * stay defensive so a bad call can't half-enter the mode).
   */
  enter: (codes: string[]) => void;
  /** Leave blob mode — empties `codes`, dropping back to the normal board. */
  exit: () => void;
  /** True while the batch resolve is in flight. */
  isLoading: boolean;
  /** Non-null when the batch resolve failed. */
  error: unknown;
  /**
   * One chip descriptor per requested code, in first-seen (paste) order.
   * Found chips carry their resolved `item`; not-found chips have
   * `found: false` and `item: null`. Empty until the query resolves.
   */
  chips: BlobChip[];
  /**
   * The matched rows as `IssueSummary` so the column can reuse `TaskCard`
   * verbatim. Ordered to mirror the found chips (first-seen order). Empty
   * until the query resolves.
   */
  matched: IssueSummary[];
  /** Count of requested codes that resolved to a visible row. */
  foundCount: number;
  /** Count of requested codes absent from the response (nonexistent / hidden). */
  notFoundCount: number;
}

/**
 * Map a SearchItem (lookup-id-batch projection) to the lean IssueSummary
 * shape `TaskCard` consumes. Reuses the shared `searchItemToSummary`
 * (exported from useTasks.ts — a pure DTO mapper, no runtime coupling to
 * the typed-search query path), then strips the relevance `score`: blob
 * rows are an EXACT id resolution, not an RRF ranking, so no relevance
 * badge should show on them.
 */
function batchItemToSummary(it: SearchItem): IssueSummary {
  return { ...searchItemToSummary(it), score: undefined };
}

export function useBlobMode(): UseBlobModeResult {
  const [codes, setCodes] = useState<string[]>([]);
  const active = codes.length > 0;

  const enter = useCallback((next: string[]) => {
    if (next.length === 0) return;
    setCodes(next);
  }, []);

  const exit = useCallback(() => {
    setCodes([]);
  }, []);

  // One batch resolve per distinct code-set. The query key includes the
  // codes so re-pasting a different set re-fetches; re-pasting the SAME
  // set hits the cache. Disabled (and thus never fires) outside blob mode.
  // Sorted code-set drives BOTH the cache key AND the request payload, so
  // key and payload stay in lockstep (a permutation of the same set reuses
  // the cache AND can't desync the in-flight request's argument order).
  // Chip/match display order still derives from `codes` (requested order),
  // not from this sorted copy.
  const sortedCodes = useMemo(() => [...codes].sort(), [codes]);

  const query = useQuery({
    queryKey: ['lookup-id-batch', sortedCodes],
    queryFn: () => lookupIdBatch(sortedCodes),
    enabled: active,
    staleTime: 30_000,
  });

  // id → row lookup over the response. The server returns only
  // found+visible rows, so a missing key === "not found" for the diff.
  // Keys are lowercased on BOTH sides (extracted `code`s are already
  // lowercase; we lowercase `item.id` here too) so the diff can't skew if
  // the server ever echoes a non-lowercase id — Skein ids are lowercase by
  // convention, this is a guard that documents the invariant in code.
  const byId = useMemo(() => {
    const map = new Map<string, SearchItem>();
    for (const it of query.data?.items ?? []) {
      map.set(it.id.toLowerCase(), it);
    }
    return map;
  }, [query.data]);

  // Chip descriptors in first-seen (paste) order. Drives both the chip
  // row and (via the found subset) the matched-tasks list order.
  const chips = useMemo<BlobChip[]>(() => {
    if (!active) return [];
    return codes.map((code) => {
      const item = byId.get(code) ?? null;
      return { code, found: item !== null, item };
    });
  }, [active, codes, byId]);

  const matched = useMemo<IssueSummary[]>(() => {
    const out: IssueSummary[] = [];
    for (const chip of chips) {
      if (chip.item) out.push(batchItemToSummary(chip.item));
    }
    return out;
  }, [chips]);

  const foundCount = matched.length;
  const notFoundCount = codes.length - foundCount;

  return {
    codes,
    active,
    enter,
    exit,
    isLoading: query.isLoading,
    error: query.error,
    chips,
    matched,
    foundCount,
    notFoundCount,
  };
}
