import { useEffect, useState } from 'react';
import { Alert, Box, Button, Group, Loader, Stack, Switch, TextInput } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, BusinessError } from '../../../api/client';
import {
  type ReviewPrefs,
  type ReviewSettingBounds,
  type UpdateReviewPrefsInput,
  getReviewPrefs,
  updateReviewPrefs,
} from '../../../api/review-prefs';
import { ERR_ALERT_VARS, OK_ALERT_VARS } from '../../../lib/mantineVariantVars';
import { SettingsPanel } from './SettingsLayout';

/** Query key — exported so live-event invalidation can target it. */
export const reviewPrefsQueryKey = ['review-prefs'] as const;

/**
 * Whatever a schedule field currently holds — the RAW text, exactly as it
 * was typed, including a half-finished `"-"` or a decimal `"2.7"`.
 *
 * Text, not a parsed number, and not by accident. Mantine's `NumberInput`
 * parses on every keystroke and re-parses on blur, and both steps rewrite
 * what the reader typed (measured on this very component, jsdom + Mantine
 * 7.17):
 *
 *   - with `allowDecimal={false}` the separator is not refused, it is
 *     DROPPED and the digits are glued: typing `2.7` reports `[2]`, then
 *     `[27]`, and `27` is what stays in the field and goes on the wire. For
 *     an interval `180.5` becomes `1805` — inside the bounds, so the server
 *     answers 200 and "Saved". Silent correction into a legal value is
 *     the one failure SC-022 names and the one no server can catch.
 *   - a half-typed `"-"` survives the keystroke but is normalised to empty
 *     ON BLUR — and a click on "Save" blurs the field first. The draft
 *     became `''`, `toWire('')` sent an explicit `null` ("reset to
 *     factory"), and the reader got a green "Saved" for a value they
 *     never asked for. Via Enter, without a blur, the same form refused
 *     correctly — two different outcomes for the same visible field.
 *
 * A plain text input has neither behaviour: what is typed is what is held,
 * what is held is what is shown, and both submit paths see the same string.
 * Everything the form refuses, it refuses out loud (`isMalformed`), and
 * everything else travels to the server untouched.
 *
 * Empty is how this form spells "empty/unset, factory applies"; it becomes an
 * explicit `null` on save and NEVER `0`, which is a legitimate burst setting
 * meaning "no burst" and has to stay distinguishable from unset.
 */
export type ScheduleFieldValue = string;

interface DraftState {
  mechanicEnabled: boolean;
  reviewRequiredDefault: boolean;
  burstCount: ScheduleFieldValue;
  unacceptedIntervalMinutes: ScheduleFieldValue;
  unreviewedIntervalMinutes: ScheduleFieldValue;
}

/**
 * The three schedule keys — enumerated once, with the label the refusal
 * names, so a reader with three fields on screen is told WHICH one is being
 * complained about.
 *
 * sk-398 — the label is stored as a dictionary KEY: both the field and the complaint about it
 * take it from here, so naming in a refusal something that is not
 * written on the screen is impossible in any language.
 */
const SCHEDULE_FIELDS = [
  { key: 'burstCount', labelKey: 'prefs.fields.burstCount' },
  {
    key: 'unacceptedIntervalMinutes',
    labelKey: 'prefs.fields.unacceptedInterval',
  },
  {
    key: 'unreviewedIntervalMinutes',
    labelKey: 'prefs.fields.unreviewedInterval',
  },
] as const;

function toField(v: number | null): ScheduleFieldValue {
  return v === null ? '' : String(v);
}

/**
 * True while the field holds something that is not a whole number and not
 * empty — a half-typed `"-"`, a stray `"."`, a decimal `"2.7"`, a `"5 5"`.
 *
 * This is the check the error text has always PROMISED ("must be an
 * integer") and, until now, nothing performed: the fractional case was eaten
 * by the input's own parser and the finiteness test let `2.5` through. It is
 * a check on the SHAPE of what was typed, never on its size — a well-formed
 * `9` or `-3` is out of bounds, not malformed, and travels to the server so
 * the refusal is the server's to give (SC-022).
 *
 * The alternative to refusing an unparsable entry is `Number("-")` → `NaN` →
 * `JSON.stringify` → `null`, i.e. "reset the parameter to factory", silently,
 * on a keystroke the user never finished.
 */
export function isMalformed(v: ScheduleFieldValue): boolean {
  const text = v.trim();
  return text !== '' && !/^-?\d+$/.test(text);
}

/**
 * Draft text → wire value. Empty is an explicit `null` ("empty/unset, factory
 * applies"), never `0`.
 *
 * Callers must reject a malformed field FIRST (see `isMalformed`). This
 * function would turn one into `NaN`, and `JSON.stringify` renders `NaN` as
 * `null` — so a half-typed "-" would silently arrive at the server as "reset
 * to factory", which is a value the user never asked for. Correcting or
 * mangling input behind the user's back is the one thing this form must not
 * do; it stops and says so instead.
 *
 * Exported for its own test, alongside `isMalformed`.
 */
export function toWire(v: ScheduleFieldValue): number | null {
  const text = v.trim();
  return text === '' ? null : Number(text);
}

