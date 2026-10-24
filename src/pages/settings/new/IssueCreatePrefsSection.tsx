import { Alert, Box, Group, Loader, Stack, Switch } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type IssueCreatePrefs,
  type UpdateIssueCreatePrefsInput,
  getIssueCreatePrefs,
  updateIssueCreatePrefs,
} from '../../../api/issue-create-prefs';
import { ERR_ALERT_VARS } from '../../../lib/mantineVariantVars';
import { SettingsPanel } from './SettingsLayout';

/** Query key — exported so other surfaces can invalidate or seed it. */
export const issueCreatePrefsQueryKey = ['issue-create-prefs'] as const;

/**
 * Mutation key of the save. The «a save is in flight» state is read from the
 * mutation CACHE through it (`useIsMutating`), not from this component's own
 * `useMutation` observer — so a panel mounted again while an earlier save is
 * still waiting for its answer knows about it and stays unavailable.
 */
export const issueCreatePrefsSaveKey = ['issue-create-prefs', 'save'] as const;

/**
 * sk-565 (US-8, SC-006, plan P11) — «Issue creation», the personal
 * «assign the issues my agent creates to me» setting.
 *
 * It sits on the notification settings page next to the review panel, but
 * it is a panel of its own with its own query and its own save (D8): it is
 * not part of the reason form nor of the review form, has no draft and no
 * Save button, and neither of those forms can carry or block it.
 *
 * Rules the markup keeps:
 *
 *   - **The switch shows the SERVER's value, never a guess.** It is a
 *     controlled switch fed only from the query cache. A click sends the
 *     opposite of the stored value and does not move the switch — no
 *     optimistic update. The switch moves when the PUT answers, to the value
 *     the answer carries.
 *   - **A read never overwrites a confirmed write.** Before the PUT goes out,
 *     a read in flight is cancelled; when the PUT answers, a read that started
 *     meanwhile is cancelled too, and only then is the answer written. A
 *     cancelled read leaves the cache as it was, so a GET that the server
 *     answered with the value from BEFORE the write cannot land on top of it.
 *     A read started after the answer was written started after the write
 *     was committed, so what it brings back is current.
 *   - **Unavailable while the value is not confirmed.** Before the first load,
 *     during any read (a background one included — its answer may still move
 *     the switch), while the last read stands failed, and while a save is in
 *     flight anywhere in the app. A click in any of those windows would act on
 *     a value the reader cannot see confirmed.
 *   - **A failed save leaves the stored value on screen** and says so in an
 *     alert; the switch is usable again for another try.
 *   - **Waiting is announced, not only drawn.** The spinner is decoration; a
 *     polite live region says in words that the setting is loading or saving.
 */
export function IssueCreatePrefsSection() {
  const { t } = useTranslation('notifications');
  const queryClient = useQueryClient();

  const prefsQuery = useQuery<IssueCreatePrefs>({
    queryKey: issueCreatePrefsQueryKey,
    queryFn: getIssueCreatePrefs,
  });

  const saveMutation = useMutation<IssueCreatePrefs, Error, UpdateIssueCreatePrefsInput>({
    mutationKey: issueCreatePrefsSaveKey,
    mutationFn: (input) => updateIssueCreatePrefs(input),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: issueCreatePrefsQueryKey, exact: true });
    },
    onSuccess: async (saved) => {
      // A read that started while the PUT was in flight may carry the value
      // from before the write; cancelling it keeps it from landing after.
      await queryClient.cancelQueries({ queryKey: issueCreatePrefsQueryKey, exact: true });
      queryClient.setQueryData(issueCreatePrefsQueryKey, saved);
    },
  });

  const saving = useIsMutating({ mutationKey: issueCreatePrefsSaveKey }) > 0;
  const stored = prefsQuery.data;
  const disabled =
    stored === undefined || prefsQuery.isError || prefsQuery.isFetching || saving;

  const progress = saving
    ? t('issueCreate.saving')
    : prefsQuery.isFetching
      ? t('issueCreate.loading')
      : null;

  return (
    <SettingsPanel title={t('issueCreate.title')}>
      <Stack gap="md">
        {/* The alert names THIS panel's failure: the page hosts several
            independent forms, and a generic "Error" would not say which of
            them refused. */}
        {prefsQuery.isError ? (
          <Alert variant="light" style={ERR_ALERT_VARS} title={t('issueCreate.loadFailed')} role="alert">
            {prefsQuery.error.message}
          </Alert>
        ) : null}
        {saveMutation.isError ? (
          <Alert variant="light" style={ERR_ALERT_VARS} title={t('issueCreate.saveFailed')} role="alert">
            {saveMutation.error.message}
          </Alert>
        ) : null}

        <Group gap="sm" wrap="nowrap" align="flex-start">
          <Switch
            checked={stored?.assignAgentIssuesToMe ?? false}
            disabled={disabled}
            onChange={() => {
              // `disabled` stops a pointer, not a click dispatched by script
              // (jsdom, assistive tooling): the handler keeps the same rule.
              if (disabled || stored === undefined) return;
              saveMutation.mutate({ assignAgentIssuesToMe: !stored.assignAgentIssuesToMe });
            }}
            label={t('issueCreate.label')}
            description={t('issueCreate.description')}
            data-testid="issue-create-assign-to-me"
          />
          {progress !== null ? <Loader size="xs" aria-hidden="true" /> : null}
        </Group>

        {/* Always in the DOM, so assistive technology is already listening
            when the phrase appears. */}
        <Box role="status" aria-live="polite" className="sr-only">
          {progress}
        </Box>
      </Stack>
    </SettingsPanel>
  );
}
