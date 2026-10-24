/**
 * sk-17 — Activity dashboard ("terminal war-room" aesthetic).
 *
 * Three zones (top → bottom):
 *   1. Top podium / leaderboards: top-3 by closed_with_commits with
 *      proportional bars, per-axis mini-bars, and a streak badge.
 *   2. Live ticker: rolling last-100 events from the dashboard feed,
 *      live-updated via SignalR's existing `event` channel. Three
 *      client-side filter chips (Humans / Directed / Autonomous) toggle
 *      visibility per intent axis.
 *   3. Metrics matrix: per-user rows × per-metric column groups with
 *      the 3-axis split as `h│d│a` triplets. Sortable by column header.
 *
 * Data sources
 * ────────────
 *   - useDashboardScoring() — TanStack Query, refetch every 30s + on
 *     window/scope change. Drives podium + leaderboards + matrix.
 *   - useDashboardFeed() — initial fetch + buffer the SignalR firehose
 *     onto the head of the local list (cap 100).
 *
 * Visual contract per intent axis (locked by sk-17 design comment):
 *   - human            → --primary (orange) — primary accent
 *   - agent_directed   → --info        (blue/cyan)
 *   - agent_autonomous → --ink-3    (low contrast — agent firehose)
 */

import { useTranslation } from 'react-i18next';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { IconFlame, IconTrophyOff } from '@tabler/icons-react';

import {
  getDashboardAgents,
  getDashboardFeed,
  getDashboardInProgress,
  getDashboardProjects,
  getDashboardScoring,
  type AgentsRow,
  type DashboardFeedEntry,
  type DashboardWindow,
  type InProgressRow,
  type LeaderboardEntry,
  type MetricRow,
  type MetricValue,
  type MatrixUserRow,
  type ProjectActivityRow,
  type ProjectsResult,
  type ProjectsWindow,
  type ScoringResult,
} from '../../api/dashboard';
import type { EventEnvelope } from '../../lib/eventEnvelope';
import { subscribeDashboardEnvelopes, subscribeDashboardPurge } from '../../lib/dashboardEventBus';
import { useLiveEventsState } from '../../hooks/useLiveEvents';
import { useTheme } from '../../lib/useTheme';
import { ChipRow, RaceChart } from './RaceChart';
import { SkeinTooltip } from '../../components/SkeinTooltip';
import { SpaceFilter, useSpaceFilter } from '../../components/SpaceFilter';
import { useEnvelopeInSpace } from '../../hooks/useEnvelopeInSpace';
import { useDeclareAllVisible } from '../../lib/liveProjectDeclaration';

// ───────────────────────── Heroes-window (sk-30) ─────────────────────────
//
// `/activity` carries TWO independent window switchers:
//   - The global numeric `WindowTabs` (24h / 7d / 30d) drives throughput-
//     matrix / per-user matrix / feed-refresh. sk-66 relocated it from
//     the page header into the throughput-matrix zone header — the first
//     zone it actually controls — so it no longer reads as page-wide.
//   - A LOCAL `HeroesWindowTabs` (today / week / month / all-time, with
//     lexical labels — intentionally visually distinct from the numeric
//     global switcher) drives just the podium + the two leaderboards.
//
// Lexical labels exist so users don't conflate the two switchers — a
// numeric `24h` next to numeric `7d` reads as "two states of the same
// control", but `today` next to `7d` reads as "two different controls".
// The podium title (`today's heroes` / `this week's heroes` / …)
// reinforces which window the cards reflect.
type HeroesWindow = 'today' | 'week' | 'month' | 'all-time';

function heroesWindowToApi(h: HeroesWindow): DashboardWindow {
  switch (h) {
    case 'today':
      return '24h';
    case 'week':
      return '7d';
    case 'month':
      return '30d';
    case 'all-time':
      return 'all-time';
  }
}

function heroesWindowLabel(h: HeroesWindow): string {
  switch (h) {
    case 'today':
      return "Today's heroes";
    case 'week':
      return "This week's heroes";
    case 'month':
      return "This month's heroes";
    case 'all-time':
      return 'All-time heroes';
  }
}

// ───────────────────────── Subscriptions glue ─────────────────────────
//
// The envelope bus itself lives in `lib/dashboardEventBus` (sk-17
// review fix C2 — broke the circular import between this file and
// `hooks/useLiveEvents`). This file only consumes it via the hook
// below, which stabilises the listener identity via useRef.

type Listener = (env: EventEnvelope) => void;

/**
 * Register a listener for incoming SignalR EventEnvelope frames.
 *
 * sk-17 review fix C1 — the listener identity MUST be stable across
 * re-renders. Earlier shape passed the caller's inline arrow as the
 * effect dep, which meant every parent re-render (every scoring
 * refetch, every chip toggle, every 250 ms ticker batch flush) ran
 * the effect cleanup → re-add cycle. SignalR envelopes arriving
 * between cleanup and re-add would land on an empty Set and be lost
 * silently. The useRef pattern subscribes exactly once on mount,
 * un-subscribes on unmount, and always invokes the *latest* captured
 * closure via the ref hop.
 */
function useEnvelopeListener(listener: Listener) {
  const ref = useRef(listener);
  useEffect(() => {
    ref.current = listener;
  });
  useEffect(() => {
    const stable: Listener = (env) => ref.current(env);
    return subscribeDashboardEnvelopes(stable);
  }, []);
}

// ───────────────────────── Hooks ─────────────────────────

/**
 * useDashboardScoring — TanStack Query wrapper around GET /dashboard/scoring.
 * Refetches every 30s by default to keep the matrix and podium roughly
 * live without piggy-backing on every event.
 *
 * sk-68 — `placeholderData: keepPreviousData` keeps the OLD scoring data
 * rendered while a window switch refetches. Without it the query key
 * change (window is part of the key) drops `data` to `undefined`, every
 * consumer (ThroughputMatrix / PerUserMatrix / Podium / both
 * LeaderboardLists) falls back to its small empty-state `<p>`, the zones
 * collapse to a single line, and everything below jumps up — then jumps
 * back down when the new data lands. Holding the previous data preserves
 * each zone's rendered height across the transition; callers dim the
 * stale view via `isFetching` for honest "refreshing" feedback. This one
 * option fixes every consumer of the hook at once (it's called twice —
 * the global window for the matrices and the heroes window for the podium
 * + leaderboards — so both call-sites inherit the behaviour).
 */
function useDashboardScoring(
  window: DashboardWindow,
  projectId: string | null,
  username: string | null,
  space: string | null,
  enabled: boolean,
) {
  return useQuery({
    enabled,
    queryKey: ['dashboard', 'scoring', window, projectId, username, space],
    queryFn: () => getDashboardScoring({ window, projectId, username, space }),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
    placeholderData: keepPreviousData,
  });
}

/**
 * useDashboardInProgress — "now working" snapshot. Dual refresh:
 *   1. Polling fallback every 30s (in case SignalR is down).
 *   2. Live re-read on the envelopes that change the in-progress set
 *      (claim / unclaim / status / accept / close) — sk-622.21 T042 moved
 *      it into the live reaction (`liveEventInvalidation.ts#
 *      DASHBOARD_IN_PROGRESS_EVENT_TYPES`, K18 row "Dashboard `/activity`"),
 *      so it is coalesced with every other reset of the tab instead of
 *      refetching on each envelope.
 */
/**
 * useDashboardAgents — per-user MCP-session counts (sk-22). 30s
 * poll, no SignalR push integration (agents.Upsert is silent at
 * the backend, so there's nothing to subscribe to). The underlying
 * Upsert is throttled at 60s, so effective freshness is ~60–90s.
 */
function useDashboardAgents(space: string | null, enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: ['dashboard', 'agents', space],
    queryFn: () => getDashboardAgents({ space }),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });
}

// ───────────────────────── Projects window (sk-183.2) ─────────────────────────
//
// The Projects zone carries its OWN window toggle ([24h][7d][30d][ALL]),
// independent of the global `WindowTabs` and the local `HeroesWindowTabs`.
// State round-trips via `useSearchParams` (mirrors RaceChart's chip-row
// pattern) under the `projectsWindow` key — a NAME DISTINCT from RaceChart's
// own `window` key so the two toggles (mounted on the same page) never
// clobber each other's query param.

const PROJECTS_WINDOW_OPTIONS: ProjectsWindow[] = ['24h', '7d', '30d', 'all'];
const DEFAULT_PROJECTS_WINDOW: ProjectsWindow = '24h';

function parseProjectsWindow(s: string | null): ProjectsWindow {
  return (PROJECTS_WINDOW_OPTIONS as readonly string[]).includes(s ?? '')
    ? (s as ProjectsWindow)
    : DEFAULT_PROJECTS_WINDOW;
}

/**
 * useDashboardProjects — per-project HOT ZONE leaderboard (sk-183.1/.2).
 * Same polling cadence as `useDashboardAgents` (30s poll, no SignalR
 * push wiring) — this is a leaderboard-style zone that refreshes on an
 * interval, not a live ticker. `placeholderData: keepPreviousData` keeps
 * the previous window's rows on screen across a window-chip switch so
 * the table doesn't collapse to an empty state mid-refetch (same sk-68
 * idiom used by scoring/race).
 */
function useDashboardProjects(window: ProjectsWindow, space: string | null, enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: ['dashboard', 'projects', window, space],
    queryFn: () => getDashboardProjects(window, space),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
    placeholderData: keepPreviousData,
  });
}

function useDashboardInProgress(projectId: string | null, space: string | null, enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: ['dashboard', 'in-progress', projectId, space],
    queryFn: () => getDashboardInProgress({ projectId, space }),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });
}

/**
 * useDashboardFeed — initial fetch + the live ticker buffer. Returns the
 * ROLLING merged list (initial + live-pushed events), capped to maxLen.
 *
 * sk-674.18 T056 — `space` is the page's space choice: the initial read
 * carries it, and a live envelope joins the buffer only if it belongs to
 * that space (`useEnvelopeInSpace.ts`).
 */
