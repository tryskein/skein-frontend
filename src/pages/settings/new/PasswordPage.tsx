import { useEffect, useId, useRef, useState } from 'react';
import { Alert, Box, Button, Group, PasswordInput, Progress, Stack, Text } from '@mantine/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ApiError, BusinessError } from '../../../api/client';
import { changeMyPassword, getPasswordPolicy } from '../../../api/users';
import { checkPwnedHint, type PwnedHintState } from '../../../lib/pwnedCheck';
import { useTranslation } from 'react-i18next';
import { scorePassword, type PasswordStrength } from '../../../lib/passwordStrength';
import {
  ERR_ALERT_VARS,
  INFO_ALERT_VARS,
  OK_ALERT_VARS,
} from '../../../lib/mantineVariantVars';
import { SettingsLayout, SettingsPanel } from './SettingsLayout';

/**
 * /settings/password — sk-303.20. The self-service "change my own
 * password" page, rebuilt for the new shell after sk-303.15 removed the
 * legacy /legacy/settings/password wholesale.
 *
 * Two independent, deliberately asymmetric quality signals sit under the
 * new-password field:
 *
 *   - A **live strength estimate** (zxcvbn, via `lib/passwordStrength`),
 *     computed entirely in the browser on every keystroke (debounced only
 *     for render smoothness — there is no network cost to economise, so
 *     nothing here is throttled for privacy). The password is never sent
 *     anywhere for this; see PasswordPage.test.tsx for the assertion that
 *     proves it.
 *   - An **opt-in breach hint** (Pwned Passwords k-anonymity, via
 *     `lib/pwnedCheck`), fired once on blur — never per keystroke, both to
 *     avoid load on a public API and because per-character requests would
 *     leak the password's length and prefix evolution through request
 *     timing. It only runs at all when the server reports the check is
 *     enabled (`GET /me/password/policy`) — a deployment that has not
 *     opted in server-side never sees an outbound browser request either.
 *
 * Neither signal blocks submit. The actual point of enforcement is the
 * server: POST /me/password re-validates length and, when enabled, runs
 * the same breach check itself and answers with `password_pwned` if it
 * fails. This page's job is to make that outcome unsurprising, not to
 * gate it a second time — see the design note in the issue for why a
 * client-side gate here would be redundant at best and misleading at
 * worst (a reader who clears the "found" hint by editing whitespace
 * would see a green light that means nothing).
 *
 * Both async signals are guarded against staleness (sk-303.20 review,
 * three engines, Warning): the strength estimate's dictionary load can
 * plausibly outlast a fast edit/clear, and the breach hint is an
 * independent per-blur `fetch()` whose responses are not guaranteed to
 * arrive in issuance order. `newPasswordRef` mirrors the live value so an
 * async `.then` can tell "this result is still for the current password"
 * from "the user has since changed it" before calling `setState`; the
 * breach-hint path additionally aborts its own in-flight request (and any
 * still-running predecessor) via `AbortController` whenever the password
 * changes or the component unmounts.
 */

const STRENGTH_DEBOUNCE_MS = 150;

// sk-403 — keys of the levels, not labels. The order is the zxcvbn 0..4 scale.
const STRENGTH_LEVEL_KEYS = [
  'strength.levels.veryWeak',
  'strength.levels.weak',
  'strength.levels.fair',
  'strength.levels.good',
  'strength.levels.strong',
] as const;
// zxcvbn's five scores against the dictionary's three severity roles.
// The bar's own VALUE already encodes all five steps (20/40/60/80/100%)
// and the label names them, so colour is a redundant third channel here
// and does not owe the scale a fifth hue — which the dictionary has not
// got. The split follows zxcvbn's own reading of its scores: 0-1 is the
// band it calls guessable, 2 is borderline, 3-4 is what it considers
// safe. Their `['red','orange','yellow','lime','green']` were Mantine
// built-in ramps: fixed hues that neither move with the theme nor carry
// the measured contrast the `--err/--warn/--ok` roles do.
const STRENGTH_COLORS = [
  'var(--err)',
  'var(--err)',
  'var(--warn)',
  'var(--ok)',
  'var(--ok)',
] as const;

