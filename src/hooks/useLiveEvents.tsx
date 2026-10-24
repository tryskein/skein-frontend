/**
 * Live events provider — owns the single SignalR connection per browser
 * tab and pumps incoming envelopes into TanStack Query invalidations.
 *
 * Mounted in main.tsx between <AuthProvider> and <App>. Stays mounted
 * across route transitions, so the connection is established once on
 * login and torn down only on logout (or tab close). Every component
 * that wants to know the connection state pulls it from the context via
 * {@link useLiveEventsState}; events themselves do NOT flow through
 * React state — they fan out via the QueryClient cache so any consumer
 * with a useQuery on a relevant key gets a refetch automatically.
 *
 * Design highlights:
 *
 *  - Cookie auth via `withCredentials: true`. SPA and Hub are served
 *    same-origin by skein-web, so the auth cookie set at login flows
 *    through the WebSocket handshake without manual token wrangling.
 *  - StrictMode-safe: under React 18 StrictMode the dev-mode mount →
 *    cleanup → mount sequence creates two sequential connections; the
 *    first is properly torn down by the cleanup before the second
 *    starts. The per-effect `alive` flag short-circuits any setState
 *    that resolves after cleanup, so no leak and no stale state writes.
 *  - Dedup by envelope.id. The dispatcher is at-least-once, so duplicate
 *    deliveries are an expected steady-state condition, not an edge.
 *  - Invalidation is structural — see classifyEvent + invalidateForEvent.
 *  - No event subscription API exposed to consumers. The whole point of
 *    pushing through QueryClient is so feature code stays declarative
 *    (useQuery on the right key) and never has to wire imperative
 *    listeners.
 */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useInRouterContext } from 'react-router-dom';
import {
  HubConnection,
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
} from '@microsoft/signalr';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { classifyEvent } from '../lib/eventClassify';
import { EventDedup } from '../lib/eventDedup';
import {
  BrowserClientMethods,
  type EventEnvelope,
  type PersonalSignal,
  type ReminderFrame,
} from '../lib/eventEnvelope';
import { remindersListKey, ringReminderFiring } from '../lib/useReminders';
import { invalidateForEvent, isSelfDeactivation } from '../lib/liveEventInvalidation';
import { invalidateForSignal } from '../lib/livePersonalSignal';
import { startLiveSafetyNet } from '../lib/liveSafetyNet';
import {
  createLiveVisibility,
  LiveNavigationRefresh,
  type LiveVisibilityController,
} from '../lib/liveVisibility';
import { LiveAccessLoss, type AccessLossHandler } from '../lib/accessLoss';
import {
  createLiveInvalidationBatcher,
  LIVE_INVALIDATION_WINDOW_MS,
} from '../lib/liveInvalidationBatcher';
import {
  ProjectDeclarationContext,
  createProjectDeclaration,
  type ProjectDeclarationController,
} from '../lib/liveProjectDeclaration';
import {
  ME_THEME_QUERY_KEY,
  themeQueryKey,
  type Theme as ApiTheme,
  type UserThemePref,
} from '../api/themes';
import {
  applyVariables,
  cancelAutoReset,
  scheduleAutoReset,
  setDataTheme,
} from '../lib/themeRuntime';
import { reapplyActiveTheme } from '../lib/useTheme';
// sk-17 — surface every incoming EventEnvelope to the ActivityDashboard
// in addition to driving cache invalidations. The dashboard buffers
// these into the live ticker (with 250ms client-side batching).
//
// sk-17 review fix C2 — publish into the dashboard event bus instead
// of importing from the page module. The previous shape created a
// hard ESM cycle (useLiveEvents → ActivityDashboard → useLiveEvents)
// that only resolved because both involved bindings were function
// declarations (hoisted). Any future migration to `const` arrows or
// any side effect added at module scope on either side would break
// the import graph; tree-shaking is also blocked by the cycle. The
// bus is a 60-line module with no React surface, so we drag nothing
// transitive in here.
import { publishEnvelopeToDashboard } from '../lib/dashboardEventBus';

