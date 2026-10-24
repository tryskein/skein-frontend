import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  IconAdjustmentsHorizontal,
  IconAlarm,
  IconAlarmFilled,
  IconArrowDown,
  IconArrowUp,
  IconAt,
  IconBell,
  IconBinaryTree,
  IconBuildingCommunity,
  IconCrosshair,
  IconEye,
  IconFlame,
  IconInbox,
  IconKey,
  IconLayoutColumns,
  IconLayoutList,
  IconLock,
  IconLogout,
  IconPalette,
  IconPlus,
  IconUserCircle,
  IconUsers,
  IconX,
} from '@tabler/icons-react';
import { Popover } from '@mantine/core';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Avatar } from '../../components/Avatar';
import { LanguageChoiceList, LanguageSwitcher } from '../../components/LanguageSwitcher';
import { SkeinTooltip } from '../../components/SkeinTooltip';
import { useAuth } from '../../auth/AuthContext';
import { ThemeToggle } from '../../components/ThemeToggle';
import { DensitySetting } from '../../components/DensitySetting';
import { NavLayoutSetting } from '../../components/NavLayoutSetting';
import { IssueModalViewsSetting } from '../../components/IssueModalViewsSetting';
import { useToaster } from '../../components/Toaster';
import { AppVersionBadge } from '../../components/VersionCheck';
import { SkeinMark } from './SkeinMark';
import { useInspectMode } from '../../lib/useInspectMode';
import { useScrollEdges } from '../../lib/useScrollEdges';
import { useLayoutState } from '../../lib/useLayoutState';
import { useViewLabels } from '../../lib/useWidthMode';
import { TAB_PARAM, updateSearch, type InboxTab } from '../../lib/shellUrlState';
import { carryState, withReveal } from '../../lib/navAddressIntent';
import { useNotificationCounts } from '../../lib/useNotificationCounts';
import { useRingEpoch, useRingingTaskCount } from '../../lib/useReminders';
import { useTasksUiState } from '../../lib/useTasksUiState';
import { useWidthMode } from '../../lib/useWidthMode';
import type { ViewMode } from '../../api/issues';
import {
  CardFieldsSelect,
  FilterSelect,
  ListCardFieldsSelect,
  TreeColumnsSelect,
  kanbanAxisOptions,
} from './TaskFilters';
import { KANBAN_DEFAULT_AXIS } from '../../lib/kanbanBoard';
import { KANBAN_DEFAULT_CARD_FIELDS } from '../../lib/kanbanCardFields';
import { LIST_DEFAULT_CARD_FIELDS } from '../../lib/listCardFields';
import { TREE_DEFAULT_COLUMNS } from '../../lib/treeColumns';

interface BadgeProps {
  label: string;
  count: number;
  /**
   * Address of the queue this badge names — sk-303.13 (T027). The badge
   * is a `<Link>` to it, so the queue can be copied, opened in a new tab
   * and walked back to.
   */
  to: string;
  /**
   * `location.state` to carry through the navigation, so a queue change
   * doesn't drop an in-flight overlay flag (`selfOpenedFile` — sk-405
   * removed the second one, `fromInbox`) held by the current entry.
   */
  state?: unknown;
  /**
   * Glyph rendered at the head of the box, with the count beside it.
   * The queue badges carry NO text label at any width — the label node
   * stays in the DOM (hidden with CSS) purely so nothing depends on it
   * being conditionally rendered; the accessible name comes from the
   * wrapper's `aria-label` ("Inbox 3"), which is authored
   * independently.
   */
  icon: ReactNode;
  /** Hover/focus tooltip copy — instant, no delay (SkeinTooltip). */
  tooltip: string;
  /**
   * Side effect to run on click, on top of the navigation the link
   * performs on its own. Never the only way to reach the destination.
   */
  onClick: () => void;
  /**
   * True when the Queues column is currently showing THIS queue. Paints
   * the badge as the selected one so the header and the column read as
   * one control instead of two places showing the same numbers.
   * `false` on surfaces where the column isn't on screen at all
   * (/activity, settings) — there is no selection to reflect there.
   */
  active?: boolean;
}

/**
 * Header queue badge — one icon carrying its count as a corner chip
 * (a small round plate pinned to the icon's top-right), inside a 44×44
 * box.
 *
 * Visual: the chip is rendered ONLY for a non-zero count. An empty queue
 * shows the bare glyph, dimmed. The rail then reads as "which of these
 * four have news" at a glance, instead of four numbers three of which
 * are 0 — that is the whole point of a notification badge, and it is why
 * the count sits ON the icon rather than beside it.
 *
 * (This reverses an intermediate rendering that printed every value
 * inline, zero included, and distinguished empty by tone and weight.
 * Keep the chip absent at zero; do not "fix" the missing 0.)
 *
 * It is a real `<Link>` at every count, including zero.
 *
 * A LINK and not a button (sk-303.13 / T027): the operation is
 * navigation to an ADDRESSABLE queue, and the element has to say so —
 * assistive tech announces a link, and the browser's own affordances
 * (copy the address, open in a new tab, see where it goes) come back.
 * The click handler is a side effect on top of the navigation, never
 * the only route to the destination.
 *
 * At every count, INCLUDING zero, and that is the one place this differs
 * from the inline text badge T027 replaced: that one dropped to a plain
 * `<span>` when empty, on the reasoning that an empty bucket is not
 * worth a tab stop. It is here, because the number is an UNREAD counter
 * and not the queue's length — Watching counts unread events over a
 * subscription list, Inbox counts unaccepted issues over the whole
 * assignment list. A queue with no chip therefore routinely holds plenty
 * of tasks, so the badge is its entry point at zero exactly as much as
 * at five, and must stay reachable and keyboard-focusable.
 *
 * The aria-label "Inbox 3" is independent of the visible chip, so the
 * announcement carries the number even when nothing is drawn — a screen
 * reader user still hears "Inbox 0".
 */
