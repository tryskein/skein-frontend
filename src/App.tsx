import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth } from './auth/RequireAuth';
import { VersionCheck } from './components/VersionCheck';
import { LoginPage } from './pages/login';
// sk-674.18 T058 — public: the session is gone once the account is deleted.
import { AccountDeletedPage } from './pages/AccountDeletedPage';
// sk-674.18 T059 — public screens (screens 1.16: opened without signing in).
import { SignupPage } from './pages/SignupPage';
import { InvitePage } from './pages/InvitePage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { ConfirmEmailPage } from './pages/ConfirmEmailPage';

// New UI — the only UI. sk-303.15 removed the legacy /legacy/* tree
// wholesale (no functionality carried over — project/component create
// stayed agent-only via Skein MCP tools; self-service password change
// was rebuilt in the new shell by sk-303.20, see NewPasswordPage below).
import { Shell } from './pages/shell/Shell';
// Route-level header chrome for the pages that don't render HeaderBar
// themselves (Shell and SettingsLayout do). sk-303.15 removed /legacy/*,
// so /activity is the last of them.
import { AppChrome } from './pages/shell/AppChrome';

// sk-41 — new-shell-styled settings pages, mounted at /settings/*.
import { NewPasswordPage } from './pages/settings/new/PasswordPage';
import { NewApiKeysPage } from './pages/settings/new/ApiKeysPage';
import { NewUsersPage } from './pages/settings/new/UsersPage';
// sk-674.18 T057 — the «Spaces» tab and the settings of one space (screens 2.1–2.4, 2.14).
import { SpacesPage } from './pages/settings/new/SpacesPage';
// sk-674.18 T058 — the «Account» tab (screens 2.9, 2.13).
import { AccountPage } from './pages/settings/new/AccountPage';
import { SpaceSettingsPage } from './pages/settings/new/SpaceSettingsPage';
import { NewNotificationsPage } from './pages/settings/new/NotificationsPage';
// sk-10.2 — user-customisable themes.
import { ThemeEditorPage } from './pages/settings/ThemeEditorPage';
// sk-17 — Activity dashboard (throughput matrix + live ticker).
import { ActivityDashboard } from './pages/activity/ActivityDashboard';
// sk-401 — global search across issues, comments, projects, components.
import { SearchPage } from './pages/search/SearchPage';

export default function App() {
  return (
    <>
      {/* Mounted globally — fires on every page, including /login.
       *  Polls /version.json every 60s and shows a sticky update
       *  banner when the deployed version diverges from the one
       *  loaded at page start. */}
      <VersionCheck />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/account-deleted" element={<AccountDeletedPage />} />
        {/* Their addresses with a token are served by nginx with
            `Referrer-Policy: no-referrer` and a CSP of their own
            (`nginx.conf`, the token pages block). */}
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
        <Route path="/confirm-email/:token" element={<ConfirmEmailPage />} />
      <Route element={<RequireAuth />}>
        {/* Same Shell across all mounts; the component reads
            selectedProject / selectedIssue from URL params via
            useLayoutState (F2).
            `/issues/:id` is the cross-project surface variant: details
            panel is shown but Tasks column keeps the cross-project list
            (selectedProject === null). A click in the Queues column
            goes to the project-scoped shape
            `/projects/{alias}/issues/{id}` so the API call has project
            context — and, since sk-405, carries no nav state with it. */}
        <Route path="/" element={<Shell />} />
        <Route path="/issues/:id" element={<Shell />} />
        <Route path="/projects/:alias" element={<Shell />} />
        <Route path="/projects/:alias/issues/:id" element={<Shell />} />
        {/* sk-674.18 T052 — the place «space» (screens 1.7, 1.16):
            `:space` is `<id>-<slug>`, found by the id alone
            (`lib/shellUrlState.ts#parseSpaceHandle`). The Tasks column
            lists every project of the space; an open issue keeps the
            place, as `/projects/:alias/issues/:id` keeps the project. */}
        <Route path="/spaces/:space" element={<Shell />} />
        <Route path="/spaces/:space/issues/:id" element={<Shell />} />
        {/* Component-scoped views — component tree row click drives
            here. The Tasks column applies a `componentId` filter; the
            Details column behaves identically to the alias-scoped
            variants. */}
        <Route
          path="/projects/:alias/components/:cid"
          element={<Shell />}
        />
        <Route
          path="/projects/:alias/components/:cid/issues/:id"
          element={<Shell />}
        />

        <Route path="/settings/account" element={<AccountPage />} />
        <Route path="/settings/password" element={<NewPasswordPage />} />
        <Route path="/settings/spaces" element={<SpacesPage />} />
        <Route path="/settings/spaces/:space" element={<SpaceSettingsPage />} />
        <Route path="/settings/api-keys" element={<NewApiKeysPage />} />
        <Route path="/settings/users" element={<NewUsersPage />} />
        <Route
          path="/settings/notifications"
          element={<NewNotificationsPage />}
        />
        {/* sk-303.13 — the push page is gone: its category switches were a
            second vocabulary of channels, and device management moved beside
            the reason table. The address stays answerable, because links to it
            live in bookmarks and in chat history. */}
        <Route
          path="/settings/push"
          element={<Navigate to="/settings/notifications" replace />}
        />
        <Route path="/settings/theme" element={<ThemeEditorPage />} />

        {/* sk-17 — Activity dashboard. Full-page surface; lives outside
            the Shell because the war-room layout (podium + ticker +
            matrix) does not share the 4-column structure of the main
            board. The header comes from <AppChrome> in `page` scroll
            mode — the page opts the document into native window scroll
            while mounted, so it must not be caged in a 100dvh
            overflow container. (Their side rendered a header inside the
            page instead; that arrangement predates <AppChrome> and is
            the one this redesign replaced.) */}
        <Route element={<AppChrome scroll="page" />}>
          <Route path="/activity" element={<ActivityDashboard />} />
        </Route>

        {/* sk-401 — global search. Under <AppChrome> for the same reason
            as /activity: the page has no header of its own, and it does not fit into the
            shell's column row. Scrolling is `container` (the default): this is
            a list, it needs its own scroll under the header, and the page gestures
            for which /activity takes `page` are not needed here. */}
        <Route element={<AppChrome />}>
          <Route path="/search" element={<SearchPage />} />
        </Route>
      </Route>
      {/* Unknown routes (including the removed /legacy/* tree, sk-303.15)
          fall back to root; RequireAuth then handles auth. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