/**
 * Connection lifecycle states surfaced to the UI. SignalR's own status
 * enum is HubConnectionState — we collapse it into the four states the
 * connection banner cares about:
 *  - disconnected: no connection right now. This is always TRANSIENT
 *    unless we deliberately stopped (logout / unmount): a manual retry
 *    loop ({@link tryConnect}) keeps re-attempting `start()` with capped
 *    backoff, so the UI recovers on its own once the network returns.
 *  - connecting:   start() in flight.
 *  - connected:    handshake complete, receiving events.
 *  - reconnecting: transient drop, SignalR is retrying transparently.
 */
export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting';

/**
 * Backoff schedule (ms) shared by both recovery paths:
 *  - SignalR's own `withAutomaticReconnect` (transient drop on an
 *    already-established connection), and
 *  - our manual {@link tryConnect} loop (initial handshake + terminal
 *    onclose, which auto-reconnect does NOT cover).
 *
 * Indexed by retry count and CLAMPED to the last entry, so after the
 * ramp it retries every ~30s FOREVER. The default policy
 * (`withAutomaticReconnect()` with no args) instead stops after 0/2/10/30s
 * and fires onclose — leaving the tab dead until a manual reload. That
 * dead-end is exactly the bug this schedule fixes (sk-64).
 */
/**
 * The reminder frame is untrusted wire: ring and re-read only on a frame
 * that names its reminder and its firing.
 */
function isReminderFrame(frame: unknown): frame is ReminderFrame {
  if (!frame || typeof frame !== 'object') return false;
  const f = frame as Partial<Record<keyof ReminderFrame, unknown>>;
  return (
    typeof f.reminderId === 'string' &&
    f.reminderId !== '' &&
    typeof f.kind === 'string' &&
    typeof f.firingId === 'string' &&
    f.firingId !== ''
  );
}

export const RECONNECT_DELAYS_MS = [0, 2_000, 5_000, 10_000, 20_000, 30_000];

/**
 * sk-622.21 US-14 / T044 — upper bound of the random delay before a tab
 * re-reads its data after a reconnect or a `resync` frame. A skein-web
 * restart (or a recovered bus, US-10) reconnects every tab at once; the
 * jitter spreads their re-reads over 0–10 s instead of one wave of
 * ~12 000 tabs (spec target scale). The declaration is NOT delayed: it is
 * sent at once, before the re-read (edge 12).
 */
export const RESYNC_JITTER_MS = 10_000;

/**
 * The timer delay before the re-read is handed to the coalescing batcher, in
 * `[0, RESYNC_JITTER_MS − LIVE_INVALIDATION_WINDOW_MS)`, from `Math.random`.
 * The batcher applies it with its next wave, at most one window later, so
 * the re-read itself lands within `RESYNC_JITTER_MS` of the trigger (spec
 * "re-reads … with a random delay 0–RESYNC_JITTER_MS"; test-plan
 * No. 81 "no more than RESYNC_JITTER_MS") — not up to a window past it.
 */
export function resyncDelayMs(): number {
  return Math.floor(Math.random() * (RESYNC_JITTER_MS - LIVE_INVALIDATION_WINDOW_MS));
}

/**
 * Capped-backoff delay with ±20% jitter so a fleet of tabs that all
 * dropped on the same outage don't reconnect in lockstep and stampede
 * the Hub when it comes back. Never returns null/undefined — the
 * connection must never permanently give up on its own.
 */
export function reconnectDelayMs(retryCount: number): number {
  const idx = Math.min(retryCount, RECONNECT_DELAYS_MS.length - 1);
  const base = RECONNECT_DELAYS_MS[idx];
  if (base === 0) return 0;
  const jitter = (Math.random() - 0.5) * 0.4 * base; // ±20%
  return Math.max(0, Math.round(base + jitter));
}

interface LiveEventsContextValue {
  state: ConnectionState;
}

/**
 * R3.3 — wire shape of NotificationEnvelope (see skein-web
 * Hubs/NotificationEnvelope.cs). Distinct from EventEnvelope: carries
 * `notificationId` instead of `id`. The Hub sends both shapes on the
 * single `event` SignalR channel; the receive handler discriminates by
 * field name.
 */
interface NotificationEnvelopeShape {
  notificationId: number;
  userId: string;
  eventId: number;
  eventType: string;
  projectId?: string | null;
  createdAt: string;
}

