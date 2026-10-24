import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Group,
  Loader,
  Stack,
  Switch,
  Table,
  Text,
} from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useAuth } from '../../../auth/AuthContext';
import { ApiError, BusinessError } from '../../../api/client';
import {
  ReasonChannelName,
  ReasonPrefs,
  ReasonRow,
  UpdateReasonPrefsInput,
  diffReasonPrefs,
  getReasonPrefs,
  hasReasonPrefsChanges,
  setReasonChannel,
  updateReasonPrefs,
} from '../../../api/notification-reasons';
import { reasonPrefsQueryKey } from '../../../lib/useReasonPrefsProbe';
import { IssueCreatePrefsSection } from './IssueCreatePrefsSection';
import { PushDevicesSection } from './PushDevicesSection';
import { ReviewPrefsSection } from './ReviewPrefsSection';
import { SettingsLayout, SettingsPanel } from './SettingsLayout';
import { ERR_ALERT_VARS, INFO_ALERT_VARS, OK_ALERT_VARS } from '../../../lib/mantineVariantVars';

/**
 * /settings/notifications — THE notification settings form (sk-303.13 / US-1).
 *
 * One page instead of three. Each row is a REASON; it has two independent
 * switches, "Feed" and "Push". The page owns no vocabulary of its own: the
 * rows, their names, their captions and which channels they even have all
 * arrive from the server registry, so a reason added or retired server-side
 * shows up here without a frontend release.
 *
 * Three rules the markup exists to keep:
 *
 *   - A channel a reason does not have gets an em dash with an explanation,
 *     never a switch that happens to be off. A switch that changes nothing is
 *     the defect (sk-87) this whole wave removes, and an off switch is a
 *     promise that turning it on would do something.
 *   - The caption under a reason's name is the SERVER's, because the two
 *     channels of one reason legitimately reach different people — the feed of
 *     "Delegated-issue status" goes to everyone subscribed, its push
 *     only to the person who delegated. A caption written here would sooner or
 *     later promise "delegated only" for the feed as well.
 *   - Saving sends only what the user actually changed. Reasons this build
 *     never rendered — reserved ones, or ones a newer server knows about —
 *     are not named in the body and therefore keep their stored state.
 *
 * Not on this page, deliberately: reserved reasons (their mechanics arrive in
 * later waves, so their switch would do nothing — Q10), the subscription
 * event-type filters (those belong to a SUBSCRIPTION, not to a channel — R-4 /
 * Q1), and the default inbox scope (the server never read it — Q2; it is not
 * coming back). Agent-action suppression stays on the page but OUTSIDE the
 * reason table: it is not a reason, it is a filter across the whole
 * subscription path. Device management is likewise not a reason and keeps its
 * own block.
 */

/**
 * Panel description that explains the agent-action suppression checkbox.
 *
 * The wording has to carry two facts the user cannot infer from the label, and
 * sk-335 changed the first one: the setting covers ANY agent, not only the
 * reader's own, and it silences only what they merely WATCH — anything
 * addressed to them personally still arrives. Without the second half the
 * checkbox reads as "switch my notifications off", which is not what it does
 * and would stop people using it at all: in this system almost every action is
 * an agent's.
 */
const SUPPRESS_HELP_ID = 'suppress-agent-help';
const UNWATCH_ON_CLOSE_HELP_ID = 'unwatch-on-close-help';

/**
 * sk-396 — the channel name comes from the dictionary, but the channel KEY stays
 * machine (`feed` / `push`): it is a protocol field name, not a label.
 */
const CHANNEL_LABEL_KEY: Record<ReasonChannelName, string> = {
  feed: 'reasons.channels.feed',
  push: 'reasons.channels.push',
};

