import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Group,
  Loader,
  Radio,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, BusinessError } from '../../api/client';
import {
  ME_THEME_QUERY_KEY,
  THEME_PREVIEW_CHANNEL,
  THEMES_QUERY_KEY,
  createTheme,
  getMeTheme,
  getTheme,
  themeQueryKey,
  Theme,
  updateTheme,
  UserThemePref,
} from '../../api/themes';
import {
  defaultVariablesForBase,
  TOKEN_SECTIONS,
  TokenDef,
  TokenSection,
} from '../../lib/themeTokens';
import { migrateThemeVariables } from '../../lib/themeMigration';
import { findPreset } from '../../lib/themePresets';
import { SettingsLayout, SettingsPanel } from './new/SettingsLayout';
import { ERR_ALERT_VARS, INFO_ALERT_VARS } from '../../lib/mantineVariantVars';

/**
 * Theme editor — /settings/theme (sk-10.3 Designer rewrite).
 *
 * Sidebar with 7 UI-zone tabs (Surfaces/Text/Brand/Accents/Search/Geometry/
 * Type) on the left; the active section's token controls on the right. No
 * inline preview pane — the parent window plays that role via the
 * BroadcastChannel `preview/reset` flow.
 *
 * Designer-style highlight (borrowed from a visual design tool):
 * hover/click on a tab posts
 * `{type:'highlight-section', section}` and a per-row hover overrides with
 * `{type:'highlight-tokens', selectors}`. The parent's useTheme hook
 * outlines the matching selectors with a 1px solid #E53935 ring.
 *
 * Query params (unchanged): ?new=1 → fresh draft, no "Save"; ?theme=<id>
 * → edit an existing row; default → seeded from the user's active theme.
 */

interface DraftState {
  /** Editing an existing theme — id is set; otherwise creating new. */
  editingId: string | null;
  name: string;
  base: 'light' | 'dark';
  variables: Record<string, string>;
}

const SECTION_STORAGE_KEY = 'skein.theme-editor.section';

function describeError(err: unknown, fallback: string): string {
  if (err instanceof BusinessError) return err.message;
  if (err instanceof ApiError) return 'internal error — try again';
  if (err instanceof Error) return err.message || fallback;
  return fallback;
}

// Channel publishers — full variables map every time so the receiving
// tab can do an idempotent apply (no diff tracking on the wire).
function broadcastPreview(c: BroadcastChannel, variables: Record<string, string>) {
  c.postMessage({ type: 'preview', variables });
}
function broadcastReset(c: BroadcastChannel) {
  c.postMessage({ type: 'reset' });
}
function broadcastHighlightSection(c: BroadcastChannel, section: string | null) {
  c.postMessage({ type: 'highlight-section', section });
}
function broadcastHighlightTokens(c: BroadcastChannel, selectors: string[]) {
  c.postMessage({ type: 'highlight-tokens', selectors });
}

function readStoredSection(): string {
  try {
    const v = window.localStorage.getItem(SECTION_STORAGE_KEY);
    if (v && TOKEN_SECTIONS.some((s) => s.id === v)) return v;
  } catch {
    /* SSR / private mode — ignore */
  }
  return TOKEN_SECTIONS[0].id;
}

function writeStoredSection(id: string): void {
  try {
    window.localStorage.setItem(SECTION_STORAGE_KEY, id);
  } catch {
    /* private mode / quota — ignore */
  }
}

