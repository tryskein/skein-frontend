/**
 * sk-342 — labels of the assignee chips under the "Delegated" lens.
 *
 * ─── What it was ───────────────────────────────────────────────────
 *
 * The chip was labelled with the raw `issues.assignee`. That is a TEXT field that
 * is stored "as written": an MCP client may put a UUID or an
 * email there, because an agent may assign someone who is not yet in the
 * directory. Then a UUID ended up in the chip.
 *
 * The field must NOT be changed — its textuality is the contract. The resolve
 * goes by a separate `userId`, which arrives alongside.
 *
 * ─── Why this became possible only now ─────────────────────────────
 *
 * Before sk-523 the server join matched the assignee ONLY by user
 * name, so in exactly the UUID and email cases `assigneeUserId`
 * arrived NULL — there was nothing to resolve by, and a fix to the letter of
 * the statement would have repaired nothing. Now the join matches name, email and
 * identifier (`internal/assignee/assignee.go#JoinOn`), and `userId` is
 * filled.
 *
 * ─── The boundary, named aloud ─────────────────────────────────────
 *
 * The directory here is the PROJECT MEMBERS, a set bounded by
 * construction. Outside a project surface (the lens is on for "all
 * projects") there is nothing to resolve with, and the label stays the raw string. This is
 * not a hole but a refusal of an unbounded directory request, which
 * sk-285.5.5 rejected on a measurement: 39 782 records, ~4.3 MB of JSON.
 */

/** A delegate, as `useTasks#delegateeAssignees` returns it. */
export interface Delegatee {
  username: string;
  userId: string | null;
}

/** A project member — the part needed for the label. */
export interface DirectoryEntry {
  userId?: string | null;
  name?: string | null;
}

/**
 * Whether there is anything to resolve.
 *
 * A separate function, not an inline expression: the members query's `enabled`
 * rests on it, and the acceptance criterion requires that there be no extra
 * request when there is nothing to resolve. A verifiable assertion must be
 * verifiable separately from the render.
 */
export function needsDirectoryResolve(delegatees: readonly Delegatee[]): boolean {
  return delegatees.some((d) => d.userId !== null);
}

/**
 * The chip label: the name from the directory, otherwise the RAW string.
 *
 * Not "unknown user" and not empty: the raw string is the
 * only clue by which the reader understands whom was meant
 * when the person is not in the directory (deleted, external, an agent wrote an
 * arbitrary value).
 */
export function delegateeLabel(
  delegatee: Delegatee,
  directory: readonly DirectoryEntry[],
): string {
  if (delegatee.userId === null) return delegatee.username;
  for (const entry of directory) {
    if (entry.userId !== delegatee.userId) continue;
    const name = entry.name?.trim();
    // An empty name in the directory is not a name. Falling back to the raw string
    // is more honest than showing an empty chip.
    if (name) return name;
  }
  return delegatee.username;
}
