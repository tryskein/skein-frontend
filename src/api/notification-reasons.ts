/**
 * Notification-reason settings — REST client for contract C1 (sk-303.13).
 *
 *   GET /api/v1/me/notification-reasons → the server-side reason registry
 *                                         with the caller's channel states
 *   PUT /api/v1/me/notification-reasons → partial update of those states
 *
 * One row = one REASON («Issue assignment», «Comment», …) with two
 * INDEPENDENT channels: `feed` and `push`. This module replaces the two
 * previous settings contracts (notify-event-types for the feed, push
 * categories for the push side) — the client no longer owns a dictionary of
 * reasons, labels, applicability or defaults. It renders what the server
 * returned, and nothing else.
 *
 * Three properties of the wire contract shape everything below:
 *
 *   1. `applicable` and `enabled` are SEPARATE fields on a channel. «this
 *      reason has no such channel» and «the channel exists but is off» are
 *      different statements: the first draws a dash the user cannot switch
 *      on, the second draws an off switch. Collapsing them into one boolean
 *      would resurrect the dead-toggle defect this wave removes.
 *   2. `audience` lives on the CHANNEL, not on the reason: the two channels
 *      of one reason legitimately reach different people (the feed of
 *      «Delegated-issue status» goes to every subscriber, its push only
 *      to the delegating creator).
 *   3. The update is PARTIAL. Only the reasons named in the body change, and
 *      within them only the channels named. That is what lets a form built
 *      against an older registry survive a newer server: what it cannot draw,
 *      it does not name, and what it does not name keeps its stored value.
 *
 * Consequently NOTHING here narrows a server string into a closed client
 * union. `key` and `audience` stay `string`: an unknown reason or an unknown
 * audience must render neutrally and survive a save, not be dropped on parse.
 *
 * Push DEVICE management (subscribe this browser, list devices, revoke) is a
 * different contract and stays in `api/push.ts` — devices are not a reason.
 */

import { apiJson } from './client';

// ───────────────────────── Wire DTOs ─────────────────────────

/** The two channels a reason can have. Fixed by the wire shape, not a catalog. */
export type ReasonChannelName = 'feed' | 'push';

/** Both channels, in render order. */
export const REASON_CHANNELS: readonly ReasonChannelName[] = ['feed', 'push'];

/**
 * One cell of the settings table: one channel of one reason for one user.
 *
 * `applicable` / `audience` come from the server registry (identical for every
 * user); `enabled` is this caller's state. On an inapplicable channel the
 * server always reports `enabled: false` and `audience` is absent — the UI
 * draws a dash there and must not offer a switch.
 */
export interface ReasonChannel {
  /** Whether this channel exists for the reason at all. */
  applicable: boolean;
  /**
   * Who this channel reaches, as a registry code (e.g. `subscribers`,
   * `new_assignee`, `delegating_creator`). Empty string when the channel is
   * inapplicable — and deliberately NOT a closed union: a code this build
   * does not recognise must render neutrally rather than break the row.
   */
  audience: string;
  /** The caller's state. Always false on an inapplicable channel. */
  enabled: boolean;
}

/** One row of the settings table: a reason and its two channels. */
export interface ReasonRow {
  /** Stable registry key — the value sent back on update. */
  key: string;
  /** Human-readable (RU) name, server-owned. */
  label: string;
  /**
   * Sub-caption under the name. Non-empty when the two channels of this
   * reason reach different audiences and the row has to say so instead of
   * averaging them. Empty string when the server sent none.
   */
  hint: string;
  feed: ReasonChannel;
  push: ReasonChannel;
}

