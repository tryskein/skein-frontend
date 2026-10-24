import { useMemo, useState, type CSSProperties } from 'react';
import { IconPlus } from '@tabler/icons-react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  PasswordInput,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../auth/AuthContext';
import { useAuthConfig } from '../../../lib/useAuthConfig';
import { ApiError, BusinessError } from '../../../api/client';
import {
  CreateUserPayload,
  UpdateUserPayload,
  User,
  UserListResult,
  UserSpacesPreview,
  createUser,
  deactivateUser,
  getUserSpaces,
  listUsers,
  previewUserSpaces,
  putUserSpaces,
  reactivateUser,
  updateUser,
} from '../../../api/users';
import type { MySpace } from '../../../api/spaces';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { SkeinTooltip } from '../../../components/SkeinTooltip';
import { spaceHandle } from '../../../lib/shellUrlState';
import { noSeatsLeft, seatsLabel } from '../../../lib/spaceQuota';
import { MY_SPACES_QUERY_PREFIX, useMySpaces } from '../../../lib/useMySpaces';
import { SettingsLayout, SettingsPanel } from './SettingsLayout';

/**
 * /settings/users — admin-only user management (R3.1) ported to the
 * new-shell aesthetic (sk-41). Functional parity with
 * `pages/settings/users.tsx`:
 *   - Create / edit / deactivate / reactivate users.
 *   - Toggle to view active vs archived (deactivated) users.
 *   - Admin gate (redirect non-admin visitors to /settings/api-keys).
 *
 * sk-674.18 T058 (screens 1.14, K6, plan 2.6, 7, 8) — the spaces of an
 * account, for a non-external one:
 *   - checkboxes of every space of the instance but personal ones (the
 *     admin's "my spaces", K1), at creation (the common space checked by
 *     default) and in the edit card (the current memberships checked);
 *     the admin's own account has them too — that is how he joins;
 *   - a space without seats is off unless the person is already in it;
 *     a space the person OWNS is checked and locked, with a link to its
 *     settings where the owner is changed (2.14);
 *   - an unchecked box is a removal (K6): all of them in ONE dialog of
 *     consequences before the save (`POST /users/{id}/spaces/preview`),
 *     and "Save" applies everything at once (`PUT …/spaces`);
 *   - deactivating says that assignments and memberships are kept and
 *     names the spaces the person owns ("Owns: …") — a warning, not
 *     a refusal.
 */

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

function describeError(err: unknown, fallback: string): string {
  if (err instanceof BusinessError) return err.message;
  if (err instanceof ApiError) return err.message || 'internal error — try again';
  if (err instanceof Error) return err.message || fallback;
  return fallback;
}

/**
 * sk-385 — the error Alert's own pair, off Mantine's builtin red ramp.
 *
 * `<Alert color="red" variant="light">` paints its TITLE (and its icon,
 * and its close button) with `--alert-color`, which the library resolves
 * to `var(--mantine-color-red-light-color)` — a literal our dictionary
 * never reaches. Measured on a live Chromium, real markup, real
 * stylesheet, both built-in themes: **2.51 light / 13.01 dark**. The
 * light theme fails the 4.5 floor for a 14px/700 title, which is normal
 * text, not large.
 *
 * The MESSAGE body is a different pairing and was never at risk — it
 * takes `var(--mantine-color-text)` and measured 18.97 / 13.92. So the
 * two untitled Alerts below (`createError`, `editError`) were passing
 * TODAY, on the accident that they render no title. They are moved with
 * the other two anyway: the control is the same, the failure is silent,
 * and it comes back the moment someone adds a `title` prop.
 *
 * `--err` on `--err-t` is the dictionary's own error wash and measures
 * **4.75 light / 4.86 dark**. The `color` prop is dropped rather than
 * kept alongside the override, so that if these variables ever stop
 * being honoured the chip falls back to the primary ramp loudly instead
 * of back onto the red that failed.
 */
const ERROR_ALERT_VARS = {
  '--alert-bg': 'var(--err-t)',
  '--alert-color': 'var(--err)',
} as CSSProperties;

/**
 * sk-408 — the row's identity cell: `Username` and `Name` in one column.
 *
 * Measured before the merge (Chromium 1284×900, `/settings/users`, 100
 * users, 2026-09-09): Username 208.66 + Email 285.56 + Name 225.16 =
 * 719.38 of natural width for three identity columns, in a panel body
 * 894 wide that also owes Role and Actions. Merged, the pair costs
 * max(208.66, 225.16) = 225.16 and every identity fact stays on the row.
 *
 * The handle is dropped when it EQUALS the name, which is not a cosmetic
 * rule: most accounts on a large instance are machine users whose name,
 * username and email local part are one string, and printing it twice
 * would make every one of those rows two lines tall to say nothing.
 */
function UserIdentity({ user }: { user: User }) {
  return (
    <div className="settings-user-identity">
      <span className="settings-user-identity-name">{user.name}</span>
      {user.username !== user.name ? (
        <code className="settings-user-identity-handle">{user.username}</code>
      ) : null}
    </div>
  );
}

