/**
 * Loss of access in a live tab (sk-674.18 T053; spec US-19, SC-015, E-9,
 * E-23; screens 1.15).
 *
 * The tab learns of a lost space or project only through the personal
 * signal: the area `spaces` names the space and why
 * (`eventEnvelope.ts#PersonalSignalSpace`), the area `projects` says only
 * that the user's project set changed. The hub's own `access_changed`
 * event (skein-api `signals/contract.go`) is a control event of skein-web
 * and never reaches the browser. Hence two paths:
 *
 *  A. A space is lost — an entry `removed` (excluded, or left in another
 *     tab, E-23) or `deleted` (E-9). Everything that may still hold its
 *     data is purged on any route (`resetAfterAccessLoss`: queues and
 *     counters, every task list, the cards and the trees, the search, the
 *     people directory, HOT ZONE), and if the address is in that space — its place, its
 *     settings, one of its projects or an issue of one — the tab leaves
 *     for `/` with "You are no longer a member of {name}" / "Space {name}
 *     was removed".
 *  B. A single project is lost (visibility `space → members`, removal
 *     from the project, a lost admin role) — the frame has no project
 *     data, so the answer decides: on a signal `projects` or an
 *     `owner_changed` entry (E-29) the same data is re-read, and an open
 *     project or issue is read again;
 *     "not found" for it leaves for `/` with "The project is no longer available".
 *     A space place is never left this way: losing one project of a space
 *     does not take the person out of the space (US-19) — an issue of the
 *     lost project open ON the space place closes back to the place.
 *
 * `owner_assigned` shows "You are the owner of the new space {name}" when the
 * space was not among «my spaces» before the signal (created for the
 * person by an admin), else "You are the owner of space {name}" (an owner
 * change). Every other reason (`invited`, `accepted`, `declined`,
 * `expired`, `added`, `owner_assigned`, `renamed`) only re-reads its own
 * keys — «my spaces», invitations, counters (`livePersonalSignal.ts`) —
 * and neither purges nor re-checks the open card.
 *
 * The decision is pure (`spaceSignalDecision`, `addressPlace`); the effect
 * runs in `LiveAccessLoss`, rendered by `LiveEventsProvider` inside the
 * router and fed every signal the connection receives.
 */

import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Query, QueryCache } from '@tanstack/react-query';
import { ApiError, BusinessError } from '../api/client';
import { getIssueByID, type IssueDetail } from '../api/issues';
import {
  getProject,
  resolveProject,
  type ProjectListItem,
  type ResolveResult,
} from '../api/projects';
import type { MySpace, MySpacesResponse } from '../api/spaces';
import { toaster } from '../components/Toaster';
import {
  SpaceSignalReason,
  type PersonalSignal,
  type PersonalSignalSpace,
} from './eventEnvelope';
import { publishDashboardPurge } from './dashboardEventBus';
import { releaseAcceptedWhere } from './inboxAcceptedRetention';
import type { LiveInvalidationTarget } from './liveInvalidationBatcher';
import { projectResolveQueryKey, projectsListQueryKey } from './projectHandleCache';
import { parseSpaceHandle } from './shellUrlState';
import { mySpacesQueryKey } from './useMySpaces';

// ───────────────────────── The decision ─────────────────────────

/** Why the tab leaves a lost place, for the toast. */
export type AccessLossLeave =
  | { kind: 'space-removed'; spaceName: string }
  | { kind: 'space-deleted'; spaceName: string };

/** What one signal frame asks of the tab under path A and the toasts. */
export interface SpaceSignalDecision {
  /** Spaces lost by this frame (`removed` / `deleted`), by id. */
  lostSpaceIds: ReadonlySet<string>;
  /** Leave the current address for `/`, and why; null — stay. */
  leave: AccessLossLeave | null;
  /** `owner_assigned` toasts, in frame order. */
  ownerToasts: Array<{ spaceName: string; isNew: boolean }>;
  /**
   * The frame may have taken access away: a space lost (`removed`,
   * `deleted`), an owner change (`owner_changed` — the previous owner loses
   * the projects shared with members only, E-29) or the area `projects`
   * (the project set changed; a loss and a gain look the same). Only then
   * is the data of lost spaces and projects purged — every other reason
   * re-reads its own keys (`livePersonalSignal.ts`).
   */
  possibleLoss: boolean;
  /**
   * The lost project set is unknown (the area `projects`, an
   * `owner_changed` entry): data that cannot be told apart by space is
   * dropped whole.
   */
  unknownLoss: boolean;
  /** Path B: a possible loss and the tab stays — re-check the open project or issue. */
  recheckOpen: boolean;
}