function draftFrom(prefs: ReviewPrefs): DraftState {
  return {
    mechanicEnabled: prefs.mechanicEnabled,
    reviewRequiredDefault: prefs.reviewRequiredDefault,
    burstCount: toField(prefs.burstCount),
    unacceptedIntervalMinutes: toField(prefs.unacceptedIntervalMinutes),
    unreviewedIntervalMinutes: toField(prefs.unreviewedIntervalMinutes),
  };
}

/**
 * Caption for one schedule field, built from the SERVER's bounds block.
 *
 * The numbers are never written down here. They arrive in `bounds` for
 * exactly this purpose: a range copied into the frontend is a third
 * transcription of the schedule contract, and a hand-written copy says
 * nothing when the contract moves — it just goes quietly wrong.
 */
function boundsCaption(
  t: TFunction<'review'>,
  bounds: ReviewSettingBounds,
  unit: 'items' | 'minutes',
): string {
  return t('prefs.bounds.known', {
    min: bounds.min,
    max: bounds.max,
    unit: t(`prefs.bounds.units.${unit}`),
    factory: bounds.factory,
  });
}

/**
 * sk-303.14 (T029) — "Review of results", the client form of
 * contract C4 (US-3, SC-022, SC-027).
 *
 * Five settings: the master switch (INV-6), the personal default of the
 * per-issue flag, and the three schedule parameters. It sits on the
 * notifications settings page because all five live in the same
 * per-user preferences row, but keeps its own query, its own draft and its
 * own save — the reason table next to it diffs a server registry and has
 * nothing to share with this beyond the page.
 *
 * Two rules the markup exists to keep:
 *
 *   - **A value out of bounds is REFUSED, not corrected.** The schedule
 *     fields are plain text inputs with no `min` / `max` and no numeric
 *     parser of their own, so a typed 9 stays a typed 9, travels to the
 *     server and comes back as a 422 the user can read. Clamping it here
 *     would leave them looking at a form that agreed with them while the
 *     system stored something else, which is precisely what SC-022 forbids —
 *     and so, for the same reason, would a parser that turns a typed `2.7`
 *     into `27` (see `ScheduleFieldValue`). What the form will not send, it
 *     refuses out loud instead.
 *   - **Empty is a value.** An empty field means "factory applies" and
 *     is sent as an explicit `null`; it is not the same as `0`, and it is
 *     not the same as leaving the field alone. The caption under each input
 *     names the built-in default so "empty" is never a mystery.
 */
