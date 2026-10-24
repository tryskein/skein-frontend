/**
 * sk-303.20 — /settings/password.
 *
 * Covers the acceptance criteria that are actually verifiable from a
 * component test:
 *   - all three fields render and submit is gated on non-empty +
 *     new === confirm;
 *   - happy path calls changeMyPassword with the right payload and clears
 *     the form;
 *   - each server error code (invalid_credentials, password_pwned,
 *     local_password_disabled) is shown distinctly, per its own field/UI
 *     branch, and current-field errors do NOT clear the typed values;
 *   - the live strength estimate makes ZERO network calls while it updates
 *     (the acceptance criterion "the strength estimate makes no network
 *     requests with the password in the body", proven here rather than merely asserted);
 *   - the pwned hint only ever calls `fetch` when the server-reported
 *     policy says it's enabled, fires at most once per blur, and never
 *     blocks submit regardless of outcome.
 *
 * `lib/passwordStrength` and `lib/pwnedCheck` run for REAL here (not
 * mocked) — that's the point: the "no network for strength" assertion is
 * only meaningful if the real zxcvbn path executes and we watch `fetch`
 * from the outside.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import { ApiError, BusinessError } from '../../../api/client';
import type { ChangePasswordPayload, PasswordPolicy } from '../../../api/users';

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u-1', username: 'caller', role: 'user' } }),
}));

// Thin SettingsLayout pass-through — avoids mounting HeaderBar + the
// LayoutProvider/TasksUiState stack (same pattern as
// PushDevicesSection.test.tsx). SettingsPanel stays real.
vi.mock('./SettingsLayout', async (importActual) => {
  const actual = await importActual<typeof import('./SettingsLayout')>();
  return {
    ...actual,
    SettingsLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  };
});

const changeMyPasswordSpy = vi.fn<(payload: ChangePasswordPayload) => Promise<void>>();
const getPasswordPolicySpy = vi.fn<() => Promise<PasswordPolicy>>();

vi.mock('../../../api/users', () => ({
  changeMyPassword: (payload: ChangePasswordPayload) => changeMyPasswordSpy(payload),
  getPasswordPolicy: () => getPasswordPolicySpy(),
}));

// Imported AFTER the mocks so the mocked modules are wired in.
import { NewPasswordPage } from './PasswordPage';

function mount() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MantineProvider>
        <MemoryRouter>
          <NewPasswordPage />
        </MemoryRouter>
      </MantineProvider>
    </QueryClientProvider>,
  );
}

// Mantine renders the `required` indicator as a nested `<span>*</span>`
// inside the `<label>`, which RTL's getByLabelText folds into the label's
// textContent regardless of the span's aria-hidden — so an exact-string
// match against "New password" (without the trailing " *") never matches.
// A leading-anchored regex sidesteps it (same pattern UsersPage.test.tsx
// uses for its own required PasswordInput).
const currentField = () => screen.getByLabelText(/^Current password/) as HTMLInputElement;
const newField = () => screen.getByLabelText(/^New password/) as HTMLInputElement;
const confirmField = () => screen.getByLabelText(/^Confirm new password/) as HTMLInputElement;
const submitButton = () => screen.getByRole('button', { name: 'Change password' }) as HTMLButtonElement;

// jest-dom is not set up in this project (see other *.test.tsx: disabled
// state is checked via the native `disabled` property, not `toBeDisabled`).
const isDisabled = (el: HTMLButtonElement) => el.disabled;

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  changeMyPasswordSpy.mockReset();
  getPasswordPolicySpy.mockReset();
  getPasswordPolicySpy.mockResolvedValue({ pwnedCheckEnabled: false });
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('form shape', () => {
  test('renders all three fields', () => {
    mount();
    expect(currentField()).toBeTruthy();
    expect(newField()).toBeTruthy();
    expect(confirmField()).toBeTruthy();
  });

  // sk-303.20 review (claude+codex+grok Warning) — the button used to be
  // hard-disabled until all three fields were filled and matched, with no
  // programmatically-discoverable reason. It is now always enabled (short
  // of a pending submit) and validates on click instead, surfacing the
  // SAME inline messages a server round trip would.
  test('submit is enabled from the start; clicking with empty fields shows inline errors and does not submit', () => {
    mount();
    expect(isDisabled(submitButton())).toBe(false);

    fireEvent.click(submitButton());
    expect(screen.getByText('Enter your current password.')).toBeTruthy();
    expect(screen.getByText('Enter a new password.')).toBeTruthy();
    expect(changeMyPasswordSpy).not.toHaveBeenCalled();
  });

  test('mismatched confirm password blocks submit and moves focus to the confirm field', () => {
    mount();
    fireEvent.change(currentField(), { target: { value: 'oldP@ssword1' } });
    fireEvent.change(newField(), { target: { value: 'newP@ssword2' } });
    fireEvent.change(confirmField(), { target: { value: 'mismatch' } });
    fireEvent.click(submitButton());

    expect(screen.getByText('Passwords do not match.')).toBeTruthy();
    expect(changeMyPasswordSpy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(confirmField());
  });

  test('a too-short new password (< 8 bytes) is blocked client-side before submit', () => {
    mount();
    fireEvent.change(currentField(), { target: { value: 'oldP@ssword1' } });
    fireEvent.change(newField(), { target: { value: 'short' } });
    fireEvent.change(confirmField(), { target: { value: 'short' } });
    fireEvent.click(submitButton());

    expect(
      screen.getByText('Password must be at least 8 bytes once UTF-8 encoded.'),
    ).toBeTruthy();
    expect(changeMyPasswordSpy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(newField());
  });

  // sk-303.20 review (grok Warning) — the byte cap must be checked on the
  // UTF-8 ENCODING, not on JS `.length` (UTF-16 code units). 37 Cyrillic
  // characters is 37 in `.length` but 74 bytes in UTF-8 (2 bytes/char) — a
  // `.length > 72` check would wrongly let this through.
  test('a new password that is 72 characters but 74 bytes (multi-byte) is blocked client-side', () => {
    mount();
    const longPw = 'ж'.repeat(37);
    expect(longPw.length).toBe(37);
    fireEvent.change(currentField(), { target: { value: 'oldP@ssword1' } });
    fireEvent.change(newField(), { target: { value: longPw } });
    fireEvent.change(confirmField(), { target: { value: longPw } });
    fireEvent.click(submitButton());

    expect(
      screen.getByText(
        'Password must not exceed 72 bytes once UTF-8 encoded — try a shorter one.',
      ),
    ).toBeTruthy();
    expect(changeMyPasswordSpy).not.toHaveBeenCalled();
  });

  test('exactly 72 UTF-8 bytes (36 Cyrillic characters) passes client-side validation', async () => {
    changeMyPasswordSpy.mockResolvedValue(undefined);
    mount();
    const okPw = 'ж'.repeat(36);
    fireEvent.change(currentField(), { target: { value: 'oldP@ssword1' } });
    fireEvent.change(newField(), { target: { value: okPw } });
    fireEvent.change(confirmField(), { target: { value: okPw } });
    fireEvent.click(submitButton());

    await waitFor(() =>
      expect(changeMyPasswordSpy).toHaveBeenCalledWith({
        currentPassword: 'oldP@ssword1',
        newPassword: okPw,
      }),
    );
  });
});

describe('happy path', () => {
  test('calls changeMyPassword with the typed payload, then clears the form', async () => {
    changeMyPasswordSpy.mockResolvedValue(undefined);
    mount();

    fireEvent.change(currentField(), { target: { value: 'oldP@ssword1' } });
    fireEvent.change(newField(), { target: { value: 'newP@ssword2' } });
    fireEvent.change(confirmField(), { target: { value: 'newP@ssword2' } });
    fireEvent.click(submitButton());

    await waitFor(() =>
      expect(changeMyPasswordSpy).toHaveBeenCalledWith({
        currentPassword: 'oldP@ssword1',
        newPassword: 'newP@ssword2',
      }),
    );

    await waitFor(() => expect(screen.getByText('Password changed')).toBeTruthy());
    expect(currentField().value).toBe('');
    expect(newField().value).toBe('');
    expect(confirmField().value).toBe('');
  });
});

describe('server error branches', () => {
  test('invalid_credentials (422) — inline error under current password, fields NOT cleared', async () => {
    changeMyPasswordSpy.mockRejectedValue(
      new BusinessError(422, 'current password is incorrect', 'invalid_credentials'),
    );
    mount();

    fireEvent.change(currentField(), { target: { value: 'wrongpass' } });
    fireEvent.change(newField(), { target: { value: 'newP@ssword2' } });
    fireEvent.change(confirmField(), { target: { value: 'newP@ssword2' } });
    fireEvent.click(submitButton());

    await waitFor(() =>
      expect(screen.getByText('Current password is incorrect.')).toBeTruthy(),
    );
    expect(currentField().value).toBe('wrongpass');
    expect(newField().value).toBe('newP@ssword2');
  });

  test('password_pwned (422) — distinct inline error from invalid_password', async () => {
    changeMyPasswordSpy.mockRejectedValue(
      new BusinessError(
        422,
        'this password has appeared in a known data breach',
        'password_pwned',
      ),
    );
    mount();

    fireEvent.change(currentField(), { target: { value: 'oldP@ssword1' } });
    fireEvent.change(newField(), { target: { value: 'password' } });
    fireEvent.change(confirmField(), { target: { value: 'password' } });
    fireEvent.click(submitButton());

    await waitFor(() =>
      expect(
        screen.getByText(
          'This password has appeared in a known data breach — choose a different one.',
        ),
      ).toBeTruthy(),
    );
    // Not the same text as the too-short/invalid_password branch.
    expect(screen.queryByText('Password must be at least 8 characters.')).toBeNull();
  });

  test('local_password_disabled (403, ApiError) — whole form replaced by an Alert with the server message', async () => {
    changeMyPasswordSpy.mockRejectedValue(
      new ApiError(
        403,
        'this account authenticates via SSO; there is no local password to change here',
        'local_password_disabled',
      ),
    );
    mount();

    fireEvent.change(currentField(), { target: { value: 'oldP@ssword1' } });
    fireEvent.change(newField(), { target: { value: 'newP@ssword2' } });
    fireEvent.change(confirmField(), { target: { value: 'newP@ssword2' } });
    fireEvent.click(submitButton());

    await waitFor(() =>
      expect(
        screen.getByText(
          'this account authenticates via SSO; there is no local password to change here',
        ),
      ).toBeTruthy(),
    );
    // The form fields are gone — replaced, not just supplemented.
    expect(screen.queryByLabelText(/^Current password/)).toBeNull();
    // sk-303.20 review (claude+grok Warning) — the whole form (and the
    // submit button focus was on) is replaced; the alert must receive
    // focus so a keyboard user doesn't lose their place at <body>.
    expect(document.activeElement).toBe(screen.getByText('Managed via SSO').closest('[role="alert"]'));
  });

  // sk-303.20 review (codex Info) — invalid_password / password_too_long
  // had UI branches with no test coverage.
  test('invalid_password (400) — inline error under new password', async () => {
    changeMyPasswordSpy.mockRejectedValue(
      new ApiError(400, 'password must be at least 8 characters', 'invalid_password'),
    );
    mount();

    fireEvent.change(currentField(), { target: { value: 'oldP@ssword1' } });
    fireEvent.change(newField(), { target: { value: 'shortpw1' } });
    fireEvent.change(confirmField(), { target: { value: 'shortpw1' } });
    fireEvent.click(submitButton());

    await waitFor(() =>
      expect(
        screen.getByText('Password must be at least 8 bytes once UTF-8 encoded.'),
      ).toBeTruthy(),
    );
    expect(document.activeElement).toBe(newField());
  });

  test('password_too_long (400) — inline error under new password', async () => {
    changeMyPasswordSpy.mockRejectedValue(
      new ApiError(
        400,
        'password must not exceed 72 bytes once UTF-8 encoded',
        'password_too_long',
      ),
    );
    mount();

    // Client-side validation only checks bytes on the SUBMITTED value; feed
    // it something under the client's own 72-byte cap so the request
    // actually reaches the (mocked) server and we're testing the server
    // error branch, not the client-side short-circuit.
    fireEvent.change(currentField(), { target: { value: 'oldP@ssword1' } });
    fireEvent.change(newField(), { target: { value: 'aValidLookingPassword1' } });
    fireEvent.change(confirmField(), { target: { value: 'aValidLookingPassword1' } });
    fireEvent.click(submitButton());

    await waitFor(() =>
      expect(
        screen.getByText(
          'Password must not exceed 72 bytes once UTF-8 encoded — try a shorter one.',
        ),
      ).toBeTruthy(),
    );
    expect(document.activeElement).toBe(newField());
  });

  test('current-password field error moves focus to the current-password field', async () => {
    changeMyPasswordSpy.mockRejectedValue(
      new BusinessError(422, 'current password is incorrect', 'invalid_credentials'),
    );
    mount();

    fireEvent.change(currentField(), { target: { value: 'wrongpass' } });
    fireEvent.change(newField(), { target: { value: 'newP@ssword2' } });
    fireEvent.change(confirmField(), { target: { value: 'newP@ssword2' } });
    fireEvent.click(submitButton());

    await waitFor(() => expect(document.activeElement).toBe(currentField()));
  });

  test('an unrecognised error code shows the generic alert and moves focus to it', async () => {
    changeMyPasswordSpy.mockRejectedValue(new ApiError(500, 'internal_error', ''));
    mount();

    fireEvent.change(currentField(), { target: { value: 'oldP@ssword1' } });
    fireEvent.change(newField(), { target: { value: 'newP@ssword2' } });
    fireEvent.change(confirmField(), { target: { value: 'newP@ssword2' } });
    fireEvent.click(submitButton());

    await waitFor(() => expect(screen.getByText('internal_error')).toBeTruthy());
    expect(document.activeElement).toBe(
      screen.getByText('Could not change password').closest('[role="alert"]'),
    );
  });
});

describe('accessibility wiring', () => {
  test('field errors set aria-invalid on the offending input', async () => {
    changeMyPasswordSpy.mockRejectedValue(
      new BusinessError(422, 'current password is incorrect', 'invalid_credentials'),
    );
    mount();

    fireEvent.change(currentField(), { target: { value: 'wrongpass' } });
    fireEvent.change(newField(), { target: { value: 'newP@ssword2' } });
    fireEvent.change(confirmField(), { target: { value: 'newP@ssword2' } });
    fireEvent.click(submitButton());

    await waitFor(() => expect(currentField().getAttribute('aria-invalid')).toBe('true'));
    expect(newField().getAttribute('aria-invalid')).toBe('false');
  });

  test('mismatched confirm password sets aria-invalid on the confirm field', () => {
    mount();
    fireEvent.change(newField(), { target: { value: 'newP@ssword2' } });
    fireEvent.change(confirmField(), { target: { value: 'mismatch' } });
    expect(confirmField().getAttribute('aria-invalid')).toBe('true');
  });

  test('the strength status container is joined to the New password field via aria-describedby', async () => {
    mount();
    fireEvent.change(newField(), { target: { value: 'correcthorsebatterystaple' } });

    // sk-403 — a generous wait, and it is waiting for LOADING, not
    // "let's wait until the value becomes right": the estimator now
    // loads a second language dictionary (the sk-403 decision — the dictionary
    // describes the attacker's words, not the interface language), and the first count
    // took 219 ms measured in a single run plus 150 ms of debounce. Under
    // eleven parallel runners the default of 1 s sometimes
    // was not enough — observed once on the full suite.
    const strengthBox = await waitFor(() => screen.getByTestId('password-strength'), {
      timeout: 5000,
    });
    const strengthId = strengthBox.id;
    expect(strengthId).toBeTruthy();

    await waitFor(() => {
      const describedBy = newField().getAttribute('aria-describedby') ?? '';
      expect(describedBy.split(' ')).toContain(strengthId);
    });
  });

  test('the pwned-hint container is joined to the New password field via aria-describedby', async () => {
    getPasswordPolicySpy.mockResolvedValue({ pwnedCheckEnabled: true });
    fetchSpy.mockResolvedValue(
      new Response('1E4C9B93F3F0682250B6CF8331B7EE68FD8:3730471\r\n', { status: 200 }),
    );
    mount();
    await waitFor(() => expect(getPasswordPolicySpy).toHaveBeenCalled());

    fireEvent.change(newField(), { target: { value: 'password' } });
    fireEvent.blur(newField());

    const hint = await waitFor(() => screen.getByTestId('pwned-hint'));
    const hintId = hint.id;
    expect(hintId).toBeTruthy();

    await waitFor(() => {
      const describedBy = newField().getAttribute('aria-describedby') ?? '';
      expect(describedBy.split(' ')).toContain(hintId);
    });
  });

  test('a cleared field removes the strength/pwned ids from aria-describedby instead of leaving a dangling reference', async () => {
    getPasswordPolicySpy.mockResolvedValue({ pwnedCheckEnabled: true });
    fetchSpy.mockResolvedValue(
      new Response('1E4C9B93F3F0682250B6CF8331B7EE68FD8:3730471\r\n', { status: 200 }),
    );
    mount();
    await waitFor(() => expect(getPasswordPolicySpy).toHaveBeenCalled());

    fireEvent.change(newField(), { target: { value: 'password' } });
    fireEvent.blur(newField());
    const hint = await waitFor(() => screen.getByTestId('pwned-hint'));
    const hintId = hint.id;
    await waitFor(() => {
      const describedBy = newField().getAttribute('aria-describedby') ?? '';
      expect(describedBy.split(' ')).toContain(hintId);
    });

    // Clearing the field drops both the strength box and the hint (the
    // reset effect also fires) — their ids must come back OUT of
    // aria-describedby, not linger pointing at nothing.
    fireEvent.change(newField(), { target: { value: '' } });
    await waitFor(() => {
      const describedBy = (newField().getAttribute('aria-describedby') ?? '').split(' ');
      expect(describedBy).not.toContain(hintId);
    });
  });
});

describe('strength estimate makes no network calls', () => {
  test('typing a password and waiting for the strength indicator never calls fetch', async () => {
    mount();
    fireEvent.change(newField(), { target: { value: 'password' } });

    await waitFor(() => expect(screen.getByTestId('password-strength')).toBeTruthy(), {
      // sk-403 — see above: the estimator loads two language dictionaries.
      timeout: 5000,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('pwned hint — gated by server policy, on blur only, never blocks submit', () => {
  test('policy disabled: blur on the new-password field never calls fetch', async () => {
    getPasswordPolicySpy.mockResolvedValue({ pwnedCheckEnabled: false });
    mount();

    // Let the policy query resolve before interacting.
    await waitFor(() => expect(getPasswordPolicySpy).toHaveBeenCalled());

    fireEvent.change(newField(), { target: { value: 'password' } });
    fireEvent.blur(newField());

    // Give any errant async path a chance to fire, then assert it didn't.
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('policy enabled: blur fires exactly one request to the range endpoint; a match renders the found hint', async () => {
    getPasswordPolicySpy.mockResolvedValue({ pwnedCheckEnabled: true });
    // SHA-1('password') = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
    fetchSpy.mockResolvedValue(
      new Response('1E4C9B93F3F0682250B6CF8331B7EE68FD8:3730471\r\n', { status: 200 }),
    );
    mount();

    await waitFor(() => expect(getPasswordPolicySpy).toHaveBeenCalled());

    fireEvent.change(newField(), { target: { value: 'password' } });
    fireEvent.blur(newField());

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.pwnedpasswords.com/range/5BAA6');

    await waitFor(() =>
      expect(
        screen.getByText('This password has appeared in a known data breach.'),
      ).toBeTruthy(),
    );

    // Submit stays enabled — the hint never gates it.
    fireEvent.change(currentField(), { target: { value: 'oldP@ssword1' } });
    fireEvent.change(confirmField(), { target: { value: 'password' } });
    expect(isDisabled(submitButton())).toBe(false);
  });

  test('policy enabled: a fetch rejection leaves the UI quiet, submit still enabled', async () => {
    getPasswordPolicySpy.mockResolvedValue({ pwnedCheckEnabled: true });
    fetchSpy.mockRejectedValue(new TypeError('network unreachable'));
    mount();

    await waitFor(() => expect(getPasswordPolicySpy).toHaveBeenCalled());

    fireEvent.change(newField(), { target: { value: 'password' } });
    fireEvent.blur(newField());

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    // No error text rendered for the failed hint lookup.
    expect(screen.queryByText(/data breach/)).toBeNull();

    fireEvent.change(currentField(), { target: { value: 'oldP@ssword1' } });
    fireEvent.change(confirmField(), { target: { value: 'password' } });
    expect(isDisabled(submitButton())).toBe(false);
  });

  // sk-303.20 review (claude+codex+grok Warning) — a 'found' result must
  // never keep describing a password the user has since edited away from.
  test('editing the field after a "found" result clears the stale hint (no reblur needed)', async () => {
    getPasswordPolicySpy.mockResolvedValue({ pwnedCheckEnabled: true });
    fetchSpy.mockResolvedValue(
      new Response('1E4C9B93F3F0682250B6CF8331B7EE68FD8:3730471\r\n', { status: 200 }),
    );
    mount();
    await waitFor(() => expect(getPasswordPolicySpy).toHaveBeenCalled());

    fireEvent.change(newField(), { target: { value: 'password' } });
    fireEvent.blur(newField());
    await waitFor(() =>
      expect(
        screen.getByText('This password has appeared in a known data breach.'),
      ).toBeTruthy(),
    );

    // Edit WITHOUT re-blurring — the stale "found" banner must disappear
    // immediately, not linger describing the old value.
    fireEvent.change(newField(), { target: { value: 'aCompletelyDifferentOne1' } });
    expect(screen.queryByText('This password has appeared in a known data breach.')).toBeNull();
    expect(screen.queryByTestId('pwned-hint')).toBeNull();
  });

  // sk-303.20 review (claude+codex+grok Warning) — two blurs in flight must
  // not let an earlier (now-stale) response overwrite the later one's
  // result, regardless of which HTTP response arrives first.
  test('a stale response from an earlier blur never overwrites the latest blur\'s result', async () => {
    getPasswordPolicySpy.mockResolvedValue({ pwnedCheckEnabled: true });
    let resolveFirst!: (body: string) => void;
    let resolveSecond!: (body: string) => void;
    const first = new Promise<string>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<string>((resolve) => {
      resolveSecond = resolve;
    });
    fetchSpy
      .mockImplementationOnce(async () => new Response(await first, { status: 200 }))
      .mockImplementationOnce(async () => new Response(await second, { status: 200 }));
    mount();
    await waitFor(() => expect(getPasswordPolicySpy).toHaveBeenCalled());

    // First blur — request #1, for "password".
    fireEvent.change(newField(), { target: { value: 'password' } });
    fireEvent.blur(newField());
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    // Edit + blur again before #1 resolves — request #2, for
    // "anotherOne1"; this aborts #1.
    fireEvent.change(newField(), { target: { value: 'anotherOne1' } });
    fireEvent.blur(newField());
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));

    // #1 (stale, aborted) resolves FIRST — SHA-1('password') suffix, a
    // real match for "password" — but must be ignored: the field no
    // longer holds "password".
    resolveFirst('1E4C9B93F3F0682250B6CF8331B7EE68FD8:3730471\r\n');
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('This password has appeared in a known data breach.')).toBeNull();

    // #2 (current) resolves after — SHA-1('anotherOne1') suffix, also a
    // real match — and its result must be the one that's applied.
    resolveSecond('BEC5E560055AC3D2E290460A87C02B01894:1\r\n');
    await waitFor(() =>
      expect(
        screen.getByText('This password has appeared in a known data breach.'),
      ).toBeTruthy(),
    );
  });

  test('unmounting mid-check does not throw and does not leave a pending "checking" state visible', async () => {
    getPasswordPolicySpy.mockResolvedValue({ pwnedCheckEnabled: true });
    let resolveFetch!: (body: string) => void;
    const pending = new Promise<string>((resolve) => {
      resolveFetch = resolve;
    });
    fetchSpy.mockImplementation(async () => new Response(await pending, { status: 200 }));
    const { unmount } = mount();
    await waitFor(() => expect(getPasswordPolicySpy).toHaveBeenCalled());

    fireEvent.change(newField(), { target: { value: 'password' } });
    fireEvent.blur(newField());
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    expect(() => unmount()).not.toThrow();
    // Resolve after unmount — must not throw / warn from a setState on an
    // unmounted component.
    resolveFetch('1E4C9B93F3F0682250B6CF8331B7EE68FD8:3730471\r\n');
    await new Promise((r) => setTimeout(r, 20));
  });
});
