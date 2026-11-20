/**
 * An asynchronous push step: a piece of push work done for one appearance of
 * a user (`auth/appearance.ts`), with that appearance as its token.
 *
 * Before each effect — a push request, a write of the push state, a removal
 * of a channel, a publication of the UI state — the step checks that it is
 * still live: its appearance is current and its signal is not aborted. The
 * signal is aborted when the appearance is replaced, or when the step's own
 * deadline passed (explicit logout). A step that is not live stops without
 * the effect.
 */

import type { PushOutcome } from '../../api/push';
import { type Appearance, isCurrentAppearance } from '../../auth/appearance';
import type { WriteGuard } from './pushState';

/** Ends a step: it is no longer live, or the server said the user changed. */
export class StepEnded extends Error {
  constructor(readonly reason: 'superseded' | 'userChanged') {
    super(reason);
    this.name = 'StepEnded';
  }
}

/** One asynchronous push step of an appearance. */
export interface PushStep {
  token: Appearance;
  /** Aborted when the appearance is replaced or the step's deadline passed. */
  signal: AbortSignal;
  /**
   * Whether the step's appearance still holds; by default, that it is the
   * current appearance.
   */
  holds?: () => boolean;
}

/** Whether the step may still have effects. */
export function isLive(step: PushStep): boolean {
  return !step.signal.aborted && (step.holds !== undefined ? step.holds() : isCurrentAppearance(step.token));
}

/** Throws {@link StepEnded} unless the step is live. */
export function live(step: PushStep): void {
  if (!isLive(step)) throw new StepEnded('superseded');
}

/**
 * Sends one push operation of the step. "User changed" ends the step as
 * such even when the step ended meanwhile: the server's answer is known and
 * the caller must not act as if it were not. Any other answer of a step that
 * is no longer live is not a basis for anything.
 */
export async function request<T>(
  step: PushStep,
  send: (signal: AbortSignal) => Promise<PushOutcome<T>>,
): Promise<PushOutcome<T>> {
  live(step);
  const outcome = await send(step.signal);
  if (outcome.kind === 'userChanged') throw new StepEnded('userChanged');
  live(step);
  return outcome;
}

/**
 * The bound of a push state write made by the step: the wait for the store
 * lock ends with the step's signal, and the step must still be live once the
 * lock is held, right before the write.
 */
export function guardOf(step: PushStep): WriteGuard {
  return { signal: step.signal, check: () => live(step) };
}