function QueueBadge({ label, count, to, state, icon, tooltip, onClick, active }: BadgeProps) {
  const isEmpty = count === 0;

  return (
    <SkeinTooltip content={tooltip} position="bottom">
      <Link
        to={to}
        state={state}
        className={[
          'header-badge',
          'header-icon-btn',
          'header-badge-clickable',
          isEmpty ? 'header-badge-empty' : '',
          active ? 'header-badge-active' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        aria-label={`${label} ${count}`}
        // The badge acts as a tab-like selector over the Queues column;
        // `aria-current` is how a screen reader learns which of them
        // the column is showing.
        aria-current={active ? 'true' : undefined}
        onClick={onClick}
      >
        <span className="header-badge-icon" aria-hidden>
          {icon}
        </span>
        <span className="header-badge-label">{label}</span>
        {/* Zero renders NOTHING — an empty bucket carries no chip at all,
            so the rail reads as "these four have news" at a glance
            instead of "here are four numbers, three of which are 0".
            The count still reaches assistive tech through the button's
            aria-label ("Inbox 0"), which is why the chip is aria-hidden:
            aria-label wins over descendant content in the accname
            algorithm, so the name is never "Inbox 5 5". */}
        {isEmpty ? null : (
          <span className="header-badge-chip" aria-hidden>
            {count}
          </span>
        )}
      </Link>
    </SkeinTooltip>
  );
}

/**
 * sk-285.7 T024 — the phone's ONE queue control.
 *
 * Handoff §5 draws the mobile header as "logo · Cards/Tree/Board icons ·
 * one "Queues" button with a total counter · avatar": four 44×44
 * badges do not fit beside the brand and the view switcher on a 390px
 * screen, and four numbers is not what a phone user needs from a header
 * anyway — one "is there anything for me" is.
 *
 * ALWAYS RENDERED, hidden by the stylesheet above the mobile threshold.
 * That is the same shape `.header-badge-label` already uses in this file
 * and the same shape T019 gave the zones: the DOM composition is one
 * fact at every width, and the mode decides what is DRAWN. The
 * alternative — mounting it from a width hook — would put a second
 * answer to "how wide is the window" inside a component that three
 * different roots mount, two of them outside the Shell.
 *
 * The count is the SUM of the badges, and is a sum rather than another
 * number from the server on purpose: it must agree with the ones it
 * replaces, and a separately-fetched total could not be shown to.
 * Like the badges it does NOT follow the global lens — the counts come
 * from the notifications table filtered on `user_id = caller`, so they
 * are caller-scoped by construction (coverage row 30; the same rule
 * `HeaderBar` already applies to the badges and the lens counts).
 *
 * Zero draws no chip, exactly like every other counter on the rail, and
 * the number still reaches assistive tech through `aria-label`.
 */
function QueuesTotalButton({
  total,
  to,
  state,
  onClick,
}: {
  total: number;
  /** The last-selected queue's own address — same shape as a badge's. */
  to: string;
  state?: unknown;
  onClick: () => void;
}) {
  const { t } = useTranslation('header');
  return (
    <SkeinTooltip content={t('queuesTotalTitle')} position="bottom">
      <Link
        to={to}
        state={state}
        className={`header-icon-btn header-queues-total${total === 0 ? ' header-badge-empty' : ''}`}
        aria-label={t('queuesTotalAria', { count: total })}
        onClick={onClick}
      >
        <IconInbox size={20} stroke={1.75} aria-hidden />
        {total === 0 ? null : (
          <span className="header-badge-chip" aria-hidden>
            {total}
          </span>
        )}
      </Link>
    </SkeinTooltip>
  );
}

/**
 * Best-effort scroll-to-top of the active queue list. sk-551.8 (P10) —
 * found by `[data-queue-body]`, which the queue body carries both as the
 * Queues column and as the Queues section (the section is not a
 * `.col-inbox`).
 */
function scrollQueueBodyToTop(): void {
  const el = document.querySelector('[data-queue-body]');
  if (el instanceof HTMLElement) {
    el.scrollTop = 0;
  }
}

/**
 * The header bar is rendered on EVERY page of the app: the main Shell
 * (with full Queues/Projects/Tasks/Details columns), the settings
 * pages and /activity. A queue badge points
 * at a different ADDRESS on each — the current path with `?tab=` swapped
 * in where the column is mounted, and `/?tab=` from a focus page, which
 * has no column to switch. The view switcher has the same two cases for
 * the same reason. This helper distinguishes the two surfaces via the
 * URL pathname.
 *
 * Deny-list rather than allow-list because the Shell owns a family of
 * parameterised routes (`/`, `/issues/:id`, `/projects/:alias`,
 * `/projects/:alias/issues/:id`, `/projects/:alias/components/:cid`…)
 * plus the catch-all redirect to "/", whereas the focus pages are four
 * fixed prefixes. Adding a Shell route must not require editing this.
 * Keep in sync with `src/App.tsx` when a NON-shell route is added.
 *
 * sk-551.8 — /search counts as the shell here, as it always has; with the
 * sections layout active on desktop/tablet `HeaderBar` treats it as a
 * column-less page on top of this answer (see `columnSurface` there).
 */
function isMainShell(pathname: string): boolean {
  if (pathname.startsWith('/settings')) return false;
  if (pathname.startsWith('/login')) return false;
  // /activity is a full-page war-room mounted outside the Shell — it
  // has no Queues column either, so a badge click must navigate.
  if (pathname.startsWith('/activity')) return false;
  return true;
}

/**
 * Numeric count for the "On me" / "Delegated" lens toggles (sk-54).
 *
 * Same idiom as the queue badges above: a corner chip on the glyph, and
 * NOTHING at zero. One rail, one rule — a lens with no chip is simply
 * empty, and the eye can skip it.
 *
 * `aria-hidden` because the parent button already carries an aria-label
 * ("On me 3") announcing the same number — so the count still reaches a
 * screen reader at zero, where nothing is drawn.
 */
function LensCount({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="lens-toggle-count" aria-hidden>
      {count}
    </span>
  );
}

/*
 * sk-411 — the SECOND number that stood inside the Delegated toggle
 * (sk-303.14 T027, US-6: "next to the number of active delegated tasks
 * a second number is shown") is REMOVED: the Delegated toggle
 * shows one number.
 *
 * Gone with it: its tooltip paragraph, the two-number accessible name,
 * the `.lens-toggle-unreviewed` chip styles and `unreviewedBadge()` — the
 * helper that decided «show / hide», which nothing else read.
 *
 * What did NOT go, and is a different surface: the «Unreviewed» chip on
 * the status axis of the filter panel. The decision was for one number in
 * the header, not for the unreviewed set to become unreachable, and that
 * chip is how it stays reachable.
 */

/*
 * sk-404.3 — the one-action JUMP to the unreviewed set that stood here
 * (sk-303.14 T027, `.unreviewed-jump`) is REMOVED: the Delegated
 * button already leads there. It is recorded here rather than deleted
 * silently, so that a bare deletion does not read as a merge loss.
 *
 * The SECOND NUMBER inside the Delegated toggle stays — it is the half
 * that was kept — and the set itself stays reachable through the
 * «Unreviewed» chip on the status axis, which is the entry channel
 * `unreviewedEntry.test.tsx` drives. What went is a shortcut, not a
 * capability. The guard is `HeaderRailNoUnreviewedJump.test.tsx`.
 */

/**
 * sk-62.2 — reminders ("Reminders") lens button. The THIRD lens in the
 * On-me / Delegated group; mutually exclusive with both. The icon is an
 * old-style two-bell alarm clock (`IconAlarm`). When `ringingCount > 0`
 * the whole button enters its "ringing" state:
 *   - the icon shakes violently / "psychotically" (CSS keyframes)
 *   - the badge number blinks + jitters aggressively
 * No sound — pure visual nag. When `ringingCount === 0` the icon is calm
 * and static and the number renders as a dim inline "0" (the same
 * `lens-toggle-count` treatment the other two lenses use when empty) —
 * the alarm keeps its place in the rail's "icon + number" row instead
 * of being the one control with nothing after its glyph.
 *
 * The badge value is `ringingTaskCount` (distinct issues with a ringing
 * reminder), live via SignalR through `useRingingTaskCount`.
 *
 * sk-551.36 — the ring is FINITE: pulse, glow, shake and badge run about
 * ten seconds (iteration counts in `index.css`), then the pill stays in
 * its static ringing look (amber + a still glow). A new alarm going off
 * rings it again, keyed off `ringEpoch` (`useRingEpoch`):
 *   - the icon and badge spans are `key`ed by it, so they remount and
 *     their animations start from zero;
 *   - the BUTTON cannot remount (it may hold focus), so it flips
 *     `data-ring-cycle` between `a` and `b`, and `index.css` swaps each
 *     of its two animation names for an identical copy on `b` — a new
 *     `animation-name` is what restarts a CSS animation in place.
 */
function BudilnikLensButton({
  active,
  ringingCount,
  ringEpoch,
  onClick,
}: {
  active: boolean;
  ringingCount: number;
  ringEpoch: number;
  onClick: () => void;
}) {
  const { t } = useTranslation('header');
  const ringing = ringingCount > 0;
  const Icon = ringing ? IconAlarmFilled : IconAlarm;
  const tooltip = ringing
    ? t('remindersTitleRinging', { count: ringingCount })
    : active
      ? t('remindersTitleActive')
      : t('remindersTitleInactive');
  return (
    <SkeinTooltip content={tooltip} position="bottom">
      <button
        type="button"
        className={[
          'outbox-toggle',
          'lens-toggle',
          'lens-pill',
          'budilnik',
          active ? 'active' : '',
          ringing ? 'ringing' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        aria-pressed={active}
        data-ring-cycle={ringing ? (ringEpoch % 2 === 0 ? 'a' : 'b') : undefined}
        aria-label={
          ringing
            ? t('remindersAriaRinging', { count: ringingCount })
            : t('remindersAria')
        }
        onClick={onClick}
      >
        <span
          key={`icon-${ringEpoch}`}
          className={`budilnik-icon${ringing ? ' shaking' : ''}`}
          aria-hidden
        >
          <Icon size={20} stroke={1.75} />
        </span>
        {/* sk-285.7 T023 — the pill carries its own word, like the other
            two lenses. Before the redesign the rail was icon-only and the
            name lived in the tooltip alone; US-4 asks for the label on
            the control itself. */}
        <span className="lens-pill-label">{t('reminders')}</span>
        {/* Ringing → the loud amber pill that blinks and jitters.
            Calm → nothing at all, same rule as every other counter on
            the rail: a zero draws no chip. The count still reaches
            assistive tech through the button's aria-label. */}
        {ringing ? (
          <span key={`badge-${ringEpoch}`} className="budilnik-badge" aria-hidden>
            {ringingCount}
          </span>
        ) : null}
      </button>
    </SkeinTooltip>
  );
}

/**
 * View switcher — three icon buttons in the rail, one per layout of the
 * Tasks column.
 *
 * Moved out of the filter panel deliberately. The panel narrows the SET
 * of tasks (who, what status, which project); the view decides the SHAPE
 * they are drawn in. Two different questions, and only one of them was
 * worth a click through a collapsed panel: changing the layout is a
 * frequent, exploratory action, and burying it two clicks deep made the
 * board feel like a setting rather than a place.
 *
 * Icons rather than a select: three fixed options fit the rail's own
 * idiom (44×44 targets, instant tooltips) and cost one click instead of
 * two. The active one is pressed — `aria-pressed` carries that to a
 * screen reader, which a select's value would not.
 *
 * sk-285.6.17 — the header is on every page, including the focus pages
 * (/settings/*, /activity) where there is no Tasks column at
 * all. There the click used to set `view` and stop: the button went
 * pressed and nothing else happened, so it read as a dead control. This
 * is the SAME situation `goToSidebarTab` already resolves for the queue
 * badges, resolved the same way — set the state, then leave the focus
 * page for the shell that can show it. Order matters: `setView` persists
 * synchronously, so the freshly-mounted shell reads the new value even
 * though this provider unmounts in the same commit.
 */
function ViewSwitch() {
  // Labels live in the `filters` namespace: these controls were moved
  // out of the filter panel, and their strings stayed where they were
  // rather than being duplicated under a second namespace.
  const { t } = useTranslation('filters');
  const ui = useTasksUiState();
  const navigate = useNavigate();
  const location = useLocation();
  // sk-404.2 — the words are drawn from `VIEW_LABELS_MIN_PX` upward and
  // not below it. See the constant for the measurement.
  const showLabels = useViewLabels();

  const pick = (value: ViewMode) => {
    ui.setView(value);
    if (!isMainShell(location.pathname)) {
      navigate('/');
    }
  };

  const MODES: ReadonlyArray<{ value: ViewMode; icon: ReactNode; title: string }> = [
    { value: 'cards', icon: <IconLayoutList size={20} stroke={1.75} aria-hidden />, title: t('view.cardsTitle') },
    { value: 'tree', icon: <IconBinaryTree size={20} stroke={1.75} aria-hidden />, title: t('view.treeTitle') },
    { value: 'kanban', icon: <IconLayoutColumns size={20} stroke={1.75} aria-hidden />, title: t('view.kanbanTitle') },
  ];

  return (
    <div className="header-viewswitch" role="group" aria-label={t('labels.view')}>
      {MODES.map((m) => (
        <SkeinTooltip key={m.value} content={m.title} position="bottom">
          <button
            type="button"
            className={
              `header-icon-btn header-view-btn`
              + `${showLabels ? ' header-view-btn-labelled' : ''}`
              + `${ui.view === m.value ? ' active' : ''}`
            }
            aria-label={`${t('labels.view')}: ${t(`view.${m.value}`)}`}
            aria-pressed={ui.view === m.value}
            onClick={() => pick(m.value)}
          >
            {m.icon}
            {/* sk-404.2 — the word, back on the maintainers' instruction
                ("no labels in the List / tree / kanban choice") and
                gated on a MEASURED width.

                handoff §6 draws the member as "icon 20 + label
                14/500»; sk-285.7.8 shipped that, and sk-285.7.9 took
                the word off again after measuring it at the app's own
                floor: labelled, the segment costs ~126px more, the
                brand's `minmax(0, 1fr)` track is the only one that can
                yield, and at 1284 it has nothing left — «SKEIN» came
                out cut in half. That measurement did not expire; what
                changed is that the words are no longer all-or-nothing.

                Re-measured on the running app at the floor after
                sk-404.3 freed the rail of the unreviewed jump: rail
                964.2, brand track 131.8 against a mark that needs 82.
                49.8px of slack against the 126 the words want — still
                76 short, so «just put them back» would reproduce the
                very defect they were removed for.

                So they are drawn from `VIEW_LABELS_MIN_PX` upward and
                nowhere else, and the member keeps its accessible name
                in both states — the word was never the name.

                Not `display: none` on the label: a hidden word still
                reserves nothing, but a rendered one the sheet hides
                would leave the DOM claiming a control that is not
                there. The branch is in the markup, where the reader
                can see it. */}
            {showLabels ? (
              <span className="header-view-btn-label">{t(`view.${m.value}`)}</span>
            ) : null}
          </button>
        </SkeinTooltip>
      ))}
    </div>
  );
}

/**
 * View settings — the knobs that shape HOW the Tasks column draws, behind
 * one rail button.
 *
 * Holds the board's two shape knobs — column axis and card properties —
 * which appear only in board mode, and (sk-285.2.19) the tree table's
 * column set, which appears only in tree mode, the same way the dep-type
 * lens only appears in tree mode. Each view sees the knobs that shape
 * IT; the sets behind them are stored separately, so nothing a user
 * changes in one view moves in another.
 *
 * SORT deliberately stayed in the filter panel: during a search the key
 * is an ephemeral 'relevance' overlay owned by `useTaskSearchModes`,
 * which lives inside TasksColumn — below this header in the tree. Moving
 * the control up here would have silently dropped that behaviour.
 *
 * ── Why a popover and not the knobs inline in the rail (sk-364) ──────
 *
 * RE-MEASURED on a live Chromium at the current floor. The previous
 * version of this note carried a measurement taken at the floor as it
 * then was (1240px) — "~413px of slack against roughly 450px for three
 * labelled selects" — and T009's floor raise turned that into ~457px by
 * ARITHMETIC, which T009 flagged as a derivation rather than a reading
 * and asked to be replaced. It is replaced here, and both halves of the
 * old premise turn out to be obsolete rather than merely close.
 *
 * Method: dev server, both viewports, `.header-controls` widened one px
 * at a time until the brand's `minmax(0, 1fr)` track is pushed below the
 * wordmark's own `min-content`. That threshold is the definition of
 * "slack" used here — the point where the one element that yields first
 * starts losing letters. Control widths are each control's `max-content`
 * width, cloned out of the open panel so the panel's 560px clamp does
 * not shrink the reading.
 *
 *   floor 1284: grid tracks 96.3 / 142 / 999.7, wordmark 88.3 against a
 *               83.4 min-content  →  RAIL SLACK 6px
 *   at   1440: tracks 252.3 / 142 / 999.7                →  162px
 *
 * Six pixels, not 457. The number did not move by the +44 of the floor
 * raise because the floor is not what changed: T007 and T021 spent the
 * rail on the lens pills and the labelled view segment, so the rail now
 * ends where the wordmark begins. (The 999.7px controls track measures
 * identical at both viewports — the rail is content-sized, and it is the
 * brand's track that absorbs the difference.)
 *
 * And the controls are nothing like "roughly 450px for three":
 *
 *   Columns (board axis)   228px      Table columns (tree)   296px
 *   Card properties        416px      Card attributes        801px
 *
 * Two of those are multi-line attribute pickers — 98.6px and 153.6px
 * tall — which a 44px rail cannot host at any width, quite apart from
 * the horizontal budget.
 *
 * So the decision stands, and now on numbers that say why: the popover
 * is not winning by a margin, it is the only option at the floor. One
 * 44px button costs 44px; the panel is 560px wide and as tall as it
 * needs to be. Behaviour was deliberately NOT touched by sk-364 — the
 * task was the fact, not a redesign. Reopening the question means
 * finding slack that does not exist at 1284, so it would have to start
 * by taking width back from the lens pills or the view segment.
 */
function ViewSettings() {
  // Labels live in the `filters` namespace: these controls were moved
  // out of the filter panel, and their strings stayed where they were
  // rather than being duplicated under a second namespace.
  const { t } = useTranslation('filters');
  const ui = useTasksUiState();
  const [open, setOpen] = useState(false);
  /**
   * The attribute picker of whichever view is on. Exactly one of the
   * three is mounted at a time (they are gated on `ui.view`), so one ref
   * addresses "this panel's picker" without a per-view branch.
   */
  const attrFieldRef = useRef<HTMLInputElement | null>(null);

  const isBoard = ui.view === 'kanban';
  const isTree = ui.view === 'tree';
  // Cards view had NO knob at all until now: opening «View settings» in
  // the list showed an empty panel, which reads as a broken control
  // rather than as "nothing to configure here". It gets the same
  // «which fields» switch list the other two views have, under its own
  // key — see `lib/listCardFields.ts`.
  const isList = ui.view === 'cards';

  /**
   * sk-285.7.11 (VS4) — «Reset to default» puts THIS view's knobs back to
   * the constants the app ships with, and touches nothing else. Scoped
   * that way because the three sets are stored under three keys on
   * purpose (`useTasksUiState`): a reset that also cleared the board's
   * card properties while you were looking at the tree would be a
   * destructive surprise, and the footer sentence beside the button says
   * the panel's reach is the current view.
   */
  const resetCurrentView = () => {
    if (isBoard) {
      ui.setKanbanAxis(KANBAN_DEFAULT_AXIS);
      ui.setKanbanCardFields(new Set(KANBAN_DEFAULT_CARD_FIELDS));
    }
    if (isTree) ui.setTreeColumns(new Set(TREE_DEFAULT_COLUMNS));
    if (isList) ui.setListCardFields(new Set(LIST_DEFAULT_CARD_FIELDS));
  };

  return (
    <Popover
      opened={open}
      onChange={setOpen}
      position="bottom-end"
      withArrow
      shadow="md"
      /* sk-285.7.11 (VS1) — §6: «View settings 560px». The stylesheet
         has said 560 since T030 and the panel still measured 799.2:
         Mantine writes `width: max-content` as an INLINE style on the
         dropdown, and an inline declaration beats a class no matter what
         the class says. So the number has to be handed to the component
         that writes that style, not to the sheet it overrides. The CSS
         rule stays as the panel's own statement of its width (and its
         `max-width` clamp); this prop is what makes it true. */
      width={560}
    >
      <Popover.Target>
        <span className="header-viewsettings-anchor">
          <SkeinTooltip content={t('labels.viewSettings')} position="bottom">
            <button
              type="button"
              className="header-icon-btn"
              aria-label={t('labels.viewSettings')}
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              <IconAdjustmentsHorizontal size={20} stroke={1.75} aria-hidden />
            </button>
          </SkeinTooltip>
        </span>
      </Popover.Target>
      <Popover.Dropdown className="header-viewsettings-panel">
        {/* sk-285.7.11 (VS5) — the panel's own close control. The artboard
            draws one; the panel shipped with none, so the only ways out
            were Esc and a click on the app behind it — both invisible.
            Redundant with those two on purpose: a visible way out is what
            makes a floating panel readable as dismissible at all. */}
        <div className="viewsettings-head">
          <h2 className="viewsettings-title">{t('labels.viewSettings')}</h2>
          <button
            type="button"
            className="viewsettings-close"
            aria-label={t('viewSettings.close')}
            onClick={() => setOpen(false)}
          >
            <IconX size={20} stroke={1.75} aria-hidden />
          </button>
        </div>
        {isBoard ? (
          <FilterSelect
            label={t('labels.kanbanAxis')}
            value={ui.kanbanAxis}
            options={kanbanAxisOptions(t)}
            onChange={ui.setKanbanAxis}
          />
        ) : null}
        {isBoard ? (
          <CardFieldsSelect
            axis={ui.kanbanAxis}
            value={ui.kanbanCardFields}
            onChange={ui.setKanbanCardFields}
            inputRef={attrFieldRef}
          />
        ) : null}
        {/* sk-285.2.19 — the tree's columns, gated on tree view exactly
            as the board's two knobs are gated on board view. The set is
            persisted under its own key, so flipping columns here leaves
            the board's card properties alone and vice versa. */}
        {isTree ? (
          <TreeColumnsSelect
            value={ui.treeColumns}
            onChange={ui.setTreeColumns}
            inputRef={attrFieldRef}
          />
        ) : null}
        {/* The list's attributes, gated on cards view exactly as the
            other two pickers are gated on the views they shape. Its own
            key again, so narrowing the list leaves the board and the
            tree where they were. */}
        {isList ? (
          <ListCardFieldsSelect
            value={ui.listCardFields}
            onChange={ui.setListCardFields}
            inputRef={attrFieldRef}
          />
        ) : null}

        {/* sk-285.7.11 (VS3) — the artboard's dashed «+ Add attribute».
            It opens the same picker the field above opens; the chip
            exists because a row of chips with a ✕ on each states how to
            REMOVE an attribute and says nothing about adding one.

            ⚠ The artboard draws it INLINE, as the last chip in the row.
            Mantine's `MultiSelect` renders the pill list itself and
            exposes no slot to append to it, so the chip sits under the
            field instead of inside it. Putting it inside would mean
            hand-building the control out of `Combobox` + `PillsInput` —
            and that control is shared with the Tree and Board passes,
            i.e. not this pass's surface to rewrite. The difference is one
            line of vertical placement; the affordance is real either way
            (it focuses and opens the actual field, no simulation). */}
        <button
          type="button"
          className="viewsettings-add"
          onClick={() => {
            const field = attrFieldRef.current;
            if (!field) return;
            field.focus();
            field.click();
          }}
        >
          <IconPlus size={16} stroke={1.75} aria-hidden />
          {t('viewSettings.addAttribute')}
        </button>

        {/* sk-285.7.11 (VS4) — the footer the artboard rules off at the
            bottom: what this panel's reach is, and the way back to the
            shipped set. Both were missing, and the second one mattered:
            once a user had switched five attributes off there was no way
            to find out what the default had been. */}
        <div className="viewsettings-footer">
          <span className="viewsettings-scope">{t('viewSettings.scope')}</span>
          <button type="button" className="viewsettings-reset" onClick={resetCurrentView}>
            {t('viewSettings.reset')}
          </button>
        </div>
      </Popover.Dropdown>
    </Popover>
  );
}

/**
 * Top header bar for the new Shell.
 *
 * sk-285.1.18.5 — the hamburger is gone. The brand sits alone on the
 * left, EVERYTHING else is pushed right and split into groups by thin
 * vertical rules:
 *
 *   [SKEIN] ─spacer─ │ ✉5 @3 ◉0 │ ↓7 ↑1 ⏰0 │ [🔥 HOT ZONE] │ ⌖ │ (admin)
 *
 *   • three queue badges (Inbox / Mentions / Watching) — icon + corner
 *     chip, each a `<Link>` to that queue's own address. There was a
 *     fourth, Outbox; sk-303.13 / US-9 removed the surface behind it —
 *     it was a third, event-shaped view of what the Delegated lens
 *     already counts as tasks. The LENS of that name stays, in the next
 *     group down;
 *   • three lens toggles (On me / Delegated / Reminders) — back OUT of
 *     the drawer, icon + inline count on the same rule as the queues,
 *     driving the real `useLayoutState` lenses;
 *   • HOT ZONE — the ONE full-size labelled button in the rail (icon +
 *     text), a single hop to /activity, no menu behind it. Repainted on
 *     theme tokens: the old vertical fire gradient, flame silhouette,
 *     text-shadow and letter-spacing were hardcoded hex outside the
 *     token catalog and are gone (the activity PAGE keeps its own
 *     deliberately theme-independent hero — see themeTokens.ts);
 *   • Inspect — a standalone icon again (sk-285.1.18.1 had folded it
 *     into the Settings list; that decision is explicitly reverted).
 *     Its `data-inspect-toggle` anchor is unchanged, so the
 *     capture-phase click handler in `useInspectMode` still lets its
 *     own toggle click through instead of swallowing it;
 *   • the UI language — a flag-only 44px button (sk-285.6.15), out of
 *     the account menu and into the rail beside the avatar;
 *   • the avatar — last in the rail, opening the account menu that
 *     holds identity + Logout, the theme switcher and the Settings
 *     links.
 *
 * Every icon carries an instant SkeinTooltip (0ms open, per
 * the project guidelines, Tooltips) and an aria-label; no control in the
 * rail relies on a native `title`.
 *
 * Geometry: every icon control is `--tap-target` (44px) tall and at
 * least that wide — Inspect and the avatar are exact squares, the seven
 * counted controls floor their width and grow with the digits (52px at
 * one digit, ~59px at two). Neighbours sit `--space-2` (8px) apart as
 * laid-out flex boxes, so hit areas cannot overlap at any count, even
 * while the ringing Reminders scales to 1.09 (2.4px of overhang per
 * side against 8px of clearance). See the `.header-icon-btn` /
 * `.header-counted-btn` blocks in index.css.
 *
 * Counts come from `useNotificationCounts()` — TanStack Query hook
 * backed by `GET /api/v1/me/notification-counts` (B6). Refetches on
 * window focus, every 30s, and on every project-scoped SignalR event
 * routed through `liveEventInvalidation.ts`.
 *
 * sk-303.13 (T027) — each queue has an ADDRESS, and the badge is a link
 * to it. They share one destination shape, the left column's own tab:
 *   - on the main shell → the current path with `?tab=<queue>` swapped
 *     in, every other parameter (`?file=`, `?lens=`, …) left alone;
 *   - from a focus page (`/settings/*`), where the column isn't mounted
 *     → `/?tab=<queue>`. The freshly-mounted shell reads the parameter
 *     and expands the column for it — a link to a tab must not open it
 *     invisible.
 *
 * The click handler adds only what an address cannot say: expand the
 * column and scroll it to the top when the shell is already mounted
 * (re-clicking the tab you are on doesn't change the URL, so nothing
 * would react to it otherwise).
 *
 * Unlike the inline text badges this replaced, an EMPTY badge is still
 * a link — see `QueueBadge`: the chip counts unread, not queue length.
 */
export function HeaderBar() {
  const { t } = useTranslation('header');
  const { t: tCommon } = useTranslation('common');
  const { user, logout } = useAuth();
  const {
    outboxMode,
    toggleOutboxMode,
    onMeMode,
    toggleOnMeMode,
    budilnikMode,
    toggleBudilnikMode,
    inboxCollapsed,
    setInboxCollapsed,
    inboxTab,
    setActiveZone,
    navLayout,
    reportNavGesture,
  } = useLayoutState();
  const { counts } = useNotificationCounts();
  const ringingTaskCount = useRingingTaskCount();
  const ringEpoch = useRingEpoch();
  const toast = useToaster();
  const location = useLocation();
  const inspectMode = useInspectMode();
  const [menuOpen, setMenuOpen] = useState(false);
  /**
   * sk-285.7.7 — the account menu is the phone's ONLY menu surface, and
   * two rail controls fall back into it there. `useWidthMode` is a
   * subscription to `matchMedia`, so mounting a second one costs two
   * listeners and writes the same attribute the first one writes; the
   * alternative was threading a prop through all three of this
   * component's mounting roots, none of which passes it any today.
   */
  const mobile = useWidthMode() === 'mobile';

  /**
   * The avatar, so a menu row that changes STATE can hand focus back
   * before the row it lives in is torn down.
   *
   * The menu's own docblock explains why it does not use Mantine's
   * `returnFocus`: every entry it had either navigated or left the page,
   * and neither loses focus. The language rows are the first entries
   * that do NEITHER — they flip a setting and close the menu — so the
   * pressed row is unmounted and `document.activeElement` falls back to
   * `<body>`. That is the exact regression `LanguageSwitcher` records
   * against its own `anchorRef`, and the repair is the same one, applied
   * to the same case rather than to every close.
   */
  const userAnchorRef = useRef<HTMLSpanElement>(null);

  /**
   * sk-285.7.2.76 (audit W-1, W-2) — the rail is a scroll container, and
   * on a tablet it really scrolls: at 768 it holds 712px of controls in
   * 498px of track, so HOT ZONE, Inspect, the language switch and the
   * account menu rest past its right edge. Panning reaches them; nothing
   * on screen said they were there.
   *
   * The state is MEASURED rather than derived from the width mode. Two
   * reasons, and the second is the load-bearing one: INV-6 forbids a
   * width condition in an at-rule below the floor, and the band where
   * the rail overflows (768…~982) is not the tablet band anyway — from
   * ~1000 up the same mode has nothing hidden. A mode-keyed fade would
   * be wrong on a third of its own range; an overflow-keyed one is right
   * on all of it, this rail included whenever a future control lands in
   * it.
   */
  const railRef = useRef<HTMLDivElement>(null);
  const railEdges = useScrollEdges(railRef);

  const closeMenu = () => setMenuOpen(false);
  const closeMenuReturningFocus = () => {
    userAnchorRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    setMenuOpen(false);
  };
  const username = user?.username ?? t('common:unknown');

  // logout is async — its rejection used to be silently swallowed via
  // `void logout()`, which left the UI claiming "logged in" while
  // tokens may have been partially cleared. Surface failures via toast
  // so users know to retry.
  const handleLogout = async () => {
    try {
      await logout();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t('logoutFailed');
      toast.error(message);
    }
  };

  const onMainShell = isMainShell(location.pathname);
  // sk-551.8 (US-12) — with the sections layout active on desktop/tablet,
  // /search is a page WITHOUT the navigation column: a badge there leads
  // into the task shell with a reveal by address. On a phone the sum
  // button off the shell goes where it always went and writes nothing,
  // and with side-by-side active /search behaves as it always has.
  const sectionsLayout = navLayout === 'sections';
  const onSearch = location.pathname.startsWith('/search');
  const columnSurface = onMainShell && !(sectionsLayout && onSearch && !mobile);

  /**
   * The address of one queue — what the badge LINKS to.
   *
   * On the main shell the column is already mounted, so only the `tab`
   * parameter moves: same path, same `?file=` / `?lens=` / anything a
   * later feature adds. On a focus page (`/settings/*`) the column
   * isn't there at all, so the destination is the shell root
   * carrying the tab — the address has to name the queue, not rely on
   * local state to restore it after the jump.
   */
  const tabHref = (tab: InboxTab): string =>
    columnSurface
      ? `${location.pathname}${updateSearch(location.search, { [TAB_PARAM]: tab })}`
      : `/?${TAB_PARAM}=${tab}`;

  /**
   * Click side effect, on top of the navigation the link does itself:
   * expand the column if the user had collapsed it and scroll its body
   * back to the top. Only meaningful where the column is mounted — on a
   * focus page the freshly-mounted shell expands for `?tab=` on its own.
   *
   * This cannot be folded into the address: clicking the tab you are
   * already on lands on the same URL, so nothing downstream re-runs,
   * and a collapsed column would stay collapsed.
   */
  const expandSidebar = () => {
    if (!columnSurface) return;
    if (sectionsLayout) {
      // sk-551.8 — on a phone the sum button opens the Queues sheet and
      // writes nothing, in either layout's record ("Scope", US-9/12).
      if (mobile) {
        setActiveZone('queues');
        scrollQueueBodyToTop();
        return;
      }
      // Desktop/tablet with the sections column on screen: a GESTURE of
      // the person (not a reveal by address) — the fold rules open the
      // column and the Queues section and, on a board or tree, record
      // the sections opt-out; during a shared file they only keep the
      // temporary picture. The link itself selects the queue.
      reportNavGesture({ type: 'gestureExpand', via: 'badge' });
      scrollQueueBodyToTop();
      return;
    }
    if (inboxCollapsed) {
      setInboxCollapsed(false);
    }
    // sk-285.7 T024 — and SHOW the Queues zone. Unfolding the column is
    // enough on a desktop, where all four zones are on screen at once;
    // on a phone exactly one zone is drawn, so a handler that only
    // unfolded a hidden column would leave the user looking at the same
    // screen they clicked from. Written at every width — above the
    // mobile threshold `data-active-zone` is simply not read (see
    // `Shell.tsx`), so this costs desktop nothing and removes the mode
    // branch that would otherwise have to live in this handler.
    setActiveZone('queues');
    scrollQueueBodyToTop();
  };

  // `location.state` rides along only on the main shell, where the tab
  // change is a move within the same entry's context (`selfOpenedFile`
  // must survive it). Leaving a focus page for `/` is a real departure
  // — the flag belongs to the page we are leaving.
  //
  // sk-551.8 (P12) — carried without a stale one-shot reveal mark
  // (`carryState`); a column-less page in the sections layout plants a
  // fresh one instead (`withReveal`), so the shell it opens reveals the
  // queue by address — without an opt-out.
  // The nonce is minted once per history entry, not on every render.
  const revealState = useMemo(
    () => (sectionsLayout && !columnSurface ? withReveal(undefined) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [location.key, sectionsLayout, columnSurface],
  );
  const badgeState = columnSurface ? carryState(location.state) ?? undefined : revealState;

  // Which badge reads as "selected". Only on the main shell, where the
  // Queues column is actually on screen showing that queue — on a focus
  // page the persisted `inboxTab` is a stored preference, not a visible
  // selection, and painting it would claim a state the user can't see.
  const shellSurface = columnSurface;
  const activeQueue = shellSurface ? inboxTab : null;

  return (
    <header className="header-bar">
      {/* Skein brand + click-home affordance. NOT an <h1> — settings
          pages emit their own <h1 class="settings-title">Settings</h1>,
          and two h1s on one document confuses screen-reader outline
          navigation. The page-level heading is provided by the
          surface (Shell main view, SettingsLayout, …); the brand
          here is chrome.

          sk-285.2.24 — the mark replaced the ░▒▓ ASCII wings that used
          to flank the word. It is the SAME yarn ball the browser shows
          in the tab (`public/favicon.svg`), drawn inline rather than
          fetched; `SkeinMark.tsx` explains why. Decorative: the link's
          own `aria-label` is the accessible name, and the mark is
          `aria-hidden`. */}
      <span className="header-logo">
        <Link to="/" className="header-logo-link" aria-label={t('brandAria')}>
          <SkeinMark />
          {/* The word is an ELEMENT and not a bare text node because the
              cap trim below it (`text-box`, .header-logo-word) is not an
              inherited property: on a raw text node it would land in an
              anonymous flex item the sheet cannot name, and measured on
              the running header it changed nothing. */}
          <span className="header-logo-word">SKEIN</span>
        </Link>
      </span>

      {/* The view switcher sits HERE, between the brand and the rail,
          because it is the header's middle column — see the
          `.header-bar` grid in index.css. It used to live inside
          `.header-controls`, where its position was whatever the widths
          of the queue badges, the lenses and the HOT ZONE button left
          it: it drifted every time a neighbouring group changed size.
          As the middle track of a three-track grid whose two side
          tracks are equal it is centred on the HEADER, and stays there
          however wide the brand on its left or the rail on its right
          become. Do NOT move it back into `.header-controls`. */}
      <ViewSwitch />

      {/* Everything below is the right-hand control rail: four groups
          separated by hairline rules, all flush right.

          `data-pan-start` / `data-pan-end` say whether content is
          currently hidden past each edge; the stylesheet fades the
          matching edge so a rail with more behind it never rests looking
          like a rail without. Written only when true — an attribute
          present with `"false"` would still match `[data-pan-end]`, and
          the next reader would have to know which spelling the CSS
          used. */}
      <div
        className="header-controls"
        ref={railRef}
        data-pan-start={railEdges.start ? 'true' : undefined}
        data-pan-end={railEdges.end ? 'true' : undefined}
      >
        {/* T024 — the phone's single queue control, first in the rail so
            that on mobile (where everything between it and the avatar is
            hidden) the row reads logo · views · Queues · avatar, which is
            the order handoff §5 draws. Above the mobile threshold the
            stylesheet hides THIS one instead and the badges below take
            over. */}
        <QueuesTotalButton
          total={counts.inbox + counts.mentions + counts.watching}
          to={tabHref(inboxTab)}
          state={badgeState}
          onClick={expandSidebar}
        />
        <nav className="header-group header-queues" aria-label={t('queuesAria')}>
          <QueueBadge
            label={t('badges.inbox')}
            count={counts.inbox}
            to={tabHref('inbox')}
            state={badgeState}
            icon={<IconInbox size={20} stroke={1.75} />}
            tooltip={t('badgeTitles.inbox')}
            onClick={expandSidebar}
            active={activeQueue === 'inbox'}
          />
          {/* sk-303.13 / US-9 — no Outbox badge: the queue behind it is
              gone (see `InboxColumn`). The Delegated LENS of the same
              name is in the next group down and is a different thing. */}
          <QueueBadge
            label={t('badges.mentions')}
            count={counts.mentions}
            to={tabHref('mentions')}
            state={badgeState}
            icon={<IconAt size={20} stroke={1.75} />}
            tooltip={t('badgeTitles.mentions')}
            onClick={expandSidebar}
            active={activeQueue === 'mentions'}
          />
          <QueueBadge
            label={t('badges.watching')}
            count={counts.watching}
            to={tabHref('watching')}
            state={badgeState}
            icon={<IconEye size={20} stroke={1.75} />}
            tooltip={t('badgeTitles.watching')}
            onClick={expandSidebar}
            active={activeQueue === 'watching'}
          />
        </nav>

        <span className="header-divider" aria-hidden="true" />

        {/* The three lenses re-filter every column behind the header.
            Icon-only, but each one is the same real toggle the drawer
            hosted — same `useLayoutState` setters, same aria-pressed. */}
        <div className="header-group header-lenses" role="group" aria-label={t('lenses')}>
          <SkeinTooltip content={t('onMeTitle')} position="bottom">
            <button
              type="button"
              className={`outbox-toggle lens-toggle lens-pill on-me${onMeMode ? ' active' : ''}`}
              aria-pressed={onMeMode}
              aria-label={`${t('onMe')} ${counts.onMeOpenCount}`}
              onClick={toggleOnMeMode}
            >
              <IconArrowDown size={20} stroke={1.75} aria-hidden />
              <span className="lens-pill-label">{t('onMe')}</span>
              <LensCount count={counts.onMeOpenCount} />
            </button>
          </SkeinTooltip>

          <SkeinTooltip
            content={outboxMode ? t('delegatedTitleOn') : t('delegatedTitleOff')}
            position="bottom"
          >
            <button
              type="button"
              className={`outbox-toggle lens-toggle lens-pill delegated${outboxMode ? ' active' : ''}`}
              aria-pressed={outboxMode}
              aria-label={`${t('delegated')} ${counts.delegatedOpenCount}`}
              onClick={toggleOutboxMode}
            >
              <IconArrowUp size={20} stroke={1.75} aria-hidden />
              <span className="lens-pill-label">{t('delegated')}</span>
              <LensCount count={counts.delegatedOpenCount} />
            </button>
          </SkeinTooltip>

          {/* sk-62.2 — Reminders lens (third in the group, mutually
              exclusive with On me / Delegated). Alarm-clock icon shakes +
              badge blinks when reminders are ringing. */}
          <BudilnikLensButton
            active={budilnikMode}
            ringingCount={ringingTaskCount}
            ringEpoch={ringEpoch}
            onClick={toggleBudilnikMode}
          />
        </div>

        <span className="header-divider" aria-hidden="true" />

        {/* Stage 2 — the knobs that shape the Tasks column. The panel
            narrows WHICH tasks; this picks HOW they are drawn. The view
            SWITCHER that used to stand here moved out of the rail
            entirely — it is the header's centred middle column now (see
            above); only its settings popover stays in the rail, where
            every other icon control lives. */}
        <ViewSettings />

        {/* sk-285.7.9 — no divider here, and none after HOT ZONE or
         * Inspect either. §6 draws the rail with exactly TWO: "queues …
         * · separator · lenses … · separator · View settings 44×44 ·
         * HOT ZONE … · Inspect 44×44 · language … · avatar". The rail had
         * five, so the last three groups were being separated from each
         * other when the package separates only the two CLUSTERS
         * (queues, lenses) from the single controls that follow them.
         *
         * Measured: the three cost 27px of rail (1007.7 → 980.7 at the
         * floor), because each one is 1px of rule plus one 8px flex gap.
         * That is why they are named in sk-285.7.9 — they are the only
         * §6-derivable width in the rail, and the segment labels needed
         * far more than they could give. They are removed here on their
         * own merit (§6 draws two) rather than as a failed down-payment
         * on the labels. */}

        {/* sk-17 — Activity dashboard. The one labelled button in the
            rail: a single hop to /activity, no dropdown. */}
        <SkeinTooltip content={t('hotZoneAria')} position="bottom">
          <Link to="/activity" className="header-hotzone" aria-label={t('hotZoneAria')}>
            {/* sk-285.7.8 (H13) — 16, not 20. §8's scale is "16 inline in
                text and inside chips · 20 in controls · 24 in empty
                states", and the artboard picks 16 for this glyph
                (`<i class="ti ti-flame" style="font-size:16px">`) while
                giving every other rail control 20. The pill is the chip
                case: a 36px stadium around a 12px word, where a 20px
                flame is taller than the text it leads. */}
            <IconFlame size={16} stroke={1.75} aria-hidden />
            <span className="header-hotzone-label">{t('hotZone')}</span>
          </Link>
        </SkeinTooltip>

        {/* sk-285.7.9 — see the note above ViewSettings: §6 draws two
         * dividers, and both of them are already behind us. */}

        {/* sk-10.3 — Inspect. Click → arm. Click any element in the
         *  shell → POST {selector, parents, tokens, computedStyle} to
         *  /api/v1/me/theme/inspect so the MCP agent (in a paired chat
         *  session) knows what the user wants edited. Esc cancels.
         *
         *  sk-285.1.18.5 reverts sk-285.1.18.1: it is a standalone
         *  header icon again rather than a Settings-menu row.
         *
         *  `data-inspect-toggle` is the contract useInspectMode uses
         *  to recognise its own toggle and let the click through
         *  (see useInspectMode.ts). It is a stable hook, unlike the
         *  aria-label the selector used to match — the label has
         *  already moved with the control twice. */}
        <SkeinTooltip
          content={
            inspectMode.enabled ? t('inspectTitleArmed') : t('inspectTitleIdle')
          }
          position="bottom"
        >
          <button
            type="button"
            className="header-icon-btn header-inspect-btn"
            data-inspect-toggle=""
            aria-label={t('inspectAria')}
            aria-pressed={inspectMode.enabled}
            onClick={inspectMode.toggle}
          >
            <IconCrosshair size={20} stroke={1.75} aria-hidden />
          </button>
        </SkeinTooltip>

        {/* sk-285.7.9 — no divider: §6's two are spent (see ViewSettings). */}

        {/* sk-285.6.15 — UI language, a flag-only 44px control immediately
            before the avatar. It was a section INSIDE the account menu
            (a heading and two labelled buttons); it is a rail control
            now, in the same cluster as the avatar because both are about
            "me and this device" rather than about the tasks behind the
            header. No divider between the two for the same reason. */}
        <LanguageSwitcher />

        {/* Account menu. Mantine Popover gives Esc-to-close and
            click-outside-to-close by default, and a focus trap while
            open from the `trapFocus` below.
            NOT focus return: Mantine's `returnFocus` defaults to FALSE
            (@mantine/core Popover defaultProps), so nothing here puts
            focus back on the avatar. It is not missed on this menu —
            every entry either navigates (the Settings links) or leaves
            the page (Logout — and when logout FAILS it leaves the menu,
            and the focused button, exactly where they were).
            The language control next door has no such landing and
            returns focus explicitly; see `LanguageSwitcher`.
            The target is a <span> wrapper rather than the button itself
            because the button is already cloned by SkeinTooltip (which
            claims its ref); the wrapper keeps both the popover anchor
            and the instant tooltip working on the same control. */}
        <Popover
          opened={menuOpen}
          onChange={setMenuOpen}
          position="bottom-end"
          offset={6}
          withinPortal
          trapFocus
          transitionProps={{ duration: 0 }}
        >
          <Popover.Target>
            <span className="header-user-anchor" ref={userAnchorRef}>
              {/* sk-551.8 D1 — Esc closes the menu and returns focus here
                  in the same keystroke (Mantine's dropdown does it
                  synchronously); the tooltip opens on that focus and would
                  swallow the Esc before the shell closes the open task.
                  So this one tooltip lets Escape pass. */}
              <SkeinTooltip
                content={t('accountMenu', { user: username })}
                position="bottom"
                escapePassesThrough
              >
                <button
                  type="button"
                  className="header-icon-btn header-user-btn"
                  aria-label={t('accountMenu', { user: username })}
                  aria-haspopup="dialog"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((v) => !v)}
                >
                  {/* sk-285.7.8 (H15) — 32px square at r8, the size §6
                      names for the rail's account chip ("avatar 32px
                      square r8") and §8 names for every square avatar.
                      It shipped at `md` — 26px, sharp-cornered — so the
                      chip read as a sticker rather than as a control's
                      face. The chip's COLOURS (the per-user ember
                      palette and the `--skein-fg` initials) are sk-371's
                      and are untouched here. */}
                  <Avatar username={username} userId={user?.id} size="header" title={null} />
                </button>
              </SkeinTooltip>
            </span>
          </Popover.Target>

          <Popover.Dropdown className="header-user-menu">
            <div className="header-menu">
              {/* sk-285.7.11 (AM1/AM2) — the identity row the artboard
                  draws: a 40px chip (§6 "header with avatar 40"; it shipped
                  at 26 and sharp-cornered) beside TWO lines. The e-mail
                  is the second one, and it is not decoration: the name
                  alone does not say WHICH account you are in, and this
                  menu is the only place in the shell that can answer it.
                  The chip's colours are sk-371's and are untouched. */}
              <div className="header-menu-user">
                <Avatar username={username} userId={user?.id} size="lg" title={null} />
                <span className="user-area">
                  <span className="username">{username}</span>
                  {user?.email ? (
                    <span className="header-menu-email">{user.email}</span>
                  ) : null}
                </span>
              </div>

              <section className="header-drawer-section" aria-label={t('appearance')}>
                <h3 className="header-drawer-heading">{t('appearance')}</h3>
                <div className="header-drawer-theme">
                  <ThemeToggle />
                  <span className="header-drawer-hint">{t('themeHint')}</span>
                </div>
                {/* sk-551.7 — beside the theme, on every width: the type
                    steps shrink on a phone too, only the heights do not. */}
                <DensitySetting />
                {/* sk-551.8 — the left-panel layout, on every width and in
                    every root (shell, AppChrome, settings): a profile
                    setting. On a phone it carries a line that the narrow
                    screen shows sheets. */}
                <NavLayoutSetting mobile={mobile} />
                {/* sk-551.5 — not on a phone: there the open issue is
                    always the full-screen sheet, and the setting would be
                    a control that changes nothing on the screen it is on. */}
                {mobile ? null : <IssueModalViewsSetting />}
              </section>

              {/* sk-285.7.7 — the phone's fallbacks for two rail controls
                  the mobile header does not draw.

                  Mounted on the MODE, not always. A permanent duplicate
                  would give the language two entries on every screen wide
                  enough to show the rail one, and "which of these two is
                  the real control" is a question no user should have to
                  answer. Above the threshold the rail is the only home,
                  which is exactly what sk-285.6.15 decided; below it the
                  rail is not drawn at all, and this is the only surface
                  left. The rendered set therefore differs by width HERE
                  and nowhere else in the header — every rail control is
                  mounted at every width and hidden by the stylesheet (see
                  `CompactHeader.test.tsx`), because a rail control has a
                  place to be hidden IN.

                  What did NOT come along, and why:
                  · View settings — it configures the SHAPE the Tasks
                    column is drawn in (which tree columns, which card
                    properties). On the phone that shape is fixed by the
                    layout, and nothing it can be set to hides a task or
                    narrows a count: a user who cannot reach it is not
                    looking at a short list wondering why. That is the
                    line this whole issue draws — a lens narrows the data
                    and must be escapable; a preference about drawing
                    does not and need not.
                  · Inspect — it arms a click that posts a selector to a
                    PAIRED MCP agent session. There is no phone workflow
                    it belongs to. */}
              {mobile ? (
                <>
                  <section
                    className="header-drawer-section"
                    aria-label={tCommon('language.label')}
                  >
                    <h3 className="header-drawer-heading">{tCommon('language.label')}</h3>
                    <LanguageChoiceList onChosen={closeMenuReturningFocus} />
                  </section>

                  {/* A plain row, not a section: it is one destination,
                      and the rail draws it as one link too. Visible text
                      and accessible name are the pair the rail uses —
                      the name is longer than the label and CONTAINS it
                      (WCAG 2.5.3 Label in Name). */}
                  <Link
                    className="header-drawer-item"
                    to="/activity"
                    aria-label={t('hotZoneAria')}
                    onClick={closeMenu}
                  >
                    {t('hotZone')}
                  </Link>
                </>
              ) : null}

              {/* sk-40 / sk-41 — Settings group. The same destinations the
               * old gear dropdown carried. Inspect is NOT here any more —
               * sk-285.1.18.5 gave it its own header icon back. */}
              <section className="header-drawer-section" aria-label={t('settings')}>
                <h3 className="header-drawer-heading">{t('settings')}</h3>
                {/* SPA nav via React Router — avoids full page reload, keeps
                    TanStack Query cache + AuthProvider state + SignalR
                    connection alive. `Link` still renders an <a> so middle-
                    click / right-click "open in new tab" work as expected. */}
                {/* sk-285.7.11 (AM4) — each row leads with its 20px
                    glyph, in the artboard's order, and every one of them
                    was already in the §8 list with nowhere to be spent:
                    the menu drew a column of bare words. `aria-hidden`
                    throughout — the row's text is its accessible name,
                    and a second one would have a screen reader announce
                    each destination twice.

                    sk-402 — the section is the settings TAB ROW, entry
                    for entry (`SettingsLayout.tsx#TABS`), and
                    `AccountMenuSettingsItems.test.tsx` compares the two
                    rendered menus so they cannot drift apart again. Two
                    edits to the artboard's six names follow from that:
                    `device-mobile-message` is gone with the page it led
                    to (sk-303.13 deleted the push page; the address
                    survives only as a redirect, so the entry opened
                    something other than what it said), and `lock` — §8's
                    own glyph for the role — leads the new password row
                    sk-303.20 added to the tabs alone. `key` stays with
                    API keys, which held it first. */}
                {/* sk-674.18 T058 — «Account», first, as in the tab row (screens 1.14). */}
                <Link className="header-drawer-item" to="/settings/account" onClick={closeMenu}>
                  <IconUserCircle className="header-drawer-icon" size={20} stroke={1.75} aria-hidden />
                  {t('account')}
                </Link>
                <Link className="header-drawer-item" to="/settings/password" onClick={closeMenu}>
                  <IconLock className="header-drawer-icon" size={20} stroke={1.75} aria-hidden />
                  {t('password')}
                </Link>
                {/* sk-674.18 T057 — the «Spaces» tab, as in the tab row:
                    after «Password», not for an external user (screens 1.14). */}
                {user?.isExternal === true ? null : (
                  <Link className="header-drawer-item" to="/settings/spaces" onClick={closeMenu}>
                    <IconBuildingCommunity className="header-drawer-icon" size={20} stroke={1.75} aria-hidden />
                    {t('spaces')}
                  </Link>
                )}
                <Link className="header-drawer-item" to="/settings/api-keys" onClick={closeMenu}>
                  <IconKey className="header-drawer-icon" size={20} stroke={1.75} aria-hidden />
                  {t('apiKeys')}
                </Link>
                {user?.role === 'admin' ? (
                  <Link className="header-drawer-item" to="/settings/users" onClick={closeMenu}>
                    <IconUsers className="header-drawer-icon" size={20} stroke={1.75} aria-hidden />
                    {t('users')}
                  </Link>
                ) : null}
                <Link className="header-drawer-item" to="/settings/notifications" onClick={closeMenu}>
                  <IconBell className="header-drawer-icon" size={20} stroke={1.75} aria-hidden />
                  {t('notifications')}
                </Link>
                <Link className="header-drawer-item" to="/settings/theme" onClick={closeMenu}>
                  <IconPalette className="header-drawer-icon" size={20} stroke={1.75} aria-hidden />
                  {t('theme')}
                </Link>
              </section>

              {/* sk-285.7.11 (AM5/AM6) — the artboard's closing row:
                  Logout on the left in `--err`, the build's version in
                  mono on the right, one line. It shipped as two stacked
                  rows with Logout in the same ink as "Push" — i.e. the
                  one entry that ends the session read as ordinary
                  navigation. The version moved back onto Logout's line
                  because that is where the artboard puts it and because
                  a full-width row of its own made it look clickable. */}
              <div className="header-drawer-user">
                {/* sk-285.6.16 — the same row every other menu entry
                    wears (`.header-drawer-item`), but still a <button>:
                    logging out changes STATE, it does not go to an
                    address. As an <a href> it would be openable in a new
                    tab and by middle click, and both are nonsense for a
                    logout — and a /logout ROUTE would run its side effect
                    on link prefetch. Visual parity only; the element and
                    its error handling are unchanged. */}
                <button
                  type="button"
                  className="header-drawer-item header-drawer-logout"
                  onClick={() => {
                    void handleLogout();
                  }}
                >
                  <IconLogout className="header-drawer-icon" size={20} stroke={1.75} aria-hidden />
                  {t('logout')}
                </button>
                <AppVersionBadge />
              </div>
            </div>
          </Popover.Dropdown>
        </Popover>
      </div>
    </header>
  );
}
