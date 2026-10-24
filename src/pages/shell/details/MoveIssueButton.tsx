import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Autocomplete,
  Button,
  Group,
  Modal,
  Text,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconArrowMoveRight } from '@tabler/icons-react';

import type { IssueDetail } from '../../../api/issues';
import { listAllIssues } from '../../../api/issues';
import {
  addDependency,
  listDependencies,
  removeDependency,
} from '../../../api/dependencies';
import { ApiError, BusinessError } from '../../../api/client';
import { refusalReason } from '../../../lib/saveFailureReason';
import { SkeinTooltip } from '../../../components/SkeinTooltip';
import { useToaster } from '../../../components/Toaster';
import { issueDetailKey, issueDependenciesKey } from '../../../lib/useIssueDetail';

/**
 * MoveIssueButton — sk-35.
 *
 * Opens a Mantine modal that lets the user re-parent the current
 * issue. The picker only suggests epic-typed issues — moving a task
 * under another task is allowed by the backend but is almost never
 * what the user wants; restricting the picker keeps the affordance
 * focused. A "Top-level (no parent)" sentinel lets the user remove
 * the parent edge entirely.
 *
 * Mechanics (chained API calls):
 *   1. Look up the current parent edge via `listDependencies` —
 *      `outgoing` entries with `type === 'parent-child'` is the
 *      authoritative source (the issue summary's `parentIdCurrent`
 *      pins on the first one by created_at, but the API may carry
 *      multiple).
 *   2. If a new parent is selected, fire `addDependency` first so
 *      the new edge is in place BEFORE we tear down the old one —
 *      that way the tree never sees a transient "orphan" state.
 *   3. Then `removeDependency` for each pre-existing parent edge.
 *   4. If the sentinel "Top-level" is selected, skip step 2 and only
 *      run step 3.
 *
 * Invalidations: this issue's detail (so `parentIdCurrent` refreshes),
 * the dependencies list, both project lists (old + new parent's
 * project), and the epic rollup keys for the old + new parents.
 */
export interface MoveIssueButtonProps {
  issue: IssueDetail;
}

const TOP_LEVEL_SENTINEL = '__top_level__';

