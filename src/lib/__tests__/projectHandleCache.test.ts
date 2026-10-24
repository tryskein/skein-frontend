/**
 * sk-439 — `projectHandleCache.ts`: which project a handle names, from the
 * query cache alone. The integration tests (epic section, Tasks column)
 * exercise the list stage; the resolve stage and the "unknown" answers
 * are pinned here.
 */
import { describe, expect, test } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  cachedProjectIdOf,
  isKnownSameProject,
  projectResolveQueryKey,
  projectsListQueryKey,
} from '../projectHandleCache';

const A = '0198aaaa-0000-7000-8000-00000000000a';
const B = '0198bbbb-0000-7000-8000-00000000000b';

function client({ list = false, resolved = {} as Record<string, string | null> } = {}) {
  const qc = new QueryClient();
  if (list) {
    qc.setQueryData(projectsListQueryKey, {
      items: [{ id: A, idPrefix: 'proj-a' }],
    });
  }
  for (const [handle, id] of Object.entries(resolved)) {
    qc.setQueryData(projectResolveQueryKey(handle), {
      match: id === null ? null : { id, idPrefix: handle, name: handle },
      candidates: [],
    });
  }
  return qc;
}

describe('cachedProjectIdOf', () => {
  test('list stage: by idPrefix and by UUID', () => {
    const qc = client({ list: true });
    expect(cachedProjectIdOf(qc, 'proj-a')).toBe(A);
    expect(cachedProjectIdOf(qc, A)).toBe(A);
  });

  test('resolve stage: a handle past the first page, resolved earlier', () => {
    const qc = client({ list: true, resolved: { 'proj-b': B } });
    expect(cachedProjectIdOf(qc, 'proj-b')).toBe(B);
  });

  test('unknown: nothing cached, or the resolve answered no match', () => {
    expect(cachedProjectIdOf(client(), 'proj-a')).toBeNull();
    expect(cachedProjectIdOf(client({ resolved: { vague: null } }), 'vague')).toBeNull();
  });
});

describe('isKnownSameProject', () => {
  test('equal strings are the same project without any cache', () => {
    expect(isKnownSameProject(client(), 'proj-a', 'proj-a')).toBe(true);
  });

  test('alias and UUID of one project → same, once the cache knows it', () => {
    expect(isKnownSameProject(client({ list: true }), A, 'proj-a')).toBe(true);
  });

  test('two known projects → not the same', () => {
    expect(isKnownSameProject(client({ list: true, resolved: { 'proj-b': B } }), B, 'proj-a')).toBe(false);
  });

  test('either side unknown → false, never a guess', () => {
    expect(isKnownSameProject(client(), A, 'proj-a')).toBe(false);
    expect(isKnownSameProject(client({ list: true }), 'proj-x', 'proj-y')).toBe(false);
  });
});
