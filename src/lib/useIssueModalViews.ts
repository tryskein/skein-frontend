import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ViewMode } from '../api/issues';
import { ISSUE_MODAL_VIEW_ORDER } from '../api/uiPrefs';
import { useUiPrefs } from './useUiPrefs';

const EMPTY: ReadonlySet<ViewMode> = new Set();

export interface IssueModalViewsApi {
  /**
   * Views in which a selected issue opens as a centred pop-up window. Empty
   * until the server answers and when the request fails — the factory
   * position, i.e. the pane beside the view, which is what every user had
   * before this setting existed.
   */
  views: ReadonlySet<ViewMode>;
  /** The signed-in person's own set has arrived (the checkboxes reflect it). */
  loaded: boolean;
  /** Turn the pop-up window on or off for one view. Applied at once. */
  setView: (view: ViewMode, on: boolean) => void;
}

/**
 * sk-551.5 — the «open the issue in a pop-up window» setting, per view.
 *
 * A reader of the shared appearance settings (`useUiPrefs`): the query,
 * the per-person cache key and the chain that keeps overlapping writes in
 * click order live there, shared with the density switch (sk-551.7).
 *
 * The PUT carries only `issueModalViews` — the whole set, in the server's
 * canonical order, computed from the person's own loaded set, never from a
 * placeholder.
 */
export function useIssueModalViews(): IssueModalViewsApi {
  const { t } = useTranslation('header');
  const { userId, prefs, update } = useUiPrefs();

  const list = prefs?.issueModalViews;
  const views = useMemo<ReadonlySet<ViewMode>>(
    () => (list === undefined ? EMPTY : new Set(list)),
    [list],
  );

  const setView = useCallback(
    (view: ViewMode, on: boolean) => {
      update((loaded) => {
        const current = new Set(loaded.issueModalViews);
        if (on) current.add(view);
        else current.delete(view);
        return { issueModalViews: ISSUE_MODAL_VIEW_ORDER.filter((v) => current.has(v)) };
      }, t('issueModal.saveFailed'));
    },
    [update, t],
  );

  return { views, loaded: userId !== null && prefs !== undefined, setView };
}
