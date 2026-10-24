import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Select } from '@mantine/core';
import {
  IconAt,
  IconCheck,
  IconEye,
  IconInbox,
  IconLayoutSidebarLeftCollapse,
  IconListCheck,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { useLayoutState } from '../../lib/useLayoutState';
import { useNavLocalState, useNavScrollMemory } from '../../lib/useNavLocalState';
import { usePublishQueueBreakdown, usePublishZoneCount } from '../../lib/useZoneCounts';
import { NavSectionFrame, type NavSectionProps } from './NavSection';
import { useInbox } from '../../lib/useInbox';
import { useMyInvitations } from '../../lib/useMyInvitations';
import { useMySpaces } from '../../lib/useMySpaces';
import { useMentions } from '../../lib/useMentions';
import { useWatching } from '../../lib/useWatching';
import { useProjectsList } from '../../lib/useProjectsList';
import { useMarkNotificationsRead } from '../../lib/useMarkNotificationsRead';
import { useMarkWatchingCardRead } from '../../lib/useMarkWatchingCardRead';
import { useUnwatch } from '../../lib/useUnwatch';
import { useBulkUnwatch } from '../../lib/useBulkUnwatch';
import { useToaster } from '../../components/Toaster';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useRingingIssueIds } from '../../lib/useReminders';
import { useFeedChannelsAllOff } from '../../lib/useReasonPrefsProbe';
import { describeWatchingEmptiness } from '../../lib/watchingEmptiness';
import { InboxCard } from './InboxCard';
import { InvitationCard } from './InvitationCard';
import type { MySpace } from '../../api/spaces';
import { MentionCard } from './MentionCard';
import { WatchingCard } from './WatchingCard';
import { WatchingFilter, focusWatchingFilter } from './WatchingFilter';
import { WatchingSelectStrip, type WatchingSelectionKind } from './WatchingSelectStrip';
import { SkeinTooltip } from '../../components/SkeinTooltip';
import { isHistoricalWatchingCard, type WatchingState } from '../../api/notifications';
import { Link, useLocation } from 'react-router-dom';

interface Props {
  /**
   * sk-551.8 — draw as the Queues SECTION of the sections column
   * (`NavColumn`) instead of as a column: a section header, the same
   * picker, filter and cards as the body. Absent — the column, exactly as
   * before.
   */
  section?: NavSectionProps;
  collapsed: boolean;
  /**
   * The column's pixel width, or `null` when it has none of its own.
   *
   * `null` is the TABLET mode (sk-285.7 T020, plan decision R10): the
   * zone is a sliver there and the row hands the leftover to Tasks and
   * Details, so no width is rendered — and, more to the point, none is
   * READ. The caller passing `null` is the caller saying "the persisted
   * width was deliberately not consulted", which is the difference
   * between a width derived from the available room and a desktop width
   * that happens not to fit. A number is the desktop mode, where the
   * width is the user's persisted one.
   */
  width: number | null;
}

/**
 * The queues this column can show, in menu order.
 *
 * There were four: sk-303.13 / US-9 removed Outbox — it was a third,
 * event-shaped view of what the Delegated lens already counts as tasks,
 * and the two numbers diverged by construction. What the delegating
 * creator wants to see now lives on Watching, which keeps the creator
 * auto-subscription.
 */
type QueueKey = 'inbox' | 'mentions' | 'watching';

/** One entry of the queue picker: menu label + its unread counter. */
interface QueueDescriptor {
  value: QueueKey;
  label: string;
  count: number;
}

/**
 * sk-285.7 T027 — the glyph each queue is drawn with (handoff §6
 * "Queues": "icon + "Inbox" + counter …").
 *
 * They are the SAME four marks the header rail carries for the same
 * four queues (`HeaderBar.tsx`, §8's `inbox` / `send` / `at` / `eye`) at
 * the same 20px control step, which is the point: the rail and this
 * picker are two ways into one set, and a different icon in each would
 * make them read as two.
 *
 * A record rather than a field on `QueueDescriptor`: the descriptors are
 * rebuilt on every count change, and an icon element rebuilt with them
 * would be a new React element on every render for a thing that never
 * varies.
 */
const QUEUE_ICONS: Record<QueueKey, typeof IconInbox> = {
  inbox: IconInbox,
  mentions: IconAt,
  watching: IconEye,
};

/**
 * Queues column (F3, Sc1; extended for sk-36 follow-up, rewritten for
 * sk-37, third tab added in sk-38, fourth in sk-39).
 *
 * Header reads `Queues N` — same shape as the sibling columns'
 * `Projects N` / `Tasks N`, where N is everything still unread across
 * the four queues. Under it sits ONE queue picker (a `<Select>`), each
 * option carrying that queue's own counter:
 *
 *   Queues  7                      [ Inbox 3       ▾ ]
 *
 * The pill tab row this replaces (`[Inbox N] [Mentions K] [Watching W]`)
 * wrapped onto two lines at the default column width and left the column
 * as the only one in the shell with no title at all.
 *
 * sk-303.13 (T027) added the WAI-ARIA tabs keyboard model to those pills
 * — arrows / Home / End over a roving tabindex — because `role="tab"`
 * promises it and nothing implemented it. The `<Select>` is not a
 * tablist and does not owe that model: Mantine's combobox brings its own
 * complete one (arrows, Home, End, typeahead, Escape), so the promise is
 * kept by the widget instead of by hand-written key handling.
 *
 * - **Inbox** shows issues assigned to the caller that haven't been
 *   accepted yet (incoming queue from others).
 * - **Mentions** (sk-38) shows unread `comment.mention` /
 *   `issue.mention` notifications addressed to the caller. Each
 *   notification is one card (no grouping — mentions are standalone
 *   acts and clustering would obscure individual @ events). Backend
 *   supplies a ~120-char snippet around the @-mention so the card
 *   shows meaningful preview text.
 * - **Watching** (sk-39) is the caller's SUBSCRIPTION list — see the
 *   Watching branch below.
 *
 * The selected queue comes from `useLayoutState.inboxTab`, which since
 * sk-303.13 (T027) reads the `?tab=` query parameter — picking a queue
 * changes the address, so a queue can be linked to and Back walks them.
 * (localStorage still keeps the last queue as the fallback for an
 * address that names none.) All three sources fetch in parallel so
 * switching queues is instant on the second visit; each option's
 * counter reflects that queue's authoritative shape:
 *   - Inbox badge = number of issue rows
 *   - Mentions badge = number of unread notifications
 *   - Watching badge = the server's uncapped `unreadTotal`, matching
 *     the header bell badge exactly (C3 / INV-3).
 *
 * Empty-collapse strategy (Q32):
 *   The column auto-collapses to a 28px sliver when the ACTIVE tab is
 *   empty (falling edge). Manual re-expand via the sliver. We do NOT
 *   auto-expand on count > 0 — explicit user collapse is respected.
 */