export function ThemeEditorPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const isNew = searchParams.get('new') === '1';
  const themeIdParam = searchParams.get('theme');

  // Seed source: explicit theme id > current /me/theme > defaults.
  const prefQuery = useQuery<UserThemePref>({
    queryKey: ME_THEME_QUERY_KEY,
    queryFn: getMeTheme,
    staleTime: Infinity,
    retry: false,
  });

  const themeIdToLoad =
    themeIdParam ?? (prefQuery.data?.mode === 'custom' ? prefQuery.data.customThemeId : null);

  const existingThemeQuery = useQuery<Theme>({
    queryKey: themeIdToLoad ? themeQueryKey(themeIdToLoad) : ['theme', 'none'],
    queryFn: () => getTheme(themeIdToLoad!),
    enabled: !!themeIdToLoad && !isNew,
    retry: false,
    staleTime: Infinity,
  });

  // Draft state — initialised once the seed source resolves. We hold
  // `null` until that happens so the controls don't render with empty
  // strings (which would clobber the live theme via the preview channel).
  const [draft, setDraft] = useState<DraftState | null>(null);

  // Build the initial draft state from current prereq queries. Returns
  // `null` when prereqs haven't resolved yet (queries still loading).
  // Pulled out as a named function so onResetToActive can re-seed
  // synchronously without depending on a useEffect re-fire — the seed
  // effect's deps don't change between renders when only `seededRef`
  // flips, so going through setDraft(null) + ref reset is a dead-end
  // (the effect never re-runs, draft stays null forever, spinner hangs).
  const buildSeed = useCallback((): DraftState | null => {
    if (isNew) {
      const base: 'light' | 'dark' = prefQuery.data?.builtinTheme ?? 'light';
      return {
        editingId: null,
        name: '',
        base,
        variables: defaultVariablesForBase(base),
      };
    }
    if (existingThemeQuery.data) {
      const t = existingThemeQuery.data;
      return {
        editingId: t.id,
        name: t.name,
        base: t.base,
        // sk-285.7 T012 — the same function the shell reads through, so
        // the editor shows exactly what the user is looking at.
        //
        // This used to be `{ ...defaultVariablesForBase(t.base),
        // ...t.variables }`: every saved key won, and everything the
        // snapshot lacked came from the builtin. That is a SECOND
        // ownership rule, and after the redesign it is the wrong one —
        // it would keep the pre-redesign names the new dictionary no
        // longer knows, re-seed nothing the redesign is actually made of
        // (the type scale, the density), and leave saved reference
        // values pointing at names nothing declares. One rule, stated
        // once, in `themeMigration.ts`.
        variables: migrateThemeVariables(t.variables, t.base),
      };
    }
    if (!themeIdToLoad && prefQuery.data) {
      const base: 'light' | 'dark' = prefQuery.data.builtinTheme;
      return {
        editingId: null,
        name: '',
        base,
        variables: defaultVariablesForBase(base),
      };
    }
    return null;
  }, [isNew, prefQuery.data, existingThemeQuery.data, themeIdToLoad]);

  // Apply seed when prereq queries land. Run once: if the user starts
  // editing, we don't want subsequent /me/theme refetches to clobber.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    const seed = buildSeed();
    if (seed) {
      setDraft(seed);
      seededRef.current = true;
    }
  }, [buildSeed]);

  // Active section — persisted across editor opens.
  const [activeSection, setActiveSection] = useState<string>(() => readStoredSection());

  useEffect(() => {
    writeStoredSection(activeSection);
  }, [activeSection]);

  // BroadcastChannel — opened once, kept open while the editor lives.
  const channelRef = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const bc = new BroadcastChannel(THEME_PREVIEW_CHANNEL);
    channelRef.current = bc;
    const onBeforeUnload = () => {
      broadcastHighlightSection(bc, null);
      broadcastReset(bc);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      broadcastHighlightSection(bc, null);
      broadcastReset(bc);
      window.removeEventListener('beforeunload', onBeforeUnload);
      bc.close();
      channelRef.current = null;
    };
  }, []);

  // Push the active section's highlight on mount + whenever it changes,
  // so the parent always shows SOMETHING outlined (matching the
  // currently-selected tab) when nothing is hovered. Editors that
  // navigate or unmount clean this up via the unmount effect above.
  useEffect(() => {
    if (!channelRef.current) return;
    broadcastHighlightSection(channelRef.current, activeSection);
  }, [activeSection]);

  // Push the current draft's VARIABLES to the channel whenever they
  // change. (See pre-refactor comment for the userTouchedRef gate.)
  const userTouchedRef = useRef(false);
  useEffect(() => {
    if (!channelRef.current || !draft?.variables) return;
    if (!userTouchedRef.current) return;
    broadcastPreview(channelRef.current, draft.variables);
  }, [draft?.variables]);

  // Mutations (unchanged from previous editor — same backend contract).
  const createMutation = useMutation<Theme, ApiError, void>({
    mutationFn: async () => {
      if (!draft) throw new Error('no draft');
      const name = draft.name.trim();
      if (!name) throw new Error('name required');
      return createTheme({ name, base: draft.base, variables: draft.variables });
    },
    onSuccess: async (created) => {
      queryClient.setQueryData<Theme>(themeQueryKey(created.id), created);
      await queryClient.invalidateQueries({ queryKey: THEMES_QUERY_KEY });
      navigate(`/settings/theme?theme=${created.id}`, { replace: true });
      setDraft((d) => (d ? { ...d, editingId: created.id } : d));
    },
  });

  const updateMutation = useMutation<Theme, ApiError, void>({
    mutationFn: async () => {
      if (!draft || !draft.editingId) throw new Error('no editing id');
      return updateTheme(draft.editingId, {
        name: draft.name.trim(),
        base: draft.base,
        variables: draft.variables,
      });
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<Theme>(themeQueryKey(updated.id), updated);
      return queryClient.invalidateQueries({ queryKey: THEMES_QUERY_KEY });
    },
  });

  const onChangeVar = useCallback((key: string, value: string) => {
    userTouchedRef.current = true;
    setDraft((d) => (d ? { ...d, variables: { ...d.variables, [key]: value } } : d));
  }, []);

  const onChangeBase = useCallback((next: 'light' | 'dark') => {
    setDraft((d) => (d ? { ...d, base: next } : d));
  }, []);

  const onResetToActive = useCallback(() => {
    const seed = buildSeed();
    if (!seed) return;
    // Synchronous re-seed — don't rely on the useEffect (its deps haven't
    // changed since first seed, so it wouldn't refire even if we cleared
    // seededRef + draft). Also flip userTouchedRef back to false so the
    // preview-broadcast effect doesn't re-broadcast the (now-clean) seed
    // values right after we send the explicit reset below.
    setDraft(seed);
    userTouchedRef.current = false;
    // Tell the parent window to drop any preview overrides and re-apply
    // its currently-active theme. Without this the parent stays painted
    // with whatever the last preview message looked like — visually the
    // editor "Reset" wouldn't appear to do anything in the main tab.
    if (channelRef.current) broadcastReset(channelRef.current);
  }, [buildSeed]);

  const onDiscard = useCallback(() => {
    if (channelRef.current) {
      broadcastHighlightSection(channelRef.current, null);
      broadcastReset(channelRef.current);
    }
    window.close();
  }, []);

  // Section hover handlers — defined here so the JSX stays declarative.
  const onHoverSection = useCallback((id: string | null) => {
    if (!channelRef.current) return;
    // null on leave → fall back to the currently-active section so
    // the ring never blinks blank between hovering one tab and the next.
    broadcastHighlightSection(channelRef.current, id ?? activeSection);
  }, [activeSection]);

  const onHoverToken = useCallback((selectors: string[] | undefined) => {
    if (!channelRef.current) return;
    if (selectors && selectors.length > 0) {
      broadcastHighlightTokens(channelRef.current, selectors);
    } else {
      // No per-token selectors → fall back to section highlight.
      broadcastHighlightSection(channelRef.current, activeSection);
    }
  }, [activeSection]);

  const onLeaveToken = useCallback(() => {
    if (!channelRef.current) return;
    broadcastHighlightSection(channelRef.current, activeSection);
  }, [activeSection]);

  const createError = createMutation.error
    ? describeError(createMutation.error, 'failed to save')
    : null;
  const updateError = updateMutation.error
    ? describeError(updateMutation.error, 'failed to save')
    : null;
  const seedError = existingThemeQuery.error
    ? describeError(existingThemeQuery.error, 'failed to load theme')
    : null;

  if (!draft) {
    return (
      <SettingsLayout active="theme">
        <SettingsPanel title="Theme editor">
          <div className="settings-loading" style={{ padding: 16 }}>
            <Loader size="sm" />
          </div>
          {seedError ? (
            <Alert variant="light" style={ERR_ALERT_VARS} title="Failed to load theme">
              {seedError}
            </Alert>
          ) : null}
        </SettingsPanel>
      </SettingsLayout>
    );
  }

  const isForkedFromBuiltin = !draft.editingId && !isNew;
  const section = TOKEN_SECTIONS.find((s) => s.id === activeSection) ?? TOKEN_SECTIONS[0];

  return (
    <SettingsLayout active="theme">
      <SettingsPanel
        title={
          draft.editingId
            ? `Edit "${draft.name || 'theme'}"`
            : isForkedFromBuiltin
            ? 'Customise built-in theme'
            : 'New theme'
        }
        description={
          'Hover any section or row — the parent window outlines the matching UI. Open Skein in another window to see live colour previews as you type.'
        }
      >
        {isForkedFromBuiltin ? (
          <Alert
            variant="light"
            style={INFO_ALERT_VARS}
            title="Built-in themes can't be edited directly"
          >
            You opened the editor while using a built-in Solarized theme.
            Built-in themes (Light and Dark) are read-only — they ship with
            the app and can't be modified. To keep your changes, give the
            theme a <strong>name</strong> below and click{' '}
            <strong>Save as new</strong>. It will appear in the right-click
            menu on the theme toggle and can be edited freely from there.
          </Alert>
        ) : null}

        <Group align="flex-end" gap="md" wrap="wrap">
          <TextInput
            label="Name"
            placeholder="Solarized Cobalt"
            value={draft.name}
            onChange={(e) => {
              const nextName = e.currentTarget.value;
              setDraft((d) => (d ? { ...d, name: nextName } : d));
            }}
            maxLength={100}
            style={{ flexGrow: 1, minWidth: 200 }}
          />
          <Radio.Group
            label="Base"
            value={draft.base}
            onChange={(v) => onChangeBase(v as 'light' | 'dark')}
          >
            <Group gap="md">
              <Radio value="light" label="Light" />
              <Radio value="dark" label="Dark" />
            </Group>
          </Radio.Group>
          {/* sk-408 (1) — the row's actions. `theme-editor-actions` puts
            * them on §6's field band (44) so they finish flush with the
            * «Name» field beside them; before it they were 30 against the
            * field's 44. `size="sm"` rather than `"xs"` for the LABEL, not
            * the box: xs draws 12px text and the field sets its own text
            * at 14, so the band alone would have left a 44px button with
            * caption-sized type in it. */}
          <Group gap="sm" className="theme-editor-actions">
            <Button
              variant="filled"
              onClick={() => createMutation.mutate()}
              loading={createMutation.isPending}
              disabled={!draft.name.trim()}
              size="sm"
            >
              Save as new
            </Button>
            {draft.editingId ? (
              <Button
                variant="default"
                onClick={() => updateMutation.mutate()}
                loading={updateMutation.isPending}
                disabled={!draft.name.trim()}
                size="sm"
              >
                Save
              </Button>
            ) : null}
            <Button variant="default" onClick={onResetToActive} size="sm">
              Reset
            </Button>
            <Button variant="subtle" color="gray" onClick={onDiscard} size="sm">
              Close
            </Button>
          </Group>
        </Group>

        {createError ? (
          <Alert variant="light" style={ERR_ALERT_VARS} title="Failed to create theme">
            {createError}
          </Alert>
        ) : null}
        {updateError ? (
          <Alert variant="light" style={ERR_ALERT_VARS} title="Failed to save theme">
            {updateError}
          </Alert>
        ) : null}
      </SettingsPanel>

      <div className="theme-editor-shell">
        <nav
          className="theme-editor-sidebar"
          aria-label="Theme sections"
          // Leaving the sidebar entirely → fall back to active section.
          onMouseLeave={() => onHoverSection(null)}
        >
          {TOKEN_SECTIONS.map((s) => {
            const isActive = s.id === activeSection;
            return (
              <button
                key={s.id}
                type="button"
                className={`theme-editor-tab${isActive ? ' active' : ''}`}
                onMouseEnter={() => onHoverSection(s.id)}
                onFocus={() => onHoverSection(s.id)}
                onClick={() => {
                  setActiveSection(s.id);
                  onHoverSection(s.id);
                }}
                // aria-current="true" (not "page"): the editor tabs
                // don't change the URL, they swap the right-hand pane.
                // ARIA's "page" value is reserved for navigation links
                // that point at the current page — the neutral "true"
                // value is the right idiom for "this control is the
                // currently-selected one of a set".
                aria-current={isActive ? 'true' : undefined}
              >
                {s.label}
              </button>
            );
          })}
        </nav>
        <div className="theme-editor-pane">
          <div className="theme-editor-pane-header">
            <h2 className="theme-editor-pane-title">{section.label}</h2>
            <p className="theme-editor-pane-description">{section.description}</p>
          </div>
          <Stack gap="xs">
            {section.tokens.map((tok) => (
              <TokenControl
                key={tok.key}
                token={tok}
                value={draft.variables[tok.key] ?? ''}
                onChange={onChangeVar}
                onHover={onHoverToken}
                onLeave={onLeaveToken}
              />
            ))}
          </Stack>
        </div>
      </div>

      <Text size="xs" c="dimmed">
        Tip: open Skein in another browser tab and switch back to the editor —
        every change you make here paints that tab in real time, and hovering a
        section or row outlines the affected UI elements there. Closing this
        window restores the active theme.
      </Text>
    </SettingsLayout>
  );
}