/* sk-385 — these two were `color="grape"` and `color="gray"` on
 * `variant="light"`. Mantine's light pairing is `{ramp}-light-color` ink
 * on a translucent `{ramp}-light` wash, and BOTH sides are literals
 * inside @mantine/core that our dictionary never reaches — so the wash
 * composites against whatever surface is behind it, and only the DARK
 * theme happens to land well. Measured on a live Chromium, on the row
 * surface these chips actually sit on (`--n-200`):
 *   grape light  2.57 light / 10.47 dark
 *   gray  light  1.68 light /  9.92 dark
 * against a 4.5 floor — i.e. both fail the light theme outright, and
 * gray is under even the 3:1 allowed for large text. They take
 * dictionary pairs instead: `--violet` keeps grape's hue and measures
 * 4.52 / 5.04, and the neutral chip drops the coloured wash altogether
 * for `--ink-2` on `--n-300`, 7.48 / 7.86. Both roles flip with the
 * base, which is what keeps the pair honest in either theme. */
function RoleBadges({ user }: { user: User }) {
  return (
    <Group gap={4} wrap="nowrap">
      {user.role === 'admin' ? (
        <Badge
          variant="light"
          size="sm"
          style={
            {
              '--badge-bg': 'var(--violet-t)',
              '--badge-color': 'var(--violet)',
              '--badge-bd': '1px solid transparent',
            } as CSSProperties
          }
        >
          admin
        </Badge>
      ) : (
        <Badge
          variant="light"
          size="sm"
          style={
            {
              '--badge-bg': 'var(--n-300)',
              '--badge-color': 'var(--ink-2)',
              '--badge-bd': '1px solid transparent',
            } as CSSProperties
          }
        >
          user
        </Badge>
      )}
      {/* sk-163 — external collaborators are visually distinct so an admin
          never confuses them with internal staff (they're scoped to their
          own projects and capped at role='user'). */}
      {user.isExternal ? (
        <SkeinTooltip
          content="External collaborator — scoped to their own projects, never admin"
          width={240}
          position="top"
        >
          <Badge color="orange" variant="filled" size="sm">
            external
          </Badge>
        </SkeinTooltip>
      ) : null}
    </Group>
  );
}

/* Auth method badge:
 *   keycloak — SSO auto-provisioned (no local pwd)
 *   password — local account (created via "New user")
 *   both     — SSO user with a fallback local pwd
 *
 * A tooltip component instead of the `title` attribute — `title` doesn't
 * fire on touch, isn't keyboard-discoverable, and SR support is
 * inconsistent. sk-285.7.2.87 made it the product's own `SkeinTooltip`
 * rather than Mantine's.
 *
 * sk-408 — this chip left the table and lives in the per-user dialog
 * now. It varies only in an SSO deployment (every row reads «local»), and «how does this person
 * authenticate» is a detail rather than one of the three questions the
 * row exists to answer. */
function AuthBadge({ user }: { user: User }) {
  if (user.authMethod === 'keycloak') {
    return (
      <SkeinTooltip content="Auto-provisioned via Keycloak SSO" position="top">
        {/* sk-381 — was `color="blue" variant="filled"`. Mantine's builtin
          * blue is not derived from our tokens and does not move with the
          * theme, so the white ink hardcoded for `filled` measured 2.99:1
          * against `#339af0` in both themes. `variant="light"` is NOT the
          * fix either — its own pairing (blue ink on a 10% blue wash)
          * measured 2.48:1 in the LIGHT theme. So the chip takes the
          * dictionary's own wash idiom instead: `--info` ink on
          * `--info-t`, measured 4.90:1 light / 6.78:1 dark. Both roles
          * flip with the base, which is what keeps the pair honest in
          * either theme — the defect being repaired is precisely a fixed
          * ink on a ground that moves (white on `--info` measures 2.18:1
          * in dark). */}
        <Badge
          variant="light"
          size="sm"
          style={
            {
              '--badge-bg': 'var(--info-t)',
              '--badge-color': 'var(--info)',
              '--badge-bd': '1px solid transparent',
            } as CSSProperties
          }
        >
          Keycloak
        </Badge>
      </SkeinTooltip>
    );
  }
  if (user.authMethod === 'both') {
    return (
      <SkeinTooltip content="Local password + Keycloak SSO link" position="top">
        {/* sk-385 — was `color="teal" variant="light"`, measured 1.69
          * light / 10.40 dark. `--secondary` is the dictionary's own teal
          * and carries a matching wash: 5.35 / 5.92. */}
        <Badge
          variant="light"
          size="sm"
          style={
            {
              '--badge-bg': 'var(--secondary-t)',
              '--badge-color': 'var(--secondary)',
              '--badge-bd': '1px solid transparent',
            } as CSSProperties
          }
        >
          both
        </Badge>
      </SkeinTooltip>
    );
  }
  return (
    <SkeinTooltip content="Local password account" position="top">
      {/* sk-385 — was `color="gray" variant="outline"`. `outline` paints a
        * TRANSPARENT background, so the ink sits straight on the row
        * surface and the whole measurement is the ink: Mantine's
        * `gray-outline` measured 1.76 light / 14.19 dark — the widest
        * light/dark split of the four, and the clearest sign that a
        * builtin ramp is not tracking our bases at all. `--ink-2` on the
        * bare surface with a `--line` edge measures 8.57 / 9.45. */}
      <Badge
        variant="outline"
        size="sm"
        style={
          {
            '--badge-bg': 'transparent',
            '--badge-color': 'var(--ink-2)',
            '--badge-bd': '1px solid var(--line)',
          } as CSSProperties
        }
      >
        local
      </Badge>
    </SkeinTooltip>
  );
}

