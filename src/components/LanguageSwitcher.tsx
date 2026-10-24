import { useRef, useState } from 'react';
import { Popover } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { SkeinTooltip } from './SkeinTooltip';
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  isSupportedLanguage,
  setLanguage,
  type SupportedLanguage,
} from '../i18n/config';

/**
 * sk-285.6.15 — UI language switcher, a control in the HEADER RAIL next
 * to the avatar. It used to be a drawer section inside the account menu:
 * a heading plus two segmented buttons ("English" / "Русский"). That
 * shape is gone — the rail has room for ONE 44px control, not two
 * labelled ones — and with it the reasoning that a two-option group is
 * better than a dropdown.
 *
 * Collapsed the button shows the current language's TAG — «EN», «RU» —
 * and nothing else; the list behind it shows that tag AND the language
 * name in words on every row.
 *
 * ── sk-285.7.2.38: the tag replaced two flags ──────────────────────
 * Handoff §6 asks for "text "EN" mono 12/600 instead of a flag", and the
 * flags' own docblock had already written the argument for it: a flag
 * names a COUNTRY, several countries own English equally, so the
 * picture asserted something nobody had decided. The workarounds that
 * cost bought — a text accessible name on the button, the language
 * written out beside every flag — were doing the job the flag could
 * not, and they stay: the tag is short, and «EN» is a recognition aid
 * for a name, not a substitute for one.
 *
 * Two things went with the SVGs. The «why not the 🇬🇧 emoji» reasoning
 * (regional-indicator pairs have no glyph in most Windows builds, so the
 * OS falls back to the bare letters) is moot when the control IS the
 * letters. And exception 8 of `themeTokens.ts` — «national flag colours
 * are not palette choices and must not follow a skin» — is gone: the
 * tag is text and takes the ink roles like every other label.
 *
 * The choice remains a per-DEVICE preference: `setLanguage` writes it to
 * localStorage and flips the live i18next instance. Nothing is sent to
 * the backend — the server has no notion of a user language, and a
 * device-local switch means a shared account can read the UI in two
 * languages on two machines.
 */

/**
 * The two-letter tag for a language, mono and uppercase (§6).
 *
 * Derived from the language code rather than translated: «EN» and «RU»
 * are the ISO 639-1 codes themselves, the same in every UI language, and
 * a tag that changed with the interface language would stop being a
 * stable recognition mark for the thing it selects. It is `aria-hidden`
 * for the same reason the flag was — the control and every row already
 * carry a text accessible name, and a screen reader reading "E N" after
 * "English" is noise.
 */
function LanguageCode({ lng }: { lng: SupportedLanguage }) {
  return (
    <span className="header-lang-code" aria-hidden="true">
      {lng}
    </span>
  );
}

/**
 * The list of languages, as rows — the body of the rail control's
 * popover, extracted so a SECOND surface can host it.
 *
 * ── Why it is shared rather than copied (sk-285.7.7) ────────────────
 *
 * `.header-lang-anchor` is one of the seven blocks the phone's header
 * does not draw (§5 gives the mobile rail four slots and the rail has no
 * width left — see `HeaderBar`), and sk-285.6.15 had deliberately moved
 * the language OUT of the account menu into that rail. So on a phone the
 * language became unreachable: the canonical home is not drawn, and the
 * old home was given up.
 *
 * The repair is not a revert. The rail control stays exactly where
 * sk-285.6.15 put it and is still the only entry above the mobile
 * threshold; the account menu hosts these same rows ONLY in the mode
 * where the rail cannot host anything. What sk-285.6.15 decided — that
 * the rail beats a menu section when the rail has room — is untouched by
 * a fallback for the mode where it has none.
 *
 * Sharing the component rather than re-drawing the rows is what keeps
 * that true: one tag, one label, one `aria-checked`, one `setLanguage`
 * call. `onChosen` is the host's business — the rail control returns
 * focus to itself and closes its popover, the account menu closes the
 * menu.
 */
