import { describe, expect, test } from 'vitest';
import { classifyEvent } from './eventClassify';
import type { EventEnvelope } from './eventEnvelope';

// Fixture project / user UUIDs match Go subject_test.go and .NET
// SubjectParserTests so a regression is easy to triangulate cross-stack.
const FIXED_PROJECT_ID = '11111111-2222-3333-4444-555555555555';
const FIXED_USER_ID = '77777777-7777-7777-7777-777777777777';

function envelope(partial: Partial<EventEnvelope>): EventEnvelope {
  return {
    id: 1,
    occurredAt: '2026-05-02T10:00:00Z',
    eventType: 'issue.created',
    entityType: 'issue',
    entityId: 'demo-1',
    projectId: FIXED_PROJECT_ID,
    ...partial,
  };
}

describe('classifyEvent — project namespace', () => {
  test('issue.created (lifecycle)', () => {
    const result = classifyEvent(envelope({
      eventType: 'issue.created',
      entityType: 'issue',
      entityId: 'demo-1',
      projectId: FIXED_PROJECT_ID,
    }));
    expect(result).toEqual({
      namespace: 'project',
      entityType: 'issue',
      action: 'created',
      entityId: 'demo-1',
      projectId: FIXED_PROJECT_ID,
      changedFields: undefined,
    });
  });

  test('issue.closed with hierarchical id (demo-42.1)', () => {
    const result = classifyEvent(envelope({
      eventType: 'issue.closed',
      entityType: 'issue',
      entityId: 'demo-42.1',
      projectId: FIXED_PROJECT_ID,
    }));
    expect(result.namespace).toBe('project');
    expect(result.action).toBe('closed');
    expect(result.entityId).toBe('demo-42.1');
  });

  // sk-622.21 US-12 (No. 67) — the compact envelope names the fields
  // of a parent edit event in `changedFields`; the classifier takes them
  // from there. Per-field child events are no longer delivered to browsers.
  test('issue.updated parent — changedFields taken from the compact envelope', () => {
    const result = classifyEvent(envelope({
      eventType: 'issue.updated',
      entityType: 'issue',
      entityId: 'demo-1',
      projectId: FIXED_PROJECT_ID,
      changedFields: ['priority', 'description'],
    }));
    expect(result).toEqual({
      namespace: 'project',
      entityType: 'issue',
      action: 'updated',
      entityId: 'demo-1',
      projectId: FIXED_PROJECT_ID,
      changedFields: ['priority', 'description'],
    });
  });

  // The names are the string entries of the list; a list with none of
  // them is no list — the edit is then handled as one without names (every
  // edit row), not as one naming an unknown field.
  test.each([
    ['non-string and empty entries are dropped', ['title', '', 7, null, 'dueAt'], ['title', 'dueAt']],
    ['a list of nothing but empty and non-string entries is no list', ['', 3, null], undefined],
    ['an empty list is no list', [], undefined],
  ])('issue.updated changedFields: %s', (_n, raw, expected) => {
    const result = classifyEvent(envelope({
      eventType: 'issue.updated',
      changedFields: raw as unknown as string[],
    }));
    expect(result.changedFields).toEqual(expected);
  });

  test('issue.updated with a legacy payload and no changedFields — payload is not read', () => {
    // The old wire shape carried the field in `payload` (`field`, or
    // `changes[].field`). The compact envelope has no payload; an envelope
    // still carrying one must not leak a field name into the result.
    const legacy = {
      ...envelope({ eventType: 'issue.updated' }),
      payload: { field: 'priority', changes: [{ field: 'priority', oldValue: 1, newValue: 3 }] },
    } as unknown as EventEnvelope;
    const result = classifyEvent(legacy);
    expect(result.action).toBe('updated');
    expect(result.changedFields).toBeUndefined();
  });

  test('comment.created with issueId', () => {
    const result = classifyEvent(envelope({
      eventType: 'comment.created',
      entityType: 'comment',
      entityId: 'abcd1234-0000-0000-0000-aabbccddeeff',
      issueId: 'demo-1',
    }));
    expect(result.namespace).toBe('project');
    expect(result.entityType).toBe('comment');
    expect(result.action).toBe('created');
    expect(result.entityId).toBe('abcd1234-0000-0000-0000-aabbccddeeff');
  });

  test('dependency.created (entity short-name from event-type token)', () => {
    const result = classifyEvent(envelope({
      eventType: 'dependency.created',
      entityType: 'dep',
      entityId: 'demo-42',
    }));
    expect(result.namespace).toBe('project');
    expect(result.entityType).toBe('dep');
    expect(result.action).toBe('created');
  });

  test('project.member_added', () => {
    const result = classifyEvent(envelope({
      eventType: 'project.member_added',
      entityType: 'project',
      entityId: FIXED_PROJECT_ID,
    }));
    expect(result.namespace).toBe('project');
    expect(result.entityType).toBe('project');
    expect(result.action).toBe('member_added');
  });

  test('component.created', () => {
    const result = classifyEvent(envelope({
      eventType: 'component.created',
      entityType: 'component',
      entityId: 'deadbeef-0000-0000-0000-000000000001',
    }));
    expect(result.namespace).toBe('project');
    expect(result.entityType).toBe('component');
    expect(result.action).toBe('created');
  });
});