/**
 * sk-408 — the facts that left the table, on the card that already
 * existed.
 *
 * The maintainers allowed a popup ("a popup with more detailed
 * information could be made") but did not ask for one, and the row already opened a
 * dialog per user. A second dialog beside it would have duplicated a
 * title, a focus trap and an Escape handler to show four lines of text,
 * so the three retired columns landed in this one instead. `Email` leads
 * them, not because it left the row — it did not — but so the card can
 * be read on its own: the dialog is titled by the username, and the
 * username is the one identifier an admin is least likely to recognise.
 *
 * `State` is here rather than in the row because the LIST is filtered by
 * it server-side: within a view every row carries the same value (all rows), and the panel title, the row's dimming and the
 * row's own «Reactivate» button all already say which view this is.
 */
function UserFacts({ user }: { user: User }) {
  return (
    <dl className="settings-user-facts">
      <dt>Email</dt>
      <dd>{user.email}</dd>
      <dt>Auth</dt>
      <dd>
        <AuthBadge user={user} />
      </dd>
      <dt>Last login</dt>
      <dd>{formatTime(user.lastLoginAt)}</dd>
      <dt>State</dt>
      <dd>
        <span
          className={
            user.deactivatedAt
              ? 'settings-user-state-archived'
              : 'settings-user-state-active'
          }
          style={{ color: user.deactivatedAt ? 'var(--ink-3)' : 'var(--ok)' }}
        >
          {user.deactivatedAt ? 'archived' : 'active'}
        </span>
      </dd>
    </dl>
  );
}