export function NewNotificationsPage() {
  const { t } = useTranslation('notifications');
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [savedNotice, setSavedNotice] = useState(false);

  const prefsQuery = useQuery<ReasonPrefs>({
    queryKey: reasonPrefsQueryKey,
    queryFn: getReasonPrefs,
    enabled: !!user,
  });

  // `base` is the last payload the server gave us, `draft` is what the user
  // sees. The pair is the whole save mechanism: the body is their difference,
  // so an untouched row is never named and cannot be overwritten.
  const [base, setBase] = useState<ReasonPrefs | null>(null);
  const [draft, setDraft] = useState<ReasonPrefs | null>(null);
  const [dirty, setDirty] = useState(false);
  const justSavedRef = useRef(false);

  useEffect(() => {
    if (!prefsQuery.data) return;
    if (dirty) return;
    if (justSavedRef.current) {
      justSavedRef.current = false;
      return;
    }
    setBase(prefsQuery.data);
    setDraft(prefsQuery.data);
  }, [prefsQuery.data, dirty]);

  const saveMutation = useMutation<ReasonPrefs, Error, UpdateReasonPrefsInput>({
    mutationFn: (input) => updateReasonPrefs(input),
    onSuccess: (saved) => {
      // The PUT answers with the same payload as the GET, so the form
      // re-renders from the authority rather than from its own guess.
      justSavedRef.current = true;
      queryClient.setQueryData(reasonPrefsQueryKey, saved);
      setBase(saved);
      setDraft(saved);
      setSavedNotice(true);
      setDirty(false);
    },
  });

  const onSave = () => {
    if (base === null || draft === null) return;
    setSavedNotice(false);
    saveMutation.mutate(diffReasonPrefs(base, draft));
  };

  const onCancel = () => {
    navigate('/');
  };

  const errorMessage = (() => {
    const err = prefsQuery.error ?? saveMutation.error;
    if (!err) return null;
    // A 422 here is a business answer, not a crash: `unknown_reason`,
    // `reason_not_settable` or `channel_not_applicable`, and in every one of
    // them the server wrote nothing.
    if (err instanceof BusinessError || err instanceof ApiError) {
      return err.message;
    }
    if (err instanceof Error) return err.message;
    return t('loadFailed');
  })();

  const toggleChannel = (
    reasonKey: string,
    channel: ReasonChannelName,
    enabled: boolean,
  ) => {
    setDirty(true);
    setDraft((prev) =>
      prev === null ? prev : setReasonChannel(prev, reasonKey, channel, enabled),
    );
  };

  const toggleSuppression = (checked: boolean) => {
    setDirty(true);
    setDraft((prev) =>
      prev === null ? prev : { ...prev, suppressAgentActions: checked },
    );
  };

  const toggleUnwatchOnClose = (checked: boolean) => {
    setDirty(true);
    setDraft((prev) => (prev === null ? prev : { ...prev, unwatchOnClose: checked }));
  };

  const pending =
    base !== null && draft !== null ? diffReasonPrefs(base, draft) : {};
  const canSave = draft !== null && hasReasonPrefsChanges(pending);

  return (
    <SettingsLayout active="notifications">
      <Alert variant="light" style={INFO_ALERT_VARS} title={t('intro.title')} mb="lg">
        {t('intro.body')}
      </Alert>

      {savedNotice ? (
        <Box role="status" aria-live="polite">
          <Alert
            variant="light"
            style={OK_ALERT_VARS}
            title={t('saved.title')}
            withCloseButton
            closeButtonLabel={t('saved.dismiss')}
            onClose={() => setSavedNotice(false)}
          >
            {t('saved.body')}
          </Alert>
        </Box>
      ) : null}

      {errorMessage ? (
        <Alert variant="light" style={ERR_ALERT_VARS} title={t('error')}>
          {errorMessage}
        </Alert>
      ) : null}

      {/* Three states, kept apart on purpose. The form cannot be drawn without
        * the server registry, so "no draft" used to mean "keep spinning" — and
        * a failed GET, which never retries (retry: false) and never refetches
        * on focus, left a permanent spinner beside a red alert with nothing to
        * press. The draft comes first so a failed BACKGROUND refetch does not
        * throw away what the user is editing. */}
      {draft !== null ? (
        <Box
          component="form"
          onSubmit={(e: React.FormEvent) => {
            e.preventDefault();
            onSave();
          }}
        >
          <Stack gap="xl">
            <SettingsPanel
              title={t('reasons.title')}
              description={t('reasons.description')}
            >
              <ReasonTable rows={draft.reasons} onToggle={toggleChannel} t={t} />
            </SettingsPanel>

            <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
              <legend className="sr-only">{t('agent.legend')}</legend>
              <SettingsPanel
                title={t('agent.title')}
                description={t('agent.description')}
                descriptionId={SUPPRESS_HELP_ID}
              >
                <Checkbox
                  checked={draft.suppressAgentActions}
                  onChange={(e) => toggleSuppression(e.currentTarget.checked)}
                  label={t('agent.checkbox')}
                  // The panel description IS this checkbox's explanation. The
                  // deleted legacy page tied the two together; the rewrite put
                  // the text in a panel header, where a screen-reader user
                  // sitting on the control cannot reach it.
                  aria-describedby={SUPPRESS_HELP_ID}
                />
              </SettingsPanel>
            </fieldset>

            <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
              <legend className="sr-only">{t('unwatchOnClose.legend')}</legend>
              <SettingsPanel
                title={t('unwatchOnClose.title')}
                description={t('unwatchOnClose.description')}
                descriptionId={UNWATCH_ON_CLOSE_HELP_ID}
              >
                <Checkbox
                  checked={draft.unwatchOnClose}
                  onChange={(e) => toggleUnwatchOnClose(e.currentTarget.checked)}
                  label={t('unwatchOnClose.checkbox')}
                  aria-describedby={UNWATCH_ON_CLOSE_HELP_ID}
                />
              </SettingsPanel>
            </fieldset>

            <Group gap="sm">
              <Button
                variant="filled"
                size="sm"
                type="submit"
                loading={saveMutation.isPending}
                disabled={!canSave}
              >
                {t('save')}
              </Button>
              <Button
                variant="default"
                size="sm"
                type="button"
                onClick={onCancel}
              >
                {t('cancel')}
              </Button>
            </Group>
          </Stack>
        </Box>
      ) : prefsQuery.isLoading ? (
        <div className="settings-loading" role="status" aria-live="polite">
          <Loader size="sm" aria-hidden="true" />
          <span className="sr-only">{t('loading')}</span>
        </div>
      ) : prefsQuery.isError ? (
        <Group gap="sm">
          <Button
            variant="default"
            size="sm"
            type="button"
            loading={prefsQuery.isFetching}
            onClick={() => void prefsQuery.refetch()}
          >
            {t('retry')}
          </Button>
        </Group>
      ) : null}

      {/* sk-303.14 (T029) — the review workflow's own five settings.
       *  OUTSIDE the reason form, not inside it, and not merely for tidiness:
       *  this panel owns a <form> of its own, and a nested form is invalid
       *  markup the browser silently drops — its Save button would then
       *  submit the REASON form instead. Its own query, draft and save also
       *  keep an out-of-range schedule refusal from blocking a perfectly
       *  good change of a notification channel. */}
      <Box mt="xl">
        <ReviewPrefsSection />
      </Box>

      {/* sk-565 (US-8, D8) — the personal self-assignment setting. A panel of
       *  its own, outside both forms above: it saves the moment the switch
       *  is flipped, has no draft and no Save button, and must neither ride
       *  along with nor be blocked by the reason form or the review form. */}
      <Box mt="xl">
        <IssueCreatePrefsSection />
      </Box>

      <Box mt="xl">
        <PushDevicesSection />
      </Box>
    </SettingsLayout>
  );
}