/**
 * Decide what a frame means for this tab.
 *
 * `placeSpaceId` — the space the address is in (`addressPlace`), or null.
 * `knownSpaces` — «my spaces» as cached BEFORE the frame (the re-read it
 * triggers lands later), for the names and for telling a new space from
 * an owner change.
 *
 * Entries are taken in order; for one space the last entry wins (the
 * coalescer orders by last occurrence, `eventEnvelope.ts#PersonalSignal`),
 * so «removed then added again» in one window does not leave the place.
 */
export function spaceSignalDecision(
  signal: PersonalSignal | null | undefined,
  placeSpaceId: string | null,
  knownSpaces: ReadonlyArray<Pick<MySpace, 'id' | 'name'>>,
): SpaceSignalDecision {
  const areas = new Set(Array.isArray(signal?.areas) ? signal.areas : []);
  const entries = readEntries(signal);
  const lastBySpace = new Map<string, PersonalSignalSpace>();
  for (const e of entries) lastBySpace.set(e.spaceId, e);

  const nameOf = (e: PersonalSignalSpace) =>
    e.spaceName ?? knownSpaces.find((s) => s.id === e.spaceId)?.name ?? e.spaceId;

  const lostSpaceIds = new Set<string>();
  for (const [id, e] of lastBySpace) {
    if (e.reason === SpaceSignalReason.Removed || e.reason === SpaceSignalReason.Deleted) {
      lostSpaceIds.add(id);
    }
  }

  let leave: AccessLossLeave | null = null;
  if (placeSpaceId !== null && lostSpaceIds.has(placeSpaceId)) {
    const e = lastBySpace.get(placeSpaceId)!;
    leave =
      e.reason === SpaceSignalReason.Deleted
        ? { kind: 'space-deleted', spaceName: nameOf(e) }
        : { kind: 'space-removed', spaceName: nameOf(e) };
  }

  const ownerToasts = entries
    .filter((e) => e.reason === SpaceSignalReason.OwnerAssigned)
    .map((e) => ({
      spaceName: nameOf(e),
      isNew: !knownSpaces.some((s) => s.id === e.spaceId),
    }));

  const unknownLoss =
    areas.has('projects')
    || [...lastBySpace.values()].some((e) => e.reason === SpaceSignalReason.OwnerChanged);
  const possibleLoss = lostSpaceIds.size > 0 || unknownLoss;

  return {
    lostSpaceIds,
    leave,
    ownerToasts,
    possibleLoss,
    unknownLoss,
    recheckOpen: leave === null && possibleLoss,
  };
}

/** The well-formed `spaces` entries of a frame, in order. */
function readEntries(signal: PersonalSignal | null | undefined): PersonalSignalSpace[] {
  const raw: unknown = signal?.spaces;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (e): e is PersonalSignalSpace =>
      typeof e === 'object'
      && e !== null
      && typeof (e as PersonalSignalSpace).reason === 'string'
      && typeof (e as PersonalSignalSpace).spaceId === 'string'
      && (e as PersonalSignalSpace).spaceId !== '',
  );
}

/** What the address shows, as far as access is concerned. */
export interface AddressPlace {
  /** The space the address is in, when known. */
  spaceId: string | null;
  /** The project handle of `/projects/:alias…`, or null. */
  projectHandle: string | null;
  /** The open issue id (`…/issues/:id`), or null. */
  issueId: string | null;
}

/**
 * Read the place off a pathname, completing the space of a project or an
 * issue from the cache (`ProjectListItem.spaceId`, `IssueDetail.spaceId`
 * — additive fields; absent, the space stays unknown and only path B can
 * take the tab off the page).
 */