/**
 * Body of `GET/PUT /api/v1/me/notification-reasons`.
 *
 * `reasons` carries ONLY the ACTIVE reasons: the ones reserved for later
 * waves exist in storage but get no row here, because a toggle without an
 * effect is exactly the defect this contract removes. So the number of rows
 * is not the number of enabled reasons in storage, and neither number should
 * ever be hardcoded on this side.
 *
 * `suppressAgentActions` lives on the page BESIDE the reason table, not
 * inside it: it is not a reason but a cross-cutting filter of the
 * SUBSCRIPTION path — with it on, actions performed by an agent (anyone's
 * agent, not only the caller's) produce no notification about the things the
 * caller merely watches. Personal signals are never affected: assignment,
 * acceptance, the status of a task the caller delegated, an @-mention and a
 * reminder arrive whoever acted. The «default inbox scope» setting does not
 * come back: the server never reads it.
 */
export interface ReasonPrefs {
  reasons: ReasonRow[];
  suppressAgentActions: boolean;
  /**
   * sk-551.10 — when an issue is closed, drop the caller's AUTOMATIC
   * subscriptions on it (creator / assignee); a manual one stays, and a
   * reopen brings the automatic one back. Off by default.
   */
  unwatchOnClose: boolean;
}

// ───────────────────────── Update input ─────────────────────────

/**
 * Desired state of the two channels of ONE reason.
 *
 * An omitted channel keeps its stored value, so `{reason: 'comment', feed:
 * true}` switches the feed on without touching the push side.
 */
export interface ReasonChannelUpdate {
  reason: string;
  feed?: boolean;
  push?: boolean;
}

/**
 * Body of the partial update. Reasons absent from `reasons` are left exactly
 * as they are stored — including reasons this build has never heard of.
 */
export interface UpdateReasonPrefsInput {
  reasons?: ReasonChannelUpdate[];
  suppressAgentActions?: boolean;
  unwatchOnClose?: boolean;
}

// ───────────────────────── Normalisation ─────────────────────────

function normalizeChannel(raw: unknown): ReasonChannel {
  const src = (raw ?? {}) as Partial<ReasonChannel>;
  const applicable = src.applicable === true;
  return {
    applicable,
    // `audience` is omitempty on the wire — absent on an inapplicable
    // channel. Clear it even if a payload sends one anyway: «no such channel»
    // has no audience, and the type says so, so the two must not disagree.
    audience:
      applicable && typeof src.audience === 'string' ? src.audience : '',
    // An inapplicable channel is never on, whatever the payload claims.
    enabled: applicable && src.enabled === true,
  };
}

function normalizeRow(raw: unknown): ReasonRow | null {
  const src = (raw ?? {}) as Partial<ReasonRow>;
  if (typeof src.key !== 'string' || src.key === '') return null;
  return {
    key: src.key,
    // Fall back to the key rather than to a client-side label table: an
    // unknown reason still has to be nameable on screen.
    label: typeof src.label === 'string' && src.label !== '' ? src.label : src.key,
    hint: typeof src.hint === 'string' ? src.hint : '',
    feed: normalizeChannel(src.feed),
    push: normalizeChannel(src.push),
  };
}

/**
 * Defensive read of the wire payload. Rows keep their server order (it is the
 * registry's display order) and unknown keys / audiences pass through
 * untouched — the only thing dropped is a row with no key at all, which
 * could not be addressed on save anyway.
 */
export function normalizeReasonPrefs(raw: unknown): ReasonPrefs {
  const src = (raw ?? {}) as Partial<ReasonPrefs>;
  const rows = Array.isArray(src.reasons) ? src.reasons : [];
  const reasons: ReasonRow[] = [];
  for (const row of rows) {
    const normalized = normalizeRow(row);
    if (normalized !== null) reasons.push(normalized);
  }
  return {
    reasons,
    suppressAgentActions: src.suppressAgentActions === true,
    // Absent on an older API: the setting does not exist there, which is
    // the same as off.
    unwatchOnClose: src.unwatchOnClose === true,
  };
}

// ───────────────────────── Pure editing helpers ─────────────────────────

/**
 * Return a copy of `prefs` with one channel of one reason switched.
 *
 * An inapplicable channel is NOT switchable: the call returns the input
 * unchanged rather than storing a state the server would refuse with
 * `channel_not_applicable`. A reason the payload does not carry is likewise a
 * no-op — the client never invents rows.
 */
