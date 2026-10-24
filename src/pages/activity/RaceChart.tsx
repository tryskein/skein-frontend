/**
 * sk-29.2 — RaceChart
 *
 * Cumulative-per-user "race to the top" line chart living above every
 * other zone on /activity. Answers the question «who is winning this
 * window» with a pure SVG-by-hand render — no Recharts / Nivo / D3,
 * just polylines + axes + theme-aware CSS variables.
 *
 * Visual contract:
 *  - Two chip rows above the chart — metric (closed/commits/created/
 *    comments, default closed) and window (7d/30d/90d/all, default 30d).
 *    Chip state round-trips via React Router `useSearchParams`; the
 *    defaults are NOT written to the URL (keeps shareable links clean).
 *  - One <svg> contains:
 *      * X axis with 5–7 evenly spaced date ticks
 *      * Y axis with 4–5 integer ticks
 *      * Top-N coloured polylines (deterministic palette via username hash)
 *      * A dimmed "others" polyline (single grey line)
 *      * End-of-line `@username` label per top-N row, with collision avoidance
 *      * Hover: highlights one line, dims the others to ~30% opacity,
 *        renders a tooltip at the cursor (`@user · {metric}: N · rank #K`)
 *      * Click: emits a console.log stub (callback drill-down is a follow-up)
 *  - Cold-start: when the response's `isColdStart` is true the header reads
 *    `since {formattedDate}` instead of `30d race`.
 *  - Empty state: when no users + others.userCount=0, render placeholder
 *    text instead of empty axes.
 *  - Live increment: subscribes to the dashboard envelope bus and bumps
 *    the matched user's last cumulative on each `eventType` match.
 *    Dedups by envelope.id; falls back to matching by `actor` (username)
 *    when `actorUserId` is missing on the envelope.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';

import {
  type RaceMetric,
  type RaceResult,
  type RaceWindow,
} from '../../api/dashboard';
import {
  raceQueryKey,
  useDashboardRace,
} from '../../hooks/useDashboardRace';
import { useEnvelopeInSpace } from '../../hooks/useEnvelopeInSpace';
import { subscribeDashboardEnvelopes } from '../../lib/dashboardEventBus';
import type { EventEnvelope } from '../../lib/eventEnvelope';
import { applyEnvelopeToResult } from '../../lib/applyEnvelopeToRace';

// ───────────────────────── Constants ─────────────────────────

const METRIC_OPTIONS: RaceMetric[] = ['closed', 'commits', 'created', 'comments'];
const WINDOW_OPTIONS: RaceWindow[] = ['7d', '30d', '90d', 'all'];

const DEFAULT_METRIC: RaceMetric = 'closed';
const DEFAULT_WINDOW: RaceWindow = '30d';
const TOP_N = 8;

/** Deterministic per-username line colour. The hash is djb2 on the
 *  username so the same user keeps the same line across reloads —
 *  the `projectColorBucket` pattern ActivityDashboard already uses.
 *
 *  sk-285.7 T031: the buckets used to be eight fixed HSL hues at
 *  `65% 45%`, chosen once to be "readable on both bases". That made the
 *  chart the one zone of the page a theme could not reach, and the
 *  fixed lightness was tuned against a ground that has since moved.
 *  They are the eight chromatic ROLES now — which is exactly how many
 *  the dictionary has, so no bucket had to be merged and no ninth
 *  colour invented, and each is already measured ≥4.5:1 on `--bg` in
 *  both bases (`--ok` is the tight one at 4.89 light).
 *
 *  Ordered so that ADJACENT buckets stay far apart in hue — the
 *  property the old evenly-spread hue list was buying — rather than in
 *  the dictionary's own declaration order, which would put the two
 *  reds (`--primary`, `--err`) in neighbouring slots.
 *
 *  Returned as a `var()` reference, which SVG's `stroke` / `fill`
 *  presentation attributes resolve as CSS values. */
