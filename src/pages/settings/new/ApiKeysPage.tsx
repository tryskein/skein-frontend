import { useEffect, useMemo, useRef, useState } from 'react';
import { IconPlus } from '@tabler/icons-react';
import {
  Alert,
  Box,
  Button,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../auth/AuthContext';
import { ApiError, BusinessError } from '../../../api/client';
import {
  ApiKey,
  ApiKeyCreateResponse,
  createApiKey,
  listApiKeys,
  revokeApiKey,
} from '../../../api/api-keys';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { SecretReveal } from '../../../components/SecretReveal';
import { SettingsLayout, SettingsPanel } from './SettingsLayout';
import { resolveMcpUrl } from '../../../lib/mcpUrl';
import { ERR_ALERT_VARS } from '../../../lib/mantineVariantVars';
import { useAuthConfig } from '../../../lib/useAuthConfig';
import { useMySpaces } from '../../../lib/useMySpaces';
import { useTranslation } from 'react-i18next';

/**
 * /settings/api-keys — long-lived API keys for MCP / service accounts
 * (R2.1) ported to the new-shell aesthetic (sk-41).
 *
 * Functional parity with `pages/settings/api-keys.tsx`:
 *  1. MCP integration snippet at the top with a Copy button — since
 *     sk-674.18 T058 the "Connection" block (screens 1.14, K2): where the
 *     `.mcp.json` goes, which key to set, how to check the connection.
 *     The projects column's "Your agent creates projects" leads here.
 *  2. Table of existing keys (active + revoked, newest first). Active
 *     keys have a Revoke action; revoked keys are dimmed.
 *  3. "New key" button → label input → POST → SecretReveal modal
 *     showing the plain key exactly once. After dismiss, the table
 *     refetches and the new row appears (without the plain key).
 *
 * Only the chrome changes: Solarized Mantine surfaces in place of the
 * ASCII terminal frame.
 */

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

function describeError(err: unknown, fallback: string): string {
  if (err instanceof BusinessError) return err.message;
  if (err instanceof ApiError) return 'internal error — try again';
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

export function NewApiKeysPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const keysQuery = useQuery<ApiKey[]>({
    queryKey: ['api-keys'],
    queryFn: listApiKeys,
    enabled: !!user,
  });

  // Create flow.
  const [showCreateRow, setShowCreateRow] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<ApiKeyCreateResponse | null>(null);

  const createMutation = useMutation<ApiKeyCreateResponse, Error, string>({
    mutationFn: (label) => createApiKey(label),
    onSuccess: (created) => {
      setCreatedKey(created);
      setShowCreateRow(false);
      setNewLabel('');
      setCreateError(null);
      return queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
    onError: (err) => {
      setCreateError(describeError(err, 'failed to create api key'));
    },
  });

  // Revoke flow.
  const [confirmRevoke, setConfirmRevoke] = useState<ApiKey | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const revokeMutation = useMutation<void, Error, string>({
    mutationFn: (id) => revokeApiKey(id),
    onSuccess: () => {
      setConfirmRevoke(null);
      setRevokeError(null);
      return queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
    onError: (err) => {
      setRevokeError(describeError(err, 'failed to revoke api key'));
    },
  });

  // Warn before close while the plain key is held in memory — same
  // safety net as the legacy page. SecretReveal blocks Esc/click-out;
  // this protects against a literal tab-close.
  useEffect(() => {
    if (!createdKey) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [createdKey]);

  const onSubmitCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const label = newLabel.trim();
    if (!label) return;
    createMutation.mutate(label);
  };

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
  const { t } = useTranslation('settings');
  const spacesCount = useMySpaces().data?.items.length ?? 0;

  const listError = keysQuery.error
    ? describeError(keysQuery.error, 'failed to load api keys')
    : null;

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

      <SettingsPanel
        title="Your keys"
        description={
          <>
            Long-lived keys that authenticate MCP agents and CLI tools. Revoking a key invalidates it immediately.
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
              New key
            </Button>
          ) : null
        }
      >
        {listError ? (
          <Alert variant="light" style={ERR_ALERT_VARS} title="Failed to load keys">
            {listError}
          </Alert>
        ) : null}

        {createError ? (
          <Alert
            variant="light"
            style={ERR_ALERT_VARS}
            title="Failed to create key"
            withCloseButton
            onClose={() => setCreateError(null)}
          >
            {createError}
          </Alert>
        ) : null}

        {revokeError ? (
          <Alert
            variant="light"
            style={ERR_ALERT_VARS}
            title="Failed to revoke key"
            withCloseButton
            onClose={() => setRevokeError(null)}
          >
            {revokeError}
          </Alert>
        ) : null}

        {showCreateRow ? (
          <Box
            component="form"
            onSubmit={onSubmitCreate}
            style={{
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-control)',
              padding: 'var(--space-2)',
              background: 'var(--bg)',
            }}
          >
            <Group gap="sm" align="flex-end">
              <TextInput
                autoFocus
                label="Label"
                placeholder="dev-container-laptop"
                value={newLabel}
                onChange={(e) => setNewLabel(e.currentTarget.value)}
                maxLength={100}
                style={{ flexGrow: 1 }}
                required
              />
              <Button
                type="submit"
                variant="filled"
                size="sm"
                loading={createMutation.isPending}
                disabled={!newLabel.trim()}
              >
                Create
              </Button>
              <Button
                type="button"
                variant="default"
                size="sm"
                disabled={createMutation.isPending}
                onClick={() => {
                  setShowCreateRow(false);
                  setNewLabel('');
                  setCreateError(null);
                }}
              >
                Cancel
              </Button>
            </Group>
          </Box>
        ) : null}

        {keysQuery.isLoading ? (
          <div className="settings-loading">
            <Loader size="sm" />
          </div>
        ) : keys.length === 0 ? (
          <div className="settings-empty">
            No API keys yet — generate one to connect an agent.
          </div>
        ) : (
          <Table verticalSpacing="xs" striped={false} highlightOnHover={false}>
            <Table.Caption className="sr-only">API keys</Table.Caption>
            <Table.Thead>
              <Table.Tr>
                <Table.Th scope="col">Label</Table.Th>
                <Table.Th scope="col">Prefix</Table.Th>
                <Table.Th scope="col">Created</Table.Th>
                <Table.Th scope="col">Last used</Table.Th>
                <Table.Th scope="col">State</Table.Th>
                <Table.Th scope="col" style={{ textAlign: 'right' }}>Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {keys.map((k) => {
                const isRevoked = !!k.revokedAt;
                return (
                  <Table.Tr
                    key={k.id}
                    className={isRevoked ? 'settings-row-muted' : undefined}
                  >
                    <Table.Td>{k.label}</Table.Td>
                    <Table.Td>
                      <code style={{ color: 'var(--ink-2)' }}>{k.prefix}…</code>
                    </Table.Td>
                    <Table.Td>{formatTime(k.createdAt)}</Table.Td>
                    <Table.Td>
                      {k.lastUsedAt ? formatTime(k.lastUsedAt) : '—'}
                    </Table.Td>
                    <Table.Td>
                      <span
                        style={{
                          color: isRevoked
                            ? 'var(--ink-3)'
                            : 'var(--ok)',
                        }}
                      >
                        {isRevoked ? 'revoked' : 'active'}
                      </span>
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      {isRevoked ? (
                        <span style={{ color: 'var(--ink-3)' }}>—</span>
                      ) : (
                        <Button
                          aria-label={`Revoke API key "${k.label}" (prefix ${k.prefix})`}
                          variant="subtle"
                          color="red"
                          size="compact-xs"
                          onClick={() => setConfirmRevoke(k)}
                        >
                          Revoke
                        </Button>
                      )}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        )}
      </SettingsPanel>

      <SecretReveal
        opened={!!createdKey}
        onDismiss={() => setCreatedKey(null)}
        title="API key created"
        value={createdKey?.plainKey ?? ''}
        description={
          createdKey
            ? `Label: ${createdKey.label} · Prefix: ${createdKey.prefix}…`
            : undefined
        }
      />

      <ConfirmDialog
        opened={!!confirmRevoke}
        title="Revoke API key"
        message={
          confirmRevoke
            ? `Revoking "${confirmRevoke.label}" will immediately invalidate any agent using this key. Continue?`
            : ''
        }
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