export function MoveIssueButton({ issue }: MoveIssueButtonProps) {
  const { t } = useTranslation('details');
  const qc = useQueryClient();
  const toast = useToaster();
  const [opened, setOpened] = useState(false);
  const [selected, setSelected] = useState<string>('');
  // sk-35 TS-W5 — in-dialog error mirrored alongside the global toast
  // trail. Cleared on each open + on successful move.
  const [moveError, setMoveError] = useState<string | null>(null);
  // sk-35 TS-W2 — debounce search so we don't fire a server query on
  // every keystroke. queryKey field renamed to `q` to match the wire
  // param.
  const [debouncedSelected] = useDebouncedValue(selected, 250);

  // Epic picker — cross-project so the user can move children into
  // an epic in a different project (sk-35 user decision #1). Search
  // is server-side via `q=<text>` so the response stays bounded.
  // sk-674.18 T055 (review C2; screens 1.10, INV-24) — candidates are the
  // epics of the issue's own space: links never cross a space boundary.
  // The space is the card's `spaceId` (its project's), never the id
  // prefix; a card without it (an api that does not serve it yet) searches
  // as before.
  const spaceId = issue.spaceId;
  const epicsQ = useQuery({
    queryKey: ['issues', 'list-all', { type: 'epic', q: debouncedSelected.trim() || '', space: spaceId ?? '' }],
    queryFn: () =>
      listAllIssues({
        type: 'epic',
        limit: 25,
        q: debouncedSelected.trim() || undefined,
        space: spaceId,
      }),
    enabled: opened, // only fetch when modal is open
    staleTime: 5_000,
  });

  // Existing parent edges (usually 0 or 1; sk-35 allows >1).
  const depsQ = useQuery({
    queryKey: issueDependenciesKey(issue.projectId, issue.id),
    queryFn: () => listDependencies(issue.projectId, issue.id),
    enabled: opened,
    staleTime: 5_000,
  });
  // sk-674.18 T055 (review C1; the lead's decision on T009) — the hidden
  // end of a redacted edge is a synthetic `hidden-<k>`, not an id: it is
  // never shown as a parent and never sent to a removal. Every move takes
  // the issue off its current parent, so a hidden parent makes the move
  // impossible here — it is refused with a reason, before any request.
  const currentParentEdges = useMemo(
    () =>
      (depsQ.data?.outgoing ?? []).filter((e) => e.type === 'parent-child' && e.redacted !== true),
    [depsQ.data],
  );
  const hiddenParent = useMemo(
    () => (depsQ.data?.outgoing ?? []).some((e) => e.type === 'parent-child' && e.redacted === true),
    [depsQ.data],
  );

  const options = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    out.push({ value: TOP_LEVEL_SENTINEL, label: t('move.topLevel') });
    for (const e of epicsQ.data?.items ?? []) {
      // Skip self.
      if (e.id === issue.id) continue;
      // A row of another space is never offered, whatever the answer.
      if (spaceId !== undefined && e.spaceId !== undefined && e.spaceId !== spaceId) continue;
      out.push({ value: e.id, label: `${e.id} — ${e.title}` });
    }
    return out;
  }, [epicsQ.data, issue.id, spaceId, t]);

  const moveMut = useMutation<void, Error, string>({
    mutationFn: async (target: string) => {
      // Nothing is added when the old parent cannot be taken off.
      if (hiddenParent) throw new Error(t('move.hiddenParent'));
      // Step 1 (only if NOT top-level): add the new parent edge first
      // so the tree never reads as an orphan transiently. Both this
      // and the remove step operate against the FROM-side project
      // (this issue's project) — that's where the backend gates
      // visibility.
      if (target !== TOP_LEVEL_SENTINEL) {
        await addDependency(issue.projectId, issue.id, {
          toId: target,
          type: 'parent-child',
        });
      }
      // Step 2: remove every pre-existing parent edge. Single-parent
      // is the common case; multi-parent fan-in is rare but allowed.
      for (const edge of currentParentEdges) {
        // Don't delete the edge we just added.
        if (target !== TOP_LEVEL_SENTINEL && edge.toId === target) continue;
        await removeDependency(issue.projectId, issue.id, edge.toId, 'parent-child');
      }
    },
    onSuccess: (_, target) => {
      const human =
        target === TOP_LEVEL_SENTINEL
          ? t('move.movedTopLevel', { id: issue.id })
          : t('move.movedUnder', { id: issue.id, target });
      toast.info(human);
      setMoveError(null);
      setOpened(false);
      setSelected('');
    },
    onError: (err) => {
      const msg =
        refusalReason(err, t) ??
        (err instanceof BusinessError || err instanceof ApiError
          ? err.message
          : err.message || t('move.failed'));
      // sk-35 TS-W5 — surface the error inline so dialog-focused users
      // catch it immediately, AND keep the toast for the global trail.
      setMoveError(msg);
      toast.error(msg);
    },
    // sk-35 TS-W1/TS-W4 — invalidate on BOTH success and failure: a
    // partial failure (addDependency succeeded, removeDependency failed)
    // leaves the server in a multi-parent state, so we must refresh
    // even on error. The widened predicate (`'issues'` OR `'deps'`)
    // also catches the old/new parent's incoming-edge lists keyed
    // under `['deps', ...]`.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: issueDetailKey(issue.id) });
      void qc.invalidateQueries({
        queryKey: issueDependenciesKey(issue.projectId, issue.id),
      });
      void qc.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          (q.queryKey[0] === 'issues' || q.queryKey[0] === 'deps'),
      });
    },
  });

  const onSubmit = () => {
    if (!selected) {
      toast.error(t('move.pickDestination'));
      return;
    }
    // If user typed the sentinel label by hand, normalise.
    const target =
      selected === t('move.topLevel') ? TOP_LEVEL_SENTINEL : selected;
    moveMut.mutate(target);
  };

  return (
    <>
      <SkeinTooltip content={t('move.tooltip')}>
        <button
          type="button"
          className="action-button"
          // sk-35 HTML-W1 — embed issue.id in the aria-label so SR users
          // hear context. Mirrors the Drop / Resume buttons in
          // DetailsHeader (sk-34 convention). The SkeinTooltip is a
          // visual hint only and isn't wired to aria-describedby, so
          // the button carries its own context.
          aria-label={t('move.buttonAria', { id: issue.id })}
          onClick={() => {
            setSelected('');
            setMoveError(null);
            setOpened(true);
          }}
        >
          {/* sk-285.7.2.45 — `ti-arrow-move-right` 16px, exactly as
              `Sk Details.dc.html` draws this button. It was the literal
              `↪`, which no font renders at a chosen weight and which
              cannot take `currentColor`. Decorative: the button's own
              aria-label already names the action and its target. */}
          <IconArrowMoveRight size={16} stroke={1.75} aria-hidden />
          {t('move.button')}
        </button>
      </SkeinTooltip>

      <Modal
        opened={opened}
        onClose={() => {
          if (moveMut.isPending) return;
          setOpened(false);
        }}
        title={t('move.modalTitle')}
        centered
        closeOnEscape={!moveMut.isPending}
        closeOnClickOutside={!moveMut.isPending}
        // sk-35 HTML-W4 — wire the body paragraph to aria-describedby
        // so SR users hear the explanation, not just the title.
        // Mirrors DetailsHeader.tsx drop-confirm Modal.
        aria-describedby="move-issue-desc"
      >
        <div id="move-issue-desc">
          <Text size="sm" mb="xs" c="dimmed">
            {t('move.description', { id: issue.id })}
          </Text>
        </div>
        {/* sk-35 HTML-W3 — Move is reversible; focus the picker so the
            user can type immediately. Cancel no longer steals focus. */}
        <Autocomplete
          value={selected}
          onChange={setSelected}
          data={options}
          // sk-35 HTML-W2 — give the combobox an accessible name.
          label={t('move.destination')}
          placeholder={t('move.searchPlaceholder')}
          limit={25}
          data-autofocus
        />
        {hiddenParent ? (
          <Text size="xs" mt="xs" c="dimmed">
            {t('move.hiddenParent')}
          </Text>
        ) : currentParentEdges.length === 0 ? (
          <Text size="xs" mt="xs" c="dimmed">
            {t('move.currentlyTopLevel')}
          </Text>
        ) : (
          <Text size="xs" mt="xs" c="dimmed">
            {t(
              currentParentEdges.length > 1
                ? 'move.currentParents'
                : 'move.currentParent',
              { ids: currentParentEdges.map((e) => e.toId).join(', ') },
            )}
          </Text>
        )}
        {moveError ? (
          <div
            role="alert"
            style={{
              color: 'var(--err)',
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--font-sm)',
              marginTop: 'var(--space-2)',
            }}
          >
            {moveError}
          </div>
        ) : null}
        <Group justify="flex-end" gap="sm" mt="md">
          <Button
            variant="default"
            onClick={() => setOpened(false)}
            disabled={moveMut.isPending}
          >
            {t('common:cancel')}
          </Button>
          {/* sk-285.7.2.82 — audit 2B, N-5: `variant="filled"` is not
              decoration, it is what makes this the CONFIRMING button.
              `theme.ts` sets `Button.defaultProps.variant = 'default'`,
              and Mantine's `default` variant ignores `color` entirely —
              so `color="orange"` alone rendered the same white,
              `#212529`-on-`#ced4da` box as Cancel beside it, and the
              dialog had no primary action to look at. Measured in
              Chromium before: both buttons `rgb(255,255,255)` /
              `rgb(33,37,41)`, 36px. Filled routes through this repo's
              `variantColorResolver`, which inks a primary fill with
              `--on-primary` rather than Mantine's white (sk-373). */}
          <Button
            variant="filled"
            color="orange"
            loading={moveMut.isPending}
            disabled={hiddenParent}
            onClick={onSubmit}
          >
            {t('move.button')}
          </Button>
        </Group>
      </Modal>
    </>
  );
}

// Helper export for tests + future consumers that want to refer to
// the sentinel value programmatically.
export const MOVE_TOP_LEVEL_SENTINEL = TOP_LEVEL_SENTINEL;