const LINE_ROLES = [
  '--primary',
  '--ok',
  '--info',
  '--warn',
  '--secondary',
  '--err',
  '--violet',
  '--accent',
] as const;

function colorForUsername(username: string): string {
  let h = 5381;
  for (let i = 0; i < username.length; i++) {
    h = ((h << 5) + h + username.charCodeAt(i)) | 0;
  }
  return `var(${LINE_ROLES[Math.abs(h) % LINE_ROLES.length]})`;
}

// ───────────────────────── Helpers ─────────────────────────

function parseMetric(s: string | null): RaceMetric {
  return (METRIC_OPTIONS as readonly string[]).includes(s ?? '')
    ? (s as RaceMetric)
    : DEFAULT_METRIC;
}

function parseWindow(s: string | null): RaceWindow {
  return (WINDOW_OPTIONS as readonly string[]).includes(s ?? '')
    ? (s as RaceWindow)
    : DEFAULT_WINDOW;
}

/** Format a UTC day-stamp for the cold-start header / X-axis ticks
 *  using English month abbreviation + day. UTC-stable: we read the
 *  date as if the timezone were UTC so users in different zones see
 *  the same day label as the backend produced. */
function formatDayShort(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** Stable identity key for a user — userId when present, else username. */
function userKey(u: { userId?: string; username: string }): string {
  return u.userId ?? `username:${u.username}`;
}

// ───────────────────────── Geometry types ─────────────────────────

interface ChartGeometry {
  width: number;
  height: number;
  padding: { top: number; right: number; bottom: number; left: number };
  innerWidth: number;
  innerHeight: number;
  days: string[];
  xScale: (dayIdx: number) => number;
  yMax: number;
  yScale: (value: number) => number;
}

function buildGeometry(data: RaceResult): ChartGeometry {
  // SVG renders into a fixed viewBox (1000×400). The container uses
  // `width: 100%` + `preserveAspectRatio="xMinYMid meet"` so the
  // browser scales the picture down on narrow viewports without us
  // needing to ResizeObserver the parent. End-of-line labels live in
  // the right padding gutter (220px) so even the longest @username
  // doesn't get clipped at the SVG edge.
  const width = 1000;
  const height = 400;
  const padding = { top: 24, right: 220, bottom: 36, left: 56 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  // The first user's points array sets the day axis — every user
  // (including `others`) has the same dense day series from the
  // backend, so we can pick any non-empty array.
  const firstPoints = data.users[0]?.points ?? data.others.points;
  const days = firstPoints.map((p) => p.day);

  const xScale = (idx: number) => {
    if (days.length <= 1) return padding.left + innerWidth / 2;
    return padding.left + (idx / (days.length - 1)) * innerWidth;
  };

  // Y-axis max = max across every user's final cumulative AND the
  // others line's final cumulative. We pad up by ~10% so the top
  // line doesn't kiss the chart edge, then round to the next nice
  // integer for clean ticks.
  let rawMax = 0;
  for (const u of data.users) {
    for (const p of u.points) rawMax = Math.max(rawMax, p.cumulative);
  }
  for (const p of data.others.points) rawMax = Math.max(rawMax, p.cumulative);
  const yMax = niceMax(Math.max(1, Math.ceil(rawMax * 1.08)));

  const yScale = (value: number) => {
    if (yMax <= 0) return padding.top + innerHeight;
    return padding.top + innerHeight - (value / yMax) * innerHeight;
  };

  return { width, height, padding, innerWidth, innerHeight, days, xScale, yMax, yScale };
}

/** Round up to the next "nice" integer for axis tick math — picks
 *  the next multiple of 1/2/5/10 in the right order of magnitude.
 *  Keeps Y-axis ticks readable (1, 2, 5, 10, 20, 50, 100…). */
function niceMax(n: number): number {
  if (n <= 5) return Math.max(1, n);
  const mag = Math.pow(10, Math.floor(Math.log10(n)));
  const norm = n / mag;
  if (norm <= 1) return 1 * mag;
  if (norm <= 2) return 2 * mag;
  if (norm <= 5) return 5 * mag;
  return 10 * mag;
}

/** Pick ~5 X-axis tick indices distributed across the day list. */
function xTickIndices(dayCount: number): number[] {
  if (dayCount === 0) return [];
  if (dayCount <= 6) return Array.from({ length: dayCount }, (_, i) => i);
  const ticks = 6;
  const step = (dayCount - 1) / (ticks - 1);
  return Array.from({ length: ticks }, (_, i) => Math.round(i * step));
}

/**
 * The Y-axis divisions: 0…yMax on a step the axis can actually carry.
 *
 * sk-285.7.2.61 — audit 2B, HZ2B-4. §6 asks for a "20% grid", i.e.
 * five intervals and six labels, and the artboard `2a` draws exactly
 * six: 5 4 3 2 1 0. What shipped divided the axis into FOUR intervals
 * and then rounded each division to an integer, so at yMax = 5 the step
 * was 1.25 and the labels came out `Math.round` of 0, 1.25, 2.5, 3.75,
 * 5 — that is 0 1 3 4 5. Measured live: five `<text>` nodes at y = 368,
 * 300, 164, 96, 28, i.e. the slot at 232 empty while the scale ran
 * through it. A reader counting rows off the grid read every value
 * above 1 one row too low.
 *
 * The step is therefore chosen so every division lands ON an integer:
 * a fifth of the axis when the axis divides by five (which is every
 * value `niceMax` returns from 5 upward — 5, 10, 20, 50, 100 …), and 1
 * below that, where a fifth would not be a whole task. Rounding never
 * enters, so a division can neither be skipped nor be printed twice.
 */
export function yTickValues(yMax: number): number[] {
  const step = yMax % 5 === 0 ? yMax / 5 : 1;
  const out: number[] = [];
  for (let v = 0; v <= yMax; v += step) out.push(v);
  return out;
}

/** Build SVG polyline `points` attribute from a series of cumulative
 *  values. Empty arrays return an empty string so the polyline
 *  renders nothing (instead of NaN warnings in the console). */
function polylinePoints(
  points: { cumulative: number }[],
  geom: ChartGeometry,
): string {
  if (points.length === 0) return '';
  return points
    .map((p, idx) => `${geom.xScale(idx).toFixed(2)},${geom.yScale(p.cumulative).toFixed(2)}`)
    .join(' ');
}

// ───────────────────────── End-of-line label layout ─────────────────────────

interface LabelRow {
  username: string;
  color: string;
  x: number;
  y: number; // post-collision-avoidance y
  rawY: number; // pre-collision y, for the leader connector
}

/** Sort labels by their natural Y and push neighbours apart so none
 *  end up within MIN_GAP of each other. Simple O(N) sweep — N≤8,
 *  performance is irrelevant. The algorithm doesn't bother going
 *  backwards: with only 8 lines and a 14px minimum gap on a 320px
 *  tall plot region, forward push handles every realistic case. */
function layoutLabels(
  rawLabels: { username: string; color: string; x: number; y: number }[],
  geom: ChartGeometry,
): LabelRow[] {
  const MIN_GAP = 14;
  const sorted = [...rawLabels].sort((a, b) => a.y - b.y);
  const out: LabelRow[] = [];
  let lastY = -Infinity;
  for (const l of sorted) {
    const minY = lastY + MIN_GAP;
    const pushedY = Math.max(l.y, minY);
    // Clamp inside the plot region so labels don't ride past the
    // bottom padding edge on dense bunching.
    const finalY = Math.min(pushedY, geom.padding.top + geom.innerHeight + 4);
    out.push({ ...l, y: finalY, rawY: l.y });
    lastY = finalY;
  }
  return out;
}

// ───────────────────── End-label pill geometry (HZ6) ─────────────────────
//
// The chart is hand-drawn SVG in a fixed 1000×400 viewBox, so a pill
// around a text node has to be sized by arithmetic — there is no box to
// measure. Every number below is the artboard's own (`#2a`: `padding:
// 2px 8px 2px 4px; gap: 6px`, an 8px dot, a 12px radius on a ~20px
// stadium) except the advance, which is a property of the typeface.
//
// `MONO_ADVANCE` is the per-character width of Geist Mono at the 12px
// `--font-xs` the label is set in: monospaced faces in this family
// advance at 0.6em, so 12 × 0.6 = 7.2. It is only used to size the
// PLATE, so an imprecise face would show as a slightly loose or tight
// right edge, never as clipped text — and the plate is drawn into the
// 220px right gutter `buildGeometry` reserves, which is far wider than
// the longest username plus its padding.
const MONO_ADVANCE = 7.2;
const PILL_HEIGHT = 20;
const PILL_PAD_LEFT = 4;
const PILL_PAD_RIGHT = 8;
const PILL_DOT = 8;
const PILL_GAP = 6;

// ───────────────────────── Sub-components ─────────────────────────

export interface ChipRowProps<T extends string> {
  label: string;
  options: readonly T[];
  active: T;
  onChange: (v: T) => void;
  /**
   * Namespaces the generated `labelId` so two ChipRow instances sharing
   * the same `label` text (e.g. both RaceChart and the Projects zone
   * have a "Window" toggle, sk-183.1/.2 coderev) don't emit a duplicate
   * DOM id — which breaks `aria-labelledby` uniqueness. Defaults to
   * `'race'` to keep RaceChart's existing ids stable for anyone already
   * depending on them (tests, deep links, etc).
   */
  idPrefix?: string;
}

/**
 * ChipRow — generic label + toggle-button-group control, reused by
 * every window/metric switcher on the activity page (sk-183.2 lifted
 * it out for the Projects zone's window toggle — see ActivityDashboard.tsx).
 */
export function ChipRow<T extends string>({
  label,
  options,
  active,
  onChange,
  idPrefix = 'race',
}: ChipRowProps<T>) {
  // sk-29 review fix HTML W5 — anchor the group's accessible name on
  // the visible <span> via aria-labelledby instead of mirroring the
  // string as aria-label. Avoids "Metric, group, Metric" duplicate-
  // name announcement on screen readers.
  const labelId = `${idPrefix}-chip-row-${label.toLowerCase()}-label`;
  return (
    <div className="race-chip-row" role="group" aria-labelledby={labelId}>
      <span className="race-chip-row-label" id={labelId}>
        {label}
      </span>
      {/* sk-285.7.11 (HZ5) — the options live in a TRACK now. The
          artboard draws metric and window as segment controls — `--elev`
          under the row, the current member raised onto `--surface` with
          §4's segment shadow — and they shipped as loose filter chips
          whose active member wore a solid `--primary` fill. That fill
          was the app's mark for one of several INDEPENDENT toggles (the
          ticker's Humans / Directed / Autonomous chips wore it too, and
          sk-414.7 has since moved every filter chip in the product onto
          one outlined recipe); these four are one control with four
          positions, and a raised plate is how such a control says which
          one is on.
          The extra element is the track: a raised member needs a ground
          to be raised from. */}
      <span className="segment-track">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            className={`segment-cell${active === opt ? ' active' : ''}`}
            aria-pressed={active === opt}
            onClick={() => onChange(opt)}
          >
            {opt}
          </button>
        ))}
      </span>
    </div>
  );
}

