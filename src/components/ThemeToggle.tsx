import { useState } from 'react';
import { Menu } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import {
  IconMoon,
  IconPlus,
  IconSettings,
  IconSun,
  IconTrash,
} from '@tabler/icons-react';
import { SkeinTooltip } from './SkeinTooltip';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import {
  ME_THEME_QUERY_KEY,
  THEMES_QUERY_KEY,
  deleteTheme,
  listThemes,
  Theme,
} from '../api/themes';
import { useTheme } from '../lib/useTheme';
import { ConfirmDialog } from './ConfirmDialog';

/**
 * Theme switcher — a SEGMENT in the account menu's Appearance row.
 *
 *   Click a segment → select that built-in directly. If the user was on
 *                 a custom theme, this also exits custom mode (the PUT
 *                 /me/theme call uses mode='builtin').
 *   Right-click  → opens a Mantine Menu listing every saved custom theme,
 *                 split into "My themes" / "Team themes", plus quick
 *                 links to the editor.
 *
 * sk-285.7.11 (AM3) — it used to be ONE icon that flipped, which is a
 * different control from the one the design draws: §6 "segment
 * Light/Dark/System", artboard `#2c` a three-cell track. A flip button
 * states the theme you are NOT in and hides the set of choices; a segment
 * shows the whole set and marks the current member. The two cells here
 * ARE the whole set the app has: the stored preference is
 * `{mode: builtin|custom, builtinTheme: light|dark}` (see `useTheme`),
 * with no third value a "System" cell could be persisted as. Faking it in
 * localStorage would give the theme a second source of truth beside the
 * server; the honest shape is the two states that exist.
 *
 * sk-285.7.19 — a third cell WAS built (sk-383: its own server column,
 * `matchMedia` as an external store, a write-back for the resolved
 * palette) and was withdrawn whole, both halves in one
 * pass. Not because it misbehaved: the deployed API does not carry the
 * column, and a front end that only works against an API of the same
 * minute was not the intended trade. Re-adding the cell means
 * re-adding the server half first — the two are one feature, and this
 * comment exists so the next reader does not mistake the gap for an
 * oversight.
 *
 * The Menu opens both on right-click (via onContextMenu/preventDefault)
 * AND when the user presses the keyboard context-menu key on the focused
 * track (handled by Mantine via aria-haspopup="menu").
 */

/**
 * Open the theme editor in a small companion popup window (not a tab).
 *
 * The popup is same-origin so the BroadcastChannel-driven live preview
 * keeps working — every change in the editor paints the parent window
 * in real time. The named target ("skein-theme-editor") means a second
 * click reuses the existing popup instead of opening a new one. The
 * popup-style features (width/height) hint to the browser that this is
 * chrome-light UI; modern browsers may still fold it into a tab when
 * the user disables popups globally, in which case we get a tab — not
 * fatal, the editor still works.
 */
function openEditorWindow(path: string): void {
  // sk-10.3 — companion popup is now compact (720×640). The right pane
  // used to host a preview surface; that role moved to the PARENT window
  // (live BroadcastChannel preview + Designer-style highlight rings) so
  // the editor only needs room for a sidebar of section tabs and a
  // single column of token controls.
  const features = [
    'popup=yes',
    'width=720',
    'height=640',
    'left=' + Math.max(0, Math.round((window.screen.availWidth - 720) / 2)),
    'top=' + Math.max(0, Math.round((window.screen.availHeight - 640) / 2)),
    'resizable=yes',
    'scrollbars=yes',
  ].join(',');
  const w = window.open(path, 'skein-theme-editor', features);
  // If the browser blocked the popup, fall back to opening a tab so
  // the user isn't left wondering what happened. `null` from
  // `window.open` means a popup blocker intervened.
  if (!w) window.open(path, '_blank', 'noopener,noreferrer');
}