export function NewUsersPage() {
  // Rules of Hooks: ALL hooks must run on every render before any
  // conditional return. The admin-gate `<Navigate />` below used to
  // short-circuit before `useAuthConfig` / `useState` / `useQuery` etc.,
  // which crashed React when `user.role` flipped live (e.g. SignalR
  // demotion). Keep hooks above the gate; gate on derived state.
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { t } = useTranslation('settings');
  const { t: tSpaces } = useTranslation('spaces');

  // sk-163 S8 — auth-mode shapes what "New user" can create.
  //   - local:            internal OR external users (free choice).
  //   - keycloak/hybrid:  internal users auto-provision on first SSO login,
  //                       so a manually-created internal (local-password)
  //                       account is non-functional. The only meaningful
  //                       manual create here is an EXTERNAL collaborator —
  //                       those are always local accounts. So the button
  //                       stays ENABLED in SSO modes, but the create modal
  //                       forces (and locks) the External checkbox on.
  const authConfig = useAuthConfig();
  const ssoMode =
    authConfig.data?.authMode === 'keycloak' ||
    authConfig.data?.authMode === 'hybrid';

  const [archivedView, setArchivedView] = useState(false);
  // sk-163 S8 — "External only" filter; drives the server-side ?external=true
  // query param (see usersQuery below), not a client-side row filter.
  const [externalOnly, setExternalOnly] = useState(false);

  // sk-163 S8 — the "External only" filter is applied SERVER-SIDE (so it's
  // correct across cursor pages, not just the first 100 rows). It MUST be in
  // the query key so toggling refetches.
  const usersQuery = useQuery<UserListResult>({
    queryKey: ['users-admin', archivedView, externalOnly],
    queryFn: () =>
      listUsers({
        archived: archivedView ? 'true' : 'false',
        external: externalOnly ? true : undefined,
        limit: 100,
      }),
    enabled: !!user && user.role === 'admin',
  });

  // sk-674.18 T058 — the spaces of the instance the checkboxes offer: the
  // admin's "my spaces" without personal ones (K1).
  const mySpacesQ = useMySpaces();
  const instanceSpaces = useMemo(
    () => (mySpacesQ.data?.items ?? []).filter((sp) => sp.kind !== 'personal'),
    [mySpacesQ.data],
  );
  // null — untouched: the default applies, the common space checked if
  // there is one (screens 1.14). Computed, not copied at opening: «my
  // spaces» may answer after the dialog opened.
  const [createSpacesPicked, setCreateSpaces] = useState<Set<string> | null>(null);
  const createSpaces = useMemo(
    () =>
      createSpacesPicked ??
      new Set(instanceSpaces.filter((sp) => sp.kind === 'common').map((sp) => sp.id)),
    [createSpacesPicked, instanceSpaces],
  );

  // Create flow.
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateUserPayload>({
    email: '',
    username: '',
    name: '',
    password: '',
    role: 'user',
    isExternal: false,
  });
  const [createError, setCreateError] = useState<string | null>(null);
  const createMutation = useMutation<User, Error, CreateUserPayload>({
    mutationFn: (payload) => createUser(payload),
    onSuccess: () => {
      setCreateOpen(false);
      setCreateForm({
        email: '',
        username: '',
        name: '',
        password: '',
        role: 'user',
        isExternal: false,
      });
      setCreateError(null);
      void queryClient.invalidateQueries({ queryKey: MY_SPACES_QUERY_PREFIX });
      return queryClient.invalidateQueries({ queryKey: ['users-admin'] });
    },
    onError: (err) => setCreateError(describeError(err, 'failed to create user')),
  });

  // sk-163 S8 — toggling the External checkbox forces role='user' (an
  // external account can never be admin — matches the server rule so the
  // UI never offers an invalid combo).
  const setExternal = (checked: boolean) =>
    setCreateForm((f) => ({
      ...f,
      isExternal: checked,
      role: checked ? 'user' : f.role,
    }));

  // Open the create modal with a clean form; in SSO modes external is the
  // only meaningful kind, so it's pre-checked (and locked in the modal).
  const openCreate = () => {
    setCreateError(null);
    setCreateForm({
      email: '',
      username: '',
      name: '',
      password: '',
      role: 'user',
      isExternal: ssoMode,
    });
    setCreateSpaces(null);
    setCreateOpen(true);
  };

  // Edit flow.
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [editForm, setEditForm] = useState<UpdateUserPayload>({});
  const [editError, setEditError] = useState<string | null>(null);
  // sk-674.18 T058 — the edited person's spaces: what is checked now
  // (`editSpaces`, null until the read answers) against what was read.
  const editSpacesQ = useQuery({
    queryKey: ['users-admin', 'spaces', editTarget?.id ?? ''],
    queryFn: () => getUserSpaces(editTarget!.id),
    enabled: editTarget !== null && !editTarget.isExternal,
    gcTime: 0,
  });
  const editSpacesRead = useMemo(
    () => new Set((editSpacesQ.data?.items ?? []).map((sp) => sp.id)),
    [editSpacesQ.data],
  );
  const editOwned = useMemo(
    () => new Set((editSpacesQ.data?.items ?? []).filter((sp) => sp.role === 'owner').map((sp) => sp.id)),
    [editSpacesQ.data],
  );
  const [editSpaces, setEditSpaces] = useState<Set<string> | null>(null);
  const shownEditSpaces = editSpaces ?? (editSpacesQ.isSuccess ? editSpacesRead : null);
  // The one dialog of consequences of the unchecked spaces (K6).
  const [spacesRemoval, setSpacesRemoval] = useState<UserSpacesPreview | null>(null);

  const editMutation = useMutation<
    void,
    Error,
    { id: string; payload: UpdateUserPayload; spaceIds: string[] | null }
  >({
    mutationFn: async ({ id, payload, spaceIds }) => {
      if (Object.keys(payload).length > 0) await updateUser(id, payload);
      if (spaceIds !== null) await putUserSpaces(id, spaceIds);
    },
    onSuccess: (_res, vars) => {
      setEditTarget(null);
      setEditForm({});
      setEditError(null);
      setEditSpaces(null);
      setSpacesRemoval(null);
      if (vars.spaceIds !== null) void queryClient.invalidateQueries({ queryKey: MY_SPACES_QUERY_PREFIX });
      return queryClient.invalidateQueries({ queryKey: ['users-admin'] });
    },
    onError: (err) => {
      setSpacesRemoval(null);
      setEditError(describeError(err, 'failed to update user'));
    },
  });
  const spacesPreviewMutation = useMutation<
    UserSpacesPreview,
    Error,
    { id: string; spaceIds: string[] }
  >({
    mutationFn: ({ id, spaceIds }) => previewUserSpaces(id, spaceIds),
    onSuccess: (preview) => setSpacesRemoval(preview),
    onError: (err) => setEditError(describeError(err, 'failed to count the consequences')),
  });

  // Deactivate / reactivate flow.
  const [confirmDeactivate, setConfirmDeactivate] = useState<User | null>(null);
  // sk-674.18 T058 — what the person owns, named in the deactivation dialog.
  const deactivateSpacesQ = useQuery({
    queryKey: ['users-admin', 'spaces', confirmDeactivate?.id ?? ''],
    queryFn: () => getUserSpaces(confirmDeactivate!.id),
    enabled: confirmDeactivate !== null && !confirmDeactivate.isExternal,
    gcTime: 0,
  });
  const deactivateOwned = (deactivateSpacesQ.data?.items ?? []).filter((sp) => sp.role === 'owner');
  const [confirmReactivate, setConfirmReactivate] = useState<User | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const deactivateMutation = useMutation<void, Error, string>({
    mutationFn: (id) => deactivateUser(id),
    onSuccess: () => {
      setConfirmDeactivate(null);
      setActionError(null);
      return queryClient.invalidateQueries({ queryKey: ['users-admin'] });
    },
    onError: (err) => setActionError(describeError(err, 'failed to deactivate user')),
  });
  const reactivateMutation = useMutation<void, Error, string>({
    mutationFn: (id) => reactivateUser(id),
    onSuccess: () => {
      setConfirmReactivate(null);
      setActionError(null);
      return queryClient.invalidateQueries({ queryKey: ['users-admin'] });
    },
    onError: (err) => setActionError(describeError(err, 'failed to reactivate user')),
  });

  const rows = useMemo(() => usersQuery.data?.items ?? [], [usersQuery.data]);
  const listError = usersQuery.error
    ? describeError(usersQuery.error, 'failed to load users')
    : null;

  // Admin gate. Placed AFTER all hooks (Rules of Hooks). API also
  // returns 403 not_admin, but bouncing client-side avoids a flash of
  // an empty table for non-admin visitors arriving via a deep link.
  if (user && user.role !== 'admin') {
    return <Navigate to="/settings/api-keys" replace />;
  }

  return (
    <SettingsLayout active="users">
      <SettingsPanel
        title={archivedView ? 'Archived users' : 'Active users'}
        description="Manage team members. Deactivating a user blocks their login and revokes all of their API keys."
        actions={
          <Group gap="sm">
            <Switch
              size="sm"
              label="External only"
              checked={externalOnly}
              onChange={(e) => setExternalOnly(e.currentTarget.checked)}
            />
            <Switch
              size="sm"
              label="Show archived"
              checked={archivedView}
              onChange={(e) => setArchivedView(e.currentTarget.checked)}
            />
            {/* sk-163 S8 — the button is enabled in ALL auth modes: in SSO
                modes it creates EXTERNAL (local) collaborator accounts, which
                the modal pre-checks and locks. The tooltip only appears in SSO
                modes to explain that internal users provision via SSO. */}
            <SkeinTooltip
              content="In SSO mode this creates external (local) collaborator accounts. Internal users auto-provision on first SSO login."
              disabled={!ssoMode}
              width={280}
              position="bottom"
            >
              <Button
                variant="filled"
                size="sm"
                onClick={openCreate}
                /* sk-285.7.2.88 — `plus`, §8's name for it; was U+002B. */
                leftSection={<IconPlus size={16} stroke={1.75} aria-hidden />}
              >
                New user
              </Button>
            </SkeinTooltip>
          </Group>
        }
      >
        {listError ? (
          <Alert variant="light" title="Failed to load users" style={ERROR_ALERT_VARS}>
            {listError}
          </Alert>
        ) : null}

        {actionError ? (
          <Alert
            variant="light"
            title="Action failed"
            style={ERROR_ALERT_VARS}
            withCloseButton
            onClose={() => setActionError(null)}
          >
            {actionError}
          </Alert>
        ) : null}

        {usersQuery.isLoading ? (
          <div className="settings-loading">
            <Loader size="sm" />
          </div>
        ) : rows.length === 0 ? (
          <div className="settings-empty">
            {archivedView
              ? 'No archived users.'
              : 'No active users — create one to get started.'}
          </div>
        ) : (
          <Table verticalSpacing="xs" striped={false} highlightOnHover={false}>
            <Table.Caption className="sr-only">Users</Table.Caption>
            <Table.Thead>
              <Table.Tr>
                {/* sk-408 — four columns, down from eight. The row answers
                  * «who is this», «what may they do» and «what can I do
                  * about it»; `Auth`, `Last login` and `State` were the
                  * details and moved into the per-user dialog. The
                  * arithmetic that forced the cut, and the argument for
                  * this particular composition, are in
                  * `UsersTableFit.test.tsx`. */}
                <Table.Th scope="col">User</Table.Th>
                <Table.Th scope="col">Email</Table.Th>
                <Table.Th scope="col" style={{ minWidth: 132 }}>Role</Table.Th>
                <Table.Th scope="col" style={{ textAlign: 'right' }}>Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((u) => {
                const isDeactivated = !!u.deactivatedAt;
                return (
                  <Table.Tr
                    key={u.id}
                    className={isDeactivated ? 'settings-row-muted' : undefined}
                  >
                    <Table.Td>
                      <UserIdentity user={u} />
                    </Table.Td>
                    <Table.Td style={{ color: 'var(--ink-2)' }}>
                      {u.email}
                    </Table.Td>
                    <Table.Td>
                      <RoleBadges user={u} />
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      <Group gap={4} justify="flex-end" wrap="nowrap">
                        <Button
                          variant="subtle"
                          size="compact-xs"
                          onClick={() => {
                            setEditTarget(u);
                            setEditForm({});
                            setEditSpaces(null);
                            setEditError(null);
                          }}
                        >
                          Edit
                        </Button>
                        {isDeactivated ? (
                          <Button
                            variant="subtle"
                            size="compact-xs"
                            onClick={() => setConfirmReactivate(u)}
                          >
                            Reactivate
                          </Button>
                        ) : (
                          <Button
                            variant="subtle"
                            color="red"
                            size="compact-xs"
                            onClick={() => setConfirmDeactivate(u)}
                          >
                            Deactivate
                          </Button>
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

      {/* Create modal */}
      <Modal
        opened={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create user"
        centered
        withinPortal
      >
        <Box
          component="form"
          onSubmit={(e: React.FormEvent) => {
            e.preventDefault();
            const email = createForm.email.trim();
            const name = createForm.name.trim();
            if (!email || !name || !createForm.password) {
              setCreateError('Email, name, and password are required.');
              return;
            }
            if (createForm.password.length < 8) {
              setCreateError('Password must be at least 8 characters.');
              return;
            }
            createMutation.mutate({
              email,
              username: (createForm.username ?? '').trim() || undefined,
              name,
              password: createForm.password,
              // External accounts are always role='user' (server enforces
              // this too — external + admin is rejected).
              role: createForm.isExternal ? 'user' : createForm.role,
              isExternal: createForm.isExternal,
              // sk-674.18 T058 — external users are outside spaces. The set
              // is sent only when there is something to decide from: «my
              // spaces» answered, or the person ticked the boxes. Otherwise
              // it is omitted — the contract's default, the common space —
              // never an empty set nobody chose.
              ...(createForm.isExternal || (createSpacesPicked === null && !mySpacesQ.isSuccess)
                ? {}
                : { spaceIds: [...createSpaces] }),
            });
          }}
        >
          <Stack gap="sm">
            {createError ? (
              <Alert variant="light" style={ERROR_ALERT_VARS}>
                {createError}
              </Alert>
            ) : null}
            {/* autoComplete="off" on user-info fields — the admin is
                typing someone else's data, not autofilling their own.
                autoComplete="new-password" tells password managers this
                is a new-account password (offer-to-generate / never
                store as the admin's own credentials). WCAG 1.3.5. */}
            <TextInput
              label="Email"
              required
              type="email"
              autoComplete="off"
              value={createForm.email}
              onChange={(e) =>
                setCreateForm({ ...createForm, email: e.currentTarget.value })
              }
            />
            <TextInput
              label="Username (optional)"
              autoComplete="off"
              value={createForm.username ?? ''}
              onChange={(e) =>
                setCreateForm({ ...createForm, username: e.currentTarget.value })
              }
              description="Auto-derived from email if left blank."
            />
            <TextInput
              label="Name"
              required
              autoComplete="off"
              value={createForm.name}
              onChange={(e) =>
                setCreateForm({ ...createForm, name: e.currentTarget.value })
              }
            />
            <PasswordInput
              label="Password"
              required
              minLength={8}
              autoComplete="new-password"
              value={createForm.password}
              onChange={(e) =>
                setCreateForm({ ...createForm, password: e.currentTarget.value })
              }
            />
            <Select
              label="Role"
              data={[
                { value: 'user', label: 'user' },
                { value: 'admin', label: 'admin' },
              ]}
              value={createForm.role}
              disabled={createForm.isExternal}
              description={
                createForm.isExternal
                  ? 'External users are always role=user.'
                  : undefined
              }
              onChange={(v) =>
                setCreateForm({
                  ...createForm,
                  role: (v as 'user' | 'admin') ?? 'user',
                })
              }
            />
            {/* sk-163 S8 — external collaborator toggle. Locked ON in SSO
                modes (the only meaningful manual create there is external).
                Forces role=user (an external can never be admin). */}
            <Checkbox
              label="External user (collaborator outside the organization)"
              checked={!!createForm.isExternal}
              disabled={ssoMode}
              description={
                ssoMode
                  ? 'In SSO mode only external (local) accounts can be created here — internal users provision via SSO.'
                  : 'External users authenticate with a local password and are scoped to the projects you add them to.'
              }
              onChange={(e) => setExternal(e.currentTarget.checked)}
            />
            {!createForm.isExternal && mySpacesQ.isError ? (
              <Alert variant="light" style={ERROR_ALERT_VARS}>
                {t('users.spacesUnavailable')}
              </Alert>
            ) : null}
            {!createForm.isExternal && instanceSpaces.length > 0 ? (
              <UserSpacesField
                spaces={instanceSpaces}
                checked={createSpaces}
                memberOf={new Set()}
                owned={new Set()}
                onChange={setCreateSpaces}
              />
            ) : null}
            {createForm.isExternal ? (
              <Alert color="orange" variant="light" title="Adding externals to projects">
                <Text size="sm">
                  Add this user only to{' '}
                  <strong>dedicated, external-facing projects</strong>. Adding
                  an external collaborator to an internal project exposes that
                  project&apos;s member roster and full backlog to them. They
                  can never be made admin or project owner.
                </Text>
              </Alert>
            ) : null}
            <Group justify="flex-end" gap="sm">
              <Button
                type="button"
                variant="default"
                onClick={() => setCreateOpen(false)}
                disabled={createMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="filled"
                loading={createMutation.isPending}
              >
                Create
              </Button>
            </Group>
          </Stack>
        </Box>
      </Modal>

      {/* Edit modal */}
      <Modal
        opened={!!editTarget}
        onClose={() => {
          setEditTarget(null);
          setEditSpaces(null);
        }}
        title={editTarget ? `Edit ${editTarget.username}` : 'Edit user'}
        centered
        withinPortal
      >
        {editTarget ? (
          <Box
            component="form"
            onSubmit={(e: React.FormEvent) => {
              e.preventDefault();
              const payload: UpdateUserPayload = {};
              if (editForm.name !== undefined && editForm.name !== editTarget.name) {
                payload.name = editForm.name;
              }
              if (editForm.role !== undefined && editForm.role !== editTarget.role) {
                payload.role = editForm.role;
              }
              if (editForm.password) {
                if (editForm.password.length < 8) {
                  setEditError('Password must be at least 8 characters.');
                  return;
                }
                payload.password = editForm.password;
              }
              // sk-674.18 T058 — the spaces, if changed: unchecked ones are
              // removals, shown in one dialog before anything is saved.
              const wanted = shownEditSpaces;
              const spacesChanged =
                wanted !== null &&
                (wanted.size !== editSpacesRead.size || [...wanted].some((id) => !editSpacesRead.has(id)));
              const spaceIds = spacesChanged && wanted !== null ? [...wanted] : null;
              if (Object.keys(payload).length === 0 && spaceIds === null) {
                setEditTarget(null);
                return;
              }
              const removed = [...editSpacesRead].filter((id) => !(wanted?.has(id) ?? true));
              if (spaceIds !== null && removed.length > 0) {
                spacesPreviewMutation.mutate({ id: editTarget.id, spaceIds });
                return;
              }
              editMutation.mutate({ id: editTarget.id, payload, spaceIds });
            }}
          >
            <Stack gap="sm">
              {editError ? (
                <Alert variant="light" style={ERROR_ALERT_VARS}>
                  {editError}
                </Alert>
              ) : null}
              {/* sk-408 — the read-only half of the card: the three
                * columns that left the table, plus the email that
                * identifies whose card this is. Above the form, because
                * it is what you came to read; not inside it, because
                * none of it is editable here. */}
              <UserFacts user={editTarget} />
              <TextInput
                label="Name"
                defaultValue={editTarget.name}
                onChange={(e) =>
                  setEditForm({ ...editForm, name: e.currentTarget.value })
                }
              />
              <Select
                label="Role"
                data={[
                  { value: 'user', label: 'user' },
                  { value: 'admin', label: 'admin' },
                ]}
                defaultValue={editTarget.role}
                // sk-163 — an external account is permanently capped at
                // role='user' (the server rejects external→admin). Lock the
                // control so the UI never offers the invalid combo.
                disabled={editTarget.isExternal}
                description={
                  editTarget.isExternal
                    ? 'External users are always role=user.'
                    : undefined
                }
                onChange={(v) =>
                  setEditForm({
                    ...editForm,
                    role: (v as 'user' | 'admin') ?? undefined,
                  })
                }
              />
              {!editTarget.isExternal && instanceSpaces.length > 0 ? (
                editSpacesQ.isError ? (
                  <Alert variant="light" style={ERROR_ALERT_VARS}>
                    {t('users.spacesLoadFailed')}
                  </Alert>
                ) : shownEditSpaces === null ? (
                  <Loader size="sm" />
                ) : (
                  <UserSpacesField
                    spaces={instanceSpaces}
                    checked={shownEditSpaces}
                    memberOf={editSpacesRead}
                    owned={editOwned}
                    onChange={setEditSpaces}
                  />
                )
              ) : null}
              <PasswordInput
                label="Reset password (optional, min 8 chars)"
                placeholder="Leave blank to keep current"
                minLength={8}
                autoComplete="new-password"
                onChange={(e) =>
                  setEditForm({
                    ...editForm,
                    password: e.currentTarget.value || undefined,
                  })
                }
              />
              <Group justify="flex-end" gap="sm">
                <Button
                  type="button"
                  variant="default"
                  onClick={() => setEditTarget(null)}
                  disabled={editMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="filled"
                  loading={editMutation.isPending || spacesPreviewMutation.isPending}
                >
                  Save
                </Button>
              </Group>
            </Stack>
          </Box>
        ) : null}
      </Modal>

      <ConfirmDialog
        opened={!!confirmDeactivate}
        title="Deactivate user"
        message={
          confirmDeactivate ? (
            <>
              {`Deactivating "${confirmDeactivate.username}" will block their login and revoke all of their API keys. Continue?`}
              {'\n'}
              {t('users.deactivateKeeps')}
              {deactivateOwned.length > 0 ? (
                <>
                  {'\n'}
                  {t('users.ownsLead')} <OwnedSpacesLinks spaces={deactivateOwned} /> {t('users.ownsTail')}
                </>
              ) : null}
            </>
          ) : (
            ''
          )
        }
        loading={deactivateMutation.isPending}
        danger
        onConfirm={() => {
          if (confirmDeactivate) deactivateMutation.mutate(confirmDeactivate.id);
        }}
        onCancel={() => setConfirmDeactivate(null)}
      />

      {spacesRemoval !== null && editTarget !== null ? (
        <Modal
          opened
          onClose={() => setSpacesRemoval(null)}
          title={t('users.removalTitle', { name: editTarget.username })}
          centered
          withinPortal
        >
          <Stack gap="sm">
            {spacesRemoval.removed.map((sp) => (
              <section key={sp.id} className="users-space-removal">
                <Text fw={600} size="sm">
                  {sp.name}
                </Text>
                <ul className="space-consequences">
                  {removalLines(tSpaces, sp, editTarget.username).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </section>
            ))}
            <Group justify="flex-end" gap="sm">
              <Button variant="default" onClick={() => setSpacesRemoval(null)} disabled={editMutation.isPending}>
                {t('users.removalCancel')}
              </Button>
              <Button
                color="red"
                loading={editMutation.isPending}
                onClick={() => {
                  const payload: UpdateUserPayload = {};
                  if (editForm.name !== undefined && editForm.name !== editTarget.name) payload.name = editForm.name;
                  if (editForm.role !== undefined && editForm.role !== editTarget.role) payload.role = editForm.role;
                  if (editForm.password) payload.password = editForm.password;
                  editMutation.mutate({
                    id: editTarget.id,
                    payload,
                    spaceIds: shownEditSpaces === null ? null : [...shownEditSpaces],
                  });
                }}
              >
                {t('users.removalConfirm')}
              </Button>
            </Group>
          </Stack>
        </Modal>
      ) : null}

      <ConfirmDialog
        opened={!!confirmReactivate}
        title="Reactivate user"
        message={
          confirmReactivate
            ? `Reactivate "${confirmReactivate.username}"? Previously revoked API keys will NOT be re-armed; they must be reissued.`
            : ''
        }
        loading={reactivateMutation.isPending}
        onConfirm={() => {
          if (confirmReactivate) reactivateMutation.mutate(confirmReactivate.id);
        }}
        onCancel={() => setConfirmReactivate(null)}
      />
    </SettingsLayout>
  );
}

/**
 * sk-674.18 T058 — the checkboxes of an account's spaces (screens 1.14,
 * K6). `memberOf` — where the person is now (a full space does not lock a
 * box they already hold); `owned` — spaces they own: checked and locked
 * until the owner is changed in that space's settings (2.14).
 */
function UserSpacesField({
  spaces,
  checked,
  memberOf,
  owned,
  onChange,
}: {
  spaces: MySpace[];
  checked: Set<string>;
  memberOf: Set<string>;
  owned: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const { t } = useTranslation('settings');
  const { t: tSpaces } = useTranslation('spaces');
  return (
    <Checkbox.Group
      label={t('users.spacesLabel')}
      description={t('users.spacesHint')}
      value={[...checked]}
      onChange={(ids) => {
        // An owned space stays checked whatever the group reports.
        const next = new Set(ids);
        for (const id of owned) next.add(id);
        onChange(next);
      }}
    >
      <Stack gap={6} mt={6}>
        {spaces.map((sp) => {
          const isOwner = owned.has(sp.id);
          const full = noSeatsLeft(sp) && !memberOf.has(sp.id);
          const seats = full ? seatsLabel(tSpaces, sp) : null;
          return (
            <div key={sp.id} className="users-space-option">
              <Checkbox value={sp.id} label={sp.name} disabled={isOwner || (full && !checked.has(sp.id))} />
              {isOwner ? (
                <Text size="xs" className="users-space-hint">
                  {t('users.ownerLocked')} —{' '}
                  <Link to={`/settings/spaces/${spaceHandle(sp)}`}>
                    {t('users.changeOwnerLink', { name: sp.name })}
                  </Link>
                </Text>
              ) : seats !== null ? (
                <Text size="xs" className="users-space-hint">
                  {seats}
                </Text>
              ) : null}
            </div>
          );
        })}
      </Stack>
    </Checkbox.Group>
  );
}

/** «Backend, Acme» — each a link to the space's settings, where the owner is changed. */
function OwnedSpacesLinks({ spaces }: { spaces: { id: string; slug: string; name: string }[] }) {
  return (
    <>
      {spaces.map((sp, i) => (
        <span key={sp.id}>
          {i > 0 ? ', ' : ''}
          <Link to={`/settings/spaces/${spaceHandle(sp)}`}>{sp.name}</Link>
        </span>
      ))}
    </>
  );
}

/** The consequences of removing a person from one space — as the removal dialog of 2.3 names them. */
function removalLines(
  t: (key: string, opts?: Record<string, unknown>) => string,
  sp: { name: string; openAssignedIssues: number; claimedIssues: number; ownedProjects: { name: string }[] },
  username: string,
): string[] {
  const lines: string[] = [];
  if (sp.openAssignedIssues > 0) lines.push(t('removal.openAssigned', { count: sp.openAssignedIssues }));
  if (sp.claimedIssues > 0) lines.push(t('removal.claims', { name: username }));
  lines.push(t('removal.projects', { name: username, space: sp.name }));
  if (sp.ownedProjects.length > 0) {
    lines.push(
      t('removal.owned', {
        name: username,
        space: sp.name,
        projects: sp.ownedProjects.map((p) => p.name).join(', '),
      }),
    );
  }
  lines.push(t('removal.keys', { name: username, space: sp.name }));
  lines.push(t('removal.history', { name: username }));
  return lines;
}
