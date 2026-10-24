/**
 * Floating top-right banner that surfaces SignalR connection trouble.
 *
 * Visible only when state !== 'connected'. Styled off the live theme
 * tokens (amber warning accent on `--elev`, square corners) so
 * it reads as part of whatever skin is active — builtin or
 * MCP-authored. `pointer-events: none` on the wrapper
 * keeps the banner from blocking clicks on whatever sits underneath —
 * the user can still interact with the app while we reconnect.
 *
 * The tag text uses bracketed words ([reconnecting], [disconnected],
 * [connecting]) instead of glyphs so the file stays free of emojis per
 * project convention.
 *
 * sk-285.1.16 — the banner is ALSO gated on the auth state. The live
 * connection only exists for a logged-in user (LiveEventsProvider parks
 * on `disconnected` while `user` is null), so on /login — and on any
 * other unauthenticated screen — the banner used to sit in the corner
 * announcing [disconnected] before the visitor had typed anything, which
 * reads as "the app is broken". The gate is the auth state, not the URL,
 * so no unauthenticated surface can surface it again. Nothing about the
 * connection itself changes: once a user is present the banner behaves
 * exactly as before.
 */
import { useTranslation } from 'react-i18next';
import { useAuthOptional } from '../auth/AuthContext';
import { useLiveEventsState } from '../hooks/useLiveEvents';

export function ConnectionStatus() {
  // Both hooks run unconditionally — the early returns below must never
  // change the hook order between renders.
  const { t } = useTranslation('chrome');
  const auth = useAuthOptional();
  const state = useLiveEventsState();

  // Not logged in (or auth still resolving, where `user` is null too):
  // there is no live connection to report on, so report nothing. Also
  // covers the no-provider case, which is by definition not a signed-in
  // session.
  if (!auth?.user) {
    return null;
  }

  if (state === 'connected') {
    return null;
  }

  const label = t(`connection.${state}`);

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        zIndex: 1000,
        padding: '6px 10px',
        // sk-285.1.6 — the banner is mounted at the app root (main.tsx),
        // OUTSIDE `.col-details`, so it never picked up the `--skein-*`
        // → new-token remapping and floated a dark ember chip over the
        // white shell. Bound to the live palette instead: amber is the
        // warning accent (same family as the Alarm clock lens), and it
        // carries the 4.5:1 text grade on `--elev` in both themes.
        background: 'var(--elev)',
        border: '1px solid var(--warn)',
        color: 'var(--warn)',
        fontSize: 'var(--font-sm)',
        borderRadius: 2,
        // Don't block interaction with the app underneath — the banner
        // is a notice, not a modal.
        pointerEvents: 'none',
        userSelect: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </div>
  );
}
