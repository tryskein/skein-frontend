/**
 * sk-674.18 — what the hub delivered to a tab: the received WebSocket frames
 * of a page, read as SignalR JSON protocol messages (split by the record
 * separator). The same reading as `live-delivery.spec.ts` (No. 96): the frames
 * are the hub's actual output, so «no frame of X» is observed on the wire,
 * not inferred from the screen.
 */
import type { Page } from '@playwright/test';

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

/**
 * Whether the hub has answered an invocation of the tab (a SignalR
 * completion message, `type: 3`). The tab's declarations of its projects
 * (`DeclareProjects` / `DeclareAllVisible`) are invocations, and the hub
 * runs them only after the connection's `OnConnectedAsync` (the user's own
 * group): from the first completion on, both the personal signals and the
 * events of the declared projects reach this tab. Acting before it races
 * the subscription — a signal sent earlier is not delivered live, only
 * later by the safety net.
 */
export function hubAnswered(frames: string[]): boolean {
  for (const frame of frames) {
    for (const part of frame.split('\u001e')) {
      if (part.trim() === '') continue;
      try {
        if ((JSON.parse(part) as { type?: number }).type === 3) return true;
      } catch {
        // Not a JSON protocol message — not a completion.
      }
    }
  }
  return false;
}
