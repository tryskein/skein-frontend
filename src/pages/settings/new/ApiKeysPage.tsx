import { useEffect, useMemo, useRef, useState } from 'react';
import { IconPlus } from '@tabler/icons-react';
import {
  Alert,
  Anchor,
  Box,
  Button,
  Checkbox,
  Group,
  Loader,
  Radio,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useAuth } from '../../../auth/AuthContext';
import { ApiError, BusinessError } from '../../../api/client';
import {
  ApiKey,
  ApiKeyCreateResponse,
  ApiKeyLevel,
  ApiKeyPermissions,
  ApiKeyScope,
  ApiKeyScopeInput,
  ApiKeyScopeMode,
  ApiKeysSettings,
  createApiKey,
  CreateApiKeyInput,
  getApiKeysSettings,
  listApiKeys,
  narrowApiKey,
  NarrowApiKeyInput,
  reissueApiKey,
  revokeApiKey,
} from '../../../api/api-keys';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { SecretReveal } from '../../../components/SecretReveal';
import { SettingsLayout, SettingsPanel } from './SettingsLayout';
import { resolveMcpUrl } from '../../../lib/mcpUrl';
import { ERR_ALERT_VARS } from '../../../lib/mantineVariantVars';
import { useAuthConfig } from '../../../lib/useAuthConfig';
import { useMySpaces } from '../../../lib/useMySpaces';
import { useProjectsList } from '../../../lib/useProjectsList';

/**
 * /settings/api-keys — the owner's API keys (US-10), in the new-shell
 * aesthetic (sk-41).
 *
 *  1. "Connection": the MCP `.mcp.json` snippet with a Copy button
 *     (sk-674.18 T058, screens 1.14, K2).
 *  2. "Public API": whether this instance serves the public API and where —
 *     its address and the `openapi.json` link, both from GET
 *     `/me/api-keys/settings`. Three states: turned off, on without an
 *     address, on with one.
 *  3. "Your keys": the create form (name, permissions by preset or by
 *     level with the `admin` flag, scope, lifetime), the list (prefix,
 *     created, expiry as a date and the time left, last use, status with
 *     its reason, permissions with the part the owner no longer holds,
 *     scope), and per key: narrow in place, reissue, revoke. A secret —
 *     of a new or a reissued key — is shown once, in SecretReveal.
 *
 * Widening never happens in place: the narrow form offers only the
 * current grant and what lies inside it, and says that a wider grant
 * needs a new key. The server refuses a widening anyway (422
 * `invalid_grant`, rule `not_narrowing`).
 */

/** Rank of a level: `read` ⊂ `write` ⊂ `manage`; no level ranks lowest. */
const LEVELS: ApiKeyLevel[] = ['read', 'write', 'manage'];

function levelRank(level: ApiKeyLevel | null): number {
  return level === null ? -1 : LEVELS.indexOf(level);
}

/** A preset fixes the whole permission part; `custom` lets the owner pick it. */
type PermissionPreset = 'read' | 'write' | 'manage' | 'custom';

/** Radio value of "no level" in the custom permission picker. */
const NO_LEVEL = 'none';

const DAY_MS = 24 * 60 * 60 * 1000;

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