describe('classifyEvent — user namespace', () => {
  test('user.created', () => {
    const result = classifyEvent({
      id: 2,
      occurredAt: '2026-05-02T10:00:00Z',
      eventType: 'user.created',
      entityType: 'user',
      entityId: FIXED_USER_ID,
      projectId: undefined,
    });
    expect(result).toEqual({
      namespace: 'user',
      entityType: 'user',
      action: 'created',
      entityId: FIXED_USER_ID,
      userId: FIXED_USER_ID,
      changedFields: undefined,
    });
  });

  test('user.deactivated — entityId == userId (mirrors .NET SubjectParser)', () => {
    const result = classifyEvent({
      id: 3,
      occurredAt: '2026-05-02T10:00:00Z',
      eventType: 'user.deactivated',
      entityType: 'user',
      entityId: FIXED_USER_ID,
    });
    expect(result.namespace).toBe('user');
    expect(result.userId).toBe(FIXED_USER_ID);
    expect(result.entityId).toBe(FIXED_USER_ID);
  });

  test('user.updated with changedFields=[name]', () => {
    const result = classifyEvent({
      id: 4,
      occurredAt: '2026-05-02T10:00:00Z',
      eventType: 'user.updated',
      entityType: 'user',
      entityId: FIXED_USER_ID,
      changedFields: ['name'],
    });
    expect(result.namespace).toBe('user');
    expect(result.action).toBe('updated');
    expect(result.changedFields).toEqual(['name']);
    expect(result.userId).toBe(FIXED_USER_ID);
  });

  test('user namespace ignores projectId on the envelope', () => {
    // entityType === 'user' takes precedence — even if a writer bug
    // included projectId on a user event, we still route it via the
    // user namespace.
    const result = classifyEvent({
      id: 5,
      occurredAt: '2026-05-02T10:00:00Z',
      eventType: 'user.role_changed',
      entityType: 'user',
      entityId: FIXED_USER_ID,
      projectId: FIXED_PROJECT_ID,
    });
    expect(result.namespace).toBe('user');
    expect(result.userId).toBe(FIXED_USER_ID);
    expect(result.projectId).toBeUndefined();
  });
});

describe('classifyEvent — malformed inputs', () => {
  test('project entity without projectId → malformed', () => {
    const result = classifyEvent({
      id: 6,
      occurredAt: '2026-05-02T10:00:00Z',
      eventType: 'issue.created',
      entityType: 'issue',
      entityId: 'demo-1',
      projectId: undefined,
    });
    expect(result.namespace).toBe('malformed');
  });

  test('eventType without dot → malformed', () => {
    const result = classifyEvent(envelope({ eventType: 'no-dot-here' }));
    expect(result.namespace).toBe('malformed');
  });

  test('empty eventType → malformed', () => {
    const result = classifyEvent(envelope({ eventType: '' }));
    expect(result.namespace).toBe('malformed');
  });

  test('eventType with leading dot (empty entity) → malformed', () => {
    const result = classifyEvent(envelope({ eventType: '.created' }));
    expect(result.namespace).toBe('malformed');
  });

  test('eventType with trailing dot (empty action) → malformed', () => {
    const result = classifyEvent(envelope({ eventType: 'issue.' }));
    expect(result.namespace).toBe('malformed');
  });

  test('user event with empty entityId → malformed', () => {
    const result = classifyEvent({
      id: 7,
      occurredAt: '2026-05-02T10:00:00Z',
      eventType: 'user.created',
      entityType: 'user',
      entityId: '',
    });
    expect(result.namespace).toBe('malformed');
  });

  test('non-object envelope → malformed (defensive)', () => {
    // Defensive: a malformed wire payload that decodes to a primitive
    // should not throw inside the receive callback.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = classifyEvent(null as any);
    expect(result.namespace).toBe('malformed');
  });
});
