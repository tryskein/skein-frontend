import type { ReactNode } from 'react';
import { IconArrowLeft } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../auth/AuthContext';
import { LayoutProvider } from '../../../lib/useLayoutState';
import { TasksUiStateProvider } from '../../../lib/useTasksUiState';

/**
 * SettingsLayout — chrome shared by every /settings/* page in the new
 * shell aesthetic (sk-41).
 *
 * Renders:
 *   - The new-shell HeaderBar so users can still navigate via header
 *     badges / lens toggles / settings dropdown.
 *   - A simple `<header>` with the page H1 "Settings".
 *   - A horizontal tab row (Account / Password / Spaces / API keys / Users / Notifications /
 *     Theme). The Users tab is admin-only. There is no separate Push tab: sk-303.13
 *     folded push into the single notification-reason form, and device
 *     management sits beside that form rather than on a page of its own.
 *   - Children content centred in a max-width 960px column.
 *
 * Unlike `Shell`, this is a single-column focus page — no Inbox /
 * Projects / Tasks columns. The user is here to configure, not to
 * triage. Header still carries the existing badges so they can flip
 * back to the workspace in one click.
 *
 * Styling lives in index.css under `.settings-*` rules.
 */

import { HeaderBar } from '../../shell/HeaderBar';

export interface SettingsLayoutProps {
  /** Which tab to highlight. */
  active: 'account' | 'password' | 'spaces' | 'api-keys' | 'users' | 'notifications' | 'theme';
  children: ReactNode;
}

interface TabDef {
  key: SettingsLayoutProps['active'];
  /** Dictionary key under `settings:tabs` — resolved at render time. */
  labelKey: string;
  to: string;
  adminOnly?: boolean;
  /**
   * sk-674.18 T057 — hidden from an external user: they are outside the
   * rules of spaces, have no "Personal" and cannot be invited (screens 1.14).
   */
  notForExternal?: boolean;
}

const TABS: TabDef[] = [
  // sk-674.18 T058 — screens 1.14, 2.9: «Account» first — every person,
  // external ones too (email, its confirmation, username, deletion).
  { key: 'account', labelKey: 'tabs.account', to: '/settings/account' },
  // sk-303.20 — first: a personal-security action every account has,
  // unlike Users (admin-only) or Theme (cosmetic).
  { key: 'password', labelKey: 'tabs.password', to: '/settings/password' },
  // sk-674.18 T057 — screens 1.14, 2.1: shown with one space too — it is
  // where invitations are seen and a second space is created.
  { key: 'spaces', labelKey: 'tabs.spaces', to: '/settings/spaces', notForExternal: true },
  { key: 'api-keys', labelKey: 'tabs.apiKeys', to: '/settings/api-keys' },
  { key: 'users', labelKey: 'tabs.users', to: '/settings/users', adminOnly: true },
  {
    key: 'notifications',
    labelKey: 'tabs.notifications',
    to: '/settings/notifications',
  },
  // sk-303.13 — the Push tab is gone with its page: device management
  // moved beside the reason table on /settings/notifications, and the
  // category switches it carried were a second vocabulary of channels.
  { key: 'theme', labelKey: 'tabs.theme', to: '/settings/theme' },
];

export function SettingsLayout({ active, children }: SettingsLayoutProps) {
  const { t } = useTranslation('settings');
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isExternal = user?.isExternal === true;
  const visible = TABS.filter(
    (tab) => (!tab.adminOnly || isAdmin) && (!tab.notForExternal || !isExternal),
  );

  // Match React Router's <Link> to navigate without a full reload. The
  // legacy SettingsNav used path-prefix matching; here we compare
  // against the active prop directly so we don't accidentally
  // highlight two tabs when /settings/users has nested children.
  // HeaderBar reads `useLayoutState` (for the badge counts +
  // lens toggles + settings dropdown) — that context lives inside
  // `<LayoutProvider>` mounted by the main Shell. Settings pages
  // render OUTSIDE of Shell, so we mount our own provider stack here.
  // TasksUiStateProvider rides along so the persisted filter context is
  // available to any descendant that reads it (sk-46 removed the lens
  // bridge — the lens preset is now a pure overlay in useTaskSearchModes,
  // so there's no imperative coupling left between the two providers).
  return (
    <LayoutProvider>
    <TasksUiStateProvider>
    <div className="settings-shell-root">
      {/* WCAG 2.4.1 Bypass Blocks. Without it keyboard users must
          tab through ~10 header buttons every visit before reaching
          the page body. Mirrors the same affordance in Shell.tsx. */}
      <a className="sr-only-focusable" href="#main-content">
        {t('shell:skipToContent')}
      </a>
      <HeaderBar />
      <main
        id="main-content"
        className="settings-main"
        aria-label={t('mainAria')}
      >
        <div className="settings-canvas">
          {/* Explicit back-to-tasks affordance. Clicking the Skein logo
           * in the header also returns home, but a labelled link in
           * the page body is more discoverable for users who don't
           * habitually click the brand. */}
          <Link to="/" className="settings-back-link">
            {/* sk-285.7.2.88 — the `←` lived inside the dictionary
                string (`settings.back`, both locales). §8 names
                `arrow-left`; sk-285.7.2.78 already moved this exact
                character off the mobile sheet's way back for the same
                reason. §9 leaves the settings screens undrawn by any
                artboard and says to apply the system to them — this is
                that. 16: the link is a run of text, not a control with
                a box of its own. */}
            <IconArrowLeft size={16} stroke={1.75} aria-hidden />
            {t('back')}
          </Link>
          <header className="settings-header">
            <h1 className="settings-title">{t('title')}</h1>
            {/* sk-285.7.2.80 — audit 2B, N-3. The row is a SEGMENT
                CONTROL (one control, N mutually exclusive positions),
                so it wears the product's one recipe for that role
                rather than a third private one: `.segment-track` +
                `.segment-cell`, the same pair the header's view switch
                and the four HOT ZONE groups carry. `.settings-tabs` /
                `.settings-tab` stay as the hooks for what is specific
                to these five — the wrap, and the link underline. */}
            <nav className="settings-tabs segment-track" aria-label={t('tabsAria')}>
              {visible.map((tab) => {
                const isActive = tab.key === active;
                return (
                  <Link
                    key={tab.key}
                    to={tab.to}
                    className={`settings-tab segment-cell${isActive ? ' active' : ''}`}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    {t(tab.labelKey)}
                  </Link>
                );
              })}
            </nav>
          </header>
          <div className="settings-content">{children}</div>
        </div>
      </main>
    </div>
    </TasksUiStateProvider>
    </LayoutProvider>
  );
}

/**
 * Reusable panel wrapper for sections inside a settings page. Cream
 * elevated bg + subtle border + h2 title. Matches the visual weight
 * of `.detail-section` in the Shell.
 */
export interface SettingsPanelProps {
  title: string;
  description?: ReactNode;
  /**
   * Id put on the description paragraph, so a control inside the panel can
   * name it in `aria-describedby`. Needed when the panel description IS the
   * explanation of a single control — a screen-reader user on that control
   * has no other way to reach the text.
   */
  descriptionId?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function SettingsPanel({
  title,
  description,
  descriptionId,
  actions,
  children,
}: SettingsPanelProps) {
  return (
    <section className="settings-panel">
      <header className="settings-panel-header">
        <div className="settings-panel-headings">
          <h2 className="settings-panel-title">{title}</h2>
          {description ? (
            <p id={descriptionId} className="settings-panel-description">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="settings-panel-actions">{actions}</div> : null}
      </header>
      <div className="settings-panel-body">{children}</div>
    </section>
  );
}

