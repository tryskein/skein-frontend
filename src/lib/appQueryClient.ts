import {
  MutationCache,
  QueryCache,
  QueryClient,
} from '@tanstack/react-query';
import { UnauthorizedError } from '../api/client';
import { ME_KEY } from '../auth/AuthContext';

/**
 * The app's single QueryClient, with session death wired to sign-out.
 *
 * ─── Why this exists ───────────────────────────────────────────────
 *
 * Session death is an APP-WIDE fact, not a per-query failure.
 *
 * `['auth','me']` is cached with `staleTime: Infinity` and never
 * refetches, so when the session cookie expires while a tab sits open
 * the cached user stays put: RequireAuth keeps the shell mounted, the
 * header keeps its counters, and only the data queries start failing.
 * The Tasks column then renders "Failed to load tasks" — technically
 * true and completely misleading. The user is not looking at a broken
 * server, they are looking at a browser that is no longer signed in,
 * and nothing on screen says so. Reproduced on the stand: drop the
 * `skein.sid` cookie, touch any filter, and the column goes to
 * `Tasks 0` + "Failed to load tasks" while the URL stays on `/`.
 *
 * Clearing the cached user is enough to fix it — RequireAuth already
 * redirects to `/login` the moment `user` is falsy. We hook the CACHE
 * rather than each call site so a 401 from ANY query or mutation —
 * tasks, projects, comments, reminders — routes to the same place.
 *
 * ─── Why only UnauthorizedError ────────────────────────────────────
 *
 * A 403, a 500 or a dead network is a real error and must keep showing
 * its own message. Bouncing those to the login screen would be the same
 * lie in the other direction: telling someone to sign in when their
 * session is perfectly fine and the server is what broke.
 *
 * ─── Why the `=== null` guard ──────────────────────────────────────
 *
 * `null` already means "no session" (a clean 401 from /api/auth/me on
 * the login page). Writing it again would notify every observer of the
 * auth query on every failed request while the user sits on `/login`,
 * where a stream of 401s is the NORMAL state, not an event.
 */
export function createAppQueryClient(): QueryClient {
  const signOutOn401 = (error: unknown) => {
    if (!(error instanceof UnauthorizedError)) return;
    // Read through the client we are about to build — see the closure note
    // below; the variable is assigned before any query can run.
    if (client.getQueryData(ME_KEY) === null) return;
    client.setQueryData(ME_KEY, null);
  };

  // `client` is referenced by the handlers above but only ever CALLED
  // after construction returns, so the temporal dead zone is not an
  // issue: caches fire on request failures, and no request can be in
  // flight before the client exists.
  const client: QueryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
    queryCache: new QueryCache({ onError: signOutOn401 }),
    mutationCache: new MutationCache({ onError: signOutOn401 }),
  });

  return client;
}