export function ThemeToggle() {
  const { t } = useTranslation('chrome');
  const { user } = useAuth();
  const { theme, active, setBuiltin, setCustomTheme } = useTheme();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Theme | null>(null);

  // Lazy-load the catalog only when the menu is opened — most sessions
  // never right-click the toggle, so we avoid the GET on every page.
  const themesQuery = useQuery<Theme[]>({
    queryKey: THEMES_QUERY_KEY,
    queryFn: listThemes,
    enabled: menuOpen && !!user,
    staleTime: 60_000,
  });

  const deleteMutation = useMutation<void, Error, string>({
    mutationFn: (id) => deleteTheme(id),
    onSuccess: () => {
      setConfirmDelete(null);
      // Refetch the catalog AND the user pref — the server-side cascade
      // sets customThemeId=null on the active user when their theme is
      // deleted, and useTheme reads /me/theme via that cache key.
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: THEMES_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ME_THEME_QUERY_KEY }),
      ]);
    },
  });

  const themes = themesQuery.data ?? [];
  // Partition into "mine" (current user's authored themes) vs everyone
  // else's. The backend's createdBy.id is a UUID, so we compare against
  // user.id from the auth context.
  const myThemes: Theme[] = user ? themes.filter((t) => t.createdBy.id === user.id) : [];
  // When `user` is null the query is gated off (`enabled: !!user`), so
  // this fallback is defensive only — but it must be `[]` rather than
  // `themes`. Returning every theme under "Team themes" for an
  // unauthenticated caller is wrong-by-design (no caller, no notion of
  // "team"). Lock the predicate down so a future loosening of the gate
  // can't leak themes pre-auth.
  const teamThemes: Theme[] = user ? themes.filter((t) => t.createdBy.id !== user.id) : [];

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenuOpen(true);
  };

  /**
   * One cell of the track. `aria-pressed` (not `aria-checked`) because
   * the pair is a toggle-button group, the same ARIA the header's view
   * segment and the race chart's chip rows already use — one pattern for
   * every segment in the app.
   *
   * Clicking the cell that is already on is a no-op rather than a
   * re-PUT: a segment answers "which one", and re-asserting the current
   * answer is not a change.
   */
  const cell = (mode: 'light' | 'dark', label: string, icon: JSX.Element) => {
    const on = theme === mode;
    return (
      <SkeinTooltip content={label} position="bottom">
        <button
          type="button"
          className={`theme-segment-cell${on ? ' active' : ''}`}
          aria-label={label}
          aria-pressed={on}
          onClick={(e) => {
            // Mantine's Menu shares this subtree as its target and would
            // claim the click; the segment owns left-click.
            e.stopPropagation();
            if (menuOpen) {
              setMenuOpen(false);
              return;
            }
            if (on) return;
            setBuiltin(mode);
          }}
        >
          {icon}
        </button>
      </SkeinTooltip>
    );
  };

  return (
    <>
      <Menu
        opened={menuOpen}
        onChange={setMenuOpen}
        position="bottom-end"
        offset={4}
        withinPortal
        // Controlled — we open the menu only on right-click (via the
        // onContextMenu handler on the track below). Left-click stays a
        // pure selection. Mantine still wants a trigger prop; "click" is
        // the safe default and our stopPropagation in each cell's
        // onClick prevents it from re-opening on left-click.
        trigger="click"
        closeOnClickOutside
        closeOnItemClick={true}
      >
        <Menu.Target>
          {/* The TRACK is the menu target, not either cell: right-click
              anywhere on the segment (including the gap between cells)
              opens the saved-themes menu, which is what the hint beside
              it promises. `aria-haspopup` sits here for the same reason —
              it describes the track's secondary gesture, not a cell's. */}
          <div
            className="theme-segment"
            role="group"
            aria-label={t('theme.group')}
            aria-haspopup="menu"
            onContextMenu={onContextMenu}
          >
            {cell('light', t('theme.light'), <IconSun size={20} stroke={1.75} aria-hidden />)}
            {cell('dark', t('theme.dark'), <IconMoon size={20} stroke={1.75} aria-hidden />)}
          </div>
        </Menu.Target>
        <Menu.Dropdown>
          {themesQuery.isLoading ? (
            <Menu.Label>{t('theme.loading')}</Menu.Label>
          ) : null}

          {myThemes.length > 0 ? (
            <>
              <Menu.Label>{t('theme.myThemes')}</Menu.Label>
              {myThemes.map((t) => (
                <ThemeMenuItem
                  key={t.id}
                  theme={t}
                  isActive={active.mode === 'custom' && active.customThemeId === t.id}
                  onPick={() => setCustomTheme(t.id)}
                  onDelete={() => setConfirmDelete(t)}
                  canDelete
                />
              ))}
            </>
          ) : null}

          {teamThemes.length > 0 ? (
            <>
              <Menu.Label>{t('theme.teamThemes')}</Menu.Label>
              {teamThemes.map((t) => (
                <ThemeMenuItem
                  key={t.id}
                  theme={t}
                  isActive={active.mode === 'custom' && active.customThemeId === t.id}
                  onPick={() => setCustomTheme(t.id)}
                  onDelete={() => setConfirmDelete(t)}
                  // Owners can delete their own themes; admins can delete
                  // anyone's. Backend enforces — we just hide the icon
                  // for the common case so the UI doesn't look broken.
                  canDelete={user?.role === 'admin'}
                />
              ))}
            </>
          ) : null}

          {(myThemes.length > 0 || teamThemes.length > 0) ? <Menu.Divider /> : null}

          <Menu.Item
            onClick={() =>
              openEditorWindow(
                active.mode === 'custom' && active.customThemeId
                  ? `/settings/theme?theme=${active.customThemeId}`
                  : '/settings/theme',
              )
            }
            leftSection={<IconSettings size={20} />}
          >
            {t('theme.openEditor')}
          </Menu.Item>
          <Menu.Item
            onClick={() => openEditorWindow('/settings/theme?new=1')}
            leftSection={<IconPlus size={20} />}
          >
            {t('theme.createNew')}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>

      <ConfirmDialog
        opened={!!confirmDelete}
        title="Delete theme"
        message={
          confirmDelete
            ? `Delete "${confirmDelete.name}"? Anyone currently using it will fall back to the built-in ${confirmDelete.base} theme.`
            : ''
        }
        loading={deleteMutation.isPending}
        danger
        onConfirm={() => {
          if (confirmDelete) deleteMutation.mutate(confirmDelete.id);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </>
  );
}

interface ThemeMenuItemProps {
  theme: Theme;
  isActive: boolean;
  onPick: () => void;
  onDelete: () => void;
  canDelete: boolean;
}

function ThemeMenuItem({ theme, isActive, onPick, onDelete, canDelete }: ThemeMenuItemProps) {
  const baseIcon = theme.base === 'dark' ? <IconMoon size={16} /> : <IconSun size={16} />;

  return (
    <Menu.Item
      onClick={onPick}
      leftSection={baseIcon}
      rightSection={
        canDelete ? (
          // sk-285.1.12 — 44×44 hit area (WCAG 2.5.5 AAA), up from the
          // old 24×24 minimum. The visible glyph stays 14px so it does
          // not dominate the row; the box around it is what grew. It is
          // the menu row's rightSection, i.e. a flow box inside the
          // item — the only thing it can sit next to is the item's own
          // click surface, and Mantine lays the two out side by side,
          // so the hit areas cannot overlap.
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            aria-label={`Delete theme ${theme.name}`}
            title={`Delete theme ${theme.name}`}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 5,
              cursor: 'pointer',
              color: 'var(--ink-2)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 'var(--tap-target)',
              height: 'var(--tap-target)',
            }}
          >
            <IconTrash size={20} />
          </button>
        ) : null
      }
      style={isActive ? { fontWeight: 600, color: 'var(--primary)' } : undefined}
    >
      {theme.name}
    </Menu.Item>
  );
}
