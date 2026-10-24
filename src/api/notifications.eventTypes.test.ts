/**
 * sk-303.13 / row 38 — reading the subscription-event-type catalogue.
 *
 * The catalogue replaced a dictionary compiled into the bundle, so the parse
 * has one job beyond «don't crash»: keep the server's answer intact. In
 * particular `reasons` is a LIST. `issue.updated` reaches a subscriber as
 * «Issue assignment» when the assignee changed and as «Other issue edits»
 * when only the priority did; collapsing that to one key would file the filter
 * under a reason whose switch does not govern it, and turning that reason off
 * would silently take the other half with it.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';

const apiJsonSpy = vi.fn();
vi.mock('./client', async (importActual) => {
  const actual = await importActual<typeof import('./client')>();
  return { ...actual, apiJson: (path: string) => apiJsonSpy(path) };
});

import { listSubscriptionEventTypes } from './notifications';

afterEach(() => {
  apiJsonSpy.mockReset();
});

describe('listSubscriptionEventTypes', () => {
  test('asks the catalogue endpoint and keeps every reason of an entry', async () => {
    apiJsonSpy.mockResolvedValue({
      eventTypes: [
        {
          type: 'issue.updated',
          label: 'Issue edit',
          reasons: ['assignment', 'other_edits'],
        },
      ],
    });

    const out = await listSubscriptionEventTypes();
    expect(apiJsonSpy).toHaveBeenCalledWith('/api/v1/notification-event-types');
    expect(out).toEqual([
      {
        type: 'issue.updated',
        label: 'Issue edit',
        reasons: ['assignment', 'other_edits'],
      },
    ]);
  });

  test('preserves server order — it is the display order', async () => {
    apiJsonSpy.mockResolvedValue({
      eventTypes: [
        { type: 'comment.created', label: 'Comment', reasons: ['comment'] },
        { type: 'issue.created', label: 'New issue', reasons: ['issue_created'] },
      ],
    });
    const out = await listSubscriptionEventTypes();
    expect(out.map((t) => t.type)).toEqual(['comment.created', 'issue.created']);
  });

  test('an entry with no type is dropped; a missing label falls back to the type', async () => {
    apiJsonSpy.mockResolvedValue({
      eventTypes: [
        { label: 'no type', reasons: [] },
        { type: 'attachment.added' },
      ],
    });
    const out = await listSubscriptionEventTypes();
    // A typeless entry could not be stored in a filter anyway.
    expect(out).toEqual([
      { type: 'attachment.added', label: 'attachment.added', reasons: [] },
    ]);
  });

  test('a malformed payload yields an empty catalogue, not a crash', async () => {
    apiJsonSpy.mockResolvedValue(null);
    expect(await listSubscriptionEventTypes()).toEqual([]);
    apiJsonSpy.mockResolvedValue({ eventTypes: 'nope' });
    expect(await listSubscriptionEventTypes()).toEqual([]);
  });
});
