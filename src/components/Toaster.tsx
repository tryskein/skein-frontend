/**
 * Thin shim over `@mantine/notifications` preserving the F3
 * `useToaster()` surface so all existing call sites
 * (`useAcceptIssue`, `useIssueDetail`, `IssueDetailPanel`,
 * `WatchersSection`, `DependenciesSection`) keep firing toasts
 * unchanged.
 *
 * The actual rendering surface — position (bottom-left), stacking,
 * auto-close timer — is owned by the `<Notifications />` provider
 * mounted in `main.tsx`. This file only fans out `success` / `error`
 * /  `info` callers to `notifications.show()` with appropriate colour
 * mapping.
 *
 * Colour strategy: per-call `color` token (Mantine's `green` / `red`
 * / `blue`). Mantine's default green/red/blue are close enough to our
 * own `--ok` / `--err` / `--info` that bridging through theme
 * primary-shade overrides isn't worth the global blast-radius. Toasts
 * are outside the Stage 2.2 design (spec Scope) and inherit whatever the
 * Mantine bridge gives them. `autoClose` is
 * tuned per-variant: success/info dismiss in 5s (positive UX, scenarios
 * doc), errors hold for 7s so the user has a chance to read what went
 * wrong before it disappears.
 */
import type { MouseEvent, ReactNode } from 'react';
import { notifications } from '@mantine/notifications';
import i18n from '../i18n/config';

/**
 * sk-285.1.12 — Mantine's notification close ✕ ships without an
 * accessible name (unlike Alert's, which defaults to "Close alert"), so
 * a screen reader announces a bare "button". `title` would not fix it:
 * it is advisory and not reliably announced. Every toast therefore
 * carries an explicit `aria-label`. Its 44×44 size comes from the
 * CloseButton default in `theme.ts`.
 *
 * sk-285.1.17 — read through the i18n instance directly rather than a
 * `useTranslation` hook: `toaster` is the imperative entry point used
 * from mutation factories and error handlers OUTSIDE the render tree,
 * where hooks are unavailable. Reading at call time (inside each
 * `show()`), not at module scope, keeps the label correct after a
 * language switch.
 */
function closeButtonProps() {
  return { 'aria-label': i18n.t('common:closeNotification') } as const;
}

/**
 * sk-674.18 T054 — an optional link under the message: "You are in Acme ·
 * Open" (screens 1.3). Offered, never followed by itself: the toast
 * does not navigate.
 *
 * The toasts render in `<Notifications />`, which `main.tsx` mounts
 * OUTSIDE `<BrowserRouter>`, so a router `<Link>` cannot live here. The
 * action is a real `<a href={to}>` — open in a new tab and copy work as
 * on any link — and a caller that holds the router's `navigate` passes it
 * so a plain click moves inside the app instead of reloading the page.
 */
export interface ToastAction {
  /** Visible text of the link, also its accessible name. */
  label: string;
  /** In-app path the link leads to. */
  to: string;
  /** The router's `navigate`; without it the link loads the page. */
  navigate?: (to: string) => void;
}

/** Options of one toast; every field is optional. */
export interface ToastOptions {
  action?: ToastAction;
}

/** A plain primary click, not one asking for a new tab or window. */
function isPlainClick(e: MouseEvent<HTMLAnchorElement>): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

function body(message: string, action: ToastAction | undefined, id: string): ReactNode {
  if (action === undefined) return message;
  const { label, to, navigate } = action;
  return (
    <>
      {message}{' '}
      <a
        href={to}
        className="toast-action"
        onClick={(e) => {
          if (navigate === undefined || !isPlainClick(e)) return;
          e.preventDefault();
          notifications.hide(id);
          navigate(to);
        }}
      >
        {label}
      </a>
    </>
  );
}

let toastSeq = 0;

function show(color: string, autoClose: number, message: string, options?: ToastOptions) {
  toastSeq += 1;
  const id = `toast-${toastSeq}`;
  return notifications.show({
    id,
    message: body(message, options?.action, id),
    color,
    autoClose,
    closeButtonProps: closeButtonProps(),
  });
}

/**
 * Imperative entry point for non-React code paths (mutation hook
 * factories, error handlers outside the render tree). Same shape as
 * `useToaster()` so call sites can flip between the two without
 * argument changes.
 */
export const toaster = {
  success: (message: string, options?: ToastOptions) => show('green', 5_000, message, options),
  error: (message: string, options?: ToastOptions) => show('red', 7_000, message, options),
  info: (message: string, options?: ToastOptions) => show('blue', 5_000, message, options),
};

/**
 * Hook flavour of the same surface. It hands back the module-level
 * `toaster` object: the three callbacks close over nothing but the
 * `notifications` import and literal colour/timeout constants — no
 * props, state or refs — so there is nothing per-instance to capture,
 * and returning one stable reference keeps every consumer's effect and
 * callback deps from churning on each render.
 */
export function useToaster() {
  return toaster;
}