export function addressPlace(pathname: string, cache: QueryCache): AddressPlace {
  const seg = pathname.split('/').filter(Boolean).map(safeDecode);
  let spaceId: string | null = null;
  let projectHandle: string | null = null;
  let issueId: string | null = null;
  if (seg[0] === 'spaces') {
    spaceId = parseSpaceHandle(seg[1]);
    if (seg[2] === 'issues') issueId = seg[3] ?? null;
  } else if (seg[0] === 'settings' && seg[1] === 'spaces' && seg[2]) {
    spaceId = parseSpaceHandle(seg[2]);
  } else if (seg[0] === 'projects' && seg[1]) {
    projectHandle = seg[1];
    const at = seg.indexOf('issues', 2);
    if (at !== -1) issueId = seg[at + 1] ?? null;
  } else if (seg[0] === 'issues' && seg[1]) {
    issueId = seg[1];
  }
  if (spaceId === null && issueId !== null) {
    spaceId = cachedIssue(cache, issueId)?.spaceId ?? null;
  }
  if (spaceId === null && projectHandle !== null) {
    spaceId = cachedProject(cache, projectHandle)?.spaceId ?? null;
  }
  return { spaceId, projectHandle, issueId };
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function cachedIssue(cache: QueryCache, id: string): IssueDetail | undefined {
  return cache.find<IssueDetail>({ queryKey: ['issues', 'detail', id], exact: true })?.state.data;
}

/**
 * The project a handle names, from the cache: a row of the cached project
 * lists by id or idPrefix, else this handle's own resolve answer — its key
 * is the handle itself, so its match IS the project, whatever the handle
 * (an alias too; `projectHandleCache.ts#cachedProjectIdOf`). The space of a
 * resolved project comes from its list row when one is cached.
 */
function cachedProject(
  cache: QueryCache,
  handle: string,
): Pick<ProjectListItem, 'id' | 'spaceId'> | undefined {
  const lower = handle.toLowerCase();
  const rows = cache.findAll({ queryKey: projectsListQueryKey }).flatMap(listItems);
  const row = rows.find((p) => p.id === handle || p.idPrefix.toLowerCase() === lower);
  if (row) return row;
  const resolved = cache.find<ResolveResult>({
    queryKey: projectResolveQueryKey(handle),
    exact: true,
  })?.state.data;
  const m = resolved?.match;
  if (!m) return undefined;
  return rows.find((p) => p.id === m.id) ?? { id: m.id };
}

/** The project rows of a cached list — single page `{items}` or infinite `{pages}`. */
function listItems(q: Query): ProjectListItem[] {
  const d = q.state.data as
    | { items?: ProjectListItem[]; pages?: Array<{ items?: ProjectListItem[] }> }
    | undefined;
  if (!d) return [];
  if (Array.isArray(d.items)) return d.items;
  if (Array.isArray(d.pages)) return d.pages.flatMap((p) => p.items ?? []);
  return [];
}

/**
 * «My spaces» of the signed-in person as cached now — that person's entry
 * only. A logout keeps the previous person's entry in the cache
 * (`useMySpaces.ts` keys by user for that reason); reading it would name
 * spaces and tell «new» from «known» by someone else's list.
 */
function cachedMySpaces(cache: QueryCache, userId: string | null): MySpace[] {
  if (userId === null) return [];
  return (
    cache.find<MySpacesResponse>({ queryKey: mySpacesQueryKey(userId), exact: true })?.state.data
      ?.items ?? []
  );
}

/** An answer that says the thing is not there for this reader. */
export function isNotFound(err: unknown): boolean {
  if (err instanceof ApiError || err instanceof BusinessError) {
    return err.statusCode === 404 || err.code.endsWith('not_found');
  }
  return false;
}

// ───────────────────────── The effect ─────────────────────────

/**
 * Families whose data may belong to a lost space or project and is shown
 * as content: the open card, the trees, the search, HOT ZONE. A mounted
 * query of these is RESET — its data is gone at once, the screen shows
 * loading until the re-read answers — so a failed re-read (TanStack keeps
 * the previous `data` next to an error) cannot leave a lost card on screen.
 */
const RESET_FAMILIES: ReadonlyArray<readonly string[]> = [
  ['issues', 'detail'],
  ['issues', 'tree'],
  ['search'],
  ['dashboard'],
];

/**
 * Families re-read in place when mounted: queues, counters, task lists and
 * the people directory. Their re-read answers with the reader's current
 * rows (a list never answers «not found»), so they keep showing the old
 * page until it lands instead of blinking on every `projects` signal (an
 * agent creating a project sends one).
 */
const REREAD_FAMILIES: ReadonlyArray<readonly string[]> = [
  ['notification-counts'],
  ['inbox'],
  ['mentions'],
  ['watching'],
  ['tasks'],
  ['users', 'directory'],
  // Which project a handle names: an alias of a lost project resolves to
  // nothing now.
  ['project', 'resolve'],
];

/**
 * Purge everything that may still hold data of a lost space or project,
 * on any route (screens 1.15; lead decision on review C1, 2026-10-12):
 *
 *  1. a query nobody shows — removed from the cache: its next mount reads
 *     the server, never a lost space's answer;
 *  2. a shown query of {@link RESET_FAMILIES} — reset to empty;
 *  3. a shown query of {@link REREAD_FAMILIES} that is reading now — its
 *     read is cancelled back to the answer it had, so a response begun
 *     before the loss cannot land after it;
 *  4. every family is then re-read through the live batcher, so a hidden
 *     tab only takes obligations and sends nothing.
 *
 * Removing and resetting cancel a read in flight silently (`Query#destroy`):
 * its late answer is dropped by the cancelled retryer, not written.
 */
export function resetAfterAccessLoss(target: LiveInvalidationTarget): void {
  const cache = target.getQueryCache();
  for (const family of [...RESET_FAMILIES, ...REREAD_FAMILIES]) {
    const resetShown = RESET_FAMILIES.includes(family);
    for (const q of cache.findAll({ queryKey: family })) {
      if (q.getObserversCount() === 0) cache.remove(q);
      else if (resetShown || !q.isActive()) q.reset();
      else if (q.state.fetchStatus === 'fetching') void q.cancel({ revert: true });
    }
    void target.invalidateQueries({ queryKey: family });
  }
}

/** The handler `LiveEventsProvider` calls with every personal signal. */
export type AccessLossHandler = (signal: PersonalSignal, target: LiveInvalidationTarget) => void;

/**
 * Rendered by `LiveEventsProvider` inside the router: installs the signal
 * handler into `handler` and keeps it on the current address.
 */
export function LiveAccessLoss({
  handler,
  userId,
}: {
  handler: { current: AccessLossHandler | null };
  /** The signed-in person (the provider's identity) — whose «my spaces» count. */
  userId: string | null;
}): null {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  // A re-check started for one address must not move a tab that has since
  // gone elsewhere.
  const recheckGen = useRef(0);

  useEffect(() => {
    const leaveTo = (path: string, message: string) => {
      navigate(path, { replace: true });
      toaster.info(message);
    };
    handler.current = (signal, target) => {
      const cache = target.getQueryCache();
      const place = addressPlace(pathRef.current, cache);
      // Read before the purge below empties the caches it comes from.
      const projectId =
        place.projectHandle === null ? null : cachedProject(cache, place.projectHandle)?.id ?? null;
      const decision = spaceSignalDecision(
        signal,
        place.spaceId,
        cachedMySpaces(cache, userIdRef.current),
      );

      for (const o of decision.ownerToasts) {
        toaster.info(
          t(o.isNew ? 'accessLoss.ownerAssignedNew' : 'accessLoss.ownerAssigned', {
            name: o.spaceName,
          }),
        );
      }

      if (decision.possibleLoss) {
        resetAfterAccessLoss(target);
        // Copies outside the cache (review C2): Inbox cards accepted in
        // this tab — those of a lost space, all of them when the lost set
        // is unknown (a card without a space is not known to be safe) —
        // and HOT ZONE's buffer.
        const lost = decision.lostSpaceIds;
        releaseAcceptedWhere(
          decision.unknownLoss
            ? () => true
            : (item) => item.spaceId === undefined || lost.has(item.spaceId),
        );
        publishDashboardPurge();
      }

      if (decision.leave !== null) {
        recheckGen.current += 1;
        leaveTo(
          '/',
          t(
            decision.leave.kind === 'space-deleted'
              ? 'accessLoss.spaceDeleted'
              : 'accessLoss.spaceRemoved',
            { name: decision.leave.spaceName },
          ),
        );
        return;
      }

      if (!decision.recheckOpen) return;
      if (place.issueId === null && place.projectHandle === null) return;
      const gen = ++recheckGen.current;
      const path = pathRef.current;
      // On the space place the card closes back to the place (path B never
      // takes the person out of a space they still have).
      const spaceSeg = path.startsWith('/spaces/') ? path.split('/')[2] : undefined;
      const closeTo = spaceSeg ? `/spaces/${spaceSeg}` : '/';
      // «Not found» means gone; any other failure decides nothing.
      const gone = (err: unknown) => {
        if (isNotFound(err)) return false;
        throw err;
      };
      const handle = place.projectHandle;
      const stillReadable: Promise<boolean> =
        place.issueId !== null
          ? getIssueByID(place.issueId).then(() => true, gone)
          : projectId !== null
            ? getProject(projectId).then(() => true, gone)
            : // The handle was never resolved here: ask the server what it
              // names now. Resolve is filtered by visibility and answers a
              // lost project with no match (skein-api `projects/resolve.go`).
              resolveProject(handle ?? '').then(
                (r) => (r.match === null ? false : getProject(r.match.id).then(() => true, gone)),
                gone,
              );
      stillReadable.then(
        (readable) => {
          if (readable || gen !== recheckGen.current || pathRef.current !== path) return;
          leaveTo(closeTo, t('accessLoss.projectLost'));
        },
        () => {},
      );
    };
    return () => {
      handler.current = null;
    };
  }, [handler, navigate, t]);

  return null;
}
