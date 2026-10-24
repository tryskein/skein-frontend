import { useTranslation } from 'react-i18next';
import { ISSUE_MODAL_VIEW_ORDER } from '../api/uiPrefs';
import { useIssueModalViews } from '../lib/useIssueModalViews';

/**
 * sk-551.5 — «Open the issue in a pop-up window», one independent checkbox
 * per task view (Cards / Board / Tree), in the Appearance section of the
 * account menu, under the theme switch.
 *
 * A group of three checkboxes rather than a single switch: the owner asked
 * for the setting per view, so a person can keep the pane beside the cards
 * list and still read the issue in a window over the board.
 *
 * Applied at once (the hook writes optimistically) and the menu stays open:
 * it is a `Popover`, not a `Menu`, so a click inside does not dismiss it,
 * and the person sees the next checkbox they may want to tick.
 *
 * The boxes are disabled until the server's answer is in. A click before
 * that would send a set computed from «nothing is on» and overwrite views
 * the person had turned on elsewhere.
 *
 * The view names are the ones the Tasks column's own view switch prints
 * (`filters:view.*`), so the menu and the switch cannot call the same view
 * two different words.
 */
export function IssueModalViewsSetting() {
  const { t } = useTranslation('header');
  const { t: tFilters } = useTranslation('filters');
  const { views, loaded, setView } = useIssueModalViews();

  return (
    <fieldset className="header-drawer-issue-modal">
      <legend className="header-drawer-issue-modal-legend">{t('issueModal.label')}</legend>
      <div className="header-drawer-issue-modal-views">
        {ISSUE_MODAL_VIEW_ORDER.map((view) => (
          <label key={view} className="header-drawer-check">
            <input
              type="checkbox"
              checked={views.has(view)}
              disabled={!loaded}
              onChange={(e) => setView(view, e.currentTarget.checked)}
            />
            <span>{tFilters(`view.${view}`)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
