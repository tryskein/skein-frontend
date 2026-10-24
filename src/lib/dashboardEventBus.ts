// sk-17 review fix C2 — extract the dashboard event-bus out of
// pages/activity/ActivityDashboard.tsx so hooks/useLiveEvents.tsx can
// publish into it without dragging the whole dashboard module (every
// component declaration, every CSS class string, every Set constant)
// across the import graph. Previously the two files imported each
// other — a hard ESM circular dependency that worked only because
// both involved bindings were function declarations (hoisted); any
// future migration to `const` arrows or any side effect added at
// module scope would break the chain.
//
// The bus owns a single module-level Set of listeners and exposes a
// publish + subscribe pair. Tests can reset the bus via the exported
// `_resetForTests` symbol (the underscore signals not-public-API).
//
// Architectural note (mirrors the doc on the page module): the bus
// lives on top of the existing SignalR `event` channel — there is no
// new server-side firehose group. Visibility is already enforced by
// NatsBridge before the envelope reaches the browser.

import type { EventEnvelope } from './eventEnvelope';

export type DashboardEnvelopeListener = (env: EventEnvelope) => void;

const listeners = new Set<DashboardEnvelopeListener>();

/**
 * Publish an envelope to every active subscriber. Invoked by the
 * LiveEventsProvider on each incoming SignalR `event` frame. A
 * listener throwing must NOT cascade — siblings see every envelope.
 */
export function publishEnvelopeToDashboard(env: EventEnvelope): void {
  for (const listener of listeners) {
    try {
      listener(env);
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('[dashboardEventBus] listener threw', err);
      }
    }
  }
}

/**
 * Subscribe to incoming envelopes. Returns an unsubscribe function;
 * call it on effect cleanup. Subscribers are de-duplicated by Set
 * identity — passing the same function twice is idempotent.
 */
export function subscribeDashboardEnvelopes(
  listener: DashboardEnvelopeListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const purgeListeners = new Set<() => void>();

/**
 * sk-674.18 (US-19, review C2) — access was lost: every subscriber drops
 * the rows it keeps outside the query cache (HOT ZONE's rolling buffer and
 * its pending batch) and seeds again from the next authorized answer.
 * Called by `accessLoss.ts` together with the cache purge, on any route.
 */
export function publishDashboardPurge(): void {
  for (const listener of purgeListeners) {
    try {
      listener();
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('[dashboardEventBus] purge listener threw', err);
      }
    }
  }
}

/** Subscribe to {@link publishDashboardPurge}. Returns an unsubscribe function. */
export function subscribeDashboardPurge(listener: () => void): () => void {
  purgeListeners.add(listener);
  return () => {
    purgeListeners.delete(listener);
  };
}

/**
 * Test-only: clear every registered listener. Avoids cross-test
 * leakage when multiple suites mount the dashboard. Not exported
 * for production use — names prefixed with underscore by convention.
 */
export function _resetDashboardBusForTests(): void {
  listeners.clear();
  purgeListeners.clear();
}
