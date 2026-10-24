import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { SkeinMark } from './shell/SkeinMark';

/**
 * sk-674.18 T058 — "Account deleted" (screens 2.13): where
 * the tab lands after deleting its own account. Public — the session is
 * already gone (the server revoked it, the tab signed out) — so it is
 * routed outside `RequireAuth`, and wears the login page's chrome: the mark
 * and the language switch on the page, the message in the card, and the
 * only way on — to sign in (another account, or a new one where
 * registration is open).
 */
export function AccountDeletedPage() {
  const { t } = useTranslation('account');
  return (
    <div className="login-page">
      <header className="login-chrome">
        <div className="login-brand">
          <SkeinMark />
          <span className="login-wordmark">SKEIN</span>
        </div>
        <LanguageSwitcher />
      </header>
      <main className="login-card" aria-labelledby="account-deleted-title">
        <h1 className="login-title" id="account-deleted-title">
          {t('deletedPage.title')}
        </h1>
        <p className="login-tagline">{t('deletedPage.body')}</p>
        <Link to="/login" className="account-deleted-link">
          {t('deletedPage.signIn')}
        </Link>
      </main>
    </div>
  );
}