/** `YYYY-MM-DD` of a moment in local time, the value form of `<input type="date">`. */
function localDateValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** The last second of a chosen local day, or null for an empty or malformed value. */
function endOfLocalDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T23:59:59`);
  return isNaN(d.getTime()) ? null : d;
}

/** "in 12 days" / "3 hours ago" in the active language. */
function relativeFromNow(target: Date, now: number, language: string): string {
  const diff = target.getTime() - now;
  const rtf = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs >= DAY_MS) return rtf.format(Math.trunc(diff / DAY_MS), 'day');
  const hourMs = 60 * 60 * 1000;
  if (abs >= hourMs) return rtf.format(Math.trunc(diff / hourMs), 'hour');
  return rtf.format(Math.trunc(diff / 60000), 'minute');
}

/** The refusal text of a key operation: by machine code, the server message otherwise. */
function describeKeyError(err: unknown, t: TFunction<'settings'>, fallback: string): string {
  if (err instanceof BusinessError) {
    if (err.code === 'invalid_grant') {
      const details = err.extra.details as { rule?: unknown } | undefined;
      const rule = typeof details?.rule === 'string' ? details.rule : '';
      switch (rule) {
        case 'no_permission':
        case 'admin_requires_scope_all':
        case 'admin_not_available':
        case 'invalid_scope':
        case 'scope_unavailable':
        case 'expiry_out_of_range':
        case 'not_narrowing':
          return t(`keys.errors.rule.${rule}`);
        default:
          return err.message;
      }
    }
    if (err.code === 'key_revoked') return t('keys.errors.keyRevoked');
    if (err.code === 'key_expired') return t('keys.errors.keyExpired');
    return err.message;
  }
  if (err instanceof ApiError) {
    const details = err.extra.details as { staleClient?: unknown } | undefined;
    if (err.code === 'validation_error' && details?.staleClient === true) {
      return t('keys.errors.staleClient');
    }
    if (err.statusCode >= 400 && err.statusCode < 500) return err.message;
    return t('keys.errors.internal');
  }
  if (err instanceof Error) return err.message || fallback;
  return fallback;
}

/**
 * Render the .mcp.json snippet inline. We build the exact same shape
 * that legacy <McpJsonSnippet> renders so users can paste it straight
 * into their Claude Code config. The placeholder key is rendered
 * verbatim; the user replaces it with the value they generate below.
 *
 * sk-303.42 — `mcpUrl` is passed in rather than computed at module load: it
 * comes from the BFF runtime config (some deployments serve MCP from a
 * dedicated origin), which is not known until the config query resolves.
 */
function buildMcpConfig(mcpUrl: string): string {
  const config = {
    mcpServers: {
      skein: {
        url: mcpUrl,
        headers: { 'X-Skein-Api-Key': '${SKEIN_API_KEY}' },
        alwaysLoad: true,
      },
    },
  };
  return JSON.stringify(config, null, 2);
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const onCopy = async () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setFailed(false);
      timerRef.current = window.setTimeout(() => {
        setCopied(false);
        timerRef.current = null;
      }, 1400);
    } catch {
      // No clipboard (insecure context). Surface a hint so the user
      // selects manually — do NOT pretend the copy succeeded.
      setCopied(false);
      setFailed(true);
    }
  };

  return (
    <Stack gap={4}>
      <Group gap="sm">
        <Button
          variant="default"
          size="xs"
          onClick={() => {
            void onCopy();
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </Group>
      {failed ? (
        <Text size="xs" c="dimmed">
          Clipboard unavailable — select the snippet above and copy manually.
        </Text>
      ) : null}
    </Stack>
  );
}

/** One selectable project or space of the scope picker. */
interface ScopeOption {
  id: string;
  name: string;
}

/**
 * What the grant form may offer. On create: everything (admin only to an
 * instance admin). On narrow: the current grant and what lies inside it.
 */
interface GrantLimits {
  /** Highest level offered; null — no level at all. */
  maxLevel: ApiKeyLevel | null;
  /** Whether the admin flag may be ticked. */
  adminAllowed: boolean;
  /** Scope modes offered, in display order. */
  scopeModes: ApiKeyScopeMode[];
  projects: ScopeOption[];
  spaces: ScopeOption[];
  /** Latest end of the lifetime a date may give. */
  latestExpiry: Date;
}

/** The form's state, turned into a request body by `grantFromForm`. */
interface GrantFormState {
  preset: PermissionPreset;
  level: ApiKeyLevel | null;
  admin: boolean;
  scopeMode: ApiKeyScopeMode;
  projects: string[];
  spaces: string[];
  /** `default` — no expiry sent (create: default lifetime; narrow: keep the current one). */
  expiryMode: 'default' | 'date';
  expiryDate: string;
}

interface GrantResult {
  permissions: ApiKeyPermissions;
  scope: ApiKeyScopeInput;
  expiresAt?: string;
}

/** The request grant of a form, or the translation key of why it cannot be sent. */
function grantFromForm(
  s: GrantFormState,
  limits: GrantLimits,
  now: number,
): { ok: true; grant: GrantResult } | { ok: false; problem: string } {
  const permissions: ApiKeyPermissions =
    s.preset === 'custom' ? { level: s.level, admin: s.admin } : { level: s.preset, admin: false };
  if (permissions.level === null && !permissions.admin) return { ok: false, problem: 'keys.form.needPermission' };
  if (permissions.admin && s.scopeMode !== 'all') return { ok: false, problem: 'keys.form.adminNeedsAll' };
  let scope: ApiKeyScopeInput;
  if (s.scopeMode === 'projects') {
    if (s.projects.length === 0) return { ok: false, problem: 'keys.form.needProject' };
    scope = { mode: 'projects', projects: s.projects };
  } else if (s.scopeMode === 'spaces') {
    if (s.spaces.length === 0) return { ok: false, problem: 'keys.form.needSpace' };
    scope = { mode: 'spaces', spaces: s.spaces };
  } else {
    scope = { mode: 'all' };
  }
  const grant: GrantResult = { permissions, scope };
  if (s.expiryMode === 'date') {
    const end = endOfLocalDay(s.expiryDate);
    if (end === null) return { ok: false, problem: 'keys.form.needDate' };
    // The chosen day may end after the latest allowed moment (the day of
    // the maximum lifetime, or of the current expiry): the key then ends
    // at that moment, never later.
    const at = end.getTime() > limits.latestExpiry.getTime() ? limits.latestExpiry : end;
    if (at.getTime() <= now) return { ok: false, problem: 'keys.form.dateInPast' };
    grant.expiresAt = at.toISOString();
  }
  return { ok: true, grant };
}

function GrantForm({
  mode,
  limits,
  initial,
  defaultTtlDays,
  pending,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  mode: 'create' | 'narrow';
  limits: GrantLimits;
  initial: GrantFormState;
  defaultTtlDays: number | null;
  pending: boolean;
  submitLabel: string;
  onSubmit: (grant: GrantResult, label: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('settings');
  const [label, setLabel] = useState('');
  const [s, setS] = useState<GrantFormState>(initial);
  const now = Date.now();
  const result = grantFromForm(s, limits, now);
  const needsLabel = mode === 'create' && !label.trim();
  const set = (patch: Partial<GrantFormState>) => setS((prev) => ({ ...prev, ...patch }));

  const presets = (['read', 'write', 'manage'] as const).filter(
    (p) => levelRank(p) <= levelRank(limits.maxLevel),
  );
  const customLevels = LEVELS.filter((l) => levelRank(l) <= levelRank(limits.maxLevel));
  const effectiveAdmin = s.preset === 'custom' && s.admin;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!result.ok || needsLabel) return;
    onSubmit(result.grant, label.trim());
  };

  return (
    <Box
      component="form"
      aria-label={mode === 'create' ? t('keys.form.createAria') : t('keys.form.narrowAria')}
      onSubmit={submit}
      style={{
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-control)',
        padding: 'var(--space-2)',
        background: 'var(--bg)',
      }}
    >
      <Stack gap="sm">
        {mode === 'create' ? (
          <TextInput
            autoFocus
            label={t('keys.form.label')}
            placeholder="dev-container-laptop"
            value={label}
            onChange={(e) => setLabel(e.currentTarget.value)}
            maxLength={100}
            required
          />
        ) : (
          <Text size="sm">{t('keys.form.narrowHint')}</Text>
        )}

        <Radio.Group
          label={t('keys.form.permissions')}
          value={s.preset}
          onChange={(v) => set({ preset: v as PermissionPreset })}
        >
          <Stack gap={4} mt={4}>
            {presets.map((p) => (
              <Radio key={p} value={p} label={t(`keys.preset.${p}`)} description={t(`keys.presetHint.${p}`)} />
            ))}
            <Radio value="custom" label={t('keys.preset.custom')} />
          </Stack>
        </Radio.Group>

        {s.preset === 'custom' ? (
          <Stack gap={4} pl="md">
            <Radio.Group
              label={t('keys.form.level')}
              value={s.level ?? NO_LEVEL}
              onChange={(v) => set({ level: v === NO_LEVEL ? null : (v as ApiKeyLevel) })}
            >
              <Group gap="md" mt={4}>
                <Radio value={NO_LEVEL} label={t('keys.level.none')} />
                {customLevels.map((l) => (
                  <Radio key={l} value={l} label={t(`keys.level.${l}`)} />
                ))}
              </Group>
            </Radio.Group>
            {limits.adminAllowed ? (
              <Checkbox
                label={t('keys.form.admin')}
                description={t('keys.form.adminHint')}
                checked={s.admin}
                onChange={(e) => {
                  const admin = e.currentTarget.checked;
                  set(admin ? { admin, scopeMode: 'all' } : { admin });
                }}
              />
            ) : null}
          </Stack>
        ) : null}

        <Radio.Group
          label={t('keys.form.scope')}
          value={s.scopeMode}
          onChange={(v) => set({ scopeMode: v as ApiKeyScopeMode })}
        >
          <Stack gap={4} mt={4}>
            {limits.scopeModes.map((m) => (
              <Radio
                key={m}
                value={m}
                label={t(`keys.scopeMode.${m}`)}
                disabled={effectiveAdmin && m !== 'all'}
              />
            ))}
          </Stack>
        </Radio.Group>

        {s.scopeMode === 'projects' ? (
          <Checkbox.Group
            label={t('keys.form.projects')}
            value={s.projects}
            onChange={(v) => set({ projects: v })}
          >
            <Stack gap={4} mt={4} pl="md">
              {limits.projects.length === 0 ? (
                <Text size="sm" c="dimmed">{t('keys.form.noProjects')}</Text>
              ) : (
                limits.projects.map((p) => <Checkbox key={p.id} value={p.id} label={p.name} />)
              )}
            </Stack>
          </Checkbox.Group>
        ) : null}

        {s.scopeMode === 'spaces' ? (
          <Checkbox.Group
            label={t('keys.form.spaces')}
            value={s.spaces}
            onChange={(v) => set({ spaces: v })}
          >
            <Stack gap={4} mt={4} pl="md">
              {limits.spaces.length === 0 ? (
                <Text size="sm" c="dimmed">{t('keys.form.noSpaces')}</Text>
              ) : (
                limits.spaces.map((sp) => <Checkbox key={sp.id} value={sp.id} label={sp.name} />)
              )}
            </Stack>
          </Checkbox.Group>
        ) : null}

        <Radio.Group
          label={t('keys.form.expiry')}
          value={s.expiryMode}
          onChange={(v) => set({ expiryMode: v as 'default' | 'date' })}
        >
          <Stack gap={4} mt={4}>
            <Radio
              value="default"
              label={
                mode === 'create'
                  ? t('keys.form.expiryDefault', { days: defaultTtlDays ?? '—' })
                  : t('keys.form.expiryKeep')
              }
            />
            <Radio value="date" label={t('keys.form.expiryDate')} />
          </Stack>
        </Radio.Group>
        {s.expiryMode === 'date' ? (
          <TextInput
            type="date"
            label={t('keys.form.expiryDateLabel')}
            description={t('keys.form.expiryLatest', { date: localDateValue(limits.latestExpiry) })}
            value={s.expiryDate}
            min={localDateValue(new Date(now))}
            max={localDateValue(limits.latestExpiry)}
            onChange={(e) => set({ expiryDate: e.currentTarget.value })}
            pl="md"
          />
        ) : null}

        {mode === 'narrow' ? (
          <Text size="xs" c="dimmed">{t('keys.form.widenHint')}</Text>
        ) : null}

        {!result.ok ? (
          <Text size="xs" c="dimmed" role="status">
            {t(result.problem)}
          </Text>
        ) : null}

        <Group gap="sm">
          <Button type="submit" variant="filled" size="sm" loading={pending} disabled={!result.ok || needsLabel}>
            {submitLabel}
          </Button>
          <Button type="button" variant="default" size="sm" disabled={pending} onClick={onCancel}>
            {t('keys.form.cancel')}
          </Button>
        </Group>
      </Stack>
    </Box>
  );
}

/** Form state of a narrowing: the key's current grant. */
function narrowInitial(k: ApiKey): GrantFormState {
  return {
    preset: 'custom',
    level: k.permissions.level,
    admin: k.permissions.admin,
    scopeMode: k.scope.mode,
    projects: k.scope.projects.map((p) => p.id),
    spaces: k.scope.spaces.map((sp) => sp.id),
    expiryMode: 'default',
    expiryDate: '',
  };
}

/**
 * What a narrowing may offer: no higher level, admin only removed, the
 * scope inside the current one, the expiry no later. From scope `all`
 * any visible project or space may be picked; from `spaces`, a subset of
 * those spaces or the visible projects that live in them; from
 * `projects`, a subset of those projects.
 */
function narrowLimits(
  k: ApiKey,
  projects: (ScopeOption & { spaceId?: string })[],
  spaces: ScopeOption[],
  maxTtlMs: number,
  now: number,
): GrantLimits {
  const base = {
    maxLevel: k.permissions.level,
    adminAllowed: k.permissions.admin,
    latestExpiry: k.expiresAt ? new Date(k.expiresAt) : new Date(now + maxTtlMs),
  };
  if (k.scope.mode === 'all') {
    return { ...base, scopeModes: ['all', 'projects', 'spaces'], projects, spaces };
  }
  if (k.scope.mode === 'spaces') {
    const inScope = new Set(k.scope.spaces.map((sp) => sp.id));
    return {
      ...base,
      scopeModes: ['spaces', 'projects'],
      projects: projects.filter((p) => p.spaceId !== undefined && inScope.has(p.spaceId)),
      spaces: k.scope.spaces,
    };
  }
  return {
    ...base,
    scopeModes: ['projects'],
    projects: k.scope.projects,
    spaces: [],
  };
}

function PermissionsCell({ k }: { k: ApiKey }) {
  const { t } = useTranslation('settings');
  const parts: string[] = [];
  if (k.permissions.level) parts.push(t(`keys.level.${k.permissions.level}`));
  if (k.permissions.admin) parts.push(t('keys.level.admin'));
  return (
    <Stack gap={2}>
      <span>{parts.join(' + ')}</span>
      {k.unavailablePermissions.length > 0 ? (
        <Text size="xs" c="dimmed">
          {t('keys.list.unavailable', {
            list: k.unavailablePermissions.map((p) => t(`keys.level.${p}`)).join(', '),
          })}
        </Text>
      ) : null}
    </Stack>
  );
}

function scopeText(scope: ApiKeyScope, t: TFunction<'settings'>): string {
  if (scope.mode === 'projects') {
    return t('keys.list.scopeProjects', { list: scope.projects.map((p) => p.name).join(', ') });
  }
  if (scope.mode === 'spaces') {
    return t('keys.list.scopeSpaces', { list: scope.spaces.map((sp) => sp.name).join(', ') });
  }
  return t('keys.scopeMode.all');
}

function ExpiryCell({ k, now }: { k: ApiKey; now: number }) {
  const { t, i18n } = useTranslation('settings');
  if (!k.expiresAt) return <span>{t('keys.list.noExpiry')}</span>;
  const at = new Date(k.expiresAt);
  return (
    <Stack gap={2}>
      <span>{formatTime(k.expiresAt)}</span>
      <Text size="xs" c="dimmed">
        {relativeFromNow(at, now, i18n.language)}
      </Text>
    </Stack>
  );
}

function StatusCell({ k }: { k: ApiKey }) {
  const { t } = useTranslation('settings');
  if (k.status === 'active') {
    return <span style={{ color: 'var(--ok)' }}>{t('keys.status.active')}</span>;
  }
  return (
    <span style={{ color: 'var(--ink-3)' }}>
      {k.statusReason ? t(`keys.status.${k.statusReason}`) : t('keys.status.inactive')}
    </span>
  );
}

/** The "Public API" block: off, on without an address, on with one. */
function PublicApiBlock({ settings }: { settings: ReturnType<typeof useQuery<ApiKeysSettings>> }) {
  const { t } = useTranslation('settings');
  if (settings.isLoading) {
    return <p className="settings-muted">{t('keys.publicApi.loading')}</p>;
  }
  if (settings.isError || !settings.data) {
    return (
      <Alert variant="light" style={ERR_ALERT_VARS} title={t('keys.publicApi.failedTitle')}>
        {t('keys.publicApi.failed')}
      </Alert>
    );
  }
  const s = settings.data;
  if (!s.publicApiEnabled) {
    return <Alert variant="light" title={t('keys.publicApi.disabledTitle')}>{t('keys.publicApi.disabled')}</Alert>;
  }
  if (s.publicApiUrl === null) {
    return <Alert variant="light" title={t('keys.publicApi.noAddressTitle')}>{t('keys.publicApi.noAddress')}</Alert>;
  }
  return (
    <Stack gap={4}>
      <Text size="sm">
        {t('keys.publicApi.address')} <code>{s.publicApiUrl}</code>
      </Text>
      {s.openApiUrl ? (
        <Anchor href={s.openApiUrl} target="_blank" rel="noreferrer" size="sm">
          {t('keys.publicApi.openApi')}
        </Anchor>
      ) : null}
    </Stack>
  );
}

export function NewApiKeysPage() {
  const { user } = useAuth();
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();
  const isInstanceAdmin = user?.role === 'admin';

  const keysQuery = useQuery<ApiKey[]>({
    queryKey: ['api-keys'],
    queryFn: listApiKeys,
    enabled: !!user,
  });
  const settingsQuery = useQuery<ApiKeysSettings>({
    queryKey: ['api-keys', 'settings'],
    queryFn: getApiKeysSettings,
    enabled: !!user,
  });

  // Create flow.
  const [showCreateRow, setShowCreateRow] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // The secret of a new or a reissued key, shown once.
  const [revealedKey, setRevealedKey] = useState<ApiKeyCreateResponse | null>(null);

  // Narrow flow: the key being narrowed.
  const [narrowing, setNarrowing] = useState<ApiKey | null>(null);
  const [narrowError, setNarrowError] = useState<string | null>(null);

  // Projects and spaces feed the scope picker only; the projects list is
  // read once a form that may pick projects is open.
  const pickerOpen = showCreateRow || (narrowing !== null && narrowing.scope.mode !== 'projects');
  const projectsQuery = useProjectsList({ enabled: pickerOpen });
  const spacesQuery = useMySpaces();
  const projectOptions = useMemo<(ScopeOption & { spaceId?: string })[]>(
    () =>
      pickerOpen
        ? (projectsQuery.data?.items ?? [])
            .filter((p) => !p.archivedAt)
            .map((p) => ({ id: p.id, name: p.name, spaceId: p.spaceId }))
        : [],
    [pickerOpen, projectsQuery.data],
  );
  const spaceOptions = useMemo<ScopeOption[]>(
    () => (spacesQuery.data?.items ?? []).map((sp) => ({ id: sp.id, name: sp.name })),
    [spacesQuery.data],
  );

  const invalidateKeys = () => queryClient.invalidateQueries({ queryKey: ['api-keys'], exact: true });

  const createMutation = useMutation<ApiKeyCreateResponse, Error, CreateApiKeyInput>({
    mutationFn: (input) => createApiKey(input),
    onSuccess: (created) => {
      setRevealedKey(created);
      setShowCreateRow(false);
      setCreateError(null);
      return invalidateKeys();
    },
    onError: (err) => setCreateError(describeKeyError(err, t, t('keys.errors.createFailed'))),
  });

  const narrowMutation = useMutation<ApiKey, Error, { id: string; input: NarrowApiKeyInput }>({
    mutationFn: ({ id, input }) => narrowApiKey(id, input),
    onSuccess: () => {
      setNarrowing(null);
      setNarrowError(null);
      return invalidateKeys();
    },
    onError: (err) => setNarrowError(describeKeyError(err, t, t('keys.errors.narrowFailed'))),
  });

  const [confirmReissue, setConfirmReissue] = useState<ApiKey | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const reissueMutation = useMutation<ApiKeyCreateResponse, Error, string>({
    mutationFn: (id) => reissueApiKey(id),
    onSuccess: (created) => {
      setConfirmReissue(null);
      setActionError(null);
      setRevealedKey(created);
      return invalidateKeys();
    },
    onError: (err) => {
      setConfirmReissue(null);
      setActionError(describeKeyError(err, t, t('keys.errors.reissueFailed')));
    },
  });

  const [confirmRevoke, setConfirmRevoke] = useState<ApiKey | null>(null);
  const revokeMutation = useMutation<void, Error, string>({
    mutationFn: (id) => revokeApiKey(id),
    onSuccess: () => {
      setConfirmRevoke(null);
      setActionError(null);
      return invalidateKeys();
    },
    onError: (err) => {
      setConfirmRevoke(null);
      setActionError(describeKeyError(err, t, t('keys.errors.revokeFailed')));
    },
  });

  // Warn before close while the plain key is held in memory — same
  // safety net as the legacy page. SecretReveal blocks Esc/click-out;
  // this protects against a literal tab-close.
  useEffect(() => {
    if (!revealedKey) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [revealedKey]);

  const keys = keysQuery.data ?? [];
  // Where MCP lives is a deployment fact the BFF declares; absent, it is
  // same-origin /mcp (see `lib/mcpUrl.ts`).
  //
  // The snippet is withheld until that answer actually arrives. `null` alone
  // cannot be trusted here: it means "the BFF says same-origin", "the query
  // has not resolved yet" and "the query failed" all at once. On a deployment
  // serving MCP from its own origin, rendering the same-origin fallback early
  // hands the user a copyable address that is simply wrong — and a copy button
  // invites them to take it before the real one appears.
  const authConfig = useAuthConfig();
  const configuredMcpUrl = authConfig.data?.mcpUrl ?? null;
  const mcpConfig = useMemo(
    () => (authConfig.isSuccess ? buildMcpConfig(resolveMcpUrl(configuredMcpUrl)) : null),
    [authConfig.isSuccess, configuredMcpUrl],
  );

  // sk-674.18 T058 — screens 1.14: "The key sees all your spaces",
  // only with two spaces or more (an external user has none; with one there
  // is nothing to tell apart).
  const spacesCount = spacesQuery.data?.items.length ?? 0;

  const listError = keysQuery.error ? describeKeyError(keysQuery.error, t, t('keys.errors.listFailed')) : null;

  const settings = settingsQuery.data;
  const now = Date.now();
  const defaultTtlDays = settings ? Math.round(settings.defaultTtlSeconds / 86400) : null;
  const maxTtlMs = settings ? settings.maxTtlSeconds * 1000 : 0;

  const createLimits: GrantLimits = {
    maxLevel: 'manage',
    adminAllowed: isInstanceAdmin,
    scopeModes: ['all', 'projects', 'spaces'],
    projects: projectOptions,
    spaces: spaceOptions,
    latestExpiry: new Date(now + maxTtlMs),
  };
  const createInitial: GrantFormState = {
    preset: 'read',
    level: 'read',
    admin: false,
    scopeMode: 'all',
    projects: [],
    spaces: [],
    expiryMode: 'default',
    expiryDate: '',
  };

  return (
    <SettingsLayout active="api-keys">
      <SettingsPanel title={t('keys.connectTitle')}>
        <ol className="settings-connect-steps">
          <li>{t('keys.connectWhere')}</li>
          <li>{t('keys.connectKey')}</li>
          <li>{t('keys.connectCheck')}</li>
        </ol>
        {mcpConfig === null ? (
          authConfig.isError ? (
            <Alert variant="light" style={ERR_ALERT_VARS} title="Configuration unavailable">
              Could not read this deployment's MCP address, so the snippet is not
              shown — a guessed address would look right and quietly fail to
              connect. Reload the page; if it keeps failing, tell your Skein admin.
            </Alert>
          ) : (
            <p className="settings-muted">Loading this deployment's MCP address…</p>
          )
        ) : (
          <>
            <pre
              tabIndex={0}
              role="region"
              aria-label="MCP server configuration JSON"
              aria-describedby="mcp-json-copy-hint"
              className="settings-code-block"
            >
              {mcpConfig}
            </pre>
            <span id="mcp-json-copy-hint" className="sr-only">
              Use the Copy button below to copy this configuration
            </span>
            <CopyButton value={mcpConfig} />
          </>
        )}
      </SettingsPanel>

      <SettingsPanel title={t('keys.publicApi.title')}>
        <PublicApiBlock settings={settingsQuery} />
      </SettingsPanel>

      <SettingsPanel
        title={t('keys.list.title')}
        description={
          <>
            {t('keys.list.description')}
            {spacesCount >= 2 ? (
              <>
                {' '}
                <strong>{t('keys.allSpaces')}</strong>
              </>
            ) : null}
          </>
        }
        actions={
          !showCreateRow ? (
            <Button
              variant="filled"
              size="sm"
              disabled={!settings}
              onClick={() => {
                setShowCreateRow(true);
                setCreateError(null);
              }}
              leftSection={
                /* sk-285.7.2.88 — §8 names `plus`; this was the
                   character U+002B, the same stand-in the epic panel's
                   Add-child button carried. §9 leaves the settings
                   screens undrawn by an artboard and says to apply the
                   system to them — this is that. Mantine's
                   `leftSection` keeps the label the accessible name. */
                <IconPlus size={16} stroke={1.75} aria-hidden />
              }
            >
              {t('keys.list.newKey')}
            </Button>
          ) : null
        }
      >
        {listError ? (
          <Alert variant="light" style={ERR_ALERT_VARS} title={t('keys.errors.listTitle')}>
            {listError}
          </Alert>
        ) : null}

        {createError ? (
          <Alert
            variant="light"
            style={ERR_ALERT_VARS}
            title={t('keys.errors.createTitle')}
            withCloseButton
            onClose={() => setCreateError(null)}
          >
            {createError}
          </Alert>
        ) : null}

        {actionError ? (
          <Alert
            variant="light"
            style={ERR_ALERT_VARS}
            title={t('keys.errors.actionTitle')}
            withCloseButton
            onClose={() => setActionError(null)}
          >
            {actionError}
          </Alert>
        ) : null}

        {showCreateRow && settings ? (
          <GrantForm
            mode="create"
            limits={createLimits}
            initial={createInitial}
            defaultTtlDays={defaultTtlDays}
            pending={createMutation.isPending}
            submitLabel={t('keys.form.create')}
            onSubmit={(grant, label) => createMutation.mutate({ label, ...grant })}
            onCancel={() => {
              setShowCreateRow(false);
              setCreateError(null);
            }}
          />
        ) : null}

        {narrowing && settings ? (
          <Stack gap="xs">
            <Text fw={600} size="sm">
              {t('keys.form.narrowTitle', { label: narrowing.label })}
            </Text>
            {narrowError ? (
              <Alert
                variant="light"
                style={ERR_ALERT_VARS}
                title={t('keys.errors.narrowTitle')}
                withCloseButton
                onClose={() => setNarrowError(null)}
              >
                {narrowError}
              </Alert>
            ) : null}
            <GrantForm
              key={narrowing.id}
              mode="narrow"
              limits={narrowLimits(narrowing, projectOptions, spaceOptions, maxTtlMs, now)}
              initial={narrowInitial(narrowing)}
              defaultTtlDays={defaultTtlDays}
              pending={narrowMutation.isPending}
              submitLabel={t('keys.form.narrowSave')}
              onSubmit={(grant) => narrowMutation.mutate({ id: narrowing.id, input: grant })}
              onCancel={() => {
                setNarrowing(null);
                setNarrowError(null);
              }}
            />
          </Stack>
        ) : null}

        {keysQuery.isLoading ? (
          <div className="settings-loading">
            <Loader size="sm" />
          </div>
        ) : keys.length === 0 ? (
          <div className="settings-empty">{t('keys.list.empty')}</div>
        ) : (
          <Table verticalSpacing="xs" striped={false} highlightOnHover={false}>
            <Table.Caption className="sr-only">{t('keys.list.caption')}</Table.Caption>
            <Table.Thead>
              <Table.Tr>
                <Table.Th scope="col">{t('keys.list.colLabel')}</Table.Th>
                <Table.Th scope="col">{t('keys.list.colPrefix')}</Table.Th>
                <Table.Th scope="col">{t('keys.list.colCreated')}</Table.Th>
                <Table.Th scope="col">{t('keys.list.colExpires')}</Table.Th>
                <Table.Th scope="col">{t('keys.list.colLastUsed')}</Table.Th>
                <Table.Th scope="col">{t('keys.list.colStatus')}</Table.Th>
                <Table.Th scope="col">{t('keys.list.colPermissions')}</Table.Th>
                <Table.Th scope="col">{t('keys.list.colScope')}</Table.Th>
                <Table.Th scope="col" style={{ textAlign: 'right' }}>{t('keys.list.colActions')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {keys.map((k) => {
                const active = k.status === 'active';
                const revoked = k.statusReason === 'revoked';
                return (
                  <Table.Tr key={k.id} className={active ? undefined : 'settings-row-muted'}>
                    <Table.Td>{k.label}</Table.Td>
                    <Table.Td>
                      <code style={{ color: 'var(--ink-2)' }}>{k.prefix}…</code>
                    </Table.Td>
                    <Table.Td>{formatTime(k.createdAt)}</Table.Td>
                    <Table.Td>
                      <ExpiryCell k={k} now={now} />
                    </Table.Td>
                    <Table.Td>{k.lastUsedAt ? formatTime(k.lastUsedAt) : '—'}</Table.Td>
                    <Table.Td>
                      <StatusCell k={k} />
                    </Table.Td>
                    <Table.Td>
                      <PermissionsCell k={k} />
                    </Table.Td>
                    <Table.Td>{scopeText(k.scope, t)}</Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      <Group gap={4} justify="flex-end" wrap="nowrap">
                        {active ? (
                          <Button
                            aria-label={t('keys.actions.narrowAria', { label: k.label, prefix: k.prefix })}
                            variant="subtle"
                            size="compact-xs"
                            disabled={!settings}
                            onClick={() => {
                              setShowCreateRow(false);
                              setNarrowError(null);
                              setNarrowing(k);
                            }}
                          >
                            {t('keys.actions.narrow')}
                          </Button>
                        ) : null}
                        {!revoked ? (
                          <Button
                            aria-label={t('keys.actions.reissueAria', { label: k.label, prefix: k.prefix })}
                            variant="subtle"
                            size="compact-xs"
                            onClick={() => setConfirmReissue(k)}
                          >
                            {t('keys.actions.reissue')}
                          </Button>
                        ) : null}
                        {!revoked ? (
                          <Button
                            aria-label={t('keys.actions.revokeAria', { label: k.label, prefix: k.prefix })}
                            variant="subtle"
                            color="red"
                            size="compact-xs"
                            onClick={() => setConfirmRevoke(k)}
                          >
                            {t('keys.actions.revoke')}
                          </Button>
                        ) : (
                          <span style={{ color: 'var(--ink-3)' }}>—</span>
                        )}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        )}
      </SettingsPanel>

      <SecretReveal
        opened={!!revealedKey}
        onDismiss={() => setRevealedKey(null)}
        title={t('keys.reveal.title')}
        value={revealedKey?.plainKey ?? ''}
        description={
          revealedKey ? t('keys.reveal.description', { label: revealedKey.label, prefix: revealedKey.prefix }) : undefined
        }
      />

      <ConfirmDialog
        opened={!!confirmReissue}
        title={t('keys.actions.reissueTitle')}
        message={confirmReissue ? t('keys.actions.reissueConfirm', { label: confirmReissue.label }) : ''}
        confirmLabel={t('keys.actions.reissue')}
        loading={reissueMutation.isPending}
        onConfirm={() => {
          if (confirmReissue) reissueMutation.mutate(confirmReissue.id);
        }}
        onCancel={() => setConfirmReissue(null)}
      />

      <ConfirmDialog
        opened={!!confirmRevoke}
        title={t('keys.actions.revokeTitle')}
        message={confirmRevoke ? t('keys.actions.revokeConfirm', { label: confirmRevoke.label }) : ''}
        confirmLabel={t('keys.actions.revoke')}
        loading={revokeMutation.isPending}
        danger
        onConfirm={() => {
          if (confirmRevoke) revokeMutation.mutate(confirmRevoke.id);
        }}
        onCancel={() => setConfirmRevoke(null)}
      />
    </SettingsLayout>
  );
}