interface ReasonTableProps {
  rows: ReasonRow[];
  onToggle: (
    reasonKey: string,
    channel: ReasonChannelName,
    enabled: boolean,
  ) => void;
  /**
   * sk-396 — the dictionary is passed as a PROP, not taken by its own
   * `useTranslation`: both tables are parts of one page, and a second
   * independent call would let them one day drift apart in namespaces.
   */
  t: TFunction<'notifications'>;
}

/**
 * The reason × channel matrix. Rows keep the server's order — this side
 * neither sorts nor groups, having nothing to group by that the server did not
 * send.
 */
function ReasonTable({ rows, onToggle, t }: ReasonTableProps) {
  if (rows.length === 0) {
    return (
      <Text size="sm" c="var(--ink-2)">
        {t('reasons.empty')}
      </Text>
    );
  }

  return (
    <Table verticalSpacing="sm" horizontalSpacing="md">
      {/* The panel heading sits outside the <table>, so table-by-table
        * navigation would otherwise land on an unnamed grid — and this page
        * has a second block below it. */}
      <Table.Caption className="sr-only">{t('reasons.tableCaption')}</Table.Caption>
      <Table.Thead>
        <Table.Tr>
          <Table.Th scope="col">{t('reasons.columnReason')}</Table.Th>
          <Table.Th scope="col" style={{ width: 120 }}>
            {t(CHANNEL_LABEL_KEY.feed)}
          </Table.Th>
          <Table.Th scope="col" style={{ width: 120 }}>
            {t(CHANNEL_LABEL_KEY.push)}
          </Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((row) => (
          <Table.Tr key={row.key}>
            <Table.Th scope="row" style={{ fontWeight: 400 }}>
              <Text size="sm" fw={600}>
                {row.label}
              </Text>
              {row.hint !== '' ? (
                <Text size="xs" c="var(--ink-2)">
                  {row.hint}
                </Text>
              ) : null}
            </Table.Th>
            <ChannelCell row={row} channel="feed" onToggle={onToggle} t={t} />
            <ChannelCell row={row} channel="push" onToggle={onToggle} t={t} />
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

interface ChannelCellProps {
  row: ReasonRow;
  channel: ReasonChannelName;
  onToggle: ReasonTableProps['onToggle'];
  t: ReasonTableProps['t'];
}

/**
 * One cell. An inapplicable channel renders an em dash carrying its
 * explanation — not a disabled switch, which would still read as "this could
 * be turned on".
 */
function ChannelCell({ row, channel, onToggle, t }: ChannelCellProps) {
  const cell = row[channel];
  const channelName = t(CHANNEL_LABEL_KEY[channel]);

  if (!cell.applicable) {
    const explanation = t('reasons.noChannel', {
      reason: row.label,
      channel: channelName,
    });
    return (
      <Table.Td>
        {/* The glyph is decoration; the explanation is TEXT. `aria-label` on a
          * roleless <span> is not reliably used for the accessible name, and
          * `title` reaches neither keyboard nor touch — a screen reader would
          * hear an empty cell where the whole point is to hear "no channel". */}
        <Text component="span" c="var(--ink-2)" aria-hidden="true">
          —
        </Text>
        <span className="sr-only">{explanation}</span>
      </Table.Td>
    );
  }

  return (
    <Table.Td>
      <Switch
        size="sm"
        checked={cell.enabled}
        onChange={(e) => onToggle(row.key, channel, e.currentTarget.checked)}
        aria-label={t('reasons.switchAria', { reason: row.label, channel: channelName })}
      />
    </Table.Td>
  );
}
