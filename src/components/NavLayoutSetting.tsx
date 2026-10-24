import { useTranslation } from 'react-i18next';
import { NAV_LAYOUT_VALUES, type NavLayout } from '../api/uiPrefs';
import { useOptionalLayoutState } from '../lib/useLayoutState';
import { useNavLayout } from '../lib/useNavLayout';

interface Props {
  /** Phone width: the layout is sheets whatever is chosen, and the switch says so. */
  mobile: boolean;
}

/**
 * sk-551.8 — "Left panel: Columns side by side / Sections in one column", in
 * the Appearance section of the account menu, under the density switch
 * and in the same dialect (`DensitySetting`): two radios in a named
 * group, each label the tap target.
 *
 * Mounted on every page that has the menu (task shell, settings,
 * activity, search) and at every width (US-1). On a phone it stays — it
 * is a profile setting — with a line saying that a narrow screen shows
 * sheets: a choice there does not change the phone's layout.
 *
 * The radios are disabled until the person's own value is in, so the
 * switch never presents the browser's stored guess as their choice. A
 * click records the gesture in THIS page's layout provider FIRST
 * (`noteNavModeGesture`, plan P13) and only then starts the profile write
 * (`setNavLayout`): the shell tells a person's switch (which may fold the
 * column on a board) from a late profile by that cell. The menu stays
 * open (a `Popover`); a refusal rolls the value back and says so.
 */
export function NavLayoutSetting({ mobile }: Props) {
  const { t } = useTranslation('header');
  const { navLayout, loaded, setNavLayout } = useNavLayout();
  const layout = useOptionalLayoutState();

  const choose = (value: NavLayout) => {
    layout?.noteNavModeGesture(value);
    setNavLayout(value);
  };

  return (
    <fieldset className="header-drawer-nav-layout">
      <legend className="header-drawer-nav-layout-legend">{t('navLayout.label')}</legend>
      <div className="header-drawer-nav-layout-options">
        {NAV_LAYOUT_VALUES.map((value) => (
          <label key={value} className="header-drawer-check">
            <input
              type="radio"
              name="skein-nav-layout"
              value={value}
              checked={loaded && navLayout === value}
              disabled={!loaded}
              onChange={() => choose(value)}
            />
            <span>{t(`navLayout.${value}`)}</span>
          </label>
        ))}
      </div>
      {mobile ? <p className="header-drawer-nav-layout-hint">{t('navLayout.mobileHint')}</p> : null}
    </fieldset>
  );
}
