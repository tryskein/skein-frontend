/**
 * sk-342 — delegate label: the name from the directory, otherwise the raw string.
 *
 * Three assertions — exactly the three acceptance criteria of the task:
 *   1. a human-readable name when the user is in the directory;
 *   2. the RAW string when they are not — without crashing and without
 *      substituting a placeholder;
 *   3. no directory request is needed when there is nothing to resolve.
 *
 * The third is checked with a predicate, not a render: the members query's
 * `enabled` rests on it, and the assertion "no extra request" must be
 * verifiable separately from whatever is drawn around it.
 */

import { describe, expect, test } from 'vitest';
import {
  delegateeLabel,
  needsDirectoryResolve,
  type Delegatee,
  type DirectoryEntry,
} from '../delegateeChips';

const ID = 'b246b8b4-e020-4928-b6ba-c91c1795d5a6';

/** The directory: the same person as the project members know them. */
const DIRECTORY: DirectoryEntry[] = [
  { userId: ID, name: 'Anna Petrova' },
  { userId: 'ffffffff-0000-0000-0000-000000000000', name: 'Someone Else' },
];

describe('sk-342 — name from the directory', () => {
  // Three spellings of the SAME person: `issues.assignee` is text,
  // and an agent may put any of them there. The label must be one.
  const spellings: Array<[string, string]> = [
    ['username', 'tub246b8b4e0204928'],
    ['UUID', ID],
    ['email', 'tub246b8b4e0204928@test.local'],
  ];

  for (const [what, raw] of spellings) {
    test(`${what} in assignee → label is the directory name`, () => {
      const d: Delegatee = { username: raw, userId: ID };
      expect(delegateeLabel(d, DIRECTORY)).toBe('Anna Petrova');
    });
  }
});

describe('sk-342 — fallback to the raw string', () => {
  test('user is not in the directory → what was recorded is shown', () => {
    // Deleted, external, or an agent wrote an arbitrary string. The raw
    // value is the only clue to whom was meant; a placeholder like
    // "unknown user" would erase it.
    const d: Delegatee = { username: 'legacy-bot@example.org', userId: ID };
    expect(delegateeLabel(d, [])).toBe('legacy-bot@example.org');
  });

  test('userId is not known at all → still the raw string, no crash', () => {
    const d: Delegatee = { username: 'someone', userId: null };
    expect(delegateeLabel(d, DIRECTORY)).toBe('someone');
  });

  test('directory name is empty → not a name, fall back to the raw string', () => {
    // An empty chip is worse than a raw one: it names nobody.
    for (const empty of [null, undefined, '', '   ']) {
      const d: Delegatee = { username: 'raw-handle', userId: ID };
      expect(delegateeLabel(d, [{ userId: ID, name: empty }])).toBe('raw-handle');
    }
  });

  test('another directory entry does not give the label', () => {
    // The half without which "name found" would be indistinguishable from
    // "took the first one at hand": the identifier must be what matches.
    const d: Delegatee = { username: 'raw-handle', userId: 'NOT-THIS-ID' };
    expect(delegateeLabel(d, DIRECTORY)).toBe('raw-handle');
  });
});

describe('sk-342 — no extra request when there is nothing to resolve', () => {
  test('nobody has a userId → the directory is not needed', () => {
    expect(needsDirectoryResolve([
      { username: 'a', userId: null },
      { username: 'b', userId: null },
    ])).toBe(false);
  });

  test('empty list of delegates → not needed either', () => {
    expect(needsDirectoryResolve([])).toBe(false);
  });

  test('at least one has a userId → needed', () => {
    expect(needsDirectoryResolve([
      { username: 'a', userId: null },
      { username: 'b', userId: ID },
    ])).toBe(true);
  });
});
