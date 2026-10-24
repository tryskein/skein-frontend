/**
 * sk-551.8 — this machine's geometry of the SECTIONS layout ("Sections in one
 * column"): the navigation column's width, the split of height between
 * the Projects and Queues sections, which sections are folded, whether the
 * whole column is folded into its sliver, the board/tree auto-fold record,
 * and whether the sections hint was shown.
 *
 * ── Why on the machine, and why apart ────────────────────────────────
 *
 * The layout MODE lives in the profile; the geometry does not (spec D3):
 * pixels depend on the window, and a tablet and a monitor of one person
 * must not overwrite each other's sizes. Every value here belongs to the
 * sections layout only (INV-3), under its own `skein.layout.nav.*` keys —
 * never under the side-by-side layout's `skein.layout.col.*`,
 * `skein.layout.inbox-collapsed` or `skein.layout.kanban-workspace`, so an
 * action in one layout cannot change a stored value of the other.
 *
 *   - The column width is stored SEPARATELY for desktop and tablet
 *     (INV-4): the desktop width is never applied on a tablet. The split
 *     and the sections' folding are one record for both widths.
 *   - The auto-fold record has its own key: the side-by-side one is
 *     historically called `kanban-workspace` and is neither renamed nor
 *     shared (spec FOR-PLAN).
 *   - The hint flag has its own key, apart from
 *     `skein.layout.board-workspace-hint-seen`: the first sections
 *     auto-fold explains itself even if the side-by-side hint was shown.
 *
 * ── Bounds ───────────────────────────────────────────────────────────
 *
 * The column's bounds are their own numbers, outside `COL_BOUNDS`: the
 * sections column is not a term of the app floor (`--app-min-width`,
 * INV-2, D4), and `lib/widthBudget.ts` reads only `COL_BOUNDS`. A tablet's
 * live upper limit is applied on screen by the caller (`lib/navResize.ts`)
 * and is NOT written back here: a stored width above it stays stored
 * until the person drags (US-8).
 *
 * ── Failure ──────────────────────────────────────────────────────────
 *
 * Unavailable or damaged storage gives the defaults — 300 px, split 0.5,
 * everything expanded, no auto-fold and no opt-out — and values out of
 * bounds are clamped into them. Nothing here throws.
 */

import type { WorkspaceWidthMode } from './workspaceResize';

/** localStorage keys of the sections layout. */
export const NAV_STORAGE_KEYS = {
  /** Column width on the desktop, px. */
  width: 'skein.layout.nav.width',
  /** Column width on the tablet, px — apart from the desktop one (INV-4). */
  widthTablet: 'skein.layout.nav.width-tablet',
  /** `{split, collapsed: {projects, queues}}` — one for both widths. */
  sections: 'skein.layout.nav.sections',
  /** `'true'` — the whole column is folded into its sliver. */
  collapsed: 'skein.layout.nav.collapsed',
  /** `{auto, optOut}` — the board/tree auto-fold of the sections column. */
  workspace: 'skein.layout.nav.workspace',
  /** `'true'` — the sections auto-fold hint was shown in this browser. */
  hintSeen: 'skein.layout.nav.hint-seen',
} as const;

/** Drag bounds and the untouched width of the sections column, px (US-5). */
export const NAV_COLUMN_BOUNDS = { min: 200, max: 480, default: 300 } as const;

/** No expanded section body is ever shorter than this, px (INV-9, US-4). */
export const NAV_SECTION_MIN_PX = 200;

/**
 * The split — the share of the two bodies' total height taken by Projects
 * (Queues get the rest). Stored as a share of the whole, so it can never
 * leave 0…1; the live 200 px minimums are applied on screen
 * (`lib/navResize.ts#splitBounds`). Untouched — equal bodies.
 */
export const NAV_SPLIT_BOUNDS = { min: 0, max: 1, default: 0.5 } as const;

export type NavSection = 'projects' | 'queues';

export interface NavSectionsRecord {
  /** Projects' share of the two bodies' height, 0…1. */
  split: number;
  /** Folded sections: only the header is left. */
  collapsed: Record<NavSection, boolean>;
}

export interface NavWorkspaceRecord {
  /** The board/tree folded this column itself (the "Auto-fold" mark). */
  auto: boolean;
  /** The person told the board/tree to leave this column alone ("Refusal"). */
  optOut: boolean;
}