interface TooltipState {
  username: string;
  metric: RaceMetric;
  count: number;
  rank: number;
  /** Cursor coordinate in viewBox space — placed via translate(). */
  x: number;
  y: number;
}

interface RaceChartProps {
  /**
   * Reserved for follow-up: click-to-drill into the ticker. The
   * polylines themselves are not clickable today (sk-29 review fix —
   * SVG primitives aren't keyboard-reachable; a proper HTML legend
   * surface owning the affordance lands with the drill-down wiring).
   * Prop kept in the signature so the follow-up can mount a parallel
   * legend list without changing the call-site.
   */
  onLineSelect?: (username: string) => void;
  /**
   * sk-674.18 T056 — the page's space choice (screens 1.12, `?space=`):
   * the read carries it and only that space's envelopes bump a line
   * (`useEnvelopeInSpace.ts`). null / omitted — every space of the caller.
   */
  space?: string | null;
  /** False — the page is not ready to ask yet; default true. */
  enabled?: boolean;
}

// ───────────────────────── Main component ─────────────────────────

export function RaceChart(_props: RaceChartProps = {}) {
  // _props.onLineSelect is reserved for a follow-up legend surface;
  // the SVG body intentionally doesn't accept clicks today.
  void _props;
  const space = _props.space ?? null;
  const [searchParams, setSearchParams] = useSearchParams();
  const metric = parseMetric(searchParams.get('metric'));
  const windowSel = parseWindow(searchParams.get('window'));

  const queryClient = useQueryClient();
  const query = useDashboardRace({ metric, window: windowSel, topN: TOP_N, space, enabled: _props.enabled ?? true });
  // An event of a project outside the map: read the race again with the
  // space instead of guessing.
  const inSpace = useEnvelopeInSpace(space, () => {
    void queryClient.invalidateQueries({ queryKey: raceQueryKey(metric, windowSel, TOP_N, space) });
  });

  // Hover / focus state for line highlighting + tooltip.
  const [hovered, setHovered] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  // Dedup live envelopes by `envelope.id` so a re-delivery from the
  // dispatcher doesn't double-bump a user's cumulative. We use a Set
  // refs-captured rather than reactive state so a `seen` add doesn't
  // re-render the chart.
  const seenRef = useRef<Set<number>>(new Set());

  // Subscribe once. The listener identity is stabilised via useRef so
  // chip changes don't re-add the listener on every render — same
  // pattern as ActivityDashboard's `useEnvelopeListener`. Ref is synced
  // inside a useEffect (not during render) so concurrent re-renders
  // can't write a stale closure under StrictMode / React 18 concurrent
  // mode (sk-29 review fix W1).
  const listenerRef = useRef<(env: EventEnvelope) => void>(() => undefined);
  useEffect(() => {
    listenerRef.current = (env: EventEnvelope) => {
      if (typeof env.id !== 'number') return;
      if (!inSpace(env)) return;
      if (seenRef.current.has(env.id)) return;
      seenRef.current.add(env.id);
      // Cap the seen set so memory doesn't grow without bound on a
      // long-lived tab. When we exceed the soft cap, drop the OLDEST
      // half rather than wholesale-nuking — wholesale reset would let
      // an at-least-once redelivery of an id from the last few seconds
      // bump a user twice (sk-29 review fix W4).
      if (seenRef.current.size > 5000) {
        const arr = Array.from(seenRef.current);
        seenRef.current = new Set(arr.slice(arr.length - 2500));
      }
      queryClient.setQueryData<RaceResult>(
        raceQueryKey(metric, windowSel, TOP_N, space),
        (prev) => (prev ? applyEnvelopeToResult(prev, env, metric) : prev),
      );
    };
  });
  useEffect(() => {
    const stable = (env: EventEnvelope) => listenerRef.current(env);
    return subscribeDashboardEnvelopes(stable);
    // Subscription must run exactly once on mount and tear down on
    // unmount; the listener identity is stabilised via the ref above,
    // so the listener body re-binds (metric/windowSel/queryClient)
    // without re-subscribing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleMetric = (m: RaceMetric) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (m === DEFAULT_METRIC) next.delete('metric');
        else next.set('metric', m);
        return next;
      },
      { replace: true },
    );
  };

  const handleWindow = (w: RaceWindow) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (w === DEFAULT_WINDOW) next.delete('window');
        else next.set('window', w);
        return next;
      },
      { replace: true },
    );
  };

  const data = query.data;
  const isLoading = query.isLoading;
  // sk-68 — with placeholderData: keepPreviousData on the hook, `data`
  // stays populated across a metric/window chip switch, so the SVG body
  // never collapses to the one-line placeholder mid-transition. `isFetching`
  // (true during that refetch) drives the dim-overlay so the held chart
  // reads as "refreshing" rather than stale.
  const isFetching = query.isFetching;

  return (
    <section
      className="activity-race-wrap"
      aria-labelledby="activity-race-title"
      data-fetching={isFetching ? 'true' : undefined}
      aria-busy={isFetching}
    >
      <header className="activity-zone-header">
        <h2 id="activity-race-title" className="activity-zone-title">
          Race chart
        </h2>
        <span className="activity-zone-hint">
          {data
            ? data.isColdStart
              ? `since ${formatDayShort(data.effectiveStart)}`
              : `${data.window} race · ${metric}`
            : isLoading
              ? 'loading…'
              : 'no data'}
        </span>
      </header>

      <div className="race-controls">
        <ChipRow<RaceMetric>
          label="Metric"
          options={METRIC_OPTIONS}
          active={metric}
          onChange={handleMetric}
        />
        <ChipRow<RaceWindow>
          label="Window"
          options={WINDOW_OPTIONS}
          active={windowSel}
          onChange={handleWindow}
        />
      </div>

      {data ? (
        <RaceChartBody
          data={data}
          metric={metric}
          hovered={hovered}
          tooltip={tooltip}
          onHover={setHovered}
          onTooltip={setTooltip}
        />
      ) : (
        <p className="activity-empty">{isLoading ? 'loading…' : 'no data'}</p>
      )}
    </section>
  );
}

