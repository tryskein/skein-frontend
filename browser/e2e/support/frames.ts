/**
 * sk-674.18 — what the hub delivered to a tab: the received WebSocket frames
 * of a page, read as SignalR JSON protocol messages (split by the record
 * separator). The same reading as `live-delivery.spec.ts` (No. 96): the frames
 * are the hub's actual output, so «no frame of X» is observed on the wire,
 * not inferred from the screen.
 */
import type { Page, WebSocketRoute } from '@playwright/test';

/** A WebSocket message as a route sees it: text, or binary. */
type WsMessage = Parameters<Parameters<WebSocketRoute['onMessage']>[0]>[0];

/** Start recording the frames `page` receives; the array grows as they come. */
export function recordReceivedFrames(page: Page): string[] {
  const frames: string[] = [];
  page.on('websocket', (ws) => {
    ws.on('framereceived', (frame) => {
      frames.push(typeof frame.payload === 'string' ? frame.payload : frame.payload.toString('utf8'));
    });
  });
  return frames;
}

/** The `event` envelopes in `frames` (from index `from` on). */
export function eventEnvelopes(frames: string[], from = 0): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const frame of frames.slice(from)) {
    for (const part of frame.split('\u001e')) {
      if (part.trim() === '') continue;
      let msg: { target?: string; arguments?: unknown[] };
      try {
        msg = JSON.parse(part) as { target?: string; arguments?: unknown[] };
      } catch {
        continue;
      }
      const env = msg.arguments?.[0];
      if (msg.target === 'event' && env !== null && typeof env === 'object') {
        out.push(env as Record<string, unknown>);
      }
    }
  }
  return out;
}

/** Envelopes about `issueId` (as the event's entity) received from index `from` on. */
export function issueEvents(frames: string[], issueId: string, from = 0): Record<string, unknown>[] {
  return eventEnvelopes(frames, from).filter((env) => env.entityId === issueId);
}

/** Any frame from index `from` on that names `id` at all — envelope or not. */
export function framesNaming(frames: string[], id: string, from = 0): string[] {
  return frames.slice(from).filter((f) => f.includes(id));
}

/** The JSON protocol messages of `frames` (split by the record separator). */
function protocolMessages(frames: string[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const frame of frames) {
    for (const part of frame.split(RECORD_SEPARATOR)) {
      if (part.trim() === '') continue;
      try {
        const msg = JSON.parse(part) as unknown;
        if (msg !== null && typeof msg === 'object') out.push(msg as Record<string, unknown>);
      } catch {
        // Not a JSON protocol message.
      }
    }
  }
  return out;
}

/** SignalR JSON protocol: messages end with the record separator. */
const RECORD_SEPARATOR = '\u001e';

/**
 * The invocation id of the readiness probe (`probeHubReadiness`). The tab's
 * own invocation ids are counters ("0", "1", …), so this one never collides
 * with them.
 */
export const HUB_READY_INVOCATION_ID = 'e2e-hub-ready';

/**
 * The probe: `DeclareAllVisible(false)` on a fresh connection, whose mode is
 * off (skein-web `ConnectionState.AllVisible`). The hub answers it from the
 * state — no access call, no rate slot, no group change
 * (`SkeinHub.DeclareAllVisible`) — so it changes nothing the tab or the test
 * relies on. Sent before the tab sees the handshake answer, it is the first
 * invocation on the connection, ahead of any declaration of the tab.
 */
const READINESS_PROBE =
  JSON.stringify({ type: 1, invocationId: HUB_READY_INVOCATION_ID, target: 'DeclareAllVisible', arguments: [false] }) +
  RECORD_SEPARATOR;

/** Is `message` the hub's successful handshake answer (`{}`, no `error`)? */
function isHandshakeSuccess(message: WsMessage): boolean {
  const text = typeof message === 'string' ? message : message.toString('utf8');
  const first = text.split(RECORD_SEPARATOR)[0];
  try {
    const msg = JSON.parse(first) as Record<string, unknown> | null;
    return msg !== null && typeof msg === 'object' && !('type' in msg) && !('error' in msg);
  } catch {
    return false;
  }
}

/**
 * Make every hub connection of `page` carry a readiness probe. Call before
 * the page loads the app.
 *
 * Why a probe: the hub writes its handshake answer BEFORE it registers the
 * connection — ASP.NET Core `HubConnectionHandler.OnConnectedAsync` runs
 * `HandshakeAsync`, then `_lifetimeManager.OnConnectedAsync` (with the Redis
 * backplane: the subscriptions of the connection and of its user), then the
 * hub's `OnConnectedAsync` (`SkeinHub`: the `ConnectionRegistry` entry and
 * the groups), and only then dispatches invocations. The personal signals
 * need those steps: `spaces` goes to the connections the registry lists, by
 * `Clients.Client` (skein-web `PersonalSignalCoalescer`); notifications go
 * by `Clients.User` (`NatsBridge`). So neither the handshake nor the
 * client's «connected» state says that a personal signal would be
 * delivered; the answer to an invocation does. A tab with no
 * project to declare sends no invocation of its own, hence the probe.
 *
 * The page's own socket carries it: `connectToServer` opens the real
 * WebSocket in the page (its cookie, its frames for `recordReceivedFrames`).
 * Messages from the page are forwarded untouched; the probe goes to the hub
 * right after the handshake answer arrives and before the tab receives that
 * answer. Every message of the hub reaches the tab unchanged, the answer to
 * the probe included: the tab's client ignores a completion of an id it did
 * not issue (`@microsoft/signalr` `HubConnection`, `_callbacks` lookup).
 */
export async function probeHubReadiness(page: Page): Promise<void> {
  await page.routeWebSocket(
    (url) => url.pathname === '/hub',
    (ws) => {
      const server = ws.connectToServer();
      let handshakeSeen = false;
      server.onMessage((message) => {
        if (!handshakeSeen) {
          handshakeSeen = true;
          if (isHandshakeSuccess(message)) server.send(READINESS_PROBE);
        }
        ws.send(message);
      });
    },
  );
}

/**
 * Whether the hub has answered the readiness probe of `probeHubReadiness`
 * (a completion, `type: 3`, of its id, without an error). From then on the
 * connection's and the user's subscriptions are in place and its
 * `OnConnectedAsync` is done (the registry lists it): a personal signal sent
 * later reaches the tab live, by `Clients.Client` or `Clients.User`. It says nothing about project events — those need the tab's
 * declaration, see `hubAnswered`.
 */
export function hubReady(frames: string[]): boolean {
  return protocolMessages(frames).some(
    (msg) => msg.type === 3 && msg.invocationId === HUB_READY_INVOCATION_ID && !('error' in msg),
  );
}

/**
 * Whether the hub has answered an invocation of the tab itself (a SignalR
 * completion message, `type: 3`, other than the readiness probe's). The
 * tab's declarations of its projects (`DeclareProjects` /
 * `DeclareAllVisible`) are such invocations, and the hub runs them only
 * after the connection's `OnConnectedAsync`: from the first completion on,
 * both the personal signals and the events of the declared projects reach
 * this tab. Acting before it races the subscription — a signal sent earlier
 * is not delivered live, only later by the safety net. A tab with nothing
 * to declare sends no invocation and never gets here: wait for `hubReady`.
 */
export function hubAnswered(frames: string[]): boolean {
  return protocolMessages(frames).some((msg) => msg.type === 3 && msg.invocationId !== HUB_READY_INVOCATION_ID);
}
