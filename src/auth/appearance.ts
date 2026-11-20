/**
 * The appearance of a user on this page: the moment the server confirmed the
 * signed-in user — a page load, a login without a reload, another user
 * without a reload, a new session after a password reset (which ends with a
 * document load).
 *
 * An appearance is `{userId, seq}`. `seq` grows
 *   - on the first answer of `/me` with a user in this document,
 *   - on every successful login, the same user included,
 *   - on an answer of `/me` with another user, or after `null`,
 *   - on the re-read of `/me` after the server said the user changed;
 * and not on a repeated answer of `/me` with the same user.
 *
 * Every asynchronous push step takes the appearance as its token when it
 * starts and checks {@link isCurrentAppearance} before each effect: a step
 * whose appearance was replaced stops without one. The store is updated
 * synchronously where the answer arrives, not in a React effect, so a token
 * is stale from the moment the new answer exists.
 */

/** A user's appearance; also the token of the push steps started in it. */
export interface Appearance {
  readonly userId: string;
  readonly seq: number;
}

/** Why `/me` is being read; a re-read after "user changed" always grows `seq`. */
export type MeReadReason = 'load' | 'afterUserChanged';

type Listener = () => void;

let current: Appearance | null = null;
let lastSeq = 0;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

function appear(userId: string): void {
  lastSeq += 1;
  current = { userId, seq: lastSeq };
  emit();
}

/** The current appearance, `null` when no user is confirmed. */
export function currentAppearance(): Appearance | null {
  return current;
}

/** Whether `token` is still the current appearance. */
export function isCurrentAppearance(token: Appearance): boolean {
  return current !== null && current.seq === token.seq && current.userId === token.userId;
}

/** Subscribes to changes of the appearance; returns the unsubscribe. */
export function subscribeAppearance(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Records an answer of `/me`. `previousAnswer` is what the page held for
 * `/me` before this answer: `undefined` (never answered), `null` (nobody) or
 * the user id.
 */
export function noteMeAnswer(
  userId: string | null,
  previousAnswer: string | null | undefined,
  reason: MeReadReason,
): void {
  if (userId === null) {
    noteSignedOut();
    return;
  }
  if (
    reason === 'afterUserChanged' ||
    current === null ||
    current.userId !== userId ||
    previousAnswer === null
  ) {
    appear(userId);
  }
}

/** Records a successful login. */
export function noteLogin(userId: string): void {
  appear(userId);
}

/** Records that no user is signed in on this page any more. */
export function noteSignedOut(): void {
  if (current === null) return;
  current = null;
  emit();
}

let meReloader: (() => Promise<void>) | null = null;

/**
 * Registers how `/me` is re-read after the server said the user changed
 * (`AuthProvider` does). Returns the unregister.
 */
export function registerMeReload(reload: () => Promise<void>): () => void {
  meReloader = reload;
  return () => {
    if (meReloader === reload) meReloader = null;
  };
}

/**
 * Re-reads `/me` because a push operation was refused as "user changed"; the
 * answer starts a new appearance. Without a registered reader nothing happens.
 */
export async function reloadMeAfterUserChanged(): Promise<void> {
  if (meReloader !== null) await meReloader();
}
