import { useTranslation } from 'react-i18next';
import { DENSITY_VALUES } from '../api/uiPrefs';
import { useDensity } from '../lib/useDensity';

/**
 * sk-551.7 — "Density: Normal / Compact", in the Appearance section
 * of the account menu, right under the theme switch: the owner put it
 * beside the theme so the difference can be compared at once
 * (2026-09-30).
 *
 * Two radios in a named group — one of two, both visible, the current one
 * marked — drawn with the same labels as the window checkboxes below it,
 * so the section speaks one control dialect. Each label is the tap
 * target (INV-4), not the 13px dot.
 *
 * Applied at once and the menu stays open (it is a `Popover`, not a
 * `Menu`): the page behind it changes density while the person looks. The
 * radios are disabled until the person's own density is in, so the switch
 * never shows a guess as their choice.
 */
export function DensitySetting() {
  const { t } = useTranslation('header');
  const { density, loaded, setDensity } = useDensity();

  return (
    <fieldset className="header-drawer-density">
      <legend className="header-drawer-density-legend">{t('density.label')}</legend>
      <div className="header-drawer-density-options">
        {DENSITY_VALUES.map((value) => (
          <label key={value} className="header-drawer-check">
            <input
              type="radio"
              name="skein-density"
              value={value}
              checked={loaded && density === value}
              disabled={!loaded}
              onChange={() => setDensity(value)}
            />
            <span>{t(`density.${value}`)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
