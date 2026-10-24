import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { MySpace } from '../api/spaces';
import { useMySpaces } from '../lib/useMySpaces';

/**
 * sk-674.18 T056 — the space filter of a page (screens 1.11 `/search`,
 * 1.12 `/activity`, plan 5.3): "All / Personal / Acme / …" over the page,
 * state in the address as `?space=<short id>`, default «all». A filter of
 * that one page — the projects column and the rest of the shell are not
 * touched by it.
 *
 * Shown only with two spaces or more (SC-014): with one, and for an
 * external user (none), there is nothing to choose, and the page asks
 * without the parameter, as before.
 *
 * The choice NARROWS what the server would show anyway; it never widens
 * it (US-13: "the user's choice parameter does not widen the scope") — that is
 * the server's to enforce, the client only names the space.
 */

/** Query parameter of the page filter. */
export const SPACE_PARAM = 'space';

/**
 * With more spaces than this the choice is a drop-down instead of a
 * segment row (screens 1.11: "with many spaces — a drop-down
 * list"): five members («all» and four spaces) still fit a phone-wide
 * row once it wraps; more would read as a wall of buttons.
 */
export const SPACE_SEGMENTS_MAX = 4;

export interface SpaceFilterState {
  /** The spaces to choose from; null — no choice is offered (fewer than two). */
  spaces: MySpace[] | null;
  /** The chosen space (short id) to pass to every request; null — all. */
  space: string | null;
  /** Choose a space; null — all (the parameter is dropped). */
  select: (space: string | null) => void;
  /**
   * The page may ask now. False only while the address names a space and
   * «my spaces» has not answered: the requests wait, so an unknown space is
   * not read once with the parameter and then again without it.
   */
  ready: boolean;
}

/**
 * The page's space choice, read from and written to `?space=`.
 *
 * The address may name a space that is not among «my spaces» — a link
 * from someone else, a space left since. While «my spaces» has not
 * answered, the page does not ask at all (`ready` is false); once it has,
 * an unknown value is «all» and is dropped from the address (replace), so
 * the address and the selector agree and the page reads once (review
 * fe/4 #8). Without a session (no «my spaces» to ask) or with «my spaces»
 * refused, the address is taken as is — the server narrows anyway.
 *
 * `replace` — write the choice without a new history entry (the activity
 * page's switchers do so; the search page pushes, as its kind toggles do).
 */
export function useSpaceFilter({ replace = false }: { replace?: boolean } = {}): SpaceFilterState {
  const [params, setParams] = useSearchParams();
  const spacesQ = useMySpaces();
  const items = spacesQ.data?.items;

  const raw = params.get(SPACE_PARAM)?.trim() || null;
  // «My spaces» will not answer: refused, or not asked (no session).
  const noAnswer = spacesQ.isError || (spacesQ.isPending && spacesQ.fetchStatus === 'idle');
  const known = items === undefined ? null : raw !== null && items.some((sp) => sp.id === raw);
  const space = raw === null ? null : known === null ? raw : known ? raw : null;
  const ready = raw === null || items !== undefined || noAnswer;

  // An unknown space leaves the address once «my spaces» answered.
  useEffect(() => {
    if (raw === null || known !== false) return;
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        out.delete(SPACE_PARAM);
        return out;
      },
      { replace: true },
    );
  }, [raw, known, setParams]);

  const select = useCallback(
    (next: string | null) => {
      setParams(
        (prev) => {
          const out = new URLSearchParams(prev);
          if (next === null) out.delete(SPACE_PARAM);
          else out.set(SPACE_PARAM, next);
          return out;
        },
        { replace },
      );
    },
    [setParams, replace],
  );

  return { spaces: items !== undefined && items.length >= 2 ? items : null, space, select, ready };
}

/** The name a person reads for a space: "Personal" is one word for everyone (decision No. 6). */
export function useSpaceName(): (space: MySpace) => string {
  const { t } = useTranslation('common');
  return (space) => (space.kind === 'personal' ? t('spaceFilter.personal') : space.name);
}

export interface SpaceFilterProps {
  spaces: MySpace[];
  /** The chosen space; null — all. */
  value: string | null;
  onChange: (space: string | null) => void;
  /** The «all» member: "All" on search, "All my spaces" on HOT ZONE. */
  allLabel: string;
  className?: string;
}

export function SpaceFilter({ spaces, value, onChange, allLabel, className }: SpaceFilterProps) {
  const { t } = useTranslation('common');
  const nameOf = useSpaceName();
  const label = t('spaceFilter.label');

  if (spaces.length > SPACE_SEGMENTS_MAX) {
    return (
      <label className={`space-filter${className ? ` ${className}` : ''}`}>
        <span className="space-filter-label">{label}</span>
        <select
          className="detail-form-select space-filter-select"
          value={value ?? ''}
          onChange={(e) => onChange(e.currentTarget.value === '' ? null : e.currentTarget.value)}
        >
          <option value="">{allLabel}</option>
          {spaces.map((sp) => (
            <option key={sp.id} value={sp.id}>
              {nameOf(sp)}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <div className={`space-filter${className ? ` ${className}` : ''}`} role="group" aria-label={label}>
      <span className="space-filter-label" aria-hidden>
        {label}
      </span>
      <span className="segment-track">
        <button
          type="button"
          className={`segment-cell${value === null ? ' active' : ''}`}
          aria-pressed={value === null}
          onClick={() => onChange(null)}
        >
          {allLabel}
        </button>
        {spaces.map((sp) => (
          <button
            key={sp.id}
            type="button"
            className={`segment-cell${value === sp.id ? ' active' : ''}`}
            aria-pressed={value === sp.id}
            onClick={() => onChange(sp.id)}
          >
            {nameOf(sp)}
          </button>
        ))}
      </span>
    </div>
  );
}