interface RaceChartBodyProps {
  data: RaceResult;
  metric: RaceMetric;
  hovered: string | null;
  tooltip: TooltipState | null;
  onHover: (key: string | null) => void;
  onTooltip: (t: TooltipState | null) => void;
}

function RaceChartBody({
  data,
  metric,
  hovered,
  tooltip,
  onHover,
  onTooltip,
}: RaceChartBodyProps) {
  // sk-29 review fix TS critical — hooks must run unconditionally on
  // every render. The early-return for the empty state used to live
  // ABOVE these useMemo calls, which made hook order non-invariant
  // across renders (e.g. when TanStack Query refetched empty→non-empty
  // or the chip selection switched a window with no events). Now the
  // four memos run on every render, then we branch on the result.
  // Memos are cheap on empty data — `.map()` on empty arrays returns
  // empty arrays without per-item cost.
  //
  // Geometry + polyline path memoization. Re-computed only when the
  // data reference changes (TanStack Query gives stable refs across
  // refetches that returned identical content).
  const geom = useMemo(() => buildGeometry(data), [data]);

  const userPaths = useMemo(
    () =>
      data.users.map((u, idx) => ({
        key: userKey(u),
        username: u.username,
        rank: idx + 1,
        total: u.total,
        color: colorForUsername(u.username),
        path: polylinePoints(u.points, geom),
        lastY: geom.yScale(u.points[u.points.length - 1]?.cumulative ?? 0),
        // sk-29 review fix TS W3 — Math.max guards against the empty
        // points case. The previous `(len - 1) || 0` returned -1 when
        // points was empty (truthy in JS) and placed the end label
        // off-canvas to the left.
        lastX: geom.xScale(Math.max(0, u.points.length - 1)),
      })),
    [data.users, geom],
  );

  const othersPath = useMemo(
    () => polylinePoints(data.others.points, geom),
    [data.others.points, geom],
  );

  // End-of-line labels: position at the last data point and offset
  // overlapping labels.
  const labels = useMemo(
    () =>
      layoutLabels(
        userPaths.map((u) => ({
          username: u.username,
          color: u.color,
          x: u.lastX + 6,
          y: u.lastY,
        })),
        geom,
      ),
    [userPaths, geom],
  );

  // Empty state — neither top-N users nor any "others" cardinality.
  // Lives BELOW the hooks to keep hook order invariant.
  if (data.users.length === 0 && data.others.userCount === 0) {
    return (
      <p className="activity-empty">
        no {metric} events in this window — try a wider window or different metric
      </p>
    );
  }

  const xTicks = xTickIndices(geom.days.length);
  const yTicks = yTickValues(geom.yMax);

  // sk-29 review fix HTML W1/W2 — accessible name+description for the
  // SVG. <title> as first child ensures JAWS/NVDA pick it up; <desc>
  // narrates the current standings so screen-reader users get the
  // ranking information that's otherwise pointer-only.
  const titleText = `Race chart — cumulative ${metric} per user, ${data.window}`;
  const standings = data.users.map((u) => `${u.username} ${u.total}`).join(', ');
  const descText =
    data.users.length === 0
      ? `No ${metric} events in this window.`
      : `Top ${data.users.length}: ${standings}` +
        (data.others.userCount > 0
          ? `; plus ${data.others.userCount} other ${
              data.others.userCount === 1 ? 'user' : 'users'
            } combined ${data.others.total}.`
          : '.');

  const handlePointerLeave = () => {
    onHover(null);
    onTooltip(null);
  };

  return (
    <div className="race-chart-svg-wrap">
      <svg
        viewBox={`0 0 ${geom.width} ${geom.height}`}
        role="img"
        aria-labelledby="race-chart-title race-chart-desc"
        className="race-chart-svg"
        preserveAspectRatio="xMinYMid meet"
        onPointerLeave={handlePointerLeave}
      >
        <title id="race-chart-title">{titleText}</title>
        <desc id="race-chart-desc">{descText}</desc>

        {/* Plot frame */}
        <rect
          x={geom.padding.left}
          y={geom.padding.top}
          width={geom.innerWidth}
          height={geom.innerHeight}
          className="race-plot-frame"
        />

        {/* Y grid + ticks */}
        {yTicks.map((v) => {
          const y = geom.yScale(v);
          return (
            <g key={`yt-${v}`}>
              <line
                x1={geom.padding.left}
                y1={y}
                x2={geom.padding.left + geom.innerWidth}
                y2={y}
                className="race-grid-line"
              />
              <text
                x={geom.padding.left - 8}
                y={y + 4}
                textAnchor="end"
                className="race-axis-label"
              >
                {v}
              </text>
            </g>
          );
        })}

        {/* X ticks */}
        {xTicks.map((idx) => {
          const x = geom.xScale(idx);
          const day = geom.days[idx];
          return (
            <g key={`xt-${idx}`}>
              <line
                x1={x}
                y1={geom.padding.top + geom.innerHeight}
                x2={x}
                y2={geom.padding.top + geom.innerHeight + 4}
                className="race-tick-mark"
              />
              <text
                x={x}
                y={geom.padding.top + geom.innerHeight + 18}
                textAnchor="middle"
                className="race-axis-label"
              >
                {day ? formatDayShort(day) : ''}
              </text>
            </g>
          );
        })}

        {/* Others line — drawn FIRST so coloured top-N sit on top. */}
        {data.others.userCount > 0 && othersPath ? (
          <polyline
            points={othersPath}
            className="race-line race-line-others"
            data-hovered={hovered === 'others' ? 'true' : 'false'}
            data-dimmed={hovered && hovered !== 'others' ? 'true' : 'false'}
            onPointerEnter={() => onHover('others')}
            onPointerMove={(e) => {
              const lastIdx = data.others.points.length - 1;
              const lastVal = data.others.points[lastIdx]?.cumulative ?? 0;
              onTooltip({
                username: `+${data.others.userCount} others`,
                metric,
                count: lastVal,
                rank: 0,
                x: e.nativeEvent.offsetX,
                y: e.nativeEvent.offsetY,
              });
            }}
          />
        ) : null}

        {/* Top-N coloured polylines.
            sk-29 review fix HTML critical #1 + TS W6 — `onClick` was
            dropped from polylines because SVG primitives are not
            focusable / keyboard-reachable. The drill-into-ticker
            interaction is a stub today (spec carved out the real
            wiring as a follow-up); when it lands it needs a proper
            keyboard-reachable surface (an HTML legend list of
            `<button>@user</button>`, separate from the SVG). For now
            the lines remain purely informational, hover-driven. */}
        {userPaths.map((u) => {
          const isHovered = hovered === u.key;
          const isDimmed = hovered !== null && !isHovered;
          return (
            <polyline
              key={u.key}
              points={u.path}
              stroke={u.color}
              className="race-line race-line-user"
              data-username={u.username}
              data-hovered={isHovered ? 'true' : 'false'}
              data-dimmed={isDimmed ? 'true' : 'false'}
              onPointerEnter={() => onHover(u.key)}
              onPointerMove={(e) => {
                onTooltip({
                  username: u.username,
                  metric,
                  count: u.total,
                  rank: u.rank,
                  x: e.nativeEvent.offsetX,
                  y: e.nativeEvent.offsetY,
                });
              }}
            />
          );
        })}

        {/* End-of-line labels.
            sk-29 review fix HTML critical #2 — click handler removed
            (see polyline block above). Labels are decorative readouts
            of the line endpoints, no keyboard affordance needed. */}
        {labels.map((l) => {
          // Add a thin connector if the label was pushed off its raw y.
          const offset = l.y - l.rawY;
          const connector = Math.abs(offset) > 4 ? (
            <line
              x1={l.x - 2}
              y1={l.rawY}
              x2={l.x - 2}
              y2={l.y}
              stroke={l.color}
              strokeWidth={0.5}
              opacity={0.5}
            />
          ) : null;
          // sk-285.7.11 (HZ6) — the label is a PILL with a colour dot,
          // not bare text (§6: "`@user` labels in pills"). Bare
          // coloured text sitting on the plot area had to compete with
          // the gridlines behind it, and the tie between a label and its
          // line was carried by hue alone; the dot restates it and the
          // plate lifts the word off the grid.
          //
          // The geometry is arithmetic because SVG has no layout: the
          // text is monospaced at 12px, so its width is the glyph count
          // times the advance below, and the surrounding paddings are the
          // artboard's own (4 left · 8 dot · 6 gap · 8 right). Overrun
          // would be invisible, so it is spent from the 220px right
          // gutter `buildGeometry` reserves for exactly this.
          const text = `@${l.username}`;
          const pillWidth = PILL_PAD_LEFT + PILL_DOT + PILL_GAP
            + text.length * MONO_ADVANCE + PILL_PAD_RIGHT;
          return (
            <g key={`label-${l.username}`} className="race-end-label" aria-hidden="true">
              {connector}
              <rect
                className="race-end-label-pill"
                x={l.x}
                y={l.y - PILL_HEIGHT / 2}
                width={pillWidth}
                height={PILL_HEIGHT}
                rx={PILL_HEIGHT / 2}
                stroke={l.color}
              />
              <circle
                className="race-end-label-dot"
                cx={l.x + PILL_PAD_LEFT + PILL_DOT / 2}
                cy={l.y}
                r={PILL_DOT / 2}
                fill={l.color}
              />
              <text
                x={l.x + PILL_PAD_LEFT + PILL_DOT + PILL_GAP}
                y={l.y + 4}
                fill={l.color}
                className="race-end-label-text"
              >
                {text}
              </text>
            </g>
          );
        })}

        {/* Tooltip — rendered last so it sits on top of every other layer. */}
        {tooltip ? (
          <g
            className="race-tooltip"
            transform={`translate(${Math.min(tooltip.x + 12, geom.width - 220)}, ${Math.max(20, tooltip.y - 28)})`}
          >
            <rect className="race-tooltip-bg" width={210} height={28} rx={2} />
            <text className="race-tooltip-text" x={8} y={18}>
              @{tooltip.username} · {tooltip.metric}: {tooltip.count}
              {tooltip.rank > 0 ? ` · rank #${tooltip.rank}` : ''}
            </text>
          </g>
        ) : null}
      </svg>
    </div>
  );
}

export default RaceChart;
