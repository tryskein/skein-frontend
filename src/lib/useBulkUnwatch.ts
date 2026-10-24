/**
 * sk-551.10 — stop watching many issues at once: an explicit selection
 * ("Unwatch selected") or every closed one ("Unwatch
 * closed"). See `bulkUnwatch` for the server's rules — notably, a
 * state sweep keeps manual subscriptions.
 *
 * Not optimistic: nothing is taken off the screen before the server has
 * said it was done. Once it has (onSuccess), every cached Watching list
 * loses exactly what the request is KNOWN to have stopped
 * (`applyBulkUnwatch`), so switching to an inactive filter does not show
 * the removed cards again for a round-trip. Then every Watching cache —
 * inactive filters included, the cut-off tail beyond 100 cards being
 * unknown to the client — is refetched, along with the header counters
 * and the per-issue watcher lists (the Details «Watch» toggle).
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { bulkUnwatch, type BulkUnwatchInput, type BulkUnwatchResult } from '../api/watchers';
import { notificationCountsKey } from './useNotificationCounts';
import { applyBulkUnwatch } from './bulkUnwatchCache';
import { authoritativeRow, invalidateWatching, patchWatchingCaches } from './watchingCache';

export function useBulkUnwatch() {
  const qc = useQueryClient();
  return useMutation<BulkUnwatchResult, Error, BulkUnwatchInput>({
    mutationFn: bulkUnwatch,
    onSuccess: (result, input) => {
      if ('issueIds' in input) {
        const removed = input.issueIds
          .map((id) => authoritativeRow(qc, id))
          .filter((row) => row !== undefined);
        patchWatchingCaches(qc, (prev) => applyBulkUnwatch(prev, input, result, removed));
      } else {
        patchWatchingCaches(qc, (prev) => applyBulkUnwatch(prev, input, result, []));
      }
    },
    onSettled: () => {
      void invalidateWatching(qc);
      qc.invalidateQueries({ queryKey: notificationCountsKey });
      qc.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) && q.queryKey[0] === 'watchers' && q.queryKey[1] === 'issue',
      });
    },
  });
}