function useDashboardFeed(maxLen: number, space: string | null, enabled: boolean) {
  const initial = useQuery({
    enabled,
    queryKey: ['dashboard', 'feed', 'initial', space],
    queryFn: () => getDashboardFeed({ limit: maxLen, space }),
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
  // An event of a project outside the map: read the feed again with the
  // space; its answer is merged into the buffer below.
  const queryClient = useQueryClient();
  const inSpace = useEnvelopeInSpace(space, () => {
    void queryClient.invalidateQueries({ queryKey: ['dashboard', 'feed', 'initial', space] });
  });

  // Local rolling buffer — seeded from the initial query and mutated by
  // the SignalR pump. We deliberately keep this in component state so
  // every consumer re-renders together when a new event lands.
  const [buffer, setBuffer] = useState<DashboardFeedEntry[]>([]);

  // sk-674.18 T056 — another space chosen: the buffer holds the previous
  // choice's rows, and the merge below would keep them. Start empty; the
  // read of the new choice seeds it. Declared before the seeding effect,
  // so a choice answered from the cache is emptied first, then seeded.
  const shownSpaceRef = useRef(space);
  useEffect(() => {
    if (shownSpaceRef.current === space) return;
    shownSpaceRef.current = space;
    pendingRef.current = [];
    setBuffer([]);
  }, [space]);

  // Seed from the initial query.
  useEffect(() => {
    if (!initial.data) return;
    // sk-17 review fix W1 — merge incoming server snapshot into the
    // current buffer instead of replacing. The window-tab switch
    // invalidates the feed query (line ~698) which triggers a
    // refetch; the previous replace-on-data effect would drop every
    // live-pushed envelope that arrived in the gap. Merge keeps the
    // contract "live takes priority, server fills gaps". Deduplicate
    // by id, sort descending so newest stays on top, cap at maxLen.
    setBuffer((prev) => {
      const seen = new Set(prev.map((r) => r.id));
      const fresh = initial.data.items.filter((r) => !seen.has(r.id));
      const merged = [...prev, ...fresh];
      merged.sort((a, b) => b.id - a.id);
      return merged.slice(0, maxLen);
    });
  }, [initial.data, maxLen]);

  // Batched live ticker pump. Events that arrive within 250ms of each
  // other are collapsed into one setState — protects against bursts
  // that would otherwise re-render the ticker 50x in a frame.
  const pendingRef = useRef<DashboardFeedEntry[]>([]);
  const flushTimerRef = useRef<number | null>(null);
  useEnvelopeListener((env) => {
    // Convert the envelope into an ActivityEntry-shaped row. The wire
    // contract is intentionally narrow here — we don't have the issue
    // title cache to JOIN on, so we fall back to the entityId for the
    // entity ref and leave the title blank. The next 60s feed refetch
    // will fill in titles on rows that survive the cap.
    if (!inSpace(env)) return;
    const row = envelopeToTickerRow(env);
    if (!row) return;

    pendingRef.current.push(row);
    if (flushTimerRef.current !== null) return;
    flushTimerRef.current = window.setTimeout(() => {
      const batch = pendingRef.current;
      pendingRef.current = [];
      flushTimerRef.current = null;
      if (batch.length === 0) return;
      setBuffer((prev) => {
        // Prepend newest-first (highest id at index 0). Dedup by id —
        // SignalR may re-deliver and the dashboard feed already
        // returned the same row in the initial fetch.
        const seen = new Set(prev.map((r) => r.id));
        const next: DashboardFeedEntry[] = [];
        for (const r of batch) {
          if (!seen.has(r.id)) {
            next.push(r);
            seen.add(r.id);
          }
        }
        // Newest items at top — sort batch by id DESC before
        // concatenation so a burst-batch ends up in canonical order.
        next.sort((a, b) => b.id - a.id);
        return [...next, ...prev].slice(0, maxLen);
      });
    }, 250);
  });

  // sk-674.18 (US-19, review C2) — access lost: the buffer may hold rows
  // of a lost space that the next answer omits, and the merge above would
  // keep them. Drop the buffer and the pending batch; the purge reset the
  // initial query too, so its next answer seeds the buffer afresh.
  useEffect(
    () =>
      subscribeDashboardPurge(() => {
        pendingRef.current = [];
        if (flushTimerRef.current !== null) {
          clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }
        setBuffer([]);
      }),
    [],
  );

  // Cleanup the pending timer if the component unmounts mid-batch.
  useEffect(() => {
    return () => {
      if (flushTimerRef.current !== null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };
  }, []);

  return {
    items: buffer,
    isLoading: initial.isLoading,
    isError: initial.isError,
  };
}

/**
 * envelopeToTickerRow — bridge from the compact SignalR EventEnvelope
 * (spec sk-622.21 US-12) to an ActivityEntry-shaped row the ticker UI
 * already knows how to render, with no network request (matrix row
 * "Dashboard `/activity`": the feed comes from the envelope without a request).
 *
 * Reads only fields the compact envelope keeps for this consumer
 * ("Envelope consumers" — the feed): id, type, actor, actor type, actor
 * id, time, entity, entity title, project, project prefix. Nullable ones
 * arrive as null when unknown; the ticker renderer handles a missing
 * title / prefix gracefully (falls back to entityId).
 */
function envelopeToTickerRow(env: EventEnvelope): DashboardFeedEntry | null {
  if (!env.id || !env.eventType) return null;
  // Filter out high-noise non-lifecycle events so the ticker stays
  // signal. Matches the backend DefaultActivityEventTypes set.
  if (!TICKER_INCLUDE_TYPES.has(env.eventType)) return null;

  // sk-21 — actor + title + project prefix arrive directly on the
  // envelope (dispatcher JOINs at publish time). Previous shape fell
  // back to the literal string 'system' when the payload didn't carry
  // actorUsername — every single SignalR-pushed row therefore
  // displayed "system" in the ticker. Now: read the resolved fields;
  // if (older skein-api < 0.7.0) they're absent, render the actor as
  // a question mark so we don't lie about who did it.
  const actorUsername = env.actor ?? '?';
  const actorType: DashboardFeedEntry['actor']['type'] =
    env.actorType === 'agent' || env.actorType === 'system' ? env.actorType : 'human';

  return {
    id: env.id,
    occurredAt: env.occurredAt,
    type: env.eventType,
    actor: {
      userId: env.actorUserId ?? null,
      username: actorUsername,
      type: actorType,
    },
    entity: {
      type: (env.entityType as DashboardFeedEntry['entity']['type']) ?? 'issue',
      id: env.entityId,
      title: env.entityTitle ?? '',
      projectId: env.projectId ?? '',
      projectIdPrefix: env.projectIdPrefix ?? '',
    },
    field: undefined,
    summary: `${actorUsername} · ${env.eventType} ${env.entityId}`,
    projectId: env.projectId ?? '',
  };
}

/**
 * Set of event types the ticker surfaces. Mirrors the backend
 * DefaultActivityEventTypes set so live-pushed rows and refetched feed
 * rows show the same content.
 */
const TICKER_INCLUDE_TYPES = new Set<string>([
  'issue.created',
  'issue.accepted',
  'issue.updated',
  'issue.status_changed',
  'issue.archived',
  'issue.closed',
  'issue.claimed',
  'issue.unclaimed',
  'comment.created',
  'dependency.created',
  'dependency.deleted',
]);

// ───────────────────────── Helpers ─────────────────────────

/** Map a metric row to {h, d, a, total}. */
function rowTotals(m: MetricRow) {
  return {
    h: m.human ?? 0,
    d: m.agent_directed ?? 0,
    a: m.agent_autonomous ?? 0,
    total: (m.human ?? 0) + (m.agent_directed ?? 0) + (m.agent_autonomous ?? 0),
  };
}

/**
 * The proportional bar of the podium rows and the Top-5 boards: a hatched
 * track the full width of its cell and a fill over it, `value / max` of
 * that same track (`.activity-meter`).
 *
 * sk-551.1 — it replaces `asciiBar`, a fixed string of `█`/`░` glyphs.
 * A fixed string only states the ratio while its cell is exactly as wide
 * as the string: in a narrower cell `overflow: hidden` cut the `░` tail
 * and a half bar looked full; in a wider one (the podium at full width
 * on a tablet) a full bar covered ~40% of the cell. The
 * stylesheet keeps the glyph look by segmenting both layers at `1ch`.
 */
function MeterBar({ value, max, className }: { value: number; max: number; className: string }) {
  const fill = max > 0 ? Math.max(0, Math.min(1, value / max)) * 100 : 0;
  return (
    <span
      className={`activity-meter ${className}`}
      aria-hidden="true"
      style={{ '--meter-fill': `${fill}%` } as CSSProperties}
    >
      <span className="activity-meter-fill" />
    </span>
  );
}

/** Every close the user made in the window, whatever the task's origin. */
function totalClosedOf(m: MatrixUserRow | undefined): number {
  if (!m) return 0;
  return m.issuesClosedHuman + m.issuesClosedDirected + m.issuesClosedAutonomous;
}

/** Closes that shipped at least one linked commit, whatever the origin. */
function closedWithCommitsOf(m: MatrixUserRow): number {
  return m.closedWithCommitsHuman + m.closedWithCommitsDir + m.closedWithCommitsAuto;
}

/**
 * sk-551.2 — the closed-with-commits ranking over EVERY closer of the
 * window, not only those the backend's board lists.
 *
 * The backend's `closed_with_commits` board only lists people with at
 * least one commit-backed close, so a window with three such people drew
 * a «Top 5» of three while the human + directed board beside it had
 * five. The maintainers want five rows (2026-10-03): whoever closed in the
 * window WITHOUT a commit joins with a count of 0.
 *
 * The population is `matrixUsers` of the same response — the matrix is
 * not capped and carries every closer with their commit-backed closes —
 * so the backend is untouched. The board itself is capped
 * (`store.go#scoringLeaderboardLimit`, ten rows ordered by name on a
 * tie): ranking only what it returned would drop a person past the cap
 * who wins on the tie-break below (sk-551.2). A person
 * the board does list keeps the board's count; everyone else is counted
 * from the matrix.
 *
 * Order: commit-backed closes ↓, then all closes in the window ↓, then
 * the name in code-point order (the backend's own `e.actor ASC`).
 */
function rankClosedWithCommits(scoring: ScoringResult | undefined): LeaderboardEntry[] {
  if (!scoring) return [];
  const matrix = new Map((scoring.matrixUsers ?? []).map((m) => [m.username, m]));
  const counts = new Map<string, number>();
  for (const m of scoring.matrixUsers ?? []) {
    if (totalClosedOf(m) > 0) counts.set(m.username, closedWithCommitsOf(m));
  }
  for (const e of scoring.leaderboards?.closed_with_commits ?? []) counts.set(e.username, e.count);
  return [...counts]
    .map(([username, count]) => ({ username, count }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        totalClosedOf(matrix.get(b.username)) - totalClosedOf(matrix.get(a.username)) ||
        (a.username < b.username ? -1 : a.username > b.username ? 1 : 0),
    );
}

/**
 * Derive top-3 for the podium from the leaderboard. Ranking metric is
 * `closed_with_commits` (a close that shipped at least one git commit):
 * raw closed-count is gameable by decomposition + self-created issues,
 * so only commit-backed closes score. Read from the same ranking the
 * Top-5 board draws (`rankClosedWithCommits`), so a tie resolves the
 * same way on both; the zero-count top-up rows never reach the podium.
 */
function podiumTop3(scoring: ScoringResult | undefined): LeaderboardEntry[] {
  return rankClosedWithCommits(scoring)
    .filter((e) => e.count > 0)
    .slice(0, 3);
}

/** Resolve a username to its per-axis closed counts via the matrix. */
function matrixFor(scoring: ScoringResult | undefined, username: string): MatrixUserRow | undefined {
  if (!scoring) return undefined;
  return scoring.matrixUsers?.find((r) => r.username === username);
}

// ───────────────────────── Components ─────────────────────────

/**
 * The windows the global switcher offers.
 *
 * Deliberately excludes 'all-time': this switcher scopes the
 * throughput / matrix / feed surfaces, where an all-time window makes
 * no sense; the lexical today/week/month/all-time dimension belongs to
 * `HeroesWindowTabs` and stays decoupled from this one.
 *
 * sk-285.7.2.62 — audit 2B, HZ2B-6. There used to be a `WindowTabs`
 * component here, and it was the page's SECOND way of drawing one
 * role. Above the fold four window switchers were segments
 * (`.segment-track` / `.segment-cell`, §4/§6); below it this one was a
 * row of loose filter chips — 24px tall against §6's 36, its current
 * member a solid `--primary` plate instead of a raised `--surface`
 * one, and no track at all. Both measured live.
 *
 * The component is gone rather than restyled: `ChipRow` (RaceChart) is
 * already the one control for "pick one window", and the Projects zone
 * header renders exactly this shape. Restyling would have left two
 * implementations of one role that merely happened to agree today.
 *
 * The ticker's Humans / Directed / Autonomous chips stay filter chips
 * and that is NOT an exception to this: all three can be on at once
 * (measured — they were), so they are three independent toggles, and a
 * segment would claim "one of three" about a control where you can
 * have all of them. Since sk-414.7 they wear the product's
 * `.filter-chip` — one outlined recipe for every filter chip, the
 * solid plate gone — but the pairing §6 draws is unchanged: a segment is RAISED, a toggle is
 * OUTLINED, and neither vocabulary borrows the other's mark.
 */
const DASHBOARD_WINDOW_OPTIONS: ReadonlyArray<Exclude<DashboardWindow, 'all-time'>> = [
  '24h',
  '7d',
  '30d',
];

interface HeroesWindowTabsProps {
  active: HeroesWindow;
  onChange: (w: HeroesWindow) => void;
}

/**
 * sk-30 — LOCAL window switcher for the heroes podium + leaderboards.
 *
 * Visually distinct from the global numeric `WindowTabs` (24h/7d/30d)
 * by using lexical labels (today · this week · this month · all-time).
 * The four values map 1:1 onto API windows via `heroesWindowToApi`;
 * the label shown to the user is the lexical form (NOT "today's heroes"
 * — that lives on the podium title).
 *
 * `aria-label="Heroes window"` on the container scopes the radio-group
 * for testing-library queries (the global switcher uses
 * `aria-label="Time window"` so the two never collide).
 */
function HeroesWindowTabs({ active, onChange }: HeroesWindowTabsProps) {
  const items: HeroesWindow[] = ['today', 'week', 'month', 'all-time'];
  const labelFor: Record<HeroesWindow, string> = {
    today: 'today',
    week: 'this week',
    month: 'this month',
    'all-time': 'all-time',
  };
  return (
    // sk-285.7.11 (HZ4/HZ5) — a SEGMENT, not four loose pills: these
    // four are one control with four positions, and the artboard draws
    // them as a track with the current member raised onto `--surface`.
    // `.segment-cell` carries that shape; a filter chip is gone from
    // here because a chip is how the app marks one of several
    // INDEPENDENT toggles, which these are not.
    <div
      className="activity-heroes-window-tabs segment-track"
      role="group"
      aria-label="Heroes window"
    >
      {items.map((w) => (
        <button
          key={w}
          type="button"
          aria-pressed={active === w}
          className={`segment-cell${active === w ? ' active' : ''}`}
          onClick={() => onChange(w)}
        >
          {labelFor[w]}
        </button>
      ))}
    </div>
  );
}

interface ChipFiltersProps {
  showHuman: boolean;
  showDirected: boolean;
  showAutonomous: boolean;
  onToggle: (axis: 'human' | 'directed' | 'autonomous') => void;
}

function ChipFilters({ showHuman, showDirected, showAutonomous, onToggle }: ChipFiltersProps) {
  return (
    <div className="activity-chips" role="group" aria-label="Intent filters">
      <button
        type="button"
        className="filter-chip"
        aria-pressed={showHuman}
        onClick={() => onToggle('human')}
      >
        Humans
      </button>
      <button
        type="button"
        className="filter-chip"
        aria-pressed={showDirected}
        onClick={() => onToggle('directed')}
      >
        Directed
      </button>
      <button
        type="button"
        className="filter-chip"
        aria-pressed={showAutonomous}
        onClick={() => onToggle('autonomous')}
      >
        Autonomous
      </button>
    </div>
  );
}

/**
 * ProfileName — plain-text username rendering for the scoring / race /
 * agents zones (podium, leaderboards, per-user matrix).
 *
 * sk-303.15 removed the /legacy/* route tree, including the user-profile
 * page (`/legacy/users/:username`) this used to link to — there's no
 * new-shell profile page to link to instead, so every caller gets plain
 * text now. Previously (pre sk-303.15) only external callers got plain
 * text here (sk-163.18 §7, because profiles were co-set scoped
 * server-side and a non-co-member click would 404/oracle); the
 * `isExternal` split that used to gate `<Link>` vs plain text is gone
 * along with the last `<Link>` branch — git history has it if a scoped
 * profile surface returns and this needs to become conditional again.
 */
function ProfileName({
  username,
  className,
}: {
  username: string;
  className?: string;
}) {
  return <span className={className}>{username}</span>;
}

/**
 * A username in a cell that can cut it with an ellipsis — a Top-5 row
 * on a narrow board, a hero card's header on a phone (sk-551.1 and its follow-up). Only while the name IS cut does it become a
 * keyboard-reachable trigger of a tooltip with the full name; an uncut
 * name stays plain text. Measured on the cell (`className` carries the
 * overflow rules), re-measured when it resizes; the inner span carries
 * the ref because `SkeinTooltip` takes the outer one.
 */
function CutName({ username, className }: { username: string; className: string }) {
  const inner = useRef<HTMLSpanElement>(null);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const cell = inner.current?.parentElement;
    if (!cell) return;
    const measure = () => setCut(cell.scrollWidth > cell.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(cell);
    return () => observer.disconnect();
  }, [username]);
  return (
    <SkeinTooltip content={username} disabled={!cut} position="top">
      <span className={className} tabIndex={cut ? 0 : undefined}>
        <span ref={inner}>
          <ProfileName username={username} />
        </span>
      </span>
    </SkeinTooltip>
  );
}

interface PodiumProps {
  scoring?: ScoringResult;
  heroesWindow: HeroesWindow;
  /**
   * sk-68 — true while the heroes-window scoring refetches. The podium
   * keeps its previous cards rendered (keepPreviousData) and we dim them
   * via `data-fetching` so the user sees "refreshing" instead of the
   * block collapsing to the empty-state line and the page jumping.
   */
  isFetching?: boolean;
}

function Podium({ scoring, heroesWindow, isFetching = false }: PodiumProps) {
  const top3 = podiumTop3(scoring);
  const trophies = ['🥇', '🥈', '🥉'];

  // Per-metric max across the visible top-3 — each mini-bar fills
  // relative to the leader on that axis, NOT a global single max.
  // Without per-metric scaling, comments (often 10× closes) would
  // dwarf everything and the closes bar would always look empty.
  const maxes = top3.reduce(
    (acc, e) => {
      const m = matrixFor(scoring, e.username);
      if (!m) return acc;
      const created = m.issuesCreatedHuman + m.issuesCreatedDirected + m.issuesCreatedAutonomous;
      const closed = m.issuesClosedHuman + m.issuesClosedDirected + m.issuesClosedAutonomous;
      const commits = m.closedWithCommitsHuman + m.closedWithCommitsDir + m.closedWithCommitsAuto;
      const comments = m.commentsHuman + m.commentsDirected + m.commentsAutonomous;
      const autonomous = m.issuesClosedAutonomous;
      return {
        created: Math.max(acc.created, created),
        closed: Math.max(acc.closed, closed),
        commits: Math.max(acc.commits, commits),
        comments: Math.max(acc.comments, comments),
        autonomous: Math.max(acc.autonomous, autonomous),
      };
    },
    { created: 0, closed: 0, commits: 0, comments: 0, autonomous: 0 },
  );

  return (
    <section
      className="activity-podium"
      aria-labelledby="activity-podium-title"
      data-fetching={isFetching ? 'true' : undefined}
      aria-busy={isFetching}
    >
      <header className="activity-zone-header">
        <h2 id="activity-podium-title" className="activity-zone-title">
          {heroesWindowLabel(heroesWindow)}
        </h2>
        <span className="activity-zone-hint">ranked by closed-with-commits</span>
      </header>
      {top3.length === 0 ? (
        // sk-370 — the ONE empty state the design draws a glyph in
        // (`Skein Redesign.dc.html`: a dashed plate holding
        // `ti-trophy-off` beside this very sentence). `trophy-off` is
        // also the name §8 lists and the app had nowhere to spend. It is
        // decorative: the sentence beside it says the same thing, and a
        // second accessible name would have a screen reader announce the
        // emptiness twice.
        <p className="activity-empty">
          <IconTrophyOff className="activity-empty-icon" size={20} aria-hidden="true" />
          no closes with commits in this window
        </p>
      ) : (
        <ol className="activity-podium-list">
          {top3.map((entry, idx) => {
            const m = matrixFor(scoring, entry.username);
            const created = (m?.issuesCreatedHuman ?? 0) + (m?.issuesCreatedDirected ?? 0) + (m?.issuesCreatedAutonomous ?? 0);
            const closed = (m?.issuesClosedHuman ?? 0) + (m?.issuesClosedDirected ?? 0) + (m?.issuesClosedAutonomous ?? 0);
            const commits = (m?.closedWithCommitsHuman ?? 0) + (m?.closedWithCommitsDir ?? 0) + (m?.closedWithCommitsAuto ?? 0);
            const comments = (m?.commentsHuman ?? 0) + (m?.commentsDirected ?? 0) + (m?.commentsAutonomous ?? 0);
            const autonomousClosed = m?.issuesClosedAutonomous ?? 0;
            return (
              <li key={entry.username} className={`activity-podium-card place-${idx + 1}`}>
                <header className="activity-podium-card-header">
                  <span className="activity-podium-trophy" aria-hidden="true">
                    {trophies[idx] ?? `[${idx + 1}]`}
                  </span>
                  <CutName username={entry.username} className="activity-podium-name" />
                  <SkeinTooltip
                    content="Ranking metric: closed-with-commits (closes that shipped ≥1 linked git commit) in the selected heroes window. Windows are rolling from now — today = last 24h, this week = last 7 days, this month = last 30 days — not calendar periods."
                    width={280}
                    position="top"
                  >
                    <span className="activity-podium-rank-score" tabIndex={0}>
                      {entry.count} pts
                    </span>
                  </SkeinTooltip>
                </header>
                <div className="activity-podium-stats">
                  <PodiumStat
                    label="closed"
                    value={closed}
                    max={maxes.closed}
                    klass="stat-closed"
                    tip="Tasks this user closed (they are the actor of the issue.closed event). h/d/a splits by task origin: human · agent-directed · autonomous."
                    breakdown={{
                      h: m?.issuesClosedHuman ?? 0,
                      d: m?.issuesClosedDirected ?? 0,
                      a: m?.issuesClosedAutonomous ?? 0,
                    }}
                  />
                  <PodiumStat
                    label="+w/commits"
                    value={commits}
                    max={maxes.commits}
                    klass="stat-commits"
                    tip="Closed-WITH-commits: how many of this user's closes shipped ≥1 linked git commit. NOT a commit count — a close carrying 10 commits still counts as 1. For raw commit volume (one per SHA) see HOT ZONE → projects → commits."
                    breakdown={{
                      h: m?.closedWithCommitsHuman ?? 0,
                      d: m?.closedWithCommitsDir ?? 0,
                      a: m?.closedWithCommitsAuto ?? 0,
                    }}
                  />
                  <PodiumStat
                    label="created"
                    value={created}
                    max={maxes.created}
                    klass="stat-created"
                    tip="Tasks this user created. h/d/a splits by origin: human · agent-directed · autonomous."
                    breakdown={{
                      h: m?.issuesCreatedHuman ?? 0,
                      d: m?.issuesCreatedDirected ?? 0,
                      a: m?.issuesCreatedAutonomous ?? 0,
                    }}
                  />
                  <PodiumStat
                    label="comments"
                    value={comments}
                    max={maxes.comments}
                    klass="stat-comments"
                    tip="Comments this user authored. h/d/a splits by author kind: human · agent-directed · autonomous."
                    breakdown={{
                      h: m?.commentsHuman ?? 0,
                      d: m?.commentsDirected ?? 0,
                      a: m?.commentsAutonomous ?? 0,
                    }}
                  />
                  <PodiumStat
                    label="🤖 autonomous"
                    value={autonomousClosed}
                    max={maxes.autonomous}
                    klass="stat-autonomous"
                    tip="Closes made by this user's agents on their own initiative (task source = agent_autonomous). A subset of the closed count, surfaced separately to show agent-driven throughput."
                  />
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

interface PodiumStatProps {
  label: string;
  value: number;
  max: number;
  klass: string;
  breakdown?: { h: number; d: number; a: number };
  /** Plain-language explanation of what this number measures. Rendered
   *  as an instant Mantine tooltip (keyboard/touch reachable), replacing
   *  the old native `title` which had a browser delay and no focus. */
  tip?: string;
}

/**
 * PodiumStat — one metric ROW inside a hero card: label · number · bar ·
 * h│d│a breakdown, left to right. For the `autonomous` stat the
 * breakdown is omitted (the value IS the autonomous count — no further
 * axis to split).
 *
 * sk-551.1 — rows, not cells. The podium moved into the narrow heroes
 * rail (sk-285.7.11) and five side-by-side cells became ~55px each: the
 * labels collapsed to «c…» and the breakdown spilled into the next cell.
 * One row per metric gives the label its whole width back. The row's
 * four parts sit on the columns of `.activity-podium-list` through
 * subgrid, so the numbers of all three heroes line up in one column and
 * read top to bottom.
 *
 * The bar stretches with its column (`MeterBar`).
 *
 * When `tip` is set the whole row becomes a focusable trigger for an
 * instant tooltip (openDelay/closeDelay 0 per the project guidelines) so
 * the metric's meaning is legible without decoding the terse label.
 */
function PodiumStat({ label, value, max, klass, breakdown, tip }: PodiumStatProps) {
  const cell = (
    <div className={`activity-podium-stat ${klass}`} tabIndex={tip ? 0 : undefined}>
      <span className="activity-podium-stat-label">{label}</span>
      <span className="activity-podium-stat-value">{value}</span>
      <MeterBar value={value} max={max} className="activity-podium-stat-bar" />
      {breakdown ? (
        <span className="activity-podium-stat-breakdown" aria-hidden="true">
          <span className="axis-h">h&nbsp;{breakdown.h}</span>
          <span className="activity-podium-stat-sep">·</span>
          <span className="axis-d">d&nbsp;{breakdown.d}</span>
          <span className="activity-podium-stat-sep">·</span>
          <span className="axis-a">a&nbsp;{breakdown.a}</span>
        </span>
      ) : null}
    </div>
  );
  if (!tip) return cell;
  return (
    <SkeinTooltip content={tip} width={280} position="top">
      {cell}
    </SkeinTooltip>
  );
}

interface ThroughputMatrixProps {
  scoring?: ScoringResult;
}

function ThroughputMatrix({ scoring }: ThroughputMatrixProps) {
  const metrics = scoring?.metrics ?? [];
  if (metrics.length === 0) {
    return <p className="activity-empty">no metrics in this window</p>;
  }

  // Render a metric row name → friendly label.
  const labels: Record<string, string> = {
    issues_created: 'Issues created',
    issues_closed: 'Issues closed',
    issues_closed_with_commits: '↳ with commits',
    comments_authored: 'Comments authored',
    comments_on_others_issues: "↳ on others' tasks",
    mentions_sent: 'Mentions sent',
    dep_edges_added: 'Dep edges added',
  };

  return (
    <table className="activity-matrix-table" aria-label="Throughput matrix">
      <thead>
        <tr>
          <th scope="col">metric</th>
          <th scope="col" className="axis-h">
            human
          </th>
          <th scope="col" className="axis-d">
            agent_directed
          </th>
          <th scope="col" className="axis-a">
            autonomous
          </th>
        </tr>
      </thead>
      <tbody>
        {metrics.map((m) => {
          const t = rowTotals(m);
          return (
            <tr key={m.key}>
              <th scope="row" className="activity-matrix-rowlabel">
                {labels[m.key] ?? m.key}
              </th>
              <td className="axis-h">{t.h}</td>
              <td className="axis-d">{t.d}</td>
              <td className="axis-a">{t.a}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Places a Top-5 board draws; vacancies are filled with `·N —`. */
const LEADERBOARD_ROWS = 5;

type LeaderboardKind = 'closed-human-driven' | 'closed-with-commits';

interface LeaderboardListProps {
  title: string;
  entries: LeaderboardEntry[];
  scoring?: ScoringResult;
  kind: LeaderboardKind;
}

/**
 * Rich leaderboard row. Pre-redesign it was just `username  count` —
 * usable but bare. New shape adds:
 *   - medal for top-3 (1 / 2 / 3 ASCII chips so it survives monospace)
 *   - proportional bar (`MeterBar`, length = ratio to leader)
 *   - per-row secondary breakdown:
 *       closed-human-driven  → h │ d  (intent split; autonomous lives
 *                              on its own line in the podium)
 *       closed-with-commits  → "X of Y closed" + percent — gives the
 *                              "quality of close" signal that distin-
 *                              guishes shipped-with-code vs paperwork
 * The kind discriminator gates the secondary cell so both flavours
 * stay legible without bolting on a 4th column.
 */
function LeaderboardList({ title, entries, scoring, kind }: LeaderboardListProps) {
  const top = entries.slice(0, LEADERBOARD_ROWS);
  const max = top.reduce((m, e) => Math.max(m, e.count), 0);
  // sk-551.2 — a board that has anyone at all always draws five places:
  // the title says «Top 5», and the maintainers want the vacancies visible
  // as «·N —» rather than the list ending early. An empty board keeps
  // its «no rows» plate below and never reaches the vacancies.
  const vacancies = LEADERBOARD_ROWS - top.length;
  return (
    // `kind-*` is what lets the stylesheet paint the two Top-5 axes in
    // different roles (handoff §6: `--accent` human, `--info` directed).
    // Derived from the SAME discriminator that already gates the
    // secondary cell below, so a third leaderboard cannot arrive with a
    // colour but no breakdown, or the other way round.
    <div className={`activity-leaderboard kind-${kind}`}>
      <h3 className="activity-leaderboard-title">{title}</h3>
      {top.length === 0 ? (
        <p className="activity-empty">no rows</p>
      ) : (
        <ol className="activity-leaderboard-list">
          {top.map((e, idx) => {
            const m = matrixFor(scoring, e.username);
            return (
              <li key={e.username} className={`activity-leaderboard-row place-${idx + 1}`}>
                <span className="activity-leaderboard-rank" aria-hidden="true">
                  {medalForRank(idx)}
                </span>
                <CutName username={e.username} className="activity-leaderboard-name" />
                <MeterBar value={e.count} max={max} className="activity-leaderboard-bar" />
                <span className="activity-leaderboard-count">{e.count}</span>
                <span className="activity-leaderboard-detail">
                  {leaderboardDetail(kind, e.count, m)}
                </span>
              </li>
            );
          })}
          {Array.from({ length: vacancies }, (_, i) => {
            const place = top.length + i + 1;
            // A vacancy wins no medal — `·N` even on places 2 and 3.
            return (
              <li
                key={`vacant-${place}`}
                className="activity-leaderboard-row is-vacant"
              >
                <span className="activity-leaderboard-rank" aria-hidden="true">
                  ·{place}
                </span>
                <span className="activity-leaderboard-name">—</span>
                {/* Holds the second line, so a vacant place is as tall
                    as a filled one and the two boards' rows stay level
                    (sk-551.1). */}
                <span className="activity-leaderboard-detail">&nbsp;</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function medalForRank(idx: number): string {
  switch (idx) {
    case 0: return '🥇';
    case 1: return '🥈';
    case 2: return '🥉';
    case 3: return '·4';
    case 4: return '·5';
    default: return ` ${idx + 1}`;
  }
}

function leaderboardDetail(
  kind: LeaderboardKind,
  count: number,
  m: MatrixUserRow | undefined,
): ReactNode {
  if (!m) return null;
  if (kind === 'closed-human-driven') {
    // Intent breakdown for the ranking axis (h + d sum to `count`,
    // a is shown separately because it's NOT in the ranking).
    //
    // sk-551.1 — `<wbr />` after each separator: the parts are adjacent
    // spans with no space between them, so without it the detail has no
    // break opportunity and cannot wrap on a narrow board.
    return (
      <>
        <span className="axis-h">h&nbsp;{m.issuesClosedHuman}</span>
        <span className="activity-leaderboard-sep">·</span>
        <wbr />
        <span className="axis-d">d&nbsp;{m.issuesClosedDirected}</span>
        {m.issuesClosedAutonomous > 0 ? (
          <>
            <span className="activity-leaderboard-sep">·</span>
            <wbr />
            <SkeinTooltip content="autonomous (not ranked here)" position="top">
              <span className="axis-a">
                +a&nbsp;{m.issuesClosedAutonomous}
              </span>
            </SkeinTooltip>
          </>
        ) : null}
      </>
    );
  }
  // closed-with-commits → ratio of closes that shipped code.
  const totalClosed = totalClosedOf(m);
  if (totalClosed === 0) return null;
  const pct = Math.round((count / totalClosed) * 100);
  return (
    <SkeinTooltip
      content="closes with at least one linked git commit ÷ total closes"
      position="top"
    >
      <span className="activity-leaderboard-ratio">
        {count}/{totalClosed} closes&nbsp;·&nbsp;<strong>{pct}%</strong>
      </span>
    </SkeinTooltip>
  );
}

// ───────────────────────── AgentsActivity (sk-22) ─────────────────────────

interface AgentsActivityProps {
  rows: AgentsRow[];
  isLoading: boolean;
}

/**
 * Per-user MCP-session counts (live 15m + 24h + 7d + 30d + all-time).
 * One row per user; ordering driven by the backend (live DESC, d30
 * DESC, all_time DESC, username ASC) so currently-active users float
 * to the top. Rows are still gated to users active in the last 30
 * days (HAVING d30>0); the all-time column counts every session ever
 * for those users, including ones older than 30 days. The
 * `live` cell renders the count alongside up to 10 small `●`
 * pips — gives an at-a-glance "this user has 4 sessions connected
 * right now" signal without making the column wider for >10 live
 * sessions. "Connected", not "working": every column here counts
 * agents.last_seen_at, which wrapAgentRegistry bumps on ANY /mcp
 * request, so an idle client's protocol traffic keeps its session
 * live. The footnote spells this out — do not reword it back into
 * "called a tool" without changing the backend query first.
 *
 * sk-755: for a caller outside the unrestricted mode the rows are the
 * people of his HOT ZONE reach (participants of his spaces, members of his
 * projects), and every session of such a person counts, wherever it works.
 *
 * NOTE: "agents" here means MCP-session ids (`agents.session_id`),
 * which rotate on reconnect. Two reconnects of the same physical
 * Claude Code instance = two rows in the agents table. Footer-hint
 * spells this out so the count isn't misread as "physical clients".
 */
function AgentsActivity({ rows, isLoading }: AgentsActivityProps) {
  const totalLive = rows.reduce((sum, r) => sum + r.live, 0);
  const totalD30 = rows.reduce((sum, r) => sum + r.d30, 0);
  return (
    <section className="activity-agents" aria-labelledby="activity-agents-title">
      <header className="activity-zone-header">
        <h2 id="activity-agents-title" className="activity-zone-title">
          Agents
        </h2>
        <SkeinTooltip
          content="Totals across the users shown in this table (top 50 by recent activity), not the whole org. “live” = MCP sessions seen in the last 15 min; “seen 30d” = sessions seen in the last 30 days."
          width={280}
          position="bottom"
        >
          <span className="activity-zone-hint" tabIndex={0}>
            {isLoading && rows.length === 0
              ? 'loading…'
              : `${totalLive} live · ${totalD30} seen 30d`}
          </span>
        </SkeinTooltip>
      </header>
      {rows.length === 0 && !isLoading ? (
        <p className="activity-empty">— no agents seen in the last 30 days</p>
      ) : (
        <>
          <table className="activity-agents-table" aria-label="MCP-session counts per user">
            <colgroup>
              <col className="activity-agents-col-user" />
              <col className="activity-agents-col-live" />
              <col className="activity-agents-col-window" />
              <col className="activity-agents-col-window" />
              <col className="activity-agents-col-window" />
              <col className="activity-agents-col-window" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">user</th>
                <th scope="col">live (15m)</th>
                <th scope="col">24h</th>
                <th scope="col">7d</th>
                <th scope="col">30d</th>
                <th scope="col">all</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.username} className={r.live > 0 ? 'live' : ''}>
                  <td className="activity-agents-user">
                    {/* sk-551.26 — a login wider than the 14ch column is
                        cut here and offered whole in a tooltip, rather
                        than running over the live column. */}
                    <CutName username={r.username} className="activity-agents-user-name" />
                  </td>
                  <td className="activity-agents-live-cell">
                    <span className="activity-agents-pips" aria-hidden="true">
                      {pipDots(r.live)}
                    </span>
                    <span className="activity-agents-live-count">{r.live}</span>
                  </td>
                  <td className="activity-agents-cell">{r.h24}</td>
                  <td className="activity-agents-cell">{r.d7}</td>
                  <td className="activity-agents-cell">{r.d30}</td>
                  <td className="activity-agents-cell">{r.allTime}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="activity-zone-footnote">
            Every session of the people of your spaces and projects counts,
            wherever it works — also in a space you are not in. live = sessions
            that sent Skein ANY <code>/mcp</code> request in the last 15 min —
            protocol traffic counts, not just tool calls. An idle agent holding
            an open connection IS counted. Same rule for the 24h / 7d / 30d /
            all columns; only the window differs.
            <br />
            sessions ≈ MCP <code>Mcp-Session-Id</code>; rotates on reconnect.
            Live window 15 min · agents.Upsert throttled 60 s · polled 30 s.
            <br />
            Table is backend-capped at the top 50 users by recent activity.
          </p>
        </>
      )}
    </section>
  );
}

/** Render up to N filled pips for a count; cap at 10 so the column
 * doesn't blow out on edge cases (one user with 50 live sessions). */
function pipDots(n: number): string {
  const cap = 10;
  if (n <= 0) return '';
  return '●'.repeat(Math.min(n, cap)) + (n > cap ? '…' : '');
}

// ───────────────────────── ProjectsActivity (sk-183.2) ─────────────────────────

interface ProjectsActivityProps {
  data: ProjectsResult | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  window: ProjectsWindow;
  onWindowChange: (w: ProjectsWindow) => void;
}

/**
 * ProjectsActivity — per-project HOT ZONE leaderboard (sk-183). One
 * pinned "ALL PROJECTS" summary row (from `data.all`) always renders
 * above the per-project rows (`data.rows`), which arrive ALREADY
 * sorted server-side by `events.count` desc — this component does
 * NOT re-sort them.
 *
 * Redaction is intentionally narrower than `NowWorking`'s: a redacted
 * row blurs ONLY the Project cell (via the shared `RedactedTitle`);
 * every metric cell and the Top actor cell render their real values
 * exactly like a non-redacted row — see `ProjectActivityRow`'s doc in
 * api/dashboard.ts for the full contract.
 */
function ProjectsActivity({
  data,
  isLoading,
  isFetching,
  isError,
  window,
  onWindowChange,
}: ProjectsActivityProps) {
  const rows = data?.rows ?? [];
  return (
    <section
      className="activity-projects"
      aria-labelledby="activity-projects-title"
      data-fetching={isFetching ? 'true' : undefined}
      aria-busy={isFetching}
    >
      <header className="activity-zone-header">
        <h2 id="activity-projects-title" className="activity-zone-title">
          Projects
        </h2>
        <ChipRow<ProjectsWindow>
          label="Window"
          idPrefix="projects"
          options={PROJECTS_WINDOW_OPTIONS}
          active={window}
          onChange={onWindowChange}
        />
      </header>
      {!data ? (
        <p className="activity-empty" role={isError ? 'alert' : undefined}>
          {isError
            ? '⚠ failed to load project activity — retrying…'
            : isLoading
              ? 'loading…'
              : '— no project activity data'}
        </p>
      ) : (
        <table
          className="activity-projects-table"
          aria-label="Per-project activity leaderboard"
        >
          <colgroup>
            <col className="activity-projects-col-project" />
            <col className="activity-projects-col-metric" />
            <col className="activity-projects-col-metric" />
            <col className="activity-projects-col-metric" />
            <col className="activity-projects-col-metric" />
            <col className="activity-projects-col-metric" />
            <col className="activity-projects-col-actor" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Project</th>
              <ProjectHeaderCell tip="All activity events in this project in the window (created / updated / closed / commented / …). Hover a cell for its per-contributor breakdown.">
                Events
              </ProjectHeaderCell>
              <ProjectHeaderCell tip="Individual git commits linked to this project's issues in the window — one per SHA (issue_commits row), credited to whoever linked it. Raw commit volume. NOT the podium's +w/commits, which counts commit-backed closes.">
                Commits
              </ProjectHeaderCell>
              <ProjectHeaderCell tip="Issues created in this project in the window, credited to the creator.">
                Issues opened
              </ProjectHeaderCell>
              <ProjectHeaderCell tip="issue.closed events in this project in the window, credited to the closer.">
                Closed
              </ProjectHeaderCell>
              <ProjectHeaderCell tip="MCP sessions that did at least one thing in this project in the window. Hover a cell for the per-user split. In the ALL PROJECTS row a session that touched several projects counts once, so that row is NOT the sum of the rows below.">
                Agents
              </ProjectHeaderCell>
              <ProjectHeaderCell tip="The contributor with the most Events in this project in the window.">
                Top actor
              </ProjectHeaderCell>
            </tr>
          </thead>
          <tbody>
            <ProjectsTableRow row={data.all} isSummary />
            {rows.map((r, idx) => (
              <ProjectsTableRow
                // Redacted rows carry no stable projectId — key by a
                // composite of position + window so a reorder between
                // polls doesn't briefly bind one redacted row's state
                // to another (same idiom as NowWorking's redacted key).
                key={r.redacted ? `redacted-${idx}-${window}` : (r.projectId ?? `row-${idx}`)}
                row={r}
              />
            ))}
          </tbody>
        </table>
      )}
      {data && !isLoading ? (
        <p className="activity-zone-footnote">
          agents = MCP sessions (<code>Mcp-Session-Id</code>) with at least one
          event in the window — a reconnect mints a new one, so a long-running
          agent that reconnects counts more than once. ALL PROJECTS counts a
          session once even if it touched several projects, so it is not the sum
          of the rows.
        </p>
      ) : null}
    </section>
  );
}

interface ProjectsTableRowProps {
  row: ProjectActivityRow;
  isSummary?: boolean;
}

function ProjectsTableRow({ row, isSummary = false }: ProjectsTableRowProps) {
  return (
    <tr className={isSummary ? 'activity-projects-summary-row' : undefined}>
      <td className="activity-projects-project-cell">
        {isSummary ? (
          <span className="activity-projects-all-label">ALL PROJECTS</span>
        ) : row.redacted ? (
          <RedactedTitle />
        ) : row.projectId ? (
          <Link to={`/projects/${row.projectId}`} className="activity-projects-link">
            {row.projectPrefix ? (
              <span className="activity-projects-prefix">{row.projectPrefix}</span>
            ) : null}
            <span className="activity-projects-name">{row.projectName}</span>
          </Link>
        ) : (
          <span className="activity-projects-name">
            {row.projectName ?? row.projectPrefix ?? '—'}
          </span>
        )}
      </td>
      <td>
        <ProjectMetricCell metric={row.events} />
      </td>
      <td>
        <ProjectMetricCell metric={row.commits} />
      </td>
      <td>
        <ProjectMetricCell metric={row.issuesOpened} />
      </td>
      <td>
        <ProjectMetricCell metric={row.issuesClosed} />
      </td>
      <td>
        <ProjectMetricCell metric={row.activeAgents} />
      </td>
      <td className="activity-projects-actor-cell">
        {row.topActor ? row.topActor.username : '—'}
      </td>
    </tr>
  );
}

/**
 * ProjectHeaderCell — a projects-table column header wrapped in an instant
 * tooltip explaining what the column counts (the project guidelines tooltip
 * rule: openDelay/closeDelay 0). The <span> is focusable so keyboard and
 * touch users reach the explanation, not just mouse hover.
 */
function ProjectHeaderCell({ tip, children }: { tip: string; children: string }) {
  return (
    <th scope="col">
      <SkeinTooltip content={tip} width={280} position="bottom">
        <span tabIndex={0} className="activity-th-tip">
          {children}
        </span>
      </SkeinTooltip>
    </th>
  );
}

interface ProjectMetricCellProps {
  metric: MetricValue;
}

/**
 * ProjectMetricCell — one Events/Commits/Issues-opened/Closed/Active-
 * agents cell. Hover reveals the metric's top contributors straight
 * from the already-fetched `ProjectsResult` — no extra request.
 *
 * sk-285.7.2.87 — the product's own `SkeinTooltip`, which hardcodes
 * `delay: { open: 0, close: 0 }` and `restMs: 0`. The three props this
 * call site used to pass by hand (`openDelay` / `closeDelay` /
 * `transitionProps`) are gone because the rule (the project guidelines
 * § Tooltips, "delay 0ms") is now a property of the component that
 * no call site can opt out of — pinned by `TooltipDelay.test.tsx`.
 */
function ProjectMetricCell({ metric }: ProjectMetricCellProps) {
  const hasBreakdown = metric.contributors.length > 0 || !!metric.otherContributorsCount;
  const label = (
    <div className="activity-projects-tooltip">
      {metric.contributors.length === 0 ? (
        <div className="activity-projects-tooltip-row activity-projects-tooltip-empty">
          no contributors
        </div>
      ) : (
        metric.contributors.map((c) => (
          <div key={c.userId ?? c.username} className="activity-projects-tooltip-row">
            <span className="activity-projects-tooltip-user">{c.username}</span>
            <span className="activity-projects-tooltip-count">{c.count}</span>
          </div>
        ))
      )}
      {metric.otherContributorsCount ? (
        <div className="activity-projects-tooltip-more">
          +{metric.otherContributorsCount} more
        </div>
      ) : null}
    </div>
  );

  return (
    <SkeinTooltip content={label} disabled={!hasBreakdown} position="top">
      {/* sk-183 — a bare <span> can't receive focus, so
          the tooltip's focus/blur listeners never fired for keyboard /
          screen-reader users; tabIndex makes the contributor breakdown
          reachable without a mouse. Only when there's something to show —
          an empty cell isn't worth a tab stop. */}
      <span
        className="activity-projects-metric-cell"
        tabIndex={hasBreakdown ? 0 : undefined}
      >
        {metric.count}
      </span>
    </SkeinTooltip>
  );
}

// ───────────────────────── NowWorking ─────────────────────────

interface NowWorkingProps {
  rows: InProgressRow[];
  isLoading: boolean;
}

/**
 * Renders the snapshot of issues currently being worked on. Rows
 * come from useDashboardInProgress; that hook keeps the list fresh
 * via SignalR-driven invalidation on issue.claimed / unclaimed /
 * status_changed / accepted / closed (plus a 30s polling fallback).
 *
 * sk-17 v3 — switched from per-row CSS grid to a real <table> with
 * <colgroup> so columns align across rows. Previous shape had each
 * row create its own grid context, so the user column landed at a
 * different x in every line and made the list visually unscannable.
 * Plus project-name → colour bucket (8-slot deterministic hash) so
 * you can scan vertically and see "all orion rows clustered here",
 * priority colour ramp (P0 red → P4 dim), zebra striping, hover.
 */
function NowWorking({ rows, isLoading }: NowWorkingProps) {
  return (
    <section className="activity-now-working" aria-labelledby="activity-now-working-title">
      <header className="activity-zone-header">
        <h2 id="activity-now-working-title" className="activity-zone-title">
          Now working
        </h2>
        <span className="activity-zone-hint">
          {isLoading && rows.length === 0 ? 'loading…' : `${rows.length} active`}
        </span>
      </header>
      {rows.length === 0 && !isLoading ? (
        <p className="activity-empty">— nothing in progress right now</p>
      ) : (
        <table
          className="activity-now-table"
          aria-label="Issues currently in progress — newest activity first"
        >
          <colgroup>
            <col className="activity-now-col-id" />
            <col className="activity-now-col-flags" />
            <col className="activity-now-col-user" />
            <col className="activity-now-col-since" />
            <col className="activity-now-col-priority" />
            <col className="activity-now-col-project" />
            <col className="activity-now-col-title" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">id</th>
              <th scope="col" aria-label="status flags"></th>
              <th scope="col">assignee</th>
              <th scope="col">since</th>
              <th scope="col">P</th>
              <th scope="col">project</th>
              <th scope="col">title</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, index) => {
              const fresh = freshness(r.since);
              const unassigned = !r.assignee;
              // sk-163.18 — a HARD-redacted row has no project prefix
              // (dropped server-side); bucket it by a CONSTANT so all
              // secret rows share one colour instead of collapsing onto
              // projectColorBucket('') and colliding with a real prefix.
              const projBucket = r.redacted
                ? REDACTED_PROJECT_COLOR_BUCKET
                : projectColorBucket(r.projectPrefix ?? '');
              const prioBucket = Math.max(0, Math.min(4, r.priority));
              return (
                <tr
                  // sk-163.18 — redacted rows have no stable server id
                  // (issueId dropped); key by a composite of kept fields +
                  // the .map index. The list is SignalR-invalidated and can
                  // reorder between refetches, so a bare index would briefly
                  // bind status/assignee to the wrong row — the composite
                  // disambiguates within a snapshot.
                  key={
                    r.redacted
                      ? `redacted-${index}-${r.assignee ?? ''}-${r.since}`
                      : r.issueId
                  }
                  className={`${r.staleLock ? 'stale-row' : ''}${r.redacted ? ' redacted' : ''}`.trim()}
                >
                  <td>
                    {r.redacted ? (
                      // sk-163.18 — issueId is dropped server-side; render a
                      // 🔒 glyph, never the (now-empty) id. Title is a fixed
                      // reason string, NOT bound from any redacted field.
                      <span
                        className="activity-redacted-id"
                        title="No access to this project"
                        aria-label="No access to this project"
                      >
                        🔒
                      </span>
                    ) : (
                      <Link
                        to={`/projects/${r.projectId}/issues/${r.issueId}`}
                        className="activity-now-id-link"
                      >
                        {r.issueId}
                      </Link>
                    )}
                  </td>
                  <td>
                    {r.staleLock ? (
                      <span
                        className="activity-now-flag stale"
                        title="Lock is older than 25 min — auto-release within ~5 min"
                        aria-label="stale lock — auto-release soon"
                      >
                        ⚠
                      </span>
                    ) : r.lockedBySession && unassigned ? (
                      <span
                        className="activity-now-flag autonomous-lock"
                        title="Autonomous-agent lock"
                        aria-label="autonomous-agent lock"
                      >
                        ⏳
                      </span>
                    ) : null}
                  </td>
                  <td>
                    {unassigned ? (
                      <span className="activity-now-user-unassigned">— unassigned</span>
                    ) : (
                      <span className="activity-now-user">{r.assignee}</span>
                    )}
                  </td>
                  <td className="activity-now-since-cell" title={r.since}>
                    {fresh}
                  </td>
                  <td>
                    <span className={`activity-now-prio p-${prioBucket}`}>
                      {`P${prioBucket}`}
                    </span>
                  </td>
                  <td>
                    {r.redacted ? (
                      // sk-163.18 — projectPrefix is dropped server-side;
                      // keep the (constant) colour chip but render a 🔒 and
                      // a fixed-reason title, never the empty prefix.
                      <span
                        className={`activity-now-project proj-${projBucket}`}
                        title="No access to this project"
                        aria-label="No access to this project"
                      >
                        🔒
                      </span>
                    ) : (
                      <Link
                        to={`/projects/${r.projectId}`}
                        className={`activity-now-project proj-${projBucket}`}
                        title={r.projectPrefix}
                      >
                        {r.projectPrefix}
                      </Link>
                    )}
                  </td>
                  <td
                    className="activity-now-title-cell"
                    title={r.redacted ? 'No access to this project' : r.title}
                  >
                    {r.redacted ? <RedactedTitle /> : r.title}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

/**
 * RedactedTitle — placeholder for a title the caller isn't allowed to
 * read (the row belongs to a project they can't see; the server stripped
 * `title`/`summary` but kept the row so the competitive "pulse" stays
 * visible). Renders a fixed filler string under a CSS blur so it reads as
 * "there's a title here, you just can't see it". `user-select`/`pointer-
 * events` are disabled in CSS so it can't be selected or inspected as
 * real text, and the title/aria-label explain *why* it's hidden.
 */
/**
 * One CONTINUOUS run (no spaces) so the blur reads as a single frosted title
 * bar that STRETCHES across the column, not three disjoint chunks. CSS clips
 * it to a per-row width (nth-of-type) so the column looks like real titles of
 * varying length. Longer than the widest bar so it always fills.
 *
 * Built once at module load: the string never varies, so re-running
 * `.repeat(64)` for every redacted row on every render buys nothing.
 */
const REDACTED_FILLER = '█'.repeat(64);

function RedactedTitle() {
  return (
    <span
      className="activity-redacted-title"
      aria-label="No access to this project"
      title="No access to this project"
    >
      {REDACTED_FILLER}
    </span>
  );
}

/**
 * sk-163.18 — fixed colour bucket for HARD-redacted in-progress rows.
 * Their project prefix is dropped server-side, so we can't hash it; a
 * single constant keeps every secret row one consistent colour instead
 * of routing them through `projectColorBucket('')` (which would both
 * collide with any real prefix that hashes to the same slot and read as
 * "these all belong to one visible project").
 */
const REDACTED_PROJECT_COLOR_BUCKET = 0;

/**
 * projectColorBucket — deterministic 0..7 hash from a project prefix
 * so the same project gets the same colour bucket every render.
 * Cheap djb2 variant — no need to import a crypto hash for an
 * 8-slot palette. Stability across reloads + immune to prefix
 * collisions only matters within one viewer's project set (~10s of
 * prefixes), so 8 buckets is plenty.
 */
function projectColorBucket(prefix: string): number {
  let h = 5381;
  for (let i = 0; i < prefix.length; i++) {
    h = ((h << 5) + h + prefix.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 8;
}

/**
 * freshness — compact "12m" / "1h 24m" / "3d" string from an ISO
 * timestamp. Designed for the "since X" column where we want at-a-
 * glance scanning, not precision.
 */
function freshness(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '?';
  const seconds = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const restMin = minutes % 60;
  if (hours < 24) return restMin > 0 ? `${hours}h ${restMin}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

interface LiveTickerProps {
  items: DashboardFeedEntry[];
  showHuman: boolean;
  showDirected: boolean;
  showAutonomous: boolean;
  connectionStatus: 'connected' | 'reconnecting' | 'connecting' | 'disconnected';
}

// sk-17 review fix W2 — narrowed return type. The backend
// ActivityEntry wire DTO does NOT carry per-event intent
// (issues.source / comments.author_kind) — only actor.type. Until
// that lands (follow-up issue), the ticker can only distinguish
// human vs agent at the row level, never directed-vs-autonomous.
// The return type now reflects what the function can actually
// produce; previously the `'directed'` branch was dead code and the
// matching chip a no-op (the discriminated union was lying).
//
// The Directed chip is still rendered in the UI per the sk-17 visual
// spec (3-chip symmetry with the sk-16 Comments filter); see the
// LiveTicker filter at the bottom — when showDirected is OFF the
// chip currently has no effect, and `.activity-ticker-row.axis-
// directed` never matches a row. Once the wire DTO grows an
// `intent` field, this function gains the branch back and the chip
// becomes load-bearing.
type TickerAxis = 'human' | 'autonomous' | 'unknown';

function intentAxisForEntry(entry: DashboardFeedEntry): TickerAxis {
  switch (entry.actor.type) {
    case 'agent':
      return 'autonomous';
    case 'human':
      return 'human';
    case 'system':
      return 'unknown';
    default: {
      const _exhaustive: never = entry.actor.type;
      void _exhaustive;
      return 'unknown';
    }
  }
}

function intentDots(axis: TickerAxis): string {
  switch (axis) {
    case 'human':
      return '·';
    case 'autonomous':
      return '···';
    case 'unknown':
      return '';
    default: {
      const _exhaustive: never = axis;
      void _exhaustive;
      return '';
    }
  }
}

function timeOfDay(iso: string): string {
  try {
    const d = new Date(iso);
    return d
      .toLocaleTimeString(undefined, { hour12: false })
      .padStart(8, '0');
  } catch {
    return '--:--:--';
  }
}

function LiveTicker({ items, showHuman, showDirected, showAutonomous, connectionStatus }: LiveTickerProps) {
  // sk-514 (13) — the feed reads the dictionary. Before the fix each of its rows was
  // hard-coded in English: the section heading, the connection state, the empty
  // screen, the lock label and — most importantly — the VERB, which was printed
  // as a machine token (`status_changed`). Under the Russian interface it
  // was an English island, and the token is not readable in any language.
  const { t } = useTranslation('ticker');
  /** Machine token → label; an unknown type is printed as is. */
  const verbLabel = (token: string) =>
    t(`verb.${token}`, { defaultValue: token.replace(/_/g, ' ') });
  const entityLabel = (kind: string) => t(`entity.${kind}`, { defaultValue: kind });
  // sk-17 review fix W2 — `showDirected` is declared but currently
  // unused: the underlying axis-classifier can't return 'directed'
  // because the wire DTO lacks intent. Kept in the prop signature
  // for forwards compatibility (when ActivityEntry grows an intent
  // field this filter will activate). Suppress the lint by tying it
  // to a no-op assertion so future readers see the intent.
  void showDirected;
  const visible = items.filter((it) => {
    const axis = intentAxisForEntry(it);
    if (axis === 'human') return showHuman;
    if (axis === 'autonomous') return showAutonomous;
    // Unknown axis (system events) → always show.
    return true;
  });
  return (
    <section className="activity-ticker" aria-labelledby="activity-ticker-title">
      <header className="activity-zone-header">
        <h2 id="activity-ticker-title" className="activity-zone-title">
          {t('title')}
        </h2>
        <span
          className={`activity-conn ${connectionStatus}`}
          aria-label={`SignalR ${connectionStatus}`}
          title={t('connection', { status: connectionStatus })}
        >
          {connectionStatus === 'connected' ? `● ${t('online')}` : `● ${t('offline')}`}
        </span>
      </header>
      {/* sk-17 review fix HTML W1 — the ticker list dropped
          aria-live entirely. With aria-live="polite" (and the
          default aria-relevant="additions text") every burst
          announces full row text AND every drop of the 101st row
          fires a "removed" announcement, making SR unusable on
          busy projects. The list is still navigable via virtual
          cursor; real-time change is surfaced visually through
          the "● online" connection dot and prepend animations.
          If a "follow live" opt-in lands later, that's where the
          live region re-attaches under user control. */}
      {visible.length === 0 ? (
        <p className="activity-empty">{t('empty')}</p>
      ) : (
        // sk-17 v3 — same fix as now-working: switched from <ol>+<li>
        // grid-per-row (verb cell capped at 100px → `status_changed`
        // overflowed and visually collided with the next column) to a
        // real <table> with <colgroup>. Now every column aligns across
        // rows and overflow truncates with ellipsis inside its own cell.
        // Added a `type` column showing the entity kind (issue / comment
        // / user / etc.) so `system created <uuid>` rows aren't a mystery
        // anymore — `system` is the lock-reaper actor (auto-unclaims
        // agent locks >30 min old) and any non-issue.unclaimed row is a
        // platform-emitted event for a different entity, the column
        // makes that explicit.
        <table
          className="activity-ticker-table"
          aria-label={t('tableAria')}
        >
          <colgroup>
            <col className="activity-ticker-col-time" />
            <col className="activity-ticker-col-actor" />
            <col className="activity-ticker-col-dots" />
            <col className="activity-ticker-col-verb" />
            <col className="activity-ticker-col-type" />
            <col className="activity-ticker-col-id" />
            <col className="activity-ticker-col-title" />
          </colgroup>
          {/* sk-514 (13) — HEADER. Seven columns stood without a single
              label: what the third one with dots or the fifth one with the word
              `issue` is, the reader had to guess. This is also accessibility: a table
              without column headers does not tell the screen reader what it
              is reading. */}
          <thead>
            <tr>
              <th scope="col">{t('col.time')}</th>
              <th scope="col">{t('col.actor')}</th>
              <th scope="col">{t('col.origin')}</th>
              <th scope="col">{t('col.verb')}</th>
              <th scope="col">{t('col.type')}</th>
              <th scope="col">{t('col.id')}</th>
              <th scope="col">{t('col.title')}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((entry) => {
              const axis = intentAxisForEntry(entry);
              const dots = intentDots(axis);
              const verb = entry.type.replace(/^(issue|comment|dependency|project|component|user|attachment|dep)\./, '');
              // sk-163.18 — entity.id is dropped on a HARD-redacted row;
              // coalesce so the non-redacted branches stay string-typed
              // (the redacted branch renders 🔒 and never reads this).
              const entityLink = entry.entity.id ?? '';
              // A redacted row has no navigable target (the linked project
              // is invisible AND the id is stripped) — never render a <Link>.
              const isIssueId =
                entry.entity.type === 'issue' && !!entry.entity.id && !entry.redacted;
              return (
                <tr
                  key={entry.id}
                  className={`activity-ticker-row axis-${axis}${entry.redacted ? ' redacted' : ''}`}
                >
                  <td className="activity-ticker-time">{timeOfDay(entry.occurredAt)}</td>
                  <td className="activity-ticker-actor" title={entry.actor.username}>
                    {entry.actor.username}
                  </td>
                  {/* sk-514 (13) — the column got a label, so the
                      dots stopped being the only carrier of meaning
                      and `aria-hidden` is REMOVED from the cell: under the heading
                      "Source" the screen reader now reads a word instead of staying silent.
                      The dots remained as a quick visual cue. */}
                  <td className="activity-ticker-dots" title={t(`origin.${axis}`)}>
                    <span aria-hidden="true">{dots}</span>
                    <span className="sr-only">{t(`origin.${axis}`)}</span>
                  </td>
                  <td className="activity-ticker-verb">{verbLabel(verb)}</td>
                  <td>
                    <span className={`activity-ticker-type-badge type-${entry.entity.type}`}>
                      {entityLabel(entry.entity.type)}
                    </span>
                  </td>
                  <td
                    className={`activity-ticker-id${entry.redacted ? ' activity-redacted-id' : ''}`}
                    title={entry.redacted ? t('noAccess') : entityLink}
                  >
                    {entry.redacted ? (
                      // sk-163.18 — id dropped server-side; render 🔒, never
                      // the empty id. aria-label carries the reason.
                      <span aria-label={t('noAccess')}>🔒</span>
                    ) : isIssueId ? (
                      <Link to={`/issues/${encodeURIComponent(entityLink)}`}>{entityLink}</Link>
                    ) : (
                      entityLink
                    )}
                  </td>
                  <td
                    className="activity-ticker-title-cell"
                    // sk-163.18 — never bind the tooltip from a redacted
                    // field; entity.title is stripped on a redacted row.
                    title={entry.redacted ? t('noAccess') : entry.entity.title}
                  >
                    {entry.redacted ? (
                      <RedactedTitle />
                    ) : entry.entity.title ? (
                      `«${entry.entity.title}»`
                    ) : (
                      ''
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

interface PerUserMatrixProps {
  rows: MatrixUserRow[];
}

type MatrixSortKey =
  | 'closedHumanDriven'
  | 'issuesCreatedHuman'
  | 'issuesClosedHuman'
  | 'closedWithCommitsHuman'
  | 'commentsHuman';

function PerUserMatrix({ rows }: PerUserMatrixProps) {
  const [sortKey, setSortKey] = useState<MatrixSortKey>('closedHumanDriven');

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => (b[sortKey] ?? 0) - (a[sortKey] ?? 0));
  }, [rows, sortKey]);

  if (sorted.length === 0) {
    return <p className="activity-empty">no user activity in this window</p>;
  }

  // sk-17 review fix HTML/CSS C1 — sort header is a real <button>
  // nested inside the <th>. Previously the <th> carried the onClick
  // directly: keyboard users couldn't activate it (Enter/Space on a
  // non-interactive <th> does nothing), no native focus ring, and
  // the `cursor: pointer` lied about the affordance to non-mouse
  // users. The button picks up native keyboard activation + focus
  // outline; the <th> keeps its table-semantic role and `aria-sort`
  // for screen readers.
  const headerCell = (key: MatrixSortKey, label: string) => (
    <th
      scope="col"
      aria-sort={sortKey === key ? 'descending' : 'none'}
      className={`activity-matrix-sortable${sortKey === key ? ' sorted' : ''}`}
    >
      <button
        type="button"
        className="activity-matrix-sort-btn"
        onClick={() => setSortKey(key)}
        aria-label={`Sort by ${label.replace(/\s*\(.*\)\s*$/, '')}`}
      >
        {label}
        {sortKey === key ? ' ▼' : ''}
      </button>
    </th>
  );

  return (
    <table className="activity-matrix-table per-user" aria-label="Per-user metrics matrix">
      <thead>
        <tr>
          <th scope="col">user</th>
          {headerCell('issuesCreatedHuman', 'created (h│d│a)')}
          {headerCell('issuesClosedHuman', 'closed (h│d│a)')}
          {headerCell('closedWithCommitsHuman', '+w/commits (h│d│a)')}
          {headerCell('commentsHuman', 'comments (h│d│a)')}
        </tr>
      </thead>
      <tbody>
        {sorted.slice(0, 10).map((r) => (
          <tr key={r.username}>
            <th scope="row" className="activity-matrix-user">
              <ProfileName username={r.username} />
            </th>
            <td className="activity-matrix-triplet">
              <span className="axis-h">{r.issuesCreatedHuman}</span>
              <span className="axis-sep">│</span>
              <span className="axis-d">{r.issuesCreatedDirected}</span>
              <span className="axis-sep">│</span>
              <span className="axis-a">{r.issuesCreatedAutonomous}</span>
            </td>
            <td className="activity-matrix-triplet">
              <span className="axis-h">{r.issuesClosedHuman}</span>
              <span className="axis-sep">│</span>
              <span className="axis-d">{r.issuesClosedDirected}</span>
              <span className="axis-sep">│</span>
              <span className="axis-a">{r.issuesClosedAutonomous}</span>
            </td>
            <td className="activity-matrix-triplet">
              <span className="axis-h">{r.closedWithCommitsHuman}</span>
              <span className="axis-sep">│</span>
              <span className="axis-d">{r.closedWithCommitsDir}</span>
              <span className="axis-sep">│</span>
              <span className="axis-a">{r.closedWithCommitsAuto}</span>
            </td>
            <td className="activity-matrix-triplet">
              <span className="axis-h">{r.commentsHuman}</span>
              <span className="axis-sep">│</span>
              <span className="axis-d">{r.commentsDirected}</span>
              <span className="axis-sep">│</span>
              <span className="axis-a">{r.commentsAutonomous}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ───────────────────────── Page ─────────────────────────

export function ActivityDashboard() {
  // sk-17 fix — the activity surface lives OUTSIDE the Shell so the
  // ThemeToggle (which is what mounts useTheme() in the rest of the
  // app) never runs here. Without this call /activity boots with the
  // default Solarized tokens regardless of the user's saved theme
  // preference. Mounting useTheme directly inside the page makes the
  // route honour the same theme as every Shell-mounted page.
  useTheme();
  const { t } = useTranslation('common');
  // sk-622.21 T041 (R2) — the ticker and "in progress" follow every project
  // the user can see: the tab holds the hub's "all visible" mode while
  // this page is mounted and drops it on leaving.
  useDeclareAllVisible(true);
  // sk-17 fix — opt this route into browser-native window scroll.
  // The global `html, body { overflow: hidden }` rule is load-bearing
  // for the Shell's per-column scroll model, but on a full-page
  // surface like /activity it would either clip overflow or force a
  // custom container scroll (bad UX on mobile / iPad — breaks
  // pull-to-refresh and system gestures). The CSS rule
  // `body[data-allow-page-scroll='true']` restores native scroll
  // for the duration the dashboard is mounted; cleanup reverts on
  // unmount so the next route (Shell) gets its overflow:hidden back.
  useEffect(() => {
    document.body.dataset.allowPageScroll = 'true';
    return () => {
      delete document.body.dataset.allowPageScroll;
    };
  }, []);
  const queryClient = useQueryClient();
  const [windowSel, setWindowSel] = useState<DashboardWindow>('24h');
  // sk-30 — independent state for the podium + leaderboards window.
  // Driven by `HeroesWindowTabs`, decoupled from the global `windowSel`.
  const [heroesWindow, setHeroesWindow] = useState<HeroesWindow>('today');
  const [showHuman, setShowHuman] = useState(true);
  const [showDirected, setShowDirected] = useState(true);
  const [showAutonomous, setShowAutonomous] = useState(true);

  // sk-183.2 — Projects zone's own window toggle, URL-driven like
  // RaceChart's chip rows but under a distinct `projectsWindow` key so
  // it never collides with RaceChart's own `window` search param.
  const [searchParams, setSearchParams] = useSearchParams();
  const projectsWindow = parseProjectsWindow(searchParams.get('projectsWindow'));
  const handleProjectsWindow = (w: ProjectsWindow) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (w === DEFAULT_PROJECTS_WINDOW) next.delete('projectsWindow');
        else next.set('projectsWindow', w);
        return next;
      },
      { replace: true },
    );
  };

  // sk-674.18 T056 — the page's space choice (screens 1.12): every request
  // of the page carries it — scoring, the heroes, the race, the feed,
  // «now working», the agents poll and the hot projects.
  const spaceFilter = useSpaceFilter({ replace: true });
  const space = spaceFilter.space;
  // An address naming a space waits for «my spaces».
  const ready = spaceFilter.ready;

  const scoring = useDashboardScoring(windowSel, null, null, space, ready);
  // sk-30 — separate scoring fetch for the heroes podium + 2 leaderboards.
  // Uses the heroes-window state, NOT the global `windowSel`, so the
  // podium / leaderboards refetch on heroes-window change without
  // disturbing the global throughput / matrix queries.
  const heroesScoring = useDashboardScoring(heroesWindowToApi(heroesWindow), null, null, space, ready);
  const feed = useDashboardFeed(100, space, ready);
  const inProgress = useDashboardInProgress(null, space, ready);
  const agents = useDashboardAgents(space, ready);
  const projects = useDashboardProjects(projectsWindow, space, ready);
  const conn = useLiveEventsState();

  // Force a feed refetch whenever the user changes window — keeps the
  // ticker fresh after a context switch.
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ['dashboard', 'feed'] });
  }, [windowSel, queryClient]);

  const toggleChip = (axis: 'human' | 'directed' | 'autonomous') => {
    if (axis === 'human') setShowHuman((v) => !v);
    if (axis === 'directed') setShowDirected((v) => !v);
    if (axis === 'autonomous') setShowAutonomous((v) => !v);
  };

  // sk-30 — both leaderboards now feed from the heroes-window scoping,
  // matching the podium. Previously sourced from `scoring.data` (global
  // window) which would have produced inconsistent numbers between the
  // podium (heroes window) and the leaderboard rows right below it.
  const closedHumanDriven = heroesScoring.data?.leaderboards?.closed_human_driven ?? [];
  const closedWithCommits = rankClosedWithCommits(heroesScoring.data);

  return (
    <main className="activity-dashboard" aria-label="Activity dashboard">
      <header className="activity-dashboard-header activity-dashboard-header-hotzone">
        <svg
          className="hotzone-hero-flames"
          viewBox="0 0 1200 120"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d="M0 120 L0 78 C40 40 66 92 100 60 C132 30 160 92 196 62 C232 34 262 92 298 60 C332 32 360 92 396 62 C432 34 460 90 496 60 C532 32 560 92 596 62 C632 34 660 90 696 60 C732 32 760 92 796 62 C832 34 860 90 896 60 C932 32 960 92 996 62 C1032 34 1060 90 1096 62 C1132 36 1164 82 1200 78 L1200 120 Z" />
        </svg>
        <div className="activity-dashboard-title">
          {/* sk-285.7.11 (HZ2) — the flame the artboard sets beside the
              word. `--accent-text` reaches it from the heading through
              `currentColor`, so the glyph and the word are one object,
              and it is decorative: the word says the same thing, and a
              second accessible name would have a screen reader announce
              the page twice.

              NO `size` prop, deliberately — this glyph is display type
              rather than a control icon, so its box is set in `em`
              against the heading in the stylesheet
              (`.hotzone-title-flame`). The reasoning, and why writing 44
              here would be wrong, is recorded on that rule. */}
          <h1 className="hotzone-title">
            <IconFlame className="hotzone-title-flame" stroke={1.75} aria-hidden="true" />
            HOT ZONE
          </h1>
        </div>

        {/* sk-30 — the heroes-window switcher; sk-285.7.11 (HZ4) moved it
            HERE, into the header's right end, which is where the artboard
            puts it. It had been sitting under the race chart, between two
            zones it does not drive, so it read as a control of whichever
            one you happened to be looking at. Lexical labels (today / this
            week / …) keep it visually distinct from the global numeric
            WindowTabs further down, so the two are never conflated. */}
        <HeroesWindowTabs active={heroesWindow} onChange={setHeroesWindow} />
      </header>

      {/* sk-674.18 T056 — "All my spaces" or one (screens 1.12): a
          filter of this page only. Absent with one space and for an
          external user (SC-014). */}
      {spaceFilter.spaces !== null ? (
        <SpaceFilter
          spaces={spaceFilter.spaces}
          value={space}
          onChange={spaceFilter.select}
          allLabel={t('spaceFilter.allMine')}
          className="hotzone-space-filter"
        />
      ) : null}

      {/* sk-285.7.11 (HZ1) — the two-column body the artboard draws: the
          race on the left at 1.6fr, the heroes rail on the right at 1fr.
          The page had every zone stacked full-width, which is the single
          largest structural gap the fidelity audit found.

          sk-551.1 — the two Top-5 boards left the rail for the left
          column, under the race, side by side. The maintainers' call
          (2026-10-03): with both boards in the rail it stood about twice
          as tall as the race and left an empty field under the chart.
          The rail now holds the podium alone, which grew taller itself
          once its metrics became rows.

          Three grid children, placed by area (see `.hotzone-grid`): the
          DOM order — race, podium, boards — is the reading order of the
          single column the narrow modes collapse to.

          Only the zones the artboard draws are inside the grid. Agents /
          Projects / Now working / the matrices / the ticker are not in
          the design at all (§9) and stay full-width below it. */}
      <div className="hotzone-grid">
        {/* sk-29.2 — RaceChart is the "who's ahead this window" picture
            and leads the page. URL state, chip rows, live SignalR
            increment all owned by the component. */}
        <RaceChart space={space} enabled={ready} />

        <div className="hotzone-rail">
          <Podium
            scoring={heroesScoring.data}
            heroesWindow={heroesWindow}
            isFetching={heroesScoring.isFetching}
          />
        </div>

        {/* sk-68 — both leaderboards share the heroes-window scoring; dim
            them together while it refetches so the held-previous rows read
            as "refreshing" rather than stale. aria-busy lets SR announce
            the transient state without re-reading every row. */}
        <section
          className="activity-leaderboards-wrap"
          data-fetching={heroesScoring.isFetching ? 'true' : undefined}
          aria-busy={heroesScoring.isFetching}
        >
          <LeaderboardList
            title="Top 5 · closed with commits"
            entries={closedWithCommits}
            scoring={heroesScoring.data}
            kind="closed-with-commits"
          />
          <LeaderboardList
            title="Top 5 · closed (human + directed)"
            entries={closedHumanDriven}
            scoring={heroesScoring.data}
            kind="closed-human-driven"
          />
        </section>
      </div>

      <AgentsActivity
        rows={agents.data?.items ?? []}
        isLoading={agents.isLoading}
      />

      <ProjectsActivity
        data={projects.data}
        isLoading={projects.isLoading}
        isFetching={projects.isFetching}
        isError={projects.isError}
        window={projectsWindow}
        onWindowChange={handleProjectsWindow}
      />

      <NowWorking
        rows={inProgress.data?.items ?? []}
        isLoading={inProgress.isLoading}
      />

      <section className="activity-throughput-wrap" aria-labelledby="activity-throughput-title">
        {/* sk-66 — the global numeric window switcher (24h/7d/30d) lives
            here, in the header of the first zone it actually controls
            (throughput + the per-user metrics matrix below), instead of
            the page header where it misleadingly read as a page-wide
            control. Mirrors the HeroesWindowTabs idiom: switcher sits
            directly above the content it drives. Same `windowSel` state,
            same useDashboardScoring + feed-invalidate effect — pure
            relocation, no behaviour change. */}
        <header className="activity-zone-header">
          <h2 id="activity-throughput-title" className="activity-zone-title">
            Throughput matrix
          </h2>
          {/* The page's one window control (sk-285.7.2.62) — the same
              component the Projects zone header renders one zone down,
              so the two headers read as one idiom. */}
          <ChipRow<Exclude<DashboardWindow, 'all-time'>>
            label="Window"
            idPrefix="throughput"
            options={DASHBOARD_WINDOW_OPTIONS}
            active={windowSel as Exclude<DashboardWindow, 'all-time'>}
            onChange={setWindowSel}
          />
        </header>
        {/* sk-68 — dim while the window-driven scoring refetches; the
            matrix keeps its previous rows (keepPreviousData) so the zone
            height holds and the page below doesn't jump. */}
        <div
          className="activity-zone-body"
          data-fetching={scoring.isFetching ? 'true' : undefined}
          aria-busy={scoring.isFetching}
        >
          <ThroughputMatrix scoring={scoring.data} />
        </div>
        <AxisLegend />
      </section>

      {/* Intentionally unnamed. The inner <section className="activity-ticker">
          already carries aria-labelledby="activity-ticker-title"; naming this
          wrapper with the SAME heading produced two nested landmarks both
          announced "live ticker", which makes landmark navigation ambiguous
          instead of clearer. A <section> without an accessible name is not
          exposed as a landmark at all, which is exactly what this wrapper
          should be — it only groups the filters with the ticker. */}
      <section className="activity-ticker-wrap">
        <ChipFilters
          showHuman={showHuman}
          showDirected={showDirected}
          showAutonomous={showAutonomous}
          onToggle={toggleChip}
        />
        <LiveTicker
          items={feed.items}
          showHuman={showHuman}
          showDirected={showDirected}
          showAutonomous={showAutonomous}
          connectionStatus={conn}
        />
      </section>

      <section className="activity-matrix-wrap" aria-labelledby="activity-matrix-title">
        <header className="activity-zone-header">
          <h2 id="activity-matrix-title" className="activity-zone-title">
            Metrics matrix
          </h2>
          <span className="activity-zone-hint">sort ▼ closed</span>
        </header>
        {/* sk-68 — same window-driven scoring source as the throughput
            matrix; dim during refetch while the held rows preserve height. */}
        <div
          className="activity-zone-body"
          data-fetching={scoring.isFetching ? 'true' : undefined}
          aria-busy={scoring.isFetching}
        >
          <PerUserMatrix rows={scoring.data?.matrixUsers ?? []} />
        </div>
        <AxisLegend />
      </section>
    </main>
  );
}

/**
 * AxisLegend — explains the `h│d│a` triplet that shows up in every
 * cell of the metrics matrix + the throughput matrix. Pinned as a
 * footnote so a viewer scanning numbers can answer "what's a
 * directed agent?" without leaving the page.
 *
 * The split mirrors the sk-16 `comments.author_kind` axis exactly:
 * `human` = posted via Web UI, `agent_directed` = agent posted on
 * the human user's instruction, `agent_autonomous` = agent decided
 * on its own (handoff note, side-quest, progress update).
 */
function AxisLegend() {
  return (
    <aside className="activity-axis-legend" aria-label="Axis legend">
      <strong>h</strong> = human (via Web UI)
      <span className="activity-axis-sep">·</span>
      <strong>d</strong> = agent_directed (agent directed by a human)
      <span className="activity-axis-sep">·</span>
      <strong>a</strong> = agent_autonomous (agent on its own — handoff, side-quest, progress)
    </aside>
  );
}

export default ActivityDashboard;