const LiveEventsContext = createContext<LiveEventsContextValue>({
  state: 'disconnected',
});

/**
 * Read the current connection state. Read-only — components never
 * subscribe to events directly; that flows through QueryClient.
 */
export function useLiveEventsState(): ConnectionState {
  return useContext(LiveEventsContext).state;
}

interface LiveEventsProviderProps {
  children: ReactNode;
}

export function LiveEventsProvider({ children }: LiveEventsProviderProps) {
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();
  const [state, setState] = useState<ConnectionState>('disconnected');

  // Keep ctx values in refs so the long-lived `on('event', ...)` callback
  // sees the latest values without resubscribing. The Hub callback is
  // installed once per connection; admin/role changes during the
  // connection lifetime should still steer invalidations correctly.
  // sk-622.21 T041 — the tab's project declaration (US-9): which projects'
  // events the hub sends to this tab. One controller per provider, so the
  // registered sources survive reconnects; each (re)connection re-declares
  // the current set before anything else (see `connect` below). It follows
  // the rows of active `['tasks', …]` / `['issues','tree', …]` queries in
  // the QueryCache; the route, the open card, the expanded project rows and
  // `/activity` register through `useDeclareProjects` / `useDeclareAllVisible`.
  const declarationRef = useRef<ProjectDeclarationController | null>(null);
  if (declarationRef.current === null) {
    declarationRef.current = createProjectDeclaration();
  }
  const declaration = declarationRef.current;
  // sk-622.21 T044 (US-14, R6) — envelope dedup per TAB, not per
  // connection: delivery is at-least-once and a repeat may arrive after a
  // reconnect (the hub re-sends what the bus re-delivers); the effect must
  // still happen once. Ids are global (BIGSERIAL), so one bounded FIFO
  // serves every connection of the tab.
  const dedupRef = useRef<EventDedup | null>(null);
  if (dedupRef.current === null) dedupRef.current = new EventDedup();
  const dedup = dedupRef.current;
  useEffect(() => {
    const detach = declaration.attachQueryCache(queryClient.getQueryCache());
    return detach;
  }, [declaration, queryClient]);
  useEffect(() => () => declaration.dispose(), [declaration]);

  const userIdRef = useRef<string | null>(user?.id ?? null);
  const isAdminRef = useRef<boolean>(user?.role === 'admin');
  userIdRef.current = user?.id ?? null;
  isAdminRef.current = user?.role === 'admin';
  // The latest `logout` of the auth context (its identity follows the
  // mutation), read by the long-lived hub callback.
  const logoutRef = useRef(logout);
  logoutRef.current = logout;
  // The visibility / focus handling of the current connection (T043), read
  // by the navigation refresh rendered inside the router.
  const visibilityRef = useRef<LiveVisibilityController | null>(null);
  // sk-674.18 T053 — the loss-of-access handler, installed by
  // `LiveAccessLoss` inside the router (it needs the address and
  // `navigate`); fed every personal signal after its re-reads are queued.
  const accessLossRef = useRef<AccessLossHandler | null>(null);
  const inRouter = useInRouterContext();

  // Connection lifecycle is owned by this useEffect:
  //   - mount: build HubConnection + connect
  //   - cleanup: stop the connection
  //   - re-runs on user.id change: previous connection stopped, new one started
  //
  // Under React 18 StrictMode the dev-mode mount → cleanup → mount sequence
  // creates two sequential connections; the first is properly torn down by
  // the cleanup before the second starts. No leak.
  useEffect(() => {
    if (!user) {
      setState('disconnected');
      return;
    }

    // Per-effect liveness flag. The async `start()` resolution and the
    // Hub lifecycle callbacks (onreconnecting/onreconnected/onclose) can
    // fire AFTER the cleanup has already run — e.g. StrictMode tears the
    // effect down before start() resolves. Gate every setState behind
    // `alive` to avoid React's "setState after unmount" warning and to
    // prevent stale lifecycle pings from a stopped connection from
    // overwriting the state set by the next mount.
    let alive = true;


    // sk-622.1 — every cache reset an envelope causes goes through the
    // coalescing batcher, never straight to the QueryClient: resets are
    // collected and applied as one wave per window, deduplicated per query,
    // without cancelling reads in flight (see liveInvalidationBatcher.ts for
    // the window and why). Per connection (the dedup map is per tab); disposed in
    // the cleanup below once the connection has stopped. Theme frames go
    // through it too; only the preview, which touches no cache, does not.
    const batcher = createLiveInvalidationBatcher(queryClient);

    // sk-622.21 T043 — hidden tab, focus, visibility, navigation (K22):
    // a hidden tab sends nothing and keeps obligations in the batcher; the
    // return of visibility runs a pending self-logout first, else refreshes
    // registry class 3 and walks the obligations (`liveVisibility.ts`).
    const visibility = createLiveVisibility({
      batcher,
      logout: () => logoutRef.current(),
    });
    visibilityRef.current = visibility;

    // sk-622.21 T045 — the 60 s safety net (US-14, R11, R13) through the
    // same batcher: a visible tab re-reads the counters, the visible personal
    // queues, the open card and the «unreviewed» list; a hidden one only
    // takes obligations.
    const stopSafetyNet = startLiveSafetyNet(batcher);

    // sk-622.21 T044 — re-read after a reconnect or a `resync` frame (US-14,
    // US-10, K18 row "Reconnect / resync"): every ACTIVE query of the
    // tab, Inbox included (R12 keeps the cards accepted here), after a random
    // delay of 0–RESYNC_JITTER_MS (`resyncDelayMs`, the batcher's window
    // included). Through the batcher: a hidden tab only takes obligations
    // (K22) and sends nothing. One pending re-read at a time — a second
    // trigger while one waits changes nothing, the waiting one will read
    // everything. A drop of the connection cancels it: the reconnected one
    // declares first and schedules its own (`onreconnecting`, `onclose`,
    // edge 12).
    let resyncTimer: ReturnType<typeof setTimeout> | null = null;
    const cancelResync = () => {
      if (resyncTimer !== null) clearTimeout(resyncTimer);
      resyncTimer = null;
    };
    const scheduleResync = () => {
      if (!alive || resyncTimer !== null) return;
      resyncTimer = setTimeout(() => {
        resyncTimer = null;
        if (!alive) return;
        void batcher.invalidateQueries({ type: 'active' });
      }, resyncDelayMs());
    };
    // A (re)connection: declare at once, then re-read with the jitter. The
    // first connection of the effect re-reads nothing — the readers have
    // just fetched; a later one (terminal close, then a fresh start) has
    // missed whatever happened while it was down.
    let everConnected = false;
    const onConnected = () => {
      const isReconnect = everConnected;
      everConnected = true;
      void declaration.connect(conn).then(() => {
        if (isReconnect) scheduleResync();
      });
    };

    const conn: HubConnection = new HubConnectionBuilder()
      .withUrl('/hub', { withCredentials: true })
      // Custom INFINITE policy. nextRetryDelayInMilliseconds never returns
      // null, so SignalR keeps reconnecting through an outage of any length
      // instead of giving up after 30s like the no-arg default. This covers
      // the "connection was up, then dropped" path (onreconnecting/
      // onreconnected fire). The initial handshake + terminal onclose are
      // NOT covered here — that's what tryConnect() below is for.
      .withAutomaticReconnect({
        nextRetryDelayInMilliseconds: (ctx) => reconnectDelayMs(ctx.previousRetryCount),
      })
      .configureLogging(import.meta.env.DEV ? LogLevel.Information : LogLevel.Warning)
      .build();

    // Pending manual-retry timer + a monotonic generation counter. The
    // generation guards against two overlapping tryConnect() chains racing
    // (e.g. an `online` event firing while a backoff timer is still armed):
    // a new attempt bumps the counter, and any older chain's continuation
    // checks `gen === connectGen` and bails.
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let connectGen = 0;

    const clearReconnectTimer = () => {
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    // Manual self-healing connect loop. Handles the cases SignalR's own
    // auto-reconnect does NOT:
    //  - the very first start() (auto-reconnect only engages AFTER one
    //    successful handshake — a failed initial connect would otherwise
    //    stay disconnected forever), and
    //  - a terminal onclose (belt-and-suspenders; with the infinite policy
    //    above this should only fire on an unestablished connection).
    // Retries with capped backoff until the handshake succeeds or the
    // effect is torn down (alive=false).
    const tryConnect = (attempt = 0) => {
      if (!alive) return;
      // Only act when there's genuinely no connection. If SignalR is
      // mid-(re)connect or already up, leave it alone.
      if (conn.state !== HubConnectionState.Disconnected) return;
      clearReconnectTimer();
      const gen = ++connectGen;
      setState('connecting');
      conn
        .start()
        .then(() => {
          if (!alive || gen !== connectGen) {
            // Torn down (or superseded) while the handshake was in flight —
            // don't leave an orphan socket open.
            conn.stop().catch(() => {});
            return;
          }
          setState('connected');
          // A fresh connection holds no declared projects: declare first.
          onConnected();
        })
        .catch((err) => {
          if (!alive || gen !== connectGen) return;
          // Initial / terminal connect failure is usually a real outage
          // (network down, Hub redeploying). Keep retrying instead of
          // dead-ending in disconnected.
          console.warn('[live-events] hub connect failed, will retry', err);
          setState('disconnected');
          const delay = reconnectDelayMs(attempt);
          reconnectTimer = setTimeout(() => tryConnect(attempt + 1), delay);
        });
    };

    conn.onreconnecting(() => {
      if (!alive) return;
      declaration.disconnect();
      // A re-read waiting from the dropped connection (a `resync`, or an
      // earlier reconnect) must not fire over the next one before its
      // declaration: the reconnect re-reads everything after declaring.
      cancelResync();
      setState('reconnecting');
    });
    conn.onreconnected(() => {
      if (!alive) return;
      setState('connected');
      // A reconnect is a new server-side connection with an empty set
      // (edge 12): declare again before anything is re-read.
      onConnected();
    });
    conn.onclose(() => {
      if (!alive) return;
      declaration.disconnect();
      // As on `onreconnecting`: the next connection declares, then re-reads.
      cancelResync();
      setState('disconnected');
      // Auto-reconnect is exhausted (cannot happen with the infinite policy)
      // or the socket closed before the first handshake completed. Either
      // way, restart the manual loop so we recover instead of dead-ending.
      tryConnect();
    });

    // Network came back: don't wait out the current backoff timer — retry
    // immediately. Harmless if spurious (navigator.onLine can flap): the
    // conn.state guard inside tryConnect() no-ops when already connected or
    // mid-(re)connect, and the generation counter cancels the stale chain.
    const handleOnline = () => {
      if (!alive) return;
      if (conn.state === HubConnectionState.Disconnected) {
        clearReconnectTimer();
        tryConnect();
      }
    };
    window.addEventListener('online', handleOnline);

    // Hub.SendAsync method name is "event" — see skein-web SkeinHub.cs.
    // The hub sends two distinct envelope shapes on this single channel:
    //
    //  - EventEnvelope (project + user-namespace lifecycle events). Has
    //    a numeric `id` field — drives the structural classifier and the
    //    cache-invalidation router.
    //  - NotificationEnvelope (R3.3 per-user notification subject). Has
    //    a `notificationId` field instead of `id`. Deduped and otherwise
    //    ignored: the personal signal re-reads what it changes (T042).
    conn.on('event', (envelope: EventEnvelope | NotificationEnvelopeShape) => {
      // R3.3 notification envelope — discriminate on the field shape.
      // sk-622.21 T042 (K18 "Notification (personal channel)"): nothing beyond
      // the personal signal. The header counters and the personal queues
      // are re-read by the `signal` frame the server sends for the same
      // write (US-11); the `['notifications','count'|'list', …]` keys this
      // used to reset have no reader (K18 "No longer reset"). With
      // no effect there is nothing to dedup either.
      if (envelope && typeof (envelope as NotificationEnvelopeShape).notificationId === 'number') {
        return;
      }

      // Event handlers don't gate on alive — they read latest refs
      // (queryClient, userIdRef, isAdminRef) and any in-flight delivery
      // racing with cleanup is harmless: stop() will detach this listener
      // before further events are received, and an invalidate() against
      // a still-mounted QueryClient is idempotent.

      // Defensive: an envelope without an id can't be deduped, and the
      // classifier requires the structural fields. Drop quietly so a
      // bad message doesn't take down the receive loop.
      const eventEnv = envelope as EventEnvelope;
      if (!eventEnv || typeof eventEnv.id !== 'number') {
        if (import.meta.env.DEV) {
          console.warn('[live-events] dropping envelope without numeric id', envelope);
        }
        return;
      }
      if (dedup.has(eventEnv.id)) {
        return;
      }
      dedup.add(eventEnv.id);

      const classified = classifyEvent(eventEnv);
      if (classified.namespace === 'malformed') {
        if (import.meta.env.DEV) {
          console.warn('[live-events] dropping malformed envelope', envelope);
        }
        return;
      }

      const currentUserId = userIdRef.current;
      if (!currentUserId) {
        // Logged out mid-flight — don't invalidate: the logout marked the
        // whole cache stale (`AuthContext` `invalidateQueries()`, the cache
        // itself is kept), and no reader of this session is left.
        return;
      }
      // sk-622.21 T042 (K18 "User events"): `user.deactivated`
      // about this user ends the session — the same `useAuth().logout()`
      // as the menu: `POST /api/auth/logout` drops the ticket, `onSettled`
      // writes `null` into `['auth','me']` even on a 401 (ticket already
      // dropped by skein-web, T034), and `RequireAuth` leaves the shell.
      // Re-reading `/me` is no mechanism here — it reads the cookie. A
      // hidden tab sends nothing (US-14): it keeps the logout as an
      // obligation and runs it when the tab becomes visible.
      if (isSelfDeactivation(classified, currentUserId)) {
        visibility.requestLogout();
      }
      invalidateForEvent(batcher, classified, eventEnv, {
        isAdmin: isAdminRef.current,
        currentUserId,
        expandedProjectIds: declaration.explicitProjects('expanded'),
      });
      // sk-17 — also surface the envelope to any mounted ActivityDashboard
      // page so its ticker prepends a new row. Invoked AFTER the router so
      // the event's cache resets are already queued; since sk-622.1 they
      // are applied by the batcher's next wave, not synchronously here.
      publishEnvelopeToDashboard(eventEnv);
    });

    // sk-622.21 T044 — `resync` (US-10): the server could not deliver
    // everything to this connection (a bus or backplane break). Same
    // connection, same declared set: re-read only, no re-declaration.
    conn.on(BrowserClientMethods.Resync, () => {
      if (!userIdRef.current) return;
      scheduleResync();
    });

    // sk-622.21 T042 — the personal signal (US-11): areas only, no data;
    // each area re-reads its keys (K18 rows "Signal …",
    // `livePersonalSignal.ts`), through the same batcher as events.
    conn.on(BrowserClientMethods.Signal, (signal: PersonalSignal) => {
      if (!userIdRef.current) return;
      invalidateForSignal(batcher, signal);
      // sk-674.18 T053 — a lost space or project, the owner toasts
      // (`accessLoss.ts`).
      accessLossRef.current?.(signal, batcher);
    });

    // sk-622.21 T048 — the personal reminder frame (US-11, K14, K18 row
    // "Reminder frame"). Addressed to the reminder's owner whatever
    // projects this tab declared: the reminders list is re-read (through
    // the batcher, so a hidden tab only marks it stale), and a `rang`
    // frame rings the bell here and now — once per firing (`firingId`),
    // however often the at-least-once frame arrives, before or after a
    // reconnect (US-14). The project `reminder.*` envelope gets no
    // reaction any more (`liveEventInvalidation.ts`).
    conn.on(BrowserClientMethods.Reminder, (frame: ReminderFrame) => {
      if (!userIdRef.current) return;
      if (!isReminderFrame(frame)) return;
      void batcher.invalidateQueries({ queryKey: remindersListKey });
      ringReminderFiring(queryClient, frame);
    });

    // sk-10.3 — theme channels. The backend bridge fires three distinct
    // Hub method names on this connection:
    //
    //   theme.preview            (user-scoped, ephemeral): apply the
    //                            supplied variables inline; do not
    //                            persist; auto-revert after 10 min.
    //   theme.updated            (broadcast when an agent PATCHed a
    //                            theme): invalidate the affected theme's
    //                            detail cache so subscribers refetch the
    //                            new variables. If the active theme is
    //                            the one that changed, useTheme's effect
    //                            re-applies on the next render.
    //   theme.user-pref.updated  (user-scoped): the agent forked or
    //                            activated a different theme — refetch
    //                            /me/theme and let useTheme reconcile.
    //
    // ── Every cancelAutoReset() on this surface, and why (sk-285.7.6) ──
    //
    // The preview's 10-minute auto-revert is the ONLY thing that ever
    // removes a preview's keys from <html> on its own, so each cancel has
    // to mean «the preview is no longer the thing on screen». Four call
    // sites exist in the shipped bundle; three are here.
    //
    //   1. theme.updated — CONDITIONAL, and that is the fix. The channel
    //      is broadcast: this event arrives for every theme in the system,
    //      including ones nobody in this tab is wearing. Cancelling
    //      unconditionally killed the TTL of a preview the event had
    //      nothing to do with, and since nothing repainted afterwards the
    //      preview's arbitrary keys stayed inline on <html> — with
    //      data-theme pinned to "custom" — for the life of the tab. See
    //      the handler below for the exact predicate.
    //   2. theme.user-pref.updated — UNCONDITIONAL, and correctly so. It
    //      is user-scoped (subject `skein.user.{userId}...`), it always
    //      means the caller's own active theme is being re-resolved, and
    //      the /me/theme invalidation that follows always ends in an
    //      applyActive. The preview really is superseded.
    //   3. teardown — UNCONDITIONAL, and not about the preview at all: an
    //      unmount / logout must not leave a timer holding a closure over
    //      a QueryClient that is about to be cleared. Cancelling here
    //      abandons the preview's keys, which is acceptable only because
    //      the page is going away with them.
    //
    // The fourth is inside scheduleAutoReset itself (themeRuntime.ts): it
    // cancels before arming so successive previews EXTEND the TTL instead
    // of stacking timers. That one cannot strand anything — it replaces
    // the timer it clears.
    //
    // All three are co-located with the rest of the live-event surface
    // because we MUST reuse this single HubConnection — a parallel
    // connection would duplicate auth + cost a second WebSocket per
    // tab.
    conn.on(
      'theme.preview',
      (data: { variables?: Record<string, string> } | null | undefined) => {
        if (!data || typeof data !== 'object' || !data.variables) return;
        // Validate the variables map shape — the wire is untrusted and
        // we don't want to pass non-string values into setProperty.
        const vars: Record<string, string> = {};
        for (const [k, v] of Object.entries(data.variables)) {
          if (typeof v === 'string') vars[k] = v;
        }
        if (Object.keys(vars).length === 0) return;
        applyVariables(vars);
        setDataTheme('custom');
        // Auto-revert after 10 min. Successive previews extend the TTL
        // (scheduleAutoReset replaces the pending timer); a follow-up
        // theme.user-pref.updated cancels it, and so does a
        // theme.updated ABOUT THE ACTIVE THEME — both of those end in a
        // repaint that supersedes the preview. A theme.updated about any
        // OTHER theme leaves this timer armed, because nothing would
        // repaint and the timer is the only thing that ever takes these
        // keys back off <html> (sk-285.7.6).
        scheduleAutoReset(10 * 60 * 1000, () => {
          reapplyActiveTheme();
        });
      },
    );

    conn.on(
      'theme.updated',
      (data: { themeId?: string; variables?: Record<string, string> } | null | undefined) => {
        if (!data || typeof data !== 'object') return;
        const themeId = data.themeId;
        if (typeof themeId !== 'string' || themeId.length === 0) return;
        // A persisted change to the theme the caller is WEARING overrides
        // any in-flight preview: the cache write below reaches
        // `applyActive`, which strips and repaints, so the preview is
        // genuinely superseded and its auto-revert must not fire and undo
        // the new baseline.
        //
        // For any other theme this event repaints nothing — the query it
        // touches is not the one `useTheme` reads — so cancelling would
        // leave a live preview with no expiry and no other way out. The
        // predicate is deliberately the same condition under which the
        // write below reaches applyActive at all: mode is custom AND the
        // active id is this one (sk-285.7.6).
        const pref = queryClient.getQueryData<UserThemePref>(ME_THEME_QUERY_KEY);
        if (pref?.mode === 'custom' && pref.customThemeId === themeId) {
          cancelAutoReset();
        }
        // Optimistically merge the new variables into the per-theme
        // detail cache so any subscriber re-renders immediately, then
        // invalidate so the next refetch reconciles createdAt / updatedBy
        // / etc. metadata.
        if (data.variables && typeof data.variables === 'object') {
          const vars: Record<string, string> = {};
          for (const [k, v] of Object.entries(data.variables)) {
            if (typeof v === 'string') vars[k] = v;
          }
          if (Object.keys(vars).length > 0) {
            queryClient.setQueryData<ApiTheme>(
              themeQueryKey(themeId),
              (prev) =>
                prev
                  ? {
                      ...prev,
                      variables: vars,
                      updatedAt: new Date().toISOString(),
                    }
                  : prev,
            );
          }
        }
        // sk-622.1 — through the batcher like every other reset from a
        // hub frame: the optimistic merge above already repaints, so the
        // reconciling refetch can wait for the wave, and a burst of theme
        // PATCHes must not cancel-and-restart the read. The merge is a
        // `setQueryData` (`manual: true`), which the batcher does NOT take
        // for a delivered read, so the wave still refetches.
        void batcher.invalidateQueries({ queryKey: themeQueryKey(themeId) });
        // Also refresh the themes-catalog list (right-click menu) — the
        // updatedAt / updatedBy fields shifted and a sort-by-recent
        // would otherwise look stale.
        void batcher.invalidateQueries({
          predicate: (q) =>
            Array.isArray(q.queryKey) && q.queryKey[0] === 'themes',
        });
      },
    );

    conn.on('theme.user-pref.updated', () => {
      // Cancel any pending auto-revert — the user's preference may have
      // flipped to a new theme entirely, and we want the freshly
      // fetched /me/theme to drive the next paint.
      cancelAutoReset();
      // sk-622.1 — via the batcher: the repaint follows the refetch, at most
      // one window (1.5 s) after the frame.
      void batcher.invalidateQueries({ queryKey: ME_THEME_QUERY_KEY });
    });

    // Kick off the self-healing connect loop. Unlike the old bare start(),
    // a failed initial handshake now retries with backoff (and the `online`
    // listener / onclose handler keep it alive across outages) instead of
    // dead-ending in disconnected until a manual reload.
    tryConnect();

    return () => {
      alive = false;
      declaration.disconnect();
      clearReconnectTimer();
      window.removeEventListener('online', handleOnline);
      visibility.dispose();
      stopSafetyNet();
      cancelResync();
      if (visibilityRef.current === visibility) visibilityRef.current = null;
      // Cancel any pending preview auto-reset so a logout / unmount /
      // user switch doesn't leave a timer holding a stale closure that
      // would call reapplyActiveTheme() against the just-cleared cache.
      cancelAutoReset();
      conn
        .stop()
        .catch((err) => {
          // stop() can reject if the connection is already in a terminal
          // state (e.g. start() failed and the socket never opened). It's
          // not actionable in production — surface only in dev so we
          // notice if a real teardown bug regresses.
          if (import.meta.env.DEV) {
            console.warn('[live-events] hub stop failed', err);
          }
        })
        // sk-622.1 (review) — the batcher goes AFTER the connection: stop()
        // is asynchronous and the hub keeps delivering frames until it
        // settles. Disposing first would silently drop the resets of a
        // frame landing in that gap; now they are queued and applied by
        // the wave as usual. Whatever is still pending when stop() settles
        // is dropped with the batcher — the connection is gone.
        .finally(() => batcher.dispose());
    };
    // user?.id is the right dep: log-in/out flips the connection on/off,
    // but role change inside one session does NOT need a reconnect (the
    // ref-based ctx pickup above handles it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, queryClient, declaration]);

  return (
    <LiveEventsContext.Provider value={{ state }}>
      <ProjectDeclarationContext.Provider value={declaration}>
        {inRouter && <LiveNavigationRefresh controller={visibilityRef} />}
        {inRouter && <LiveAccessLoss handler={accessLossRef} userId={user?.id ?? null} />}
        {children}
      </ProjectDeclarationContext.Provider>
    </LiveEventsContext.Provider>
  );
}