/** The initial (and reset) set of marked subscriptions. */
const EMPTY_CHECKED: ReadonlySet<string> = new Set();

export function InboxColumn({ collapsed, width, section }: Props) {
  const { t, i18n } = useTranslation('inbox');
  const {
    setInboxCollapsed,
    selectedIssue,
    selectInboxIssue,
    inboxTab,
    setInboxTab,
    reportQueueFell,
  } = useLayoutState();
  // sk-622.21 R12 / K19 — cards accepted here on this route stay dimmed in
  // place through every re-read of Inbox; on another route they are not
  // laid back (`inboxAcceptedRetention.ts#applyAcceptedRetention`).
  const { pathname } = useLocation();
  const inboxQ = useInbox(pathname);
  // sk-674.18 T054 — pending invitations to me, pinned above the tasks and
  // counted with them (screens 1.2–1.3); shown with any number of spaces.
  const invitationsQ = useMyInvitations();
  const mySpacesQ = useMySpaces();
  const mentionsQ = useMentions();
  // sk-551.8 (P6) — the filter, the select mode and its marks are held by
  // the shell's navigation-state provider when there is one (kept across
  // threshold remounts, reset on a layout change); local state otherwise.
  //
  // sk-551.10 — the Open / Closed / All filter. «Open» by default: the
  // list is what still needs attention, and closed subscriptions are one
  // click away rather than the bulk of what the user scrolls through.
  const [watchingState, setWatchingState] = useNavLocalState('watchingState', 'open');
  const watchingQ = useWatching(watchingState);
  // sk-551.10 — multi-select for «Stop watching selected». Leaving the
  // filter, or the mode, drops the selection: a selection made on one
  // list must not act on cards the user can no longer see.
  const [selectMode, setSelectMode] = useNavLocalState('watchingSelectMode', false);
  const [checkedIds, setCheckedIds] = useNavLocalState('watchingCheckedIds', EMPTY_CHECKED);
  const [confirmClosedOpen, setConfirmClosedOpen] = useState(false);
  // sk-551.10 review (grok html) / sk-551.33 — leaving select mode
  // unmounts the action strip, and «Cancel» may well have had focus. It
  // goes back to the select-mode icon on the filter line (cancel, Esc or
  // a finished bulk unwatch), so keyboard users are not dropped onto
  // <body>. Entering moves nothing: the icon that started the mode stays
  // where it was (pressed), and a Ctrl / Cmd click leaves focus on the
  // card it ticked.
  //
  // The icon is found in the DOM rather than by a ref: `SkeinTooltip`
  // puts its own ref on the child it wraps.
  const prevSelectModeRef = useRef(false);
  const columnRef = useRef<HTMLDivElement>(null);
  const queueBodyRef = useRef<HTMLDivElement>(null);
  useNavScrollMemory('queues', queueBodyRef);
  useEffect(() => {
    const was = prevSelectModeRef.current;
    prevSelectModeRef.current = selectMode;
    if (was && !selectMode) {
      // A bulk unwatch that emptied the list leaves no icon to return
      // to: the filter control above the list takes focus instead of
      // <body>.
      const icon = columnRef.current?.querySelector<HTMLButtonElement>(
        '.watching-select-toggle',
      );
      if (icon) icon.focus();
      else focusWatchingFilter(columnRef.current);
    }
  }, [selectMode]);
  const bulkUnwatchMut = useBulkUnwatch();
  const toast = useToaster();
  const changeWatchingState = (next: WatchingState) => {
    setWatchingState(next);
    setCheckedIds(new Set());
  };
  const leaveSelectMode = () => {
    setSelectMode(false);
    setCheckedIds(new Set());
  };
  const toggleChecked = (id: string) =>
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // sk-551.33 — Ctrl / Cmd click outside the mode: «this one, and I am
  // choosing several», as in a file manager.
  const enterSelectModeWith = (id: string) => {
    setSelectMode(true);
    setCheckedIds(new Set([id]));
  };
  // sk-551.33 — Esc leaves the mode, from anywhere in the column. Typing
  // fields (the compact filter's input) keep their own Esc, and the event
  // goes no further: the window-level Esc of the Details column would
  // otherwise close the open issue on the same keystroke.
  const handleColumnKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!selectMode || event.key !== 'Escape') return;
    const target = event.target as HTMLElement;
    const tag = target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || target.isContentEditable) return;
    event.stopPropagation();
    leaveSelectMode();
  };
  const projectsQ = useProjectsList();
  const markReadMut = useMarkNotificationsRead();
  const markCardReadMut = useMarkWatchingCardRead();
  const unwatchMut = useUnwatch();
  // sk-62.2 / sk-194.5.2.8.5 — one ringing-set read for the whole column;
  // each InboxCard gets a `boolean`. Calling `useRingingIssueIds()` inside
  // the card meant one live QueryObserver (and two re-installed timers per
  // reminders-query update) per rendered row.
  const ringingIssueIds = useRingingIssueIds();

  const inboxItems = inboxQ.data?.items ?? [];
  const invitationItems = invitationsQ.data?.items ?? [];
  // sk-674.18 T054 — with two spaces or more a queue card names the space
  // of its issue instead of the project handle (screens 1.3–1.5); with one
  // (or none — an external user) the card is as it was. A row whose space
  // is not among «my spaces» (or that arrives without `spaceId`) keeps the
  // handle.
  const spacesById = useMemo(() => {
    const items = mySpacesQ.data?.items ?? [];
    if (items.length < 2) return null;
    return new Map<string, MySpace>(items.map((sp) => [sp.id, sp]));
  }, [mySpacesQ.data]);
  const queueSpaceOf = (spaceId: string | undefined): MySpace | null =>
    spacesById !== null && spaceId !== undefined ? spacesById.get(spaceId) ?? null : null;
  const mentionsItems = mentionsQ.data?.items ?? [];
  const watchingItems = watchingQ.data?.items ?? [];
  // Inbox badge shows UNACCEPTED count (matches header bell `inbox`
  // bucket). Optimistically-accepted items stay in the cache (dimmed
  // cards) but don't count toward the badge. Backend omits acceptedAt
  // for unaccepted items via JSON omitempty — truthy check covers both
  // wire (undefined) and optimistic-cleared (null) states.
  //
  // sk-674.18 T054 — plus the pending invitations, as the header badge
  // counts them (screens 1.2: unaccepted issues + pending invitations).
  const inboxCount = useMemo(
    () => inboxItems.filter((it) => !it.acceptedAt).length + invitationItems.length,
    [inboxItems, invitationItems],
  );
  // Total drives the empty-state branch so the column doesn't go empty
  // just because every card was acknowledged this session.
  const inboxTotalCount = inboxItems.length + invitationItems.length;

  // sk-38 — Mentions tab: unread count for the badge, total count for
  // the empty-state branch. Backend omits `readAt` for unread items
  // (JSON omitempty); truthy check covers both wire (undefined) and
  // optimistic-cleared (null) states.
  const mentionsUnreadCount = useMemo(
    () => mentionsItems.filter((it) => !it.readAt).length,
    [mentionsItems],
  );
  const mentionsTotalCount = mentionsItems.length;

  // sk-39 / sk-303.13 (T028) — Watching tab numbers come from the
  // response's own totals, NOT from the cards.
  //
  // Summing `unreadEventsCount` over `items` is right only while nothing
  // was cut: the server caps the cards at 100 and counts the badge over
  // every subscription, so past that point the sum is silently smaller
  // than the header bell showing the same word. `unreadTotal` is the
  // uncapped number the badge itself is built from (same SQL), so the
  // two agree by construction (INV-3 / US-7) instead of by luck.
  const watchingUnreadCount = watchingQ.data?.unreadTotal ?? 0;
  const watchingSubscriptionsTotal = watchingQ.data?.subscriptionsTotal ?? 0;
  // The cards ARE incomplete sometimes — that is fine, as long as the
  // column says so rather than passing a prefix off as the whole list.
  const watchingTruncated = watchingQ.data?.truncated ?? false;
  const watchingTotalCount = watchingItems.length;
  // sk-551.10 — the size of the filter on screen, uncapped. The state is
  // read off the RESPONSE: while a newly chosen filter loads, the numbers
  // shown are the previous filter's, and they must be labelled as such.
  const watchingShownState: WatchingState = watchingQ.data?.state ?? watchingState;
  const watchingStateTotal = watchingQ.data?.stateTotal ?? 0;
  const watchingClosedTotal = watchingQ.data?.closedTotal ?? 0;
  const watchingClosedAutoTotal = watchingQ.data?.closedAutoTotal ?? 0;
  // While a newly chosen filter loads, the cards on screen are the
  // PREVIOUS filter's (placeholder). Bulk actions would act on a list the
  // segment no longer names, so they wait for the real answer.
  const watchingIsPlaceholder = watchingQ.isPlaceholderData === true;
  // sk-551.33 — the select-mode icon is offered when there is something
  // to select and the list is the real answer; once the mode is on it
  // stays, so the control that turns the mode off cannot vanish under
  // the user's pointer (or focus) while a new filter loads.
  const canEnterSelectMode = watchingTotalCount > 0 && !watchingIsPlaceholder;
  // One spelling of a number on the button and in its confirmation
  // (review, grok info): «2 976» on both, not «2 976» then «2976».
  const formatCount = (n: number) => new Intl.NumberFormat(i18n.language).format(n);
  // Only ids still on screen count — a card that left the list (another
  // tab unsubscribed it, a refetch dropped it) is not silently included.
  const checkedOnScreen = watchingItems.filter((row) => checkedIds.has(row.item.id));
  // sk-622.21 (US-6) — the strip names what the ticked cards are: a
  // historical card is removed, never «unwatched».
  const checkedHistorical = checkedOnScreen.filter(isHistoricalWatchingCard).length;
  const selectionKind: WatchingSelectionKind =
    checkedHistorical === 0
      ? 'unwatch'
      : checkedHistorical === checkedOnScreen.length
        ? 'remove'
        : 'mixed';
  // grok W (html-css) — a failure names the action that failed: a
  // selection of historical cards was «remove», a mixed one both verbs.
  // The state sweep and a selection of subscriptions keep «stop watching».
  const bulkFailedKey =
    selectionKind === 'remove'
      ? 'watching.actions.failedRemove'
      : selectionKind === 'mixed'
        ? 'watching.actions.failedMixed'
        : 'watching.actions.failed';
  const runBulkUnwatch = (
    input: Parameters<typeof bulkUnwatchMut.mutate>[0],
    failedKey = 'watching.actions.failed',
  ) =>
    bulkUnwatchMut.mutate(input, {
      onSuccess: (res) => {
        // sk-622.21 (US-6) — the answer also says how many historical
        // cards went (`historicalRemoved`); it is shown whenever non-zero.
        const h = res.historicalRemoved;
        toast.success(
          h === 0
            ? t('watching.actions.done', { n: res.unwatched })
            : res.unwatched === 0
              ? t('watching.actions.removedOnly', { h })
              : t('watching.actions.doneWithRemoved', { n: res.unwatched, h }),
        );
        leaveSelectMode();
        setConfirmClosedOpen(false);
      },
      onError: () => {
        toast.error(t(failedKey));
        setConfirmClosedOpen(false);
      },
    });
  // The chosen filter is empty while other cards exist: that is neither
  // «no subscriptions» nor «subscriptions are unavailable». sk-622.21
  // (US-5) — «other cards» counts both kinds (open + closed totals), so a
  // column holding only historical cards — zero subscriptions — still
  // says the filter is empty rather than «not watching anything».
  const watchingCardsTotal = (watchingQ.data?.openTotal ?? 0) + watchingClosedTotal;
  const watchingFilterEmpty =
    watchingQ.isSuccess &&
    !watchingQ.isPlaceholderData &&
    watchingStateTotal === 0 &&
    watchingCardsTotal > 0;

  // One descriptor list drives the queue picker AND the header total,
  // so a queue can never contribute a different number depending on
  // which of the two the user is looking at.
  const queues: readonly QueueDescriptor[] = useMemo(
    () => [
      { value: 'inbox', label: t('tabs.inbox'), count: inboxCount },
      { value: 'mentions', label: t('tabs.mentions'), count: mentionsUnreadCount },
      { value: 'watching', label: t('tabs.watching'), count: watchingUnreadCount },
    ],
    [t, inboxCount, mentionsUnreadCount, watchingUnreadCount],
  );
  const queueByValue = useMemo(
    () => new Map<QueueKey, QueueDescriptor>(queues.map((q) => [q.value, q])),
    [queues],
  );
  // Header chip mirrors the sibling columns' `Projects N` / `Tasks N`
  // pattern: everything still waiting for the caller across the three
  // queues. Zero hides the chip (an empty queue set shouldn't carry a
  // "0", same rule as the header bell badges).
  const queuesTotal = useMemo(
    () => queues.reduce((acc, q) => acc + q.count, 0),
    [queues],
  );
  // sk-285.7 fidelity M1 — the same number the chip above prints, handed
  // to the mobile tab strip, which draws «Queues N» on its own tab
  // (`1g-mobile-390`). Published rather than recomputed there: this is
  // the sum of the queue counts, and a second reduction over the same
  // queries is a second thing to keep in step.
  usePublishZoneCount('queues', queuesTotal);
  // sk-551.8 — the split, for the sections column's sliver (US-6).
  usePublishQueueBreakdown(inboxCount, mentionsUnreadCount, watchingUnreadCount);
  const activeQueueLabel = queueByValue.get(inboxTab)?.label ?? '';

  // Why is there nothing to see? Three causes, three different true
  // answers (US-5) — and the third one needs the caller's own channel
  // settings, so we only ask for them when the feed is actually quiet.
  // A user with activity never pays for that round-trip.
  const watchingQuiet =
    inboxTab === 'watching' && watchingQ.isSuccess && watchingUnreadCount === 0;
  const feedChannelsAllOff = useFeedChannelsAllOff(watchingQuiet);
  // sk-303.13.2.10 (FE-G2 / W1) — one delivered row anywhere in the
  // response is what separates "all read" from "no events yet".
  // Without it the column printed the second sentence above cards whose
  // timelines listed the events it claimed had never arrived.
  const watchingHasDeliveredEvents = useMemo(
    () => watchingItems.some((row) => row.recentEvents.length > 0),
    [watchingItems],
  );
  const watchingEmptiness = watchingQ.isSuccess
    ? describeWatchingEmptiness({
        subscriptionsTotal: watchingSubscriptionsTotal,
        itemsCount: watchingTotalCount,
        unreadTotal: watchingUnreadCount,
        hasDeliveredEvents: watchingHasDeliveredEvents,
        feedChannelsAllOff,
      })
    : null;

  // sk-674.18 T054 (review TS-W1) — the Inbox tab is two reads: the issues
  // and the invitations. Its state is composed of both: loading until both
  // answered; an error only when both failed; one failed — the other's
  // cards stay and the failure is said in place, with a retry; «empty» only
  // when both succeeded with nothing.
  const inboxState = {
    isLoading: inboxQ.isLoading || invitationsQ.isLoading,
    isError: inboxQ.isError && invitationsQ.isError,
    isSuccess: inboxQ.isSuccess && invitationsQ.isSuccess,
  };
  const activeQ =
    inboxTab === 'inbox' ? inboxState : inboxTab === 'mentions' ? mentionsQ : watchingQ;
  // For collapse/empty-state decisions: use TOTAL counts (including
  // dimmed cards) on every tab so the column doesn't go empty just
  // because every card was acknowledged this session.
  const activeCount =
    inboxTab === 'inbox'
      ? inboxTotalCount
      : inboxTab === 'mentions'
        ? mentionsTotalCount
        : // sk-551.10 — every card, not the cards of the current filter:
          // switching to an empty «Closed» must not read as the queue
          // running dry and fold the column. sk-622.21 (US-5) — cards of
          // both kinds (open + closed totals), not `subscriptionsTotal`:
          // leaving the last subscription while historical cards stay is
          // not an empty column.
          watchingCardsTotal;

  // Resolve project handles in one pass — every card kind needs the
  // display alias for the eyebrow chip.
  const projectHandles = useMemo(() => {
    const out = new Map<string, string>();
    for (const p of projectsQ.data?.items ?? []) {
      out.set(p.id, p.idPrefix);
    }
    return out;
  }, [projectsQ.data]);

  // Resolve project handle for one row — first via the projects-list
  // lookup, then via the issue id's prefix segment as a fallback. The
  // hierarchical id always carries the prefix (e.g. `demo-42.1` →
  // `demo`) so even with the projects list still loading we can render
  // a sensible eyebrow.
  const resolveHandle = (issueId: string, projectId: string | null): string | null => {
    const fromMap = projectId ? projectHandles.get(projectId) : undefined;
    if (fromMap) return fromMap;
    const m = issueId.match(/^(.+)-\d+(?:\.\d+)*$/);
    return m ? m[1] : null;
  };

  // Q32 auto-collapse: only fire on the *falling edge* (had-items →
  // empty) of the ACTIVE tab. Switching tabs doesn't re-trigger because
  // we track count per-tab.
  const prevCountRef = useRef<number | null>(null);
  // What «already folded» means here: the column's sliver, or — as a
  // section — the folded section.
  const shownFolded = section ? section.collapsed : collapsed;
  const prevTabRef = useRef<typeof inboxTab>(inboxTab);
  useEffect(() => {
    if (!activeQ.isSuccess) {
      return;
    }
    const prev = prevCountRef.current;
    const tabChanged = prevTabRef.current !== inboxTab;
    prevCountRef.current = activeCount;
    prevTabRef.current = inboxTab;
    if (tabChanged) {
      // Don't auto-collapse on tab switch — that's an explicit user
      // action; respect their intent to see the other tab.
      return;
    }
    // sk-551.8 (P11) — the fall is REPORTED, not acted on: the layout
    // provider routes it by the active layout — side-by-side folds the
    // column exactly as before, the sections layout folds only the
    // Queues section (and nothing on a phone or during a shared file).
    if (prev !== null && prev > 0 && activeCount === 0 && !shownFolded) {
      reportQueueFell();
    }
  }, [activeCount, activeQ.isSuccess, shownFolded, reportQueueFell, inboxTab]);

  if (collapsed && !section) {
    // Folded state. The sliver carries the COLUMN'S OWN NAME plus the
    // cross-queue total — literally the `Queues N` of the expanded
    // header (same `queuesTotal`, so the two can never disagree), in
    // the same label+count shape the Projects sliver uses right next
    // to it. Two folded columns therefore read as one idiom.
    //
    // It used to list every queue (`Inbox 3 / Mentions 2 / …`), which
    // dated from when the column had no title of its own. The per-queue
    // breakdown is not lost by dropping it: the header rail shows all
    // four counters permanently, zeros included.
    //
    // Click anywhere on the sliver re-expands to the last-selected
    // queue (kept in `inboxTab`, untouched by folding).
    return (
      <button
        type="button"
        className="col-inbox-collapsed"
        aria-expanded={false}
        // The visible label is two words; the accessible name spends
        // its extra room on the per-queue split, which a sighted user
        // reads off the header rail at a glance.
        // Spoken at every value, matching the now-always-printed chip:
        // "0 unread: Inbox 0, …" is information, silence is not.
        aria-label={t('expandColumnWithCounts', {
          total: queuesTotal,
          inbox: inboxCount,
          mentions: mentionsUnreadCount,
          watching: watchingUnreadCount,
        })}
        onClick={() => setInboxCollapsed(false)}
      >
        <span className="col-inbox-sliver-label">
          {t('title')}
          <span
            className={
              queuesTotal === 0
                ? 'col-inbox-sliver-count col-count-empty'
                : 'col-inbox-sliver-count'
            }
          >
            {queuesTotal}
          </span>
        </span>
      </button>
    );
  }

  // One key per tab — the three message families share the tab slug so a
  // new tab only needs its three dictionary entries, not three more
  // ternary ladders here.
  const emptyMessage = t(`empty.${inboxTab}`);
  const loadingMessage = t(`loading.${inboxTab}`);
  const errorMessage = t(`error.${inboxTab}`);

  const content = (
    <>
      <div className="col-queues-picker">
        {/* sk-551.10 — on Watching the number is not the number of
            subscriptions, and the closed control cannot say so by itself:
            the hint names what it counts. */}
        <SkeinTooltip
          content={t('watching.filter.countHint', { n: watchingUnreadCount })}
          position="bottom"
          width={260}
          disabled={inboxTab !== 'watching'}
        >
        <Select
          size="xs"
          className="queue-select"
          value={inboxTab}
          onChange={(v) => {
            if (!v) return;
            setInboxTab(v as QueueKey);
          }}
          // The option label carries the count so the CLOSED control
          // still reads "Inbox 3" — the queue and its backlog are
          // legible without opening the list. Zero is included for the
          // same reason the header chips print it: a label that silently
          // drops its number cannot be told from one that never had one.
          data={queues.map((q) => ({
            value: q.value,
            label: `${q.label} ${q.count}`,
          }))}
          // §6 "Queues": the closed control reads "icon + "Inbox" +
          // counter". The icon is the ACTIVE queue's, so the control
          // states which queue it is showing without being opened.
          // `pointerEvents: none` keeps the glyph from eating the click
          // that opens the menu — the whole 44px control is one target.
          leftSection={
            <span className="queue-select-icon" aria-hidden>
              {(() => {
                const Icon = QUEUE_ICONS[inboxTab];
                return <Icon size={20} stroke={1.75} />;
              })()}
            </span>
          }
          leftSectionPointerEvents="none"
          // sk-303.13.2.10 (FE-G2 / W3) — Home / End.
          //
          // The finding was that the pill tab row declared
          // `role="tablist"` and implemented none of the keyboard model
          // it promises. The `<Select>` that replaced those pills brings
          // most of that model with it — but not all of it: checked in
          // @mantine/core 7.17.8 (`use-combobox-target-props.mjs`), the
          // combobox target handles ArrowDown, ArrowUp, Enter, Escape
          // and Space, and Home / End reach it as unhandled keys. So the
          // two the widget does not own are added here rather than lost
          // in the swap. `event.code`, like Mantine's own handler, so a
          // synthetic event without it behaves the same either way.
          onKeyDown={(event) => {
            const code = event.nativeEvent.code;
            if (code !== 'Home' && code !== 'End') return;
            const next = code === 'Home' ? queues[0] : queues[queues.length - 1];
            if (!next) return;
            event.preventDefault();
            setInboxTab(next.value);
          }}
          // Deselecting would leave the panel with no queue to render.
          allowDeselect={false}
          aria-label={t('queueSelectAria')}
          comboboxProps={{ withinPortal: true }}
          // In the OPEN list the count becomes the same brand-coloured
          // `.inbox-count-badge` chip used elsewhere (dimmed at zero,
          // where brand ink would falsely promise unread), instead of a bare
          // number glued to the label. It is read off the queue
          // descriptor rather than parsed back out of `option.label`.
          renderOption={({ option, checked }) => {
            const q = queueByValue.get(option.value as QueueKey);
            return (
              <span className="queue-option">
                {/* `renderOption` replaces Mantine's own check icon, so
                    the selected row would otherwise be indistinguishable
                    in the open list. The slot is always laid out so the
                    labels keep one left edge. */}
                <span className="queue-option-check" aria-hidden>
                  {/* sk-285.7 T027 — 16, the inline step (FR-003 / §8).
                      It was 12, which is a TYPE step, not an icon one. */}
                  {checked ? <IconCheck size={16} stroke={1.75} /> : null}
                </span>
                <span className="queue-option-label">{q ? q.label : option.label}</span>
                {q ? (
                  <span
                    className={
                      q.count === 0
                        ? 'inbox-count-badge col-count-empty'
                        : 'inbox-count-badge'
                    }
                  >
                    {q.count}
                  </span>
                ) : null}
              </span>
            );
          }}
        />
        </SkeinTooltip>
      </div>
      {inboxTab === 'watching' ? (
        <WatchingFilter
          state={watchingState}
          onChange={changeWatchingState}
          stateTotal={watchingStateTotal}
          shown={watchingTotalCount}
          truncated={watchingTruncated}
          summaryState={watchingShownState}
          summaryAction={
            selectMode || canEnterSelectMode ? (
              // sk-551.33 — the way into select mode: an icon at the end
              // of the counter line, not a button row of its own. A
              // toggle (`aria-pressed`), so it is also a way out, and
              // the one focus returns to. 24px with a mouse (the line it
              // sits in is text, and a 44px box would double its height),
              // 44 under touch — `--tap-target-min` in the sheet.
              <SkeinTooltip content={t('watching.actions.select')} position="bottom">
                <button
                  type="button"
                  className="watching-select-toggle"
                  aria-label={t('watching.actions.select')}
                  aria-pressed={selectMode}
                  onClick={(e) => {
                    // A browser that does not focus a clicked button
                    // (Safari) would leave focus outside the column, and
                    // the column's Esc would not hear the key.
                    e.currentTarget.focus();
                    if (selectMode) leaveSelectMode();
                    else setSelectMode(true);
                  }}
                >
                  <IconListCheck size={16} stroke={1.75} aria-hidden />
                </button>
              </SkeinTooltip>
            ) : null
          }
        >
          <div className="watching-actions">
            {/* «Stop watching closed» exists ONLY on the Closed filter —
                on Open it would sit one click away from sweeping what the
                user still needs. Its number is what the sweep takes:
                manual subscriptions are left alone. */}
            {watchingShownState === 'closed' &&
            !selectMode &&
            !watchingIsPlaceholder &&
            watchingClosedAutoTotal > 0 ? (
              <button
                type="button"
                className="action-button watching-unwatch-closed"
                onClick={() => setConfirmClosedOpen(true)}
                disabled={bulkUnwatchMut.isPending}
              >
                {t('watching.actions.unwatchClosed', {
                  n: formatCount(watchingClosedAutoTotal),
                })}
              </button>
            ) : null}
            {/* sk-551.33 / sk-551.49 — the select-mode strip, only while
                the mode is on; outside it the strip is empty and takes no
                room (`.watching-actions:empty`). One line at every width:
                see WatchingSelectStrip. */}
            {selectMode ? (
              <WatchingSelectStrip
                count={checkedOnScreen.length}
                disabled={
                  checkedOnScreen.length === 0 ||
                  bulkUnwatchMut.isPending ||
                  watchingIsPlaceholder
                }
                onUnwatch={() =>
                  runBulkUnwatch(
                    { issueIds: checkedOnScreen.map((row) => row.item.id) },
                    bulkFailedKey,
                  )
                }
                onCancel={leaveSelectMode}
                selectionKind={selectionKind}
              />
            ) : null}
          </div>
        </WatchingFilter>
      ) : null}
      <div
        ref={queueBodyRef}
        className="col-body inbox-body"
        // sk-551.8 (P10) — the queue body, found by this attribute in both
        // layouts (the section is not a `.col-inbox`).
        data-queue-body
        id="inbox-queue-panel"
        role="region"
        aria-label={t('panelAria', { queue: activeQueueLabel })}
      >
        {activeQ.isLoading ? (
          <div className="col-empty">{loadingMessage}</div>
        ) : activeQ.isError ? (
          <div className="col-empty col-error">{errorMessage}</div>
        ) : activeCount === 0 && inboxTab !== 'watching' && activeQ.isSuccess ? (
          <div className="col-empty">{emptyMessage}</div>
        ) : inboxTab === 'inbox' ? (
          <>
            {invitationsQ.isError ? (
              <PartialReadFailure
                message={t('error.invitations')}
                retryLabel={t('retry')}
                onRetry={() => void invitationsQ.refetch()}
              />
            ) : null}
            {inboxQ.isError ? (
              <PartialReadFailure
                message={t('error.inbox')}
                retryLabel={t('retry')}
                onRetry={() => void inboxQ.refetch()}
              />
            ) : null}
            {/* sk-733.3 — the invitations are a block of their own at the
                head of the queue. sk-735 — part of the one scrolling list,
                not pinned and with no scroller of its own: the owner ruled
                out a second scrollbar in the column. */}
            {invitationItems.length > 0 ? (
              <div
                className="inbox-invitations"
                role="group"
                aria-label={t('invitation.groupAria', { count: invitationItems.length })}
              >
                {invitationItems.map((invitation) => (
                  <InvitationCard key={`invitation-${invitation.id}`} invitation={invitation} />
                ))}
              </div>
            ) : null}
            {inboxItems.map((item) => {
              const handle = resolveHandle(item.id, item.projectId);
              return (
                <InboxCard
                  key={item.id}
                  item={item}
                  selected={selectedIssue === item.id}
                  disabled={false}
                  onSelect={() => {
                    if (!handle) return;
                    selectInboxIssue(item.id, handle);
                  }}
                  projectHandle={handle ?? '?'}
                  space={queueSpaceOf(item.spaceId)}
                  // sk-194.5.2.8.5 — boolean off the single ringing set above.
                  isRinging={ringingIssueIds.has(item.id)}
                />
              );
            })}
          </>
        ) : inboxTab === 'mentions' ? (
          // sk-38 — Mentions tab. One card per notification, NO
          // clustering (see useMentions doc). Click marks the single
          // notification read and navigates to the parent issue.
          mentionsItems.map((item) => {
            const handle = resolveHandle(item.entity.id, item.entity.projectId);
            const dimmed = !!item.readAt;
            return (
              <MentionCard
                key={item.id}
                item={item}
                projectHandle={handle ?? '?'}
                space={queueSpaceOf(item.spaceId)}
                selected={selectedIssue === item.entity.id}
                dimmed={dimmed}
                onSelect={() => {
                  if (!handle) return;
                  if (!dimmed) {
                    markReadMut.mutate([item.id]);
                  }
                  selectInboxIssue(item.entity.id, handle);
                }}
              />
            );
          })
        ) : (
          // sk-39 / sk-303.13 (T028) — Watching tab. One card per
          // SUBSCRIPTION (not per issue with activity, and not per
          // event): a subtree subscription shows its descendants'
          // activity on the ancestor's card. Click marks every unread
          // event on the subscription read AND navigates; card STAYS in
          // the list (subscription, not notification). × fires unwatch
          // on the subscribed issue.
          //
          // The explanation block comes FIRST and renders whether or not
          // there are cards: an empty list needs a reason, and a list of
          // silent subscriptions needs one just as much — that is the
          // difference between "no subscriptions" and "no events yet"
          // (US-5), and the second case has cards on screen.
          <>
            {watchingFilterEmpty ? (
              <div className="col-empty" role="status" data-empty-kind="filter-empty">
                {t(`watching.filterEmpty.${watchingShownState}`)}
              </div>
            ) : null}
            {!watchingFilterEmpty && watchingEmptiness === null && watchingTotalCount === 0 ? (
              // Unread activity is counted but no card survived: the
              // only subscribed issue was deleted or lost visibility
              // between the server's two queries. Rare, and still not a
              // reason to paint a blank column — or to blame settings
              // for it.
              <div className="col-empty" role="status">
                {t('watching.unavailable')}
              </div>
            ) : null}
            {!watchingFilterEmpty && watchingEmptiness !== null ? (
              // sk-303.13.2.10 (FE-G2 / W4) — `role="status"`, as the
              // truncation banner beside it already has. Selecting a tab
              // does not make a screen reader read the panel, so without
              // it the reader heard «Watching tab selected» and never the
              // sentence explaining why the feed is empty, nor that there
              // is a settings link to act on.
              <div
                className="col-empty watching-empty"
                role="status"
                data-empty-kind={watchingEmptiness.kind}
              >
                {/* sk-396 — the sentence is chosen by the dictionary by the REASON
                    NAME that the pure function returned: it
                    no longer carries text (it has neither a language nor `t()`).
                    There is one substitution — the number of cards of both kinds
                    (sk-622.21, US-5: above a column of historical cards only
                    "Subscriptions: 0" would contradict the screen); it is
                    deliberately not named `count`, otherwise i18next would look
                    for the plural forms `_one`/`_few`, which these
                    sentences do not have. */}
                <p className="watching-empty-text">
                  {t(`watching.empty.${watchingEmptiness.kind}`, {
                    total: watchingCardsTotal,
                  })}
                </p>
                <Link className="watching-empty-link" to="/settings/notifications">
                  {watchingEmptiness.settingsIsTheFix
                    ? t('watching.settingsFixLink')
                    : t('watching.settingsLink')}
                </Link>
              </div>
            ) : null}
            {/* sk-551.10 — the caveat BEFORE the list (W8) is now the
                «showing N» on the filter line above, beside the number it
                qualifies; the copy under the last card stays. */}
            {watchingItems.map((row) => {
              const handle = resolveHandle(row.item.id, row.item.projectId);
              return (
                <WatchingCard
                  key={row.item.id}
                  row={row}
                  projectHandle={handle ?? '?'}
                  space={queueSpaceOf(row.spaceId ?? row.item.spaceId)}
                  selected={selectedIssue === row.item.id}
                  onSelect={() => {
                    if (!handle) return;
                    // sk-622.21 (US-7) — «read card X»: the descendants'
                    // unread on a subtree card go with the task's own.
                    // Sent on EVERY ordinary open, with no gate on
                    // `unreadEventsCount`: that number counts the unread
                    // inside the Watching window only, while the card read
                    // also takes the card's unread outside it — a zero
                    // here does not mean there is nothing to read. The
                    // server answers 200 with `marked: 0` when there is not.
                    markCardReadMut.mutate(row.item.id);
                    selectInboxIssue(row.item.id, handle);
                  }}
                  onOpenActivityTarget={(issueId, projectId) => {
                    // The row describes something that happened on a
                    // DESCENDANT; that is where the click has to land.
                    const target = resolveHandle(issueId, projectId);
                    if (!target) return;
                    selectInboxIssue(issueId, target);
                  }}
                  onUnsubscribe={() => unwatchMut.mutate(row.item.id)}
                  selectable={selectMode}
                  checked={checkedIds.has(row.item.id)}
                  // sk-551.10 review — no selection on a placeholder list:
                  // the cards on screen belong to the previous filter.
                  onToggleChecked={
                    watchingIsPlaceholder ? undefined : () => toggleChecked(row.item.id)
                  }
                  onModifierSelect={
                    watchingIsPlaceholder ? undefined : () => enterSelectModeWith(row.item.id)
                  }
                />
              );
            })}
            {watchingTruncated ? (
              // The number above is complete; this list is not. Saying
              // so is the whole of INV-3 on this surface — a prefix
              // rendered as if it were everything is what US-7 removes.
              // `aria-hidden`: the filter line above (a live region) has
              // already said «showing N», and a screen reader gains
              // nothing from hearing it twice.
              <div className="col-empty watching-truncated" aria-hidden="true">
                {t('watching.truncated', {
                  shown: watchingTotalCount,
                  total: watchingStateTotal,
                })}
              </div>
            ) : null}
          </>
        )}
      </div>
      <ConfirmDialog
        opened={confirmClosedOpen}
        title={t('watching.actions.confirmTitle')}
        message={[
          t('watching.actions.confirmBody', { n: formatCount(watchingClosedAutoTotal) }),
          watchingClosedTotal > watchingClosedAutoTotal
            ? t('watching.actions.confirmKeptManual', {
                n: formatCount(watchingClosedTotal - watchingClosedAutoTotal),
              })
            : null,
        ]
          .filter(Boolean)
          .join('\n\n')}
        confirmLabel={t('watching.actions.confirmButton', {
          n: formatCount(watchingClosedAutoTotal),
        })}
        loading={bulkUnwatchMut.isPending}
        danger
        onConfirm={() => runBulkUnwatch({ state: 'closed' })}
        onCancel={() => setConfirmClosedOpen(false)}
      />
    </>
  );

  // sk-551.8 — a section of the sections column: the same picker, filter
  // and cards under a section header. The wrapper keeps the column's
  // select-mode Esc handling and focus return (`columnRef`).
  if (section) {
    return (
      <NavSectionFrame
        kind="queues"
        title={t('shell:nav.queues')}
        count={queuesTotal}
        countLabel={t('totalCountAria', { count: queuesTotal })}
        collapsed={section.collapsed}
        onToggle={section.onToggle}
        onCollapseColumn={section.onCollapseColumn}
        hidden={section.hidden}
      >
        <div ref={columnRef} className="nav-queues" onKeyDownCapture={handleColumnKeyDown}>
          {content}
        </div>
      </NavSectionFrame>
    );
  }

  return (
    <div
      ref={columnRef}
      className="col-inbox"
      // Capture phase: a tooltip on the focused control (the select-mode
      // icon has one) closes on Esc and stops the key there, which would
      // make the first Esc only close the tooltip.
      onKeyDownCapture={handleColumnKeyDown}
      // `null` → no inline sizing at all, so the stylesheet's flex rules
      // decide. Unreachable today (the one caller that passes `null` also
      // passes `collapsed`, and the sliver returns above), but written as
      // a real branch rather than a non-null assertion: `0 0 nullpx` is
      // not a length, and a column that silently loses its flex basis is
      // a worse failure than one that lets the row size it.
      style={width === null ? undefined : { width, flex: `0 0 ${width}px` }}
    >
      <div className="col-header col-queues-header">
        <span className="col-queues-heading">
          {t('title')}
          {/* Printed at every value, zero included — the dim/500 variant
              carries "empty" (see `.col-header-count` in index.css). */}
          <span
            className={
              queuesTotal === 0
                ? 'col-header-count col-count-empty'
                : 'col-header-count'
            }
            // "Queues 7" alone is ambiguous to a screen reader — spell
            // out what the number counts (WCAG 1.3.1).
            aria-label={t('totalCountAria', { count: queuesTotal })}
          >
            {queuesTotal}
          </span>
        </span>
        <button
          type="button"
          className="col-header-btn"
          aria-expanded
          aria-label={t('collapseColumn')}
          onClick={() => setInboxCollapsed(true)}
        >
          {/* sk-285.7.2.49 — §6 "Column (general)" names this control's
              icon by name (`layout-sidebar-left-collapse`), and the
              artboard draws it at 20px. It was the character `−`,
              which is a minus sign standing in for a picture of a
              folding panel: it says nothing about what folds or which
              way, and it cannot be put on §8's stroke or scale. */}
          <IconLayoutSidebarLeftCollapse size={20} stroke={1.75} aria-hidden />
        </button>
      </div>
      {content}
    </div>
  );
}

/**
 * sk-674.18 T054 (review TS-W1) — one of the two reads of the Inbox tab
 * failed while the other answered: said in place, above the cards that did
 * come, with a way to read it again.
 */
function PartialReadFailure({
  message,
  retryLabel,
  onRetry,
}: {
  message: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <div className="col-empty col-error" role="alert">
      {message}{' '}
      <button type="button" className="invitation-card-link" onClick={onRetry}>
        {retryLabel}
      </button>
    </div>
  );
}