/**
 * The defaults are built afresh on every call: a reader that mutates the
 * record it got must not change what the next read returns.
 */
function defaultNavSections(): NavSectionsRecord {
  return { split: NAV_SPLIT_BOUNDS.default, collapsed: { projects: false, queues: false } };
}

function emptyNavWorkspace(): NavWorkspaceRecord {
  return { auto: false, optOut: false };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setItem(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode / quota — the value lives until the next load */
  }
}

function parseJsonObject(raw: string | null): Record<string, unknown> | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function widthKey(mode: WorkspaceWidthMode): string {
  return mode === 'tablet' ? NAV_STORAGE_KEYS.widthTablet : NAV_STORAGE_KEYS.width;
}

/** The stored column width of this width mode, clamped; 300 when none or unusable. */
export function readNavWidth(mode: WorkspaceWidthMode): number {
  const raw = getItem(widthKey(mode));
  if (raw === null) return NAV_COLUMN_BOUNDS.default;
  const n = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(n)) return NAV_COLUMN_BOUNDS.default;
  return clamp(Math.round(n), NAV_COLUMN_BOUNDS.min, NAV_COLUMN_BOUNDS.max);
}

/** Store the column width of this width mode (rounded, clamped). */
export function writeNavWidth(mode: WorkspaceWidthMode, px: number): void {
  if (!Number.isFinite(px)) return;
  const value = clamp(Math.round(px), NAV_COLUMN_BOUNDS.min, NAV_COLUMN_BOUNDS.max);
  setItem(widthKey(mode), String(value));
}

/** Split and folding of the two sections; the defaults for anything unusable. */
export function readNavSections(): NavSectionsRecord {
  const obj = parseJsonObject(getItem(NAV_STORAGE_KEYS.sections));
  if (obj === null) return defaultNavSections();
  const split =
    typeof obj.split === 'number' && Number.isFinite(obj.split)
      ? clamp(obj.split, NAV_SPLIT_BOUNDS.min, NAV_SPLIT_BOUNDS.max)
      : NAV_SPLIT_BOUNDS.default;
  const folded =
    typeof obj.collapsed === 'object' && obj.collapsed !== null
      ? (obj.collapsed as Record<string, unknown>)
      : {};
  return {
    split,
    collapsed: { projects: folded.projects === true, queues: folded.queues === true },
  };
}

/** Store split and folding (the split clamped into 0…1). */
export function writeNavSections(record: NavSectionsRecord): void {
  const split = Number.isFinite(record.split)
    ? clamp(record.split, NAV_SPLIT_BOUNDS.min, NAV_SPLIT_BOUNDS.max)
    : NAV_SPLIT_BOUNDS.default;
  const value: NavSectionsRecord = {
    split,
    collapsed: { projects: record.collapsed.projects, queues: record.collapsed.queues },
  };
  setItem(NAV_STORAGE_KEYS.sections, JSON.stringify(value));
}

/** Whether the whole column is folded into its sliver; expanded by default. */
export function readNavColumnCollapsed(): boolean {
  return getItem(NAV_STORAGE_KEYS.collapsed) === 'true';
}

export function writeNavColumnCollapsed(collapsed: boolean): void {
  setItem(NAV_STORAGE_KEYS.collapsed, collapsed ? 'true' : 'false');
}

/** The board/tree auto-fold record; no mark and no opt-out by default. */
export function readNavWorkspace(): NavWorkspaceRecord {
  const obj = parseJsonObject(getItem(NAV_STORAGE_KEYS.workspace));
  if (obj === null) return emptyNavWorkspace();
  return { auto: obj.auto === true, optOut: obj.optOut === true };
}

export function writeNavWorkspace(record: NavWorkspaceRecord): void {
  setItem(
    NAV_STORAGE_KEYS.workspace,
    JSON.stringify({ auto: record.auto === true, optOut: record.optOut === true }),
  );
}

/**
 * Whether the sections auto-fold hint was already shown in this browser.
 * Read from its own key only — the side-by-side flag does not count.
 * Storage that cannot be read answers «not shown»; the writer below is
 * then equally unable to persist, so the cost is one extra hint per load
 * in a private window, never an exception.
 */
export function readNavHintSeen(): boolean {
  return getItem(NAV_STORAGE_KEYS.hintSeen) === 'true';
}

export function writeNavHintSeen(): void {
  setItem(NAV_STORAGE_KEYS.hintSeen, 'true');
}