export function ReviewPrefsSection() {
  const { t } = useTranslation('review');
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [dirty, setDirty] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  /** Form-shape complaint (a half-typed number), distinct from a server refusal. */
  const [formError, setFormError] = useState<string | null>(null);

  const prefsQuery = useQuery<ReviewPrefs>({
    queryKey: reviewPrefsQueryKey,
    queryFn: getReviewPrefs,
  });

  // Seed the draft from the server, and stop doing so once the user has
  // touched anything — a background refetch must not throw away an edit in
  // progress. Same shape as the reason table above it.
  useEffect(() => {
    if (!prefsQuery.data) return;
    if (dirty) return;
    setDraft(draftFrom(prefsQuery.data));
  }, [prefsQuery.data, dirty]);

  const saveMutation = useMutation<ReviewPrefs, Error, UpdateReviewPrefsInput>({
    mutationFn: (input) => updateReviewPrefs(input),
    onSuccess: (saved) => {
      queryClient.setQueryData(reviewPrefsQueryKey, saved);
      setDraft(draftFrom(saved));
      setDirty(false);
      setSavedNotice(true);
      // The master switch decides whether the second number exists at all
      // (contract C2), so the header is stale the moment it moves.
      void queryClient.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) && q.queryKey[0] === 'notification-counts',
      });
    },
  });

  const patch = <K extends keyof DraftState>(key: K, value: DraftState[K]) => {
    setSavedNotice(false);
    setFormError(null);
    setDirty(true);
    setDraft((prev) => (prev === null ? prev : { ...prev, [key]: value }));
  };

  const onSubmit = () => {
    if (draft === null) return;
    setSavedNotice(false);
    // A value that is not a whole number is refused here rather than
    // coerced — see `toWire`. This is a FORM-level check about the SHAPE of
    // what was typed, not a bounds check: an out-of-range but well-formed
    // number goes to the server untouched, and its refusal is the server's
    // to give (SC-022). Both submit paths — Enter and a click on "Save"
    // — arrive here with the same draft, because nothing rewrites the field
    // behind the reader's back on the way (see `ScheduleFieldValue`).
    const malformed = SCHEDULE_FIELDS.filter((f) => isMalformed(draft[f.key]));
    if (malformed.length > 0) {
      setFormError(
        t('prefs.malformed', {
          fields: malformed.map((f) => `«${t(f.labelKey)}»`).join(', '),
        }),
      );
      return;
    }
    setFormError(null);
    saveMutation.mutate({
      mechanicEnabled: draft.mechanicEnabled,
      reviewRequiredDefault: draft.reviewRequiredDefault,
      burstCount: toWire(draft.burstCount),
      unacceptedIntervalMinutes: toWire(draft.unacceptedIntervalMinutes),
      unreviewedIntervalMinutes: toWire(draft.unreviewedIntervalMinutes),
    });
  };

  // The server's refusal, shown verbatim. A 422 here is a business answer
  // (`invalid_schedule_setting`, naming the offending field) and NOTHING was
  // written — so the out-of-range value stays in the field the user typed it
  // into, ready to be corrected, rather than being replaced by a guess.
  const errorMessage = (() => {
    if (formError !== null) return formError;
    const err = saveMutation.error ?? prefsQuery.error;
    if (!err) return null;
    if (err instanceof BusinessError || err instanceof ApiError) return err.message;
    if (err instanceof Error) return err.message;
    return t('prefs.loadFailed');
  })();

  const bounds = prefsQuery.data?.bounds;

  return (
    <SettingsPanel title={t('prefs.title')} description={t('prefs.description')}>
      {savedNotice ? (
        <Box role="status" aria-live="polite">
          {/* sk-386 — `color="green"` / `color="red"` reach for Mantine's
              built-in ramps, which the theme does not own: a themed build
              would paint these two alerts from a palette nothing here can
              change. The answer is the same one `NotificationsPage` already uses one
              file over — the variant vars, computed from our tokens. */}
          <Alert
            variant="light"
            style={OK_ALERT_VARS}
            title={t('prefs.saved')}
            mb="md"
          />
        </Box>
      ) : null}

      {/* The title names THIS panel, not merely "Error": the page hosts two
          independent forms with two independent failures, and a reader (or a
          test) facing two identical alerts cannot tell which of them
          refused. */}
      {errorMessage ? (
        <Alert
          variant="light"
          style={ERR_ALERT_VARS}
          title={t('prefs.errorTitle')}
          mb="md"
          role="alert"
        >
          {errorMessage}
        </Alert>
      ) : null}

      {draft === null ? (
        prefsQuery.isError ? null : <Loader size="sm" />
      ) : (
        <Box
          component="form"
          onSubmit={(e: React.FormEvent) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <Stack gap="md">
            <Switch
              checked={draft.mechanicEnabled}
              onChange={(e) => patch('mechanicEnabled', e.currentTarget.checked)}
              label={t('prefs.mechanic.label')}
              data-testid="review-mechanic-enabled"
              description={t('prefs.mechanic.description')}
            />

            <Switch
              checked={draft.reviewRequiredDefault}
              onChange={(e) =>
                patch('reviewRequiredDefault', e.currentTarget.checked)
              }
              label={t('prefs.requiredDefault.label')}
              data-testid="review-required-default"
              description={t('prefs.requiredDefault.description')}
            />

            {/* Plain text inputs, `inputMode="numeric"` for the on-screen
                keyboard: the bounds are the SERVER's to enforce and its
                refusal is what the user must see (SC-022), and a numeric
                parser here would silently rewrite what was typed before
                anyone could refuse it. See the component doc. */}
            <TextInput
              label={t('prefs.fields.burstCount')}
              data-testid="review-burst-count"
              inputMode="numeric"
              value={draft.burstCount}
              onChange={(e) => patch('burstCount', e.currentTarget.value)}
              description={
                bounds
                  ? boundsCaption(t, bounds.burstCount, 'items')
                  : t('prefs.bounds.unknown')
              }
            />

            <TextInput
              label={t('prefs.fields.unacceptedInterval')}
              data-testid="review-unaccepted-interval"
              inputMode="numeric"
              value={draft.unacceptedIntervalMinutes}
              onChange={(e) =>
                patch('unacceptedIntervalMinutes', e.currentTarget.value)
              }
              description={
                bounds
                  ? boundsCaption(t, bounds.unacceptedIntervalMinutes, 'minutes')
                  : t('prefs.bounds.unknown')
              }
            />

            <TextInput
              label={t('prefs.fields.unreviewedInterval')}
              data-testid="review-unreviewed-interval"
              inputMode="numeric"
              value={draft.unreviewedIntervalMinutes}
              onChange={(e) =>
                patch('unreviewedIntervalMinutes', e.currentTarget.value)
              }
              description={
                bounds
                  ? boundsCaption(t, bounds.unreviewedIntervalMinutes, 'minutes')
                  : t('prefs.bounds.unknown')
              }
            />

            <Group gap="sm">
              {/* The accessible name names THIS panel. The page hosts a
                  second save button, for the reason table, and two buttons
                  reading "Save" are told apart by a sighted reader
                  through the panel they sit in — a screen reader listing the
                  page's controls, or a test asking for a button by name, has
                  no such context. The visible label stays "Save" and is
                  a prefix of the accessible one (WCAG 2.5.3). */}
              <Button
                type="submit"
                size="sm"
                variant="filled"
                aria-label={t('prefs.saveAria')}
                loading={saveMutation.isPending}
                disabled={!dirty}
              >
                {t('prefs.save')}
              </Button>
            </Group>
          </Stack>
        </Box>
      )}
    </SettingsPanel>
  );
}