interface TokenControlProps {
  token: TokenDef;
  value: string;
  onChange: (key: string, value: string) => void;
  onHover: (selectors: string[] | undefined) => void;
  onLeave: () => void;
}

// Color tokens get a swatch + text field (the picker can only emit hex,
// so the text field is canonical). Hover/focus broadcasts per-token
// selectors, falling back to section selectors when the token has none.
//
// Font tokens (`presets` set) layer a `<Select>` of curated stacks on
// top of the text input. Picking a preset overwrites the text field
// with the preset's full stack; the text field stays visible and
// editable so the user can always type a custom font stack. When the
// current value doesn't match any preset, the Select shows "Custom"
// — purely cosmetic; the text input remains canonical.
function TokenControl({ token, value, onChange, onHover, onLeave }: TokenControlProps) {
  const isHex = /^#[0-9a-fA-F]{6}$/.test(value);
  // Stable identity for the selectors array we hand to onHover — avoids
  // re-broadcasting on every render when the same row is still hovered.
  const selectors = useMemo(() => token.selectors, [token.selectors]);

  // Resolve the active preset (if any) for font tokens. Exact-match on
  // the full stack string — same gate the apply-time font loader uses,
  // so what the Select highlights is exactly what the loader will
  // recognise as "Google-hosted, load it".
  const matchedPreset = useMemo(
    () => (token.presets ? findPreset(value, token.presets) : null),
    [token.presets, value],
  );

  const CUSTOM_OPTION = 'custom';
  const presetData = useMemo(() => {
    if (!token.presets) return null;
    return [
      ...token.presets.map((p) => ({ value: p.id, label: p.label })),
      { value: CUSTOM_OPTION, label: 'Custom (type below)' },
    ];
  }, [token.presets]);

  const onPresetChange = useCallback(
    (presetId: string | null) => {
      if (!token.presets || !presetId || presetId === CUSTOM_OPTION) {
        // No-op — keep the existing custom value; the user can keep
        // editing in the text input below.
        return;
      }
      const p = token.presets.find((x) => x.id === presetId);
      if (!p) return;
      onChange(token.key, p.stack);
    },
    [token.presets, token.key, onChange],
  );

  return (
    <div
      className="theme-editor-row"
      onMouseEnter={() => onHover(selectors)}
      onMouseLeave={onLeave}
      onFocus={() => onHover(selectors)}
      onBlur={onLeave}
    >
      <label className="theme-editor-row-label" htmlFor={`tok-${token.key}`}>
        <code>{token.key}</code>
        <span className="theme-editor-row-meta">{token.label}</span>
      </label>
      <div className="theme-editor-row-controls">
        {token.kind === 'color' ? (
          <input
            type="color"
            value={isHex ? value : '#000000'}
            onChange={(e) => onChange(token.key, e.currentTarget.value)}
            className="theme-editor-color-swatch"
            aria-label={`${token.label} colour picker`}
            // The native colour picker only emits / accepts hex. When
            // the canonical value is rgba() / hsl() / a named colour,
            // surface that constraint by disabling the picker entirely
            // (a no-op `value="#000000"` would silently lose info on
            // edit) and pointing AT it to the visible sibling hint
            // below via aria-describedby. The disabled style + the
            // hint together replace the old `title=` tooltip, which
            // was both inaccessible (hover-only) and silently lying
            // about the value the picker would emit.
            disabled={!isHex}
            aria-describedby={isHex ? undefined : `${token.key}-rgba-hint`}
          />
        ) : null}
        {presetData ? (
          <Select
            data={presetData}
            value={matchedPreset?.id ?? CUSTOM_OPTION}
            onChange={onPresetChange}
            size="xs"
            allowDeselect={false}
            comboboxProps={{ withinPortal: true }}
            aria-label={`${token.label} preset picker`}
            style={{ width: 200, flex: '0 0 auto' }}
          />
        ) : null}
        <input
          id={`tok-${token.key}`}
          type="text"
          value={value}
          onChange={(e) => onChange(token.key, e.currentTarget.value)}
          className="theme-editor-text-input"
          spellCheck={false}
          autoComplete="off"
        />
      </div>
      {token.hint ? <p className="theme-editor-row-hint">{token.hint}</p> : null}
      {token.kind === 'color' && !isHex ? (
        <p
          id={`${token.key}-rgba-hint`}
          className="theme-editor-row-hint"
        >
          Picker accepts only hex — edit rgba / hsl / named values in the text field.
        </p>
      ) : null}
    </div>
  );
}

export type { TokenSection };
