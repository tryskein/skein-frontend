import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClientProvider } from '@tanstack/react-query';
import { createAppQueryClient } from './lib/appQueryClient';
import { installMotionIdle } from './lib/motionIdle';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './auth/AuthContext';
import { ConnectionStatus } from './components/ConnectionStatus';
import { DensitySync } from './components/DensitySync';
import { NavLayoutSync } from './components/NavLayoutSync';
import { ThemeSync } from './components/ThemeSync';
import { LiveEventsProvider } from './hooks/useLiveEvents';
import { skeinTheme } from './theme';
// i18n (sk-285.1.17) — importing initialises the shared i18next instance
// as a side effect. Must run BEFORE the first render so the very first
// paint is already in the user's language (no English flash).
import i18n from './i18n/config';
import { I18nextProvider } from 'react-i18next';

// Geist / Geist Mono (sk-285.7 T001, FR-001) — the redesign's default
// `--font-ui` / `--font-mono` pair. Bundled via @fontsource for the same
// reason as Inter below: the privacy policy for font sources is "external
// source only on an explicit user choice", so the DEFAULT font must not
// add a network request. Weights 400/500/600/700 = regular / medium /
// semibold / bold, the four the stylesheet and Mantine actually use.
//
// Package choice: `@fontsource/geist`, NOT `@fontsource/geist-sans`.
// Both exist at 5.3.0, but they are different uploads of the font and
// only one of them fits:
//   - `@fontsource/geist`      → family 'Geist',      subsets
//     latin/latin-ext/cyrillic/cyrillic-ext/vietnamese (metadata.json,
//     upstream google/fonts, v5);
//   - `@fontsource/geist-sans` → family 'Geist Sans', subset ["latin"]
//     ONLY (Vercel's 2023 v1.0.1 upload).
// `design/fable/handoff/tokens.css` declares `--font-ui: 'Geist',
// system-ui, sans-serif` — the family name has to match byte-for-byte or
// the @font-face never wins — and the UI ships a Russian locale
// (`src/i18n/config.ts`), plus user content is largely Cyrillic, which a
// latin-only face would silently drop to the system stack.
import '@fontsource/geist/400.css';
import '@fontsource/geist/500.css';
import '@fontsource/geist/600.css';
import '@fontsource/geist/700.css';

import '@fontsource/geist-mono/400.css';
import '@fontsource/geist-mono/500.css';
import '@fontsource/geist-mono/600.css';
import '@fontsource/geist-mono/700.css';

// Inter — kept as a preset (FR-001: "the previous pair remains a
// preset"), still the default `--font-ui` stack until T006 flips the
// registry. Bundled via @fontsource so we don't depend on a CDN that
// might be blocked or slow on first paint.
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';

// JetBrains Mono — the previous `--font-mono` pair member, kept as a
// preset for the same reason. Bundled for the same reason as Inter.
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/jetbrains-mono/700.css';

import '@mantine/core/styles.css';
// Notifications stylesheet must follow @mantine/core/styles.css so the
// cascade ordering keeps notification-specific overrides on top.
import '@mantine/notifications/styles.css';
// Ember palette (orange, --skein-* tokens) for the handful of shared
// components still styled on it — TerminalFrame, ErrorFrame,
// AttachmentDropzone/List, UserMention, the login page (sk-303.15
// removed the /legacy/* route tree that used to be its main consumer;
// see src/legacy.css's header comment). Imported FIRST so the new
// design system (index.css) can override conflicting selectors like
// `.skein-highlight b`, which this file paints orange but the new
// shell expects to be yellow.
import './legacy.css';
// New design system tokens (the Stage 2.2 role dictionary) — drives
// both light and dark.
// Must follow legacy.css so that overlapping selectors win in the new
// shell.
import './index.css';

// Single QueryClient for the app. Auth state lives here too, so the
// instance must outlive any route transitions — created at module scope.
// The 401 → sign-out wiring lives in lib/appQueryClient so it can be
// tested without mounting the whole app.
const queryClient = createAppQueryClient();

// sk-551.36 — pause the ringing-alarm animations while nobody is looking
// (hidden tab or unfocused window). Once, before the first render; see
// lib/motionIdle.ts.
installMotionIdle();
/**
 * sk-285.1.15 — keep Mantine's colour scheme in step with ours.
 *
 * The app's theme lives on `<html data-theme>`; Mantine's lives on
 * `<html data-mantine-color-scheme>` and defaults to `light`. They were
 * never connected, so under the dark theme every Mantine-owned surface
 * kept painting its LIGHT rules — a white drawer, white modals, white
 * combobox dropdowns and white inputs inside an otherwise dark app.
 * Roughly 140 rules in @mantine/core/styles.css key off that attribute
 * directly (`[data-mantine-color-scheme='light'] .m_…`), so no amount of
 * variable rebinding reaches them: the scheme itself has to be right.
 *
 * The colours those dark rules resolve to are OURS, not Mantine's greys
 * — `index.css` rebinds `--mantine-color-dark-*` (and the surface / text
 * variables) to our own role tokens under `[data-theme='dark']`.
 *
 * `data-theme` is the single source of truth here, and `useTheme` /
 * `theme-boot.js` are its only writers, so this hook just mirrors them.
 * A custom skin sets `data-theme="custom"` plus an inline `color-scheme`
 * (useTheme does that for the native controls) — that is what tells us
 * whether a custom skin is a dark one.
 */
function readColorScheme(): 'light' | 'dark' {
  const el = document.documentElement;
  const theme = el.getAttribute('data-theme');
  if (theme === 'dark') return 'dark';
  if (theme === 'light') return 'light';
  return el.style.colorScheme === 'dark' ? 'dark' : 'light';
}

function useAppColorScheme(): 'light' | 'dark' {
  const [scheme, setScheme] = useState<'light' | 'dark'>(readColorScheme);
  useEffect(() => {
    // Mantine writes `data-mantine-color-scheme` on the same element; the
    // filter keeps that write from re-entering this observer.
    const observer = new MutationObserver(() => setScheme(readColorScheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'style'],
    });
    setScheme(readColorScheme());
    return () => observer.disconnect();
  }, []);
  return scheme;
}

function Root() {
  const colorScheme = useAppColorScheme();
  return (
    <MantineProvider theme={skeinTheme} forceColorScheme={colorScheme}>
      {/* Bottom-left, max 3 stacked. Default 5s auto-close — per-toast
          overrides in `Toaster.tsx` (errors hold longer). Mount inside
          MantineProvider so the notifications inherit the active theme
          (CSS-in-JS variables for shades). */}
      <Notifications position="bottom-left" autoClose={5_000} limit={3} />
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            {/* Reconcile <html data-theme> with the server preference as
                soon as the app boots (and again whenever the signed-in
                identity changes). Without this the only mount of
                `useTheme` in the shell was the one inside <ThemeToggle>,
                which lives in the account-menu dropdown — so the stored
                theme landed the first time the user clicked their
                avatar, and read as "the avatar toggles the theme".
                See ThemeSync.tsx. */}
            <ThemeSync />
            {/* sk-551.7 — the same job for <html data-density>. */}
            <DensitySync />
            {/* sk-551.8 — this browser's copy of the left-panel layout,
                read before the profile answers (INV-10). */}
            <NavLayoutSync />
            <LiveEventsProvider>
              <ConnectionStatus />
              <App />
            </LiveEventsProvider>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <Root />
    </I18nextProvider>
  </StrictMode>,
);
