import { ReactNode, useEffect, useState } from 'react';
import { Box, Checkbox, Loader, Progress, Text } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { Trans, useTranslation } from 'react-i18next';
import { ApiError, BusinessError, RateLimitError } from '../api/client';
import { AccountErrorCode } from '../api/auth';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { scorePassword, type PasswordStrength } from '../lib/passwordStrength';
import { SkeinMark } from './shell/SkeinMark';

/**
 * sk-674.18 T059 — the pieces the public screens share (screens 1.13,
 * 2.5–2.9): the sign-in page's chrome, the consent checkbox, the password
 * strength line, the error line, the text of each refusal code, and the
 * referrer guard of the pages whose address carries a token.
 *
 * The chrome is the sign-in page's own (`login.tsx#LoginPage`, and
 * `AccountDeletedPage.tsx` after it): the mark and the language switch on
 * the page, everything else in the one card.
 */

interface PublicPageProps {
  /** The card's heading. */
  title: string;
  /** Id of the heading — the card's accessible name. */
  titleId: string;
  children: ReactNode;
}

/** A public screen: the sign-in page's chrome around one card. */
export function PublicPage({ title, titleId, children }: PublicPageProps) {
  return (
    <div className="login-page">
      <header className="login-chrome">
        <div className="login-brand">
          <SkeinMark />
          <span className="login-wordmark">SKEIN</span>
        </div>
        <LanguageSwitcher />
      </header>
      <main className="login-card" aria-labelledby={titleId}>
        <h1 className="login-title" id={titleId}>
          {title}
        </h1>
        {children}
      </main>
    </div>
  );
}

/** The card's waiting state. */
export function PublicLoading() {
  return (
    <div className="login-loading">
      <Loader size="sm" color="orange" />
    </div>
  );
}

/** §6 "Forms": one line of error with the `alert-circle` icon, announced. */
export function FormError({ children }: { children: ReactNode }) {
  return (
    <div className="login-error" role="alert">
      <IconAlertCircle size={16} stroke={1.75} aria-hidden />
      <span>{children}</span>
    </div>
  );
}

/**
 * The key (namespace `auth`) of the text for a failed public request: one
 * message per refusal code of screens 2.5–2.8 (matrix row 254 — a code
 * never falls back to a shared text while it has its own), then the
 * transport classes.
 */
export function refusalKey(err: unknown): string {
  if (err instanceof RateLimitError) return 'codes.rateLimited';
  if (err instanceof BusinessError) {
    switch (err.code) {
      case AccountErrorCode.EmailTaken:
        return 'codes.emailTaken';
      case AccountErrorCode.UsernameTaken:
        return 'codes.usernameTaken';
      case AccountErrorCode.UsernameInvalid:
        return 'codes.usernameInvalid';
      case AccountErrorCode.PasswordWeak:
        return 'codes.passwordWeak';
      case AccountErrorCode.PasswordPwned:
        return 'codes.passwordPwned';
      case AccountErrorCode.TermsRequired:
        return 'codes.termsRequired';
      case AccountErrorCode.CaptchaFailed:
        return 'codes.captchaFailed';
      case AccountErrorCode.SignupDisabled:
        return 'codes.signupDisabled';
      case AccountErrorCode.TokenInvalid:
        return 'codes.tokenInvalid';
      case AccountErrorCode.EmailDisabled:
        return 'codes.emailDisabled';
      case AccountErrorCode.PasswordLoginDisabled:
        return 'codes.passwordLoginDisabled';
      case AccountErrorCode.InvitationInvalid:
        return 'codes.invitationInvalid';
      case AccountErrorCode.SpaceDeleted:
        return 'codes.spaceDeleted';
      default:
        return 'codes.unavailable';
    }
  }
  if (err instanceof ApiError) {
    return err.statusCode === 400 ? 'codes.invalidRequest' : 'codes.unavailable';
  }
  return 'codes.network';
}

/** The refusal code of a failed public request; '' for a transport failure. */
export function refusalCode(err: unknown): string {
  if (err instanceof RateLimitError) return AccountErrorCode.RateLimited;
  if (err instanceof BusinessError) return err.code;
  return '';
}

/** A light shape check before sending; the server is the judge. */
export const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The referrer policy every other page is served with (`nginx-security-headers.conf`). */
const DEFAULT_REFERRER_POLICY = 'strict-origin-when-cross-origin';

