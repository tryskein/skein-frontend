import type { TFunction } from 'i18next';

import type { ProgressCaption } from '../../lib/progressNumbers';

/**
 * sk-540.3 — the text of the epic progress chip, shared by the list card
 * (`TaskCard.tsx`) and the tree's `progress` cell (`TaskTreeNode.tsx`):
 * both print the same `tasks:card.*` keys, and two copies of the wording
 * switch would drift on the first reword.
 *
 * `t` must be bound to the `tasks` namespace (both callers use
 * `useTranslation('tasks')`); the excluded-from-scope wording lives in the
 * `details` namespace and is reached by prefix, so there is one copy of it.
 */
export function epicProgressChipText(caption: ProgressCaption, t: TFunction): string {
  switch (caption.kind) {
    case 'allExcluded':
      return t('details:closeOutcome.excludedCount', { count: caption.excluded });
    case 'done':
      return caption.excluded === null
        ? t('card.epicProgressDone', { done: caption.done, counted: caption.counted })
        : t('card.epicProgressDoneExcluded', {
            done: caption.done,
            counted: caption.counted,
            excluded: t('details:closeOutcome.excludedShort', { count: caption.excluded }),
          });
    case 'plain':
      return t('card.epicProgressPlain', { closed: caption.closed, total: caption.total });
  }
}
