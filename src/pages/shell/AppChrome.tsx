import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LayoutProvider } from '../../lib/useLayoutState';
import { TasksUiStateProvider } from '../../lib/useTasksUiState';
import { HeaderBar } from './HeaderBar';

/**
 * AppChrome — route-level wrapper that puts the HeaderBar on the pages
 * that are NOT the Shell and NOT Settings (which render it themselves):
 * the whole `/legacy/*` surface and `/activity`.
 *
 * The header is the app's only global navigation — brand, the four
 * queue badges, the lens toggles, HOT ZONE, Inspect and the account
 * menu. A page without it is a dead end: the user has to hit Back or
 * retype a URL to get anywhere. Mounting it here instead of editing
 * seventeen legacy page components keeps those files untouched (they
 * are frozen verbatim under `/legacy/*`) and guarantees a page can
 * never be added to the group without chrome.
 *
 * `HeaderBar` reads `useLayoutState` (queue counts, queue selection,
 * lens toggles), which lives in `<LayoutProvider>`. The Shell mounts
 * its own; these pages are outside it, so the provider stack is
 * repeated here exactly as `SettingsLayout` does it.
 * `TasksUiStateProvider` rides along for descendants that read the
 * persisted task filters.
 *
 * NOT sticky, deliberately: `.header-bar` stays a normal in-flow
 * `flex: 0 0 auto` row. Presence is the requirement, not pinning.
 *
 * Two scroll models, because the two surfaces genuinely differ:
 *
 *  - `scroll="container"` (default, used by `/legacy/*`): the wrapper
 *    is a 100dvh flex column and the body below the header is the
 *    scroll container. The global `html, body { overflow: hidden }`
 *    rule — load-bearing for the Shell's per-column scrolling — means
 *    a plain in-flow page cannot scroll at all, so anything past the
 *    fold is simply clipped. Giving the body its own scroller is what
 *    makes a legacy page reachable below the fold at all.
 *  - `scroll="page"` (used by `/activity`): no height cage. That page
 *    opts the document into native window scroll for the duration of
 *    its mount (`body[data-allow-page-scroll]`, see its own effect and
 *    the matching rule in index.css) precisely so mobile pull-to-
 *    refresh and system gestures keep working. Wrapping it in a
 *    fixed-height overflow cage would take that back.
 */
export interface AppChromeProps {
  scroll?: 'container' | 'page';
}

export function AppChrome({ scroll = 'container' }: AppChromeProps) {
  const { t } = useTranslation('shell');

  return (
    <LayoutProvider>
      <TasksUiStateProvider>
        <div className={`app-chrome-root app-chrome-${scroll}`}>
          {/* WCAG 2.4.1 Bypass Blocks — same affordance as Shell.tsx
              and SettingsLayout: the header is ~10 tab stops deep. */}
          <a className="sr-only-focusable" href="#main-content">
            {t('skipToContent')}
          </a>
          <HeaderBar />
          {/* `id` lands on the wrapper rather than on the page's own
              root because the pages under here are frozen legacy
              components — none of them carries the anchor. */}
          <div id="main-content" className="app-chrome-body">
            <Outlet />
          </div>
        </div>
      </TasksUiStateProvider>
    </LayoutProvider>
  );
}