/**
 * Keep the page's token out of the Referer of every request the page makes
 * (plan T059: "pages with a token do not pass the token via Referer").
 *
 * The document of `/invite/:token`, `/reset-password/:token` and
 * `/confirm-email/:token` is served with `Referrer-Policy: no-referrer`
 * (`nginx.conf`) — that covers the link opened from an email. This covers
 * the other way in: a page reached inside the app (the sign-in page sends
 * the person back to `/invite/:token` with a client-side navigation), where
 * the document kept the policy of the page it was loaded as. A
 * `<meta name="referrer">` changes the document's policy when inserted;
 * leaving the page restores the default one.
 */
export function useNoReferrer(): void {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'referrer';
    meta.content = 'no-referrer';
    document.head.appendChild(meta);
    return () => {
      // Removing the element does not undo the policy it set — the content
      // change does, then the element goes.
      meta.content = DEFAULT_REFERRER_POLICY;
      meta.remove();
    };
  }, []);
}

interface ConsentCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** `termsUrl` of `/api/auth/config`; null — the words stay text. */
  termsUrl: string | null;
  /** `privacyUrl` of `/api/auth/config`; null — the words stay text. */
  privacyUrl: string | null;
  disabled?: boolean;
}

/**
 * The consent checkbox of registration (screens 2.6, 2.7, decision No. 14):
 * the terms and the policy are links when their addresses are configured,
 * plain words otherwise (spec US-8, Stage 1 decision). The links open in a
 * new tab, so reading them does not lose the filled form.
 */
export function ConsentCheckbox({
  checked,
  onChange,
  termsUrl,
  privacyUrl,
  disabled,
}: ConsentCheckboxProps) {
  const link = (url: string | null) =>
    url !== null ? (
      <a className="consent-link" href={url} target="_blank" rel="noopener noreferrer" />
    ) : (
      <span />
    );
  return (
    <Checkbox
      checked={checked}
      onChange={(e) => onChange(e.currentTarget.checked)}
      disabled={disabled}
      label={
        <Trans
          i18nKey="consent"
          ns="account"
          components={{ terms: link(termsUrl), privacy: link(privacyUrl) }}
        />
      }
    />
  );
}

/** Mirrors `PasswordPage.tsx` — the same five steps of zxcvbn's scale. */
const STRENGTH_LEVEL_KEYS = [
  'strength.levels.veryWeak',
  'strength.levels.weak',
  'strength.levels.fair',
  'strength.levels.good',
  'strength.levels.strong',
] as const;
const STRENGTH_COLORS = [
  'var(--err)',
  'var(--err)',
  'var(--warn)',
  'var(--ok)',
  'var(--ok)',
] as const;
const STRENGTH_DEBOUNCE_MS = 150;

/**
 * The strength line under a new password (screens 2.6: "the strength estimate
 * is the same as on password change") — zxcvbn in the browser
 * (`lib/passwordStrength.ts`), the password never leaves the page for it.
 * The server's policy (`password_weak`, `password_pwned`) stays the judge.
 */
export function PasswordStrengthMeter({ password }: { password: string }) {
  const { t, i18n } = useTranslation('password');
  const [strength, setStrength] = useState<PasswordStrength | null>(null);

  useEffect(() => {
    if (!password) {
      setStrength(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      void scorePassword(password, i18n.language)
        .then((result) => {
          // `live` is false once the password changed or the line unmounted.
          if (live) setStrength(result);
        })
        .catch(() => {
          // A failed dictionary load drops the estimate; the next keystroke retries.
          if (live) setStrength(null);
        });
    }, STRENGTH_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [password, i18n.language]);

  if (!password || strength === null) return null;
  const level = t(STRENGTH_LEVEL_KEYS[strength.score]);
  return (
    <Box role="status" aria-live="polite">
      <Progress
        value={((strength.score + 1) / 5) * 100}
        color={STRENGTH_COLORS[strength.score]}
        size="sm"
        aria-label={t('strength.aria', { level })}
      />
      <Text size="xs" c="var(--ink)" mt={4}>
        {level}
        {strength.warning ? ` — ${strength.warning}` : ''}
      </Text>
    </Box>
  );
}