export function setReasonChannel(
  prefs: ReasonPrefs,
  reasonKey: string,
  channel: ReasonChannelName,
  enabled: boolean,
): ReasonPrefs {
  let changed = false;
  const reasons = prefs.reasons.map((row) => {
    if (row.key !== reasonKey) return row;
    const cell = row[channel];
    if (!cell.applicable || cell.enabled === enabled) return row;
    changed = true;
    return { ...row, [channel]: { ...cell, enabled } };
  });
  return changed ? { ...prefs, reasons } : prefs;
}

/**
 * Build the partial-update body from the pair (what the server last gave us,
 * what the user now sees).
 *
 * The diff is the mechanism behind «an unknown reason survives a save»: a row
 * the form never rendered cannot appear in `draft`, so it is never named, so
 * the server leaves it alone. A row that IS rendered but untouched is also
 * left out — naming it would turn every save into a full replace by another
 * name.
 *
 * An inapplicable channel is never named either: switching one ON is a
 * business error (`channel_not_applicable`), and naming it OFF would write a
 * state nothing reads.
 */
export function diffReasonPrefs(
  base: ReasonPrefs,
  draft: ReasonPrefs,
): UpdateReasonPrefsInput {
  const baseByKey = new Map(base.reasons.map((row) => [row.key, row]));
  const reasons: ReasonChannelUpdate[] = [];

  for (const row of draft.reasons) {
    const before = baseByKey.get(row.key);
    // A row with no counterpart in `base` was not part of the payload we are
    // editing; sending it would be the client inventing a preference.
    if (before === undefined) continue;

    const update: ReasonChannelUpdate = { reason: row.key };
    let touched = false;
    for (const channel of REASON_CHANNELS) {
      const cell = row[channel];
      if (!cell.applicable) continue;
      if (!before[channel].applicable) continue;
      if (cell.enabled === before[channel].enabled) continue;
      update[channel] = cell.enabled;
      touched = true;
    }
    if (touched) reasons.push(update);
  }

  const input: UpdateReasonPrefsInput = {};
  if (reasons.length > 0) input.reasons = reasons;
  if (draft.suppressAgentActions !== base.suppressAgentActions) {
    input.suppressAgentActions = draft.suppressAgentActions;
  }
  if (draft.unwatchOnClose !== base.unwatchOnClose) {
    input.unwatchOnClose = draft.unwatchOnClose;
  }
  return input;
}

/** Whether a diff would send anything at all. */
export function hasReasonPrefsChanges(input: UpdateReasonPrefsInput): boolean {
  return (
    (input.reasons !== undefined && input.reasons.length > 0) ||
    input.suppressAgentActions !== undefined ||
    input.unwatchOnClose !== undefined
  );
}

// ───────────────────────── Operations ─────────────────────────

/** Fetch the active reason registry with the caller's channel states. */
export async function getReasonPrefs(): Promise<ReasonPrefs> {
  return normalizeReasonPrefs(
    await apiJson<unknown>('/api/v1/me/notification-reasons'),
  );
}

/**
 * Apply a PARTIAL update and return the server's fresh view of the settings
 * (the PUT answers with the same payload as the GET, so the form re-renders
 * from the authority instead of from its own optimistic guess).
 *
 * Business errors surface as `BusinessError` (422) from the shared client:
 * `unknown_reason` (a key outside the closed registry), `reason_not_settable`
 * (a reason the registry reserves for a later wave) and
 * `channel_not_applicable` (switching on a channel the reason does not have).
 * In all three cases the server wrote nothing.
 */
export async function updateReasonPrefs(
  input: UpdateReasonPrefsInput,
): Promise<ReasonPrefs> {
  return normalizeReasonPrefs(
    await apiJson<unknown>('/api/v1/me/notification-reasons', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  );
}