export function LanguageChoiceList({ onChosen }: { onChosen?: () => void }) {
  const { t, i18n } = useTranslation('common');
  const resolved = i18n.resolvedLanguage ?? i18n.language;
  const active: SupportedLanguage = isSupportedLanguage(resolved)
    ? resolved
    : DEFAULT_LANGUAGE;

  return (
    <div role="menu" aria-label={t('language.label')}>
      {SUPPORTED_LANGUAGES.map((lng) => {
        const name = t(`language.${lng}`);
        return (
          <button
            key={lng}
            type="button"
            role="menuitemradio"
            aria-checked={active === lng}
            // The row's visible text is the language name; the label
            // says what pressing it DOES, and still contains that
            // text (WCAG 2.5.3 Label in Name).
            aria-label={t('language.switchTo', { name })}
            className={`header-drawer-item header-lang-item${active === lng ? ' active' : ''}`}
            onClick={() => {
              setLanguage(lng);
              onChosen?.();
            }}
          >
            <LanguageCode lng={lng} />
            <span className="header-lang-name">{name}</span>
          </button>
        );
      })}
    </div>
  );
}

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation('common');
  const [open, setOpen] = useState(false);
  /**
   * The rail control itself, so choosing a language can hand focus back
   * to it before the list it lives in is torn down.
   *
   * Without that, picking a language drops focus on the floor: the
   * pressed row is removed from the DOM and `document.activeElement`
   * falls back to `<body>`, so the next Tab restarts at the top of the
   * document instead of continuing along the rail. Measured in Chromium
   * at 1440×900: after clicking "English", `activeElement === body`.
   * It is a REGRESSION of this task — while the switcher was two
   * buttons inside the account menu the popover stayed open on press and
   * focus never left the button.
   *
   * Why not Mantine's `returnFocus` on the Popover: it restores focus on
   * EVERY close, including click-outside, and it does so on a 10ms
   * timer (`useFocusReturn`). Clicking another rail control would then
   * have focus yanked back here a frame later. The loss is specific to
   * the "chose a language" path — Esc and click-outside both leave focus
   * somewhere sensible on their own — so the repair is specific too.
   *
   * The ref sits on the ANCHOR, not on the button: `SkeinTooltip` clones
   * its child and claims that child's ref for Floating UI, so a ref
   * passed to the button would be dropped. Mantine's `Popover.Target`
   * merges refs (`useMergedRef`), so the one here survives.
   */
  const anchorRef = useRef<HTMLSpanElement>(null);
  // `i18n.resolvedLanguage` is the language actually in effect after
  // fallback resolution ('en-US' → 'en'); `i18n.language` can still hold
  // the raw requested tag, which would leave the button showing the
  // wrong language code.
  const resolved = i18n.resolvedLanguage ?? i18n.language;
  const active: SupportedLanguage = isSupportedLanguage(resolved)
    ? resolved
    : DEFAULT_LANGUAGE;
  const currentName = t('language.current', { name: t(`language.${active}`) });

  return (
    <Popover
      opened={open}
      onChange={setOpen}
      position="bottom-end"
      offset={6}
      withinPortal
      trapFocus
      transitionProps={{ duration: 0 }}
    >
      <Popover.Target>
        {/* Same idiom as the account menu next to it: the button is
            already cloned by SkeinTooltip (which claims its ref), so
            Mantine anchors on this wrapper instead. */}
        <span className="header-lang-anchor" ref={anchorRef}>
          <SkeinTooltip content={currentName} position="bottom">
            <button
              type="button"
              className="header-icon-btn header-lang-btn"
              aria-label={currentName}
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              <LanguageCode lng={active} />
            </button>
          </SkeinTooltip>
        </span>
      </Popover.Target>

      <Popover.Dropdown className="header-lang-menu">
        <LanguageChoiceList
          onChosen={() => {
            // Focus goes home BEFORE the list closes — the pressed row is
            // about to be unmounted, and focus on a removed node lands in
            // `<body>`. See `anchorRef`.
            anchorRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
            setOpen(false);
          }}
        />
      </Popover.Dropdown>
    </Popover>
  );
}