// Mirrors internal/users.PasswordMinLen / passwordMaxBytes on the server
// (see skein-api store.go) — bcrypt's structural ceiling is a BYTE count,
// not a character count, so both bounds are checked on the UTF-8 encoding,
// never on `.length` (UTF-16 code units). Checking client-side avoids a
// pointless round trip for input the server will reject anyway; the server
// remains the actual point of enforcement (see module doc).
const PASSWORD_MIN_BYTES = 8;
const PASSWORD_MAX_BYTES = 72;

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

interface FormErrors {
  currentPassword?: string;
  newPassword?: string;
}

/**
 * sk-403 — the fallback phrase comes as a parameter, because the function lives
 * outside the component and cannot have its own `t()`. The messages of the errors
 * themselves are the server's: their language is decided by the API, and replacing them with our own text would mean
 * hiding what the server actually answered.
 */
function describeUnexpectedError(err: unknown, fallback: string): string {
  if (err instanceof BusinessError) return err.message;
  if (err instanceof ApiError) return err.message || fallback;
  if (err instanceof Error) return err.message;
  return fallback;
}

export function NewPasswordPage() {
  return (
    <SettingsLayout active="password">
      <PasswordPanel />
    </SettingsLayout>
  );
}

function PasswordPanel() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [strength, setStrength] = useState<PasswordStrength | null>(null);
  const strengthTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [pwnedHint, setPwnedHint] = useState<PwnedHintState>('idle');
  const pwnedAbortRef = useRef<AbortController | null>(null);

  const [fieldErrors, setFieldErrors] = useState<FormErrors>({});
  const [genericError, setGenericError] = useState<string | null>(null);
  const [localPasswordDisabled, setLocalPasswordDisabled] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Mirrors `newPassword` for comparison inside async `.then` callbacks —
  // those close over whatever `newPassword` was AT CALL TIME, which is
  // exactly the stale value staleness-guards need to detect. Kept current
  // via the plain assignment below (runs synchronously on every render,
  // no need for an effect — reading a ref during render is fine when
  // nothing renders FROM it, only later async code reads it).
  const newPasswordRef = useRef(newPassword);
  newPasswordRef.current = newPassword;

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Field refs — used both for the aria-describedby merge below (Mantine's
  // PasswordInput unconditionally overwrites any aria-describedby PROP with
  // its own computed value, so the only reliable way to add our own ids is
  // to patch the DOM node directly after render — see the effect below) and
  // for moving focus to the field a server/client validation error is
  // actually about (sk-303.20 review, claude+grok: no field/alert ever
  // received focus after an error).
  const currentPasswordFieldRef = useRef<HTMLInputElement>(null);
  const newPasswordFieldRef = useRef<HTMLInputElement>(null);
  const confirmPasswordFieldRef = useRef<HTMLInputElement>(null);
  const ssoAlertRef = useRef<HTMLDivElement>(null);
  const genericErrorRef = useRef<HTMLDivElement>(null);

  const strengthStatusId = useId();
  const pwnedHintStatusId = useId();

  const { t, i18n } = useTranslation('password');

  const policyQuery = useQuery({
    queryKey: ['password-policy'],
    queryFn: getPasswordPolicy,
  });
  const pwnedCheckEnabled = policyQuery.data?.pwnedCheckEnabled ?? false;

  // Live strength estimate — recomputed on every keystroke, debounced only
  // so a fast typist doesn't pile up zxcvbn passes on every render. No
  // network call happens anywhere in this effect (see lib/passwordStrength).
  //
  // Staleness/unmount guard (sk-303.20 review, all three engines, Warning):
  // the debounce's `clearTimeout` only cancels a timer that hasn't fired
  // yet — it does nothing once `scorePassword` is actually in flight (e.g.
  // mid dictionary-load on the very first keystroke on a cold cache). A
  // slow first call must not overwrite a later, faster call's result, and
  // neither may fire after unmount.
  useEffect(() => {
    if (strengthTimer.current) clearTimeout(strengthTimer.current);
    if (!newPassword) {
      setStrength(null);
      return;
    }
    const requestedFor = newPassword;
    strengthTimer.current = setTimeout(() => {
      void scorePassword(requestedFor, i18n.language)
        .then((result) => {
          if (!mountedRef.current || requestedFor !== newPasswordRef.current) return;
          setStrength(result);
        })
        .catch(() => {
          // A failed dictionary load (offline, stale chunk after a deploy)
          // must not surface as an unhandled rejection — just drop the
          // estimate for this value. lib/passwordStrength resets its
          // memoized import promise on rejection, so the NEXT keystroke's
          // call gets a fresh retry rather than replaying the same failure.
          if (!mountedRef.current || requestedFor !== newPasswordRef.current) return;
          setStrength(null);
        });
    }, STRENGTH_DEBOUNCE_MS);
    return () => {
      if (strengthTimer.current) clearTimeout(strengthTimer.current);
    };
    // sk-403 — the language is in the dependencies not for beauty: the feedback is written by
    // the library itself, and when the language changes there is nobody to translate the line
    // already shown except a new run of the estimator.
  }, [newPassword, i18n.language]);

  // The breach hint must never describe a password other than the one
  // currently in the field (sk-303.20 review, all three engines, Warning:
  // "pwned-breach hint can go stale and display a security signal for the
  // wrong password"). Reset to 'idle' — and cancel whatever check is still
  // in flight — the instant the field's value changes, whether that's a
  // fresh edit after a 'found' result or the field being cleared.
  useEffect(() => {
    setPwnedHint('idle');
    pwnedAbortRef.current?.abort();
    pwnedAbortRef.current = null;
  }, [newPassword]);

  // Abort any in-flight breach check on unmount — a hung request must not
  // keep running (or, if it does resolve, must not attempt a setState)
  // after the component is gone.
  useEffect(() => {
    return () => {
      pwnedAbortRef.current?.abort();
    };
  }, []);

  const runPwnedHint = () => {
    if (!pwnedCheckEnabled || !newPassword) return;
    const requestedFor = newPassword;
    // Cancel whatever the PREVIOUS blur kicked off — two blurs in quick
    // succession must not race each other; only the latest one's result
    // may ever be applied.
    pwnedAbortRef.current?.abort();
    const controller = new AbortController();
    pwnedAbortRef.current = controller;
    setPwnedHint('checking');
    void checkPwnedHint(requestedFor, { signal: controller.signal }).then((result) => {
      if (
        !mountedRef.current ||
        controller.signal.aborted ||
        requestedFor !== newPasswordRef.current
      ) {
        return;
      }
      setPwnedHint(result);
    });
  };

  const changeMutation = useMutation({
    mutationFn: changeMyPassword,
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setStrength(null);
      setPwnedHint('idle');
      setFieldErrors({});
      setGenericError(null);
      setLocalPasswordDisabled(null);
      setSuccess(true);
    },
    onError: (err: unknown) => {
      setSuccess(false);
      setFieldErrors({});
      setGenericError(null);
      setLocalPasswordDisabled(null);

      const code = err instanceof BusinessError || err instanceof ApiError ? err.code : '';
      switch (code) {
        case 'invalid_credentials':
          setFieldErrors({ currentPassword: t('errors.currentIncorrect') });
          return;
        case 'invalid_password':
          setFieldErrors({ newPassword: t('errors.tooShort', { min: PASSWORD_MIN_BYTES }) });
          return;
        case 'password_too_long':
          setFieldErrors({ newPassword: t('errors.tooLong', { max: PASSWORD_MAX_BYTES }) });
          return;
        case 'password_pwned':
          setFieldErrors({ newPassword: t('errors.pwned') });
          return;
        case 'local_password_disabled':
          setLocalPasswordDisabled(describeUnexpectedError(err, t('unexpected')));
          return;
        default:
          setGenericError(describeUnexpectedError(err, t('unexpected')));
      }
    },
  });

  // Move focus to whatever the mutation's error is actually about — a
  // click doesn't move focus the way a keyboard Enter does, so without
  // this a screen-reader/keyboard user's focus stays on the submit button
  // while the only signal that anything happened is the inline text next
  // to a field they aren't on (sk-303.20 review, claude+grok Warning).
  useEffect(() => {
    // Skip while the mutation is still settling: the fields are
    // `disabled={changeMutation.isPending}` at that point, and a disabled
    // input cannot take focus (in jsdom exactly like in a real browser) —
    // react-query's onError can commit fieldErrors a render or two before
    // `isPending` itself flips back to false, so gating on it here (and
    // depending on it below) lets this effect retry once the field is
    // actually focusable again instead of silently no-op'ing forever.
    if (changeMutation.isPending) return;
    if (fieldErrors.currentPassword) {
      currentPasswordFieldRef.current?.focus();
    } else if (fieldErrors.newPassword) {
      newPasswordFieldRef.current?.focus();
    }
    // fieldErrors is a fresh object on every onError/validation call (even
    // when the message repeats), so this intentionally re-fires focus on
    // every new rejection — not just the first.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldErrors, changeMutation.isPending]);

  useEffect(() => {
    if (genericError) genericErrorRef.current?.focus();
  }, [genericError]);

  useEffect(() => {
    if (localPasswordDisabled) ssoAlertRef.current?.focus();
  }, [localPasswordDisabled]);

  // sk-303.20 review (claude+codex+grok Warning) — Mantine's PasswordInput
  // computes its OWN aria-describedby from its `description`/`error` props
  // and unconditionally overwrites whatever is passed as an `aria-describedby`
  // PROP (verified against the shipped Mantine source: the literal
  // `"aria-describedby": describedBy` assignment on the inner <input> comes
  // AFTER `...rest` in the same object literal, so a prop is always
  // discarded). The strength meter and breach hint render as plain sibling
  // elements with no Mantine-native way to join the New password field's
  // description — the only reliable fix is to patch the live DOM node after
  // each render. Runs on every commit (no dependency array) so it keeps
  // re-asserting the merge even when Mantine's own base value changes (e.g.
  // fieldErrors.newPassword toggling its internal error id in and out).
  //
  // lastExtraIdsRef remembers which ids WE added last time, so a run where
  // the strength/hint boxes have disappeared (submit succeeded and the form
  // reset, or the hint went back to idle) can strip exactly those ids back
  // out — leaving Mantine's own base value intact — instead of leaving a
  // dangling reference to an id that no longer exists in the DOM.
  const lastExtraIdsRef = useRef<string[]>([]);
  useEffect(() => {
    const el = newPasswordFieldRef.current;
    if (!el) return;
    const extraIds = [
      newPassword && strength ? strengthStatusId : null,
      pwnedHint === 'checking' || pwnedHint === 'found' ? pwnedHintStatusId : null,
    ].filter((id): id is string => Boolean(id));
    const current = (el.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean);
    const base = current.filter((id) => !lastExtraIdsRef.current.includes(id));
    const merged = Array.from(new Set([...base, ...extraIds]));
    lastExtraIdsRef.current = extraIds;
    const mergedStr = merged.length > 0 ? merged.join(' ') : null;
    if (mergedStr) {
      if (el.getAttribute('aria-describedby') !== mergedStr) {
        el.setAttribute('aria-describedby', mergedStr);
      }
    } else if (el.hasAttribute('aria-describedby')) {
      el.removeAttribute('aria-describedby');
    }
  });

  if (localPasswordDisabled) {
    return (
      <SettingsPanel title={t('title')}>
        <Alert
          variant="light"
          style={INFO_ALERT_VARS}
          title={t('sso')}
          ref={ssoAlertRef}
          tabIndex={-1}
        >
          {localPasswordDisabled}
        </Alert>
      </SettingsPanel>
    );
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSuccess(false);
    setGenericError(null);
    setLocalPasswordDisabled(null);

    // Client-side validation before the round trip. The server remains the
    // actual point of enforcement (same messages, so a value that slips
    // past this and gets rejected server-side reads identically) — this
    // just avoids a pointless request for input that's obviously invalid,
    // and replaces the old hard-disabled submit button (sk-303.20 review,
    // all three engines: a disabled button with no accessible explanation
    // is worse than an enabled one that explains itself on submit).
    const errs: FormErrors = {};
    if (!currentPassword) {
      errs.currentPassword = t('errors.currentRequired');
    }
    if (!newPassword) {
      errs.newPassword = t('errors.newRequired');
    } else {
      const bytes = byteLength(newPassword);
      if (bytes < PASSWORD_MIN_BYTES) {
        errs.newPassword = t('errors.tooShort', { min: PASSWORD_MIN_BYTES });
      } else if (bytes > PASSWORD_MAX_BYTES) {
        errs.newPassword = t('errors.tooLong', { max: PASSWORD_MAX_BYTES });
      }
    }
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});

    if (newPassword !== confirmPassword) {
      confirmPasswordFieldRef.current?.focus();
      return;
    }

    changeMutation.mutate({ currentPassword, newPassword });
  };

  return (
    <SettingsPanel title={t('title')} description={t('description')}>
      {success ? (
        <Alert variant="light" style={OK_ALERT_VARS} title={t('success.title')} mb="md">
          {t('success.body')}
        </Alert>
      ) : null}

      {genericError ? (
        <Alert
          variant="light"
          style={ERR_ALERT_VARS}
          title={t('failed')}
          mb="md"
          ref={genericErrorRef}
          tabIndex={-1}
        >
          {genericError}
        </Alert>
      ) : null}

      <Box component="form" onSubmit={onSubmit} noValidate>
        <Stack gap="md">
          <PasswordInput
            ref={currentPasswordFieldRef}
            label={t('fields.current')}
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.currentTarget.value)}
            error={fieldErrors.currentPassword}
            aria-invalid={Boolean(fieldErrors.currentPassword)}
            disabled={changeMutation.isPending}
          />

          <div>
            <PasswordInput
              ref={newPasswordFieldRef}
              label={t('fields.new')}
              autoComplete="new-password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.currentTarget.value)}
              onBlur={runPwnedHint}
              error={fieldErrors.newPassword}
              aria-invalid={Boolean(fieldErrors.newPassword)}
              disabled={changeMutation.isPending}
              description={t('fields.newHint', { min: PASSWORD_MIN_BYTES })}
            />

            {newPassword && strength ? (
              <Box
                id={strengthStatusId}
                role="status"
                aria-live="polite"
                mt={6}
                data-testid="password-strength"
              >
                <Progress
                  value={((strength.score + 1) / 5) * 100}
                  color={STRENGTH_COLORS[strength.score]}
                  size="sm"
                  aria-label={t('strength.aria', {
                    level: t(STRENGTH_LEVEL_KEYS[strength.score]),
                  })}
                />
                <Text size="xs" c="var(--ink)" mt={4}>
                  {t(STRENGTH_LEVEL_KEYS[strength.score])}
                  {strength.warning ? ` — ${strength.warning}` : ''}
                  {!strength.warning && strength.suggestions[0]
                    ? ` — ${strength.suggestions[0]}`
                    : ''}
                </Text>
              </Box>
            ) : null}

            {pwnedHint === 'checking' ? (
              <Text
                id={pwnedHintStatusId}
                role="status"
                aria-live="polite"
                size="xs"
                c="var(--ink)"
                mt={4}
                data-testid="pwned-hint"
              >
                {t('pwned.checking')}
              </Text>
            ) : null}
            {pwnedHint === 'found' ? (
              <Text
                id={pwnedHintStatusId}
                size="xs"
                c="var(--warn)"
                mt={4}
                role="alert"
                data-testid="pwned-hint"
              >
                {t('pwned.found')}
              </Text>
            ) : null}
          </div>

          <PasswordInput
            ref={confirmPasswordFieldRef}
            label={t('fields.confirm')}
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.currentTarget.value)}
            error={
              confirmPassword.length > 0 && confirmPassword !== newPassword
                ? t('errors.mismatch')
                : undefined
            }
            aria-invalid={confirmPassword.length > 0 && confirmPassword !== newPassword}
            disabled={changeMutation.isPending}
          />

          <Group gap="sm">
            <Button
              type="submit"
              size="sm"
              variant="filled"
              loading={changeMutation.isPending}
              disabled={changeMutation.isPending}
            >
              {t('submit')}
            </Button>
          </Group>
        </Stack>
      </Box>
    </SettingsPanel>
  );
}
