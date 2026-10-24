import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Group, Modal, Stack, TextInput } from '@mantine/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { IconPlus } from '@tabler/icons-react';
import {
  createIssue,
  type IssueDetail,
  type IssueType,
} from '../../../api/issues';
import { SkeinTooltip } from '../../../components/SkeinTooltip';

/**
 * sk-118 (§6, decision §11.8) — the "Create subtask" affordance that
 * REPLACES the normal claim / start action on a STANDING task.
 *
 * A standing (perpetual-obligation) task is never claimable — agents and
 * humans act on it ONLY by spawning a child "cycle" (`skein_create
 * parentId=<standing id>`). This button opens a tiny modal prompting for
 * the cycle's title (e.g. "merge upstream v2.3.1") and creates the child
 * via the existing create flow with `parentId` prefilled. After create,
 * the new child surfaces in the normal ready/board lists and can be
 * claimed/worked as usual.
 *
 * The project handle is derived from the standing issue's id by contract
 * (`{prefix}-{n}` / `{prefix}-{n}.{m}`) so the create POST hits the right
 * project base — same derivation DetailsHeader uses for its eyebrow.
 */
export interface CreateSubtaskButtonProps {
  /** The standing parent issue's hierarchical id (e.g. "sk-42"). */
  parentId: string;
  /** Project handle (idPrefix) for the create POST base. */
  projectHandle: string;
  /** Optional callback after a successful create (e.g. select the child). */
  onCreated?: (child: IssueDetail) => void;
  /**
   * sk-285.6.3 — whether this button is the header's ONE primary action
   * for the current state. The button used to hard-code `primary`,
   * which is right on a standing task (the table names it there) and
   * wrong anywhere else it might later be mounted: two filled buttons
   * on one row is the defect that ticket is about. The header decides;
   * the button obeys. Defaults to the historical behaviour so an
   * existing call site does not silently change appearance.
   */
  primary?: boolean;
}

// A cycle under a standing task is an ordinary unit of work — default to
// `task`. The user renames / re-types it later if needed.
const CHILD_TYPE: IssueType = 'task';

export function CreateSubtaskButton({
  parentId,
  projectHandle,
  onCreated,
  primary = true,
}: CreateSubtaskButtonProps) {
  const { t } = useTranslation('details');
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTitle('');
      setError(null);
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  const mut = useMutation<IssueDetail, Error, string>({
    mutationFn: (t) =>
      createIssue(projectHandle, {
        parentId,
        title: t,
        type: CHILD_TYPE,
      }),
    onSuccess: (child) => {
      // The standing parent's epic/rollup + the project/board lists pick
      // up the new child — invalidate the same families other create
      // paths refresh.
      void qc.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          (q.queryKey[0] === 'tasks' ||
            q.queryKey[0] === 'issue' ||
            q.queryKey[0] === 'projects' ||
            q.queryKey[0] === 'project'),
      });
      setOpen(false);
      onCreated?.(child);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : t('subtask.createFailed'));
    },
  });

  const submit = () => {
    // NB: named `trimmed`, not `t` — `t` is the translator in this scope.
    const trimmed = title.trim();
    if (!trimmed) {
      setError(t('subtask.titleRequired'));
      return;
    }
    mut.mutate(trimmed);
  };

  return (
    <>
      <SkeinTooltip content={t('subtask.tooltip')}>
        <button
          type="button"
          className={`action-button${primary ? ' primary' : ''}`}
          aria-label={t('subtask.buttonAria', { id: parentId })}
          onClick={() => setOpen(true)}
        >
          {/* sk-285.7.2.45 — `ti-plus` 16px. The `+` used to be baked
              into the translation string, which put a typographic
              character where §8 names an icon. */}
          <IconPlus size={16} stroke={1.75} aria-hidden />
          {t('subtask.button')}
        </button>
      </SkeinTooltip>

      <Modal
        opened={open}
        onClose={() => {
          if (mut.isPending) return;
          setOpen(false);
        }}
        title={t('subtask.modalTitle', { id: parentId })}
        centered
        size="md"
        closeOnEscape={!mut.isPending}
        closeOnClickOutside={!mut.isPending}
      >
        <Stack gap="md">
          <TextInput
            ref={inputRef}
            label={t('subtask.titleLabel')}
            placeholder={t('subtask.titlePlaceholder')}
            value={title}
            onChange={(e) => setTitle(e.currentTarget.value)}
            disabled={mut.isPending}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
          />
          {error ? (
            <div
              role="alert"
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--font-sm)',
                color: 'var(--err)',
              }}
            >
              {error}
            </div>
          ) : null}
          <Group justify="flex-end" gap="sm">
            <Button
              variant="outline"
              color="orange"
              disabled={mut.isPending}
              onClick={() => setOpen(false)}
              size="sm"
            >
              {t('common:cancel')}
            </Button>
            {/* sk-285.7.2.85 — the same omission sk-285.7.2.82 measured
                on «Move issue». `theme.ts` sets
                `Button.defaultProps.variant = 'default'`, and Mantine's
                `default` variant IGNORES `color` outright, so
                `color="orange"` alone drew the same box as Cancel beside
                it and the dialog had no confirming action. Filled routes
                through this repo's `variantColorResolver`, which inks a
                primary fill with `--on-primary` rather than Mantine's
                white (sk-373). */}
            <Button
              variant="filled"
              color="orange"
              loading={mut.isPending}
              onClick={submit}
              size="sm"
            >
              {t('common:create')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
