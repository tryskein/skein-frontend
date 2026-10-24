/**
 * sk-303.13 (T028, test matrix row 42) — the Watching tab as a list of
 * SUBSCRIPTIONS: one card per subscription, an honest number, and an
 * empty state that names the right cause.
 *
 * Four properties, each of which was a real defect before the fix:
 *
 *   1. **The card is the subscription, not the issue with activity.** A
 *      subtree subscription on an ancestor gathers its descendants'
 *      activity onto ONE card. The card that must NOT appear is the one
 *      per descendant — there is no subscription on a descendant, so
 *      such a card would offer an unsubscribe that removes something
 *      else, and one busy tree would push everything else off screen.
 *   2. **The two issues on that card stay apart.** The title is the
 *      subscription; an activity row is wherever the activity happened,
 *      and clicking it goes THERE, not to the ancestor.
 *   3. **The number is the server's total, never the sum of the cards.**
 *      Cards are capped at 100 and the header badge is not, so summing
 *      makes the two numbers under one word disagree the moment a user
 *      passes the cap (INV-3 / US-7). When the list IS a prefix it says
 *      so out loud.
 *   4. **Empty says why.** Four causes — four different true answers, and
 *      each with a link to settings (US-5). The wording rules live in
 *      `lib/__tests__/watchingEmptiness.test.ts`; this file pins that
 *      the column renders the right one at the right time, including
 *      the case that has cards on screen and still owes an explanation.
 *
 * sk-622.21 — a fifth: **a historical card is a card you
 * can remove, not a subscription you can leave** (US-5, US-6). It has no
 * reasons and no subscription time; its × and the select strip say
 * «remove», never «unsubscribe»; its click is «read card X» (US-7) like
 * any other card; and the bulk answer's `historicalRemoved` is shown.
 *
 * Everything is driven through `InboxColumn` rather than through the
 * card in isolation: the ancestor/descendant split is only half a
 * component decision — the other half is which id the column navigates
 * to, and a card-only test would pass with the column wired backwards.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import type {
  NotificationItem,
  WatchingItem,
  WatchingListResponse,
} from '../../../api/notifications';
import type { BulkUnwatchResult } from '../../../api/watchers';
import i18n from '../../../i18n/config';

let watching: WatchingListResponse;
let channelsOff: boolean | null = null;
let inboxTab: 'inbox' | 'mentions' | 'watching' = 'watching';
const setInboxTab = vi.fn((tab: 'inbox' | 'mentions' | 'watching') => {
  inboxTab = tab;
});
const selectInboxIssue = vi.fn();
const reportQueueFell = vi.fn();
const markCardReadMutate = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
const unwatchMutate = vi.fn();

const bulkUnwatchMutate = vi.fn();
vi.mock('../../../lib/useLayoutState', () => ({
  useLayoutState: () => ({
    setInboxCollapsed: vi.fn(),
    selectedIssue: null,
    selectInboxIssue,
    inboxTab,
    setInboxTab,
    reportQueueFell,
  }),
}));
vi.mock('../../../lib/useInbox', () => ({
  useInbox: () => ({ data: { items: [] }, isSuccess: true }),
}));
// sk-674.18 T054 — the invitation cards and «my spaces» of the column:
// none here, one space (the cards keep their project handles).
vi.mock('../../../lib/useMyInvitations', () => ({
  useMyInvitations: () => ({ data: { items: [] }, isSuccess: true }),
}));
vi.mock('../../../lib/useMySpaces', () => ({
  useMySpaces: () => ({ data: undefined }),
}));
vi.mock('../../../lib/useMentions', () => ({
  useMentions: () => ({ data: { items: [] }, isSuccess: true }),
}));
const useWatchingSpy = vi.fn();
let placeholder = false;
vi.mock('../../../lib/useWatching', () => ({
  useWatching: (state: string) => {
    useWatchingSpy(state);
    return { data: watching, isSuccess: true, isPlaceholderData: placeholder };
  },
}));
vi.mock('../../../lib/useReasonPrefsProbe', () => ({
  useFeedChannelsAllOff: () => channelsOff,
}));
vi.mock('../../../lib/useProjectsList', () => ({
  useProjectsList: () => ({ data: { items: [{ id: 'p1', idPrefix: 'sk' }] } }),
}));
vi.mock('../../../lib/useMarkNotificationsRead', () => ({
  useMarkNotificationsRead: () => ({ mutate: vi.fn() }),
}));
// sk-622.21 (US-7) — the card's click is «read card X».
vi.mock('../../../lib/useMarkWatchingCardRead', () => ({
  useMarkWatchingCardRead: () => ({ mutate: markCardReadMutate }),
}));
vi.mock('../../../components/Toaster', () => ({
  useToaster: () => ({ success: toastSuccess, error: toastError, info: vi.fn() }),
}));
vi.mock('../../../lib/useUnwatch', () => ({ useUnwatch: () => ({ mutate: unwatchMutate }) }));
vi.mock('../../../lib/useBulkUnwatch', () => ({
  useBulkUnwatch: () => ({ mutate: bulkUnwatchMutate, isPending: false }),
}));
vi.mock('../../../lib/useReminders', () => ({ useRingingIssueIds: () => new Set() }));

import { InboxColumn } from '../InboxColumn';

/**
 * A string of the column's own dictionary (`inbox` namespace), by key.
 * Copy is not a contract (the project guidelines): where a test is about
 * WHICH message is shown and with WHICH numbers, it names the key and the
 * values, and a rewording of the sentence leaves it green.
 */
const tx = (key: string, opts?: Record<string, unknown>) => i18n.t(`inbox:${key}`, opts);

// ── fixtures ────────────────────────────────────────────────────────

function ev(id: number, onIssue: string): NotificationItem {
  return {
    id,
    type: 'comment.created',
    createdAt: '2026-08-30T10:00:00Z',
    readAt: null,
    archivedAt: null,
    actor: { username: 'alice', userId: 'u1', type: 'human' },
    entity: {
      type: 'issue',
      id: onIssue,
      title: `title of ${onIssue}`,
      projectId: 'p1',
      projectIdPrefix: 'sk',
    },
    summary: `alice commented on ${onIssue}`,
    field: null,
    oldValue: null,
    newValue: null,
  };
}

function sub(id: string, unread: number, events: NotificationItem[]): WatchingItem {
  return {
    item: { id, title: `Task ${id}`, projectId: 'p1' } as never,
    reasons: ['creator'],
    unreadEventsCount: unread,
    recentEvents: events,
    since: '2026-01-01T00:00:00Z',
  };
}

function response(over: Partial<WatchingListResponse>): WatchingListResponse {
  const items = over.items ?? [];
  const subscriptionsTotal = over.subscriptionsTotal ?? items.length;
  // sk-551.10 — fixtures default to the «open» filter the column starts
  // on, with every subscription open.
  return {
    items,
    unreadTotal: items.reduce((a, it) => a + it.unreadEventsCount, 0),
    subscriptionsTotal,
    truncated: false,
    state: 'open',
    stateTotal: subscriptionsTotal,
    openTotal: subscriptionsTotal,
    closedTotal: 0,
    closedAutoTotal: 0,
    ...over,
  };
}

// sk-285.7 T027 — the column's queue picker is a Mantine `<Select>`
// (it replaced the pill tab row), so the provider is required here.
const columnTree = () => (
  <MantineProvider>
    <MemoryRouter>
      <InboxColumn collapsed={false} width={340} />
    </MemoryRouter>
  </MantineProvider>
);

function mount() {
  return render(columnTree());
}

const cards = () =>
  Array.from(document.querySelectorAll<HTMLElement>('.watching-card'));

// sk-551.33 — the select-mode icon on the counter line, and a card's
// head button (its name carries the title; in select mode it is a toggle).
const selectIcon = () => screen.getByRole('button', { name: 'Select several' });
const enterSelectMode = () => fireEvent.click(selectIcon());
const cardHead = (id: string) =>
  screen.getByRole('button', { name: new RegExp(`Task ${id}\\b`) });

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  channelsOff = null;
  inboxTab = 'watching';
  placeholder = false;
  watching = response({});
});

// ── 1 + 2: the ancestor card ────────────────────────────────────────

describe('row 42 — a subtree subscription is one card, and it is the ancestor', () => {
  beforeEach(() => {
    // Three descendants active, one event on the ancestor itself.
    watching = response({
      items: [
        sub('sk-42', 4, [
          ev(1, 'sk-42.1'),
          ev(2, 'sk-42.3.7'),
          ev(3, 'sk-42'),
          ev(4, 'sk-42.1'),
        ]),
      ],
    });
  });

  test('one card, titled with the subscribed issue', () => {
    mount();
    expect(cards()).toHaveLength(1);
    expect(within(cards()[0]).getByText('Task sk-42')).toBeTruthy();
  });

  test('no card is created for any descendant', () => {
    mount();
    // The thing that must not exist: a card head naming a descendant.
    // Asserted on the heads themselves rather than on an accessible name
    // pattern, so the test cannot pass merely because the naming changed.
    const heads = Array.from(
      document.querySelectorAll<HTMLElement>('.watching-card-header'),
    );
    expect(heads).toHaveLength(1);
    for (const descendant of ['sk-42.1', 'sk-42.3.7']) {
      expect(heads[0].textContent).not.toContain(descendant);
    }
  });

  test('the card says its activity comes from below, and only when it does', () => {
    mount();
    expect(document.querySelector('.watching-card-subtree-note')).not.toBeNull();

    cleanup();
    watching = response({ items: [sub('sk-7', 1, [ev(9, 'sk-7')])] });
    mount();
    // An exact subscription is not decorated with an explanation of
    // something that is not happening to it.
    expect(document.querySelector('.watching-card-subtree-note')).toBeNull();
  });

  test('a descendant row opens the DESCENDANT, not the card it sits on', () => {
    mount();
    fireEvent.click(
      // The id badge splits a hierarchical id across two spans, so the
      // computed name reads «sk-42. 1» — hence the tolerant separator.
      screen.getAllByRole('button', {
        name: /Open descendant issue:\s*sk-42\.\s*1\s/,
      })[0],
    );
    expect(selectInboxIssue).toHaveBeenCalledWith('sk-42.1', 'sk');
    // …and it is not silently acknowledging the whole subscription.
    expect(markCardReadMutate).not.toHaveBeenCalled();
  });

  test('a row about the subscribed issue keeps the old behaviour', () => {
    mount();
    // The activity row recorded on the issue itself reads the card
    // (US-7) and opens it — the old «click anywhere on the card».
    fireEvent.click(screen.getByRole('button', { name: /Open sk-42:/ }));
    expect(markCardReadMutate).toHaveBeenCalledWith('sk-42');
    expect(selectInboxIssue).toHaveBeenCalledWith('sk-42', 'sk');
  });

  test('the card head does the same', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /^Open issue,/ }));
    expect(markCardReadMutate).toHaveBeenCalledWith('sk-42');
    expect(selectInboxIssue).toHaveBeenCalledWith('sk-42', 'sk');
  });

  test('unsubscribe removes the ANCESTOR subscription, and the control says so', () => {
    mount();
    const x = screen.getByRole('button', {
      name: 'Unsubscribe from sk-42 — the issue and its descendants',
    });
    fireEvent.click(x);
    expect(unwatchMutate).toHaveBeenCalledWith('sk-42');
    // Never the descendant whose activity the user was reading.
    expect(unwatchMutate).not.toHaveBeenCalledWith('sk-42.1');
  });
});

describe('row 42 — overlapping subscriptions stay two separate cards', () => {
  test('an exact subscription on a descendant is its own card, its own unsubscribe', () => {
    // INV-4 on the server: the notification is attributed to the exact
    // subscription, not to the ancestor. The UI consequence is that the
    // user sees two things he can leave independently, and leaving one
    // does not name the other.
    watching = response({
      items: [sub('sk-42', 1, [ev(1, 'sk-42.9')]), sub('sk-42.1', 2, [ev(2, 'sk-42.1')])],
    });
    mount();
    expect(cards()).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe from sk-42.1' }));
    expect(unwatchMutate).toHaveBeenCalledTimes(1);
    expect(unwatchMutate).toHaveBeenCalledWith('sk-42.1');
  });
});

describe('sk-303.13.2.10 (W2/W4) — what is on screen is what is announced', () => {
  beforeEach(() => {
    watching = response({
      items: [
        sub('sk-42', 2, [ev(1, 'sk-42.1'), ev(2, 'sk-42')]),
      ],
    });
  });

  /**
   * Accessible names of the buttons matching `pick`, collected through
   * Testing Library's own name computation (a matcher function receives
   * the computed name and the element). Going through the query rather
   * than importing an accname implementation keeps this test measuring
   * what the role-and-name queries elsewhere in the suite measure.
   */
  const namesOf = (pick: (el: Element) => boolean): string[] => {
    const out: string[] = [];
    screen.queryAllByRole('button', {
      name: (name: string, el: Element) => {
        if (pick(el)) out.push(name);
        return false;
      },
    });
    return out;
  };

  test('the card head announces the id, the title, the reasons and the subtree note', () => {
    // Before: one `aria-label` replaced all of it, so a screen reader
    // heard neither the reason it is subscribed nor that the activity
    // below comes from descendants (WCAG 2.5.3).
    mount();
    const [name] = namesOf((el) => el.classList.contains('watching-card-body'));
    for (const visible of [
      'sk-42',
      'Task sk-42',
      'creator',
      'watching this issue and its descendants',
    ]) {
      expect(name).toContain(visible);
    }
  });

  test('an activity row announces the event, not a generic "open"', () => {
    mount();
    const names = namesOf((el) => el.classList.contains('watching-card-event-open'));
    expect(names).toHaveLength(2);
    // Two rows about two different things must not sound identical.
    expect(new Set(names).size).toBe(2);
    for (const name of names) expect(name).toContain('alice');
  });

  test('the time beside a row is attached to it as a description', () => {
    mount();
    const row = document.querySelector('.watching-card-event-open')!;
    const describedBy = row.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const timeEl = document.getElementById(describedBy!);
    expect(timeEl).not.toBeNull();
    expect(timeEl!.className).toContain('outbox-card-event-time');
  });

  test('the empty-state explanation is a live region, like the truncation banner', () => {
    watching = response({ items: [], unreadTotal: 0, subscriptionsTotal: 0, truncated: false });
    mount();
    const block = document.querySelector('[data-empty-kind="no-subscriptions"]')!;
    expect(block.getAttribute('role')).toBe('status');
  });
});

// ── 3: the number ───────────────────────────────────────────────────

describe('row 42 — the column shows the full total or admits the list is a prefix', () => {
  test('past the card cap the tab shows the uncapped total, not the sum of cards', () => {
    const items = Array.from({ length: 100 }, (_, i) => sub(`sk-${i}`, 1, []));
    watching = response({ items, unreadTotal: 137, subscriptionsTotal: 150, truncated: true });
    mount();
    // 100 is what summing the cards would give; 137 is the truth, and
    // the same number the header badge shows. Read off the queue picker
    // that replaced the tab strip (sk-285.7 / T027): the closed control
    // spells «<queue> <count>» for the queue on screen.
    const picker = screen.getByRole('textbox', { name: 'Queue' }) as HTMLInputElement;
    expect(picker.value).toBe('Watching 137');
  });

  test('…and the list says out loud that it is showing part of the subscriptions', () => {
    const items = Array.from({ length: 100 }, (_, i) => sub(`sk-${i}`, 1, []));
    watching = response({ items, unreadTotal: 137, subscriptionsTotal: 150, truncated: true });
    mount();
    const notice = document.querySelector('.watching-truncated');
    expect(notice).not.toBeNull();
    // By key (§5): the copy is the truncation notice with the shown and
    // the uncapped numbers.
    expect(notice!.textContent).toBe(tx('watching.truncated', { shown: 100, total: 150 }));
  });

  test('and it says so before the list, not only after 100 cards (W8)', () => {
    // sk-303.13.2.10 (FE-G2 / W8). The caveat used to sit under the last
    // card: a reader who never scrolled that far was shown a prefix as
    // if it were the whole list, which is the defect US-7 exists for.
    const items = Array.from({ length: 100 }, (_, i) => sub(`sk-${i}`, 1, []));
    watching = response({ items, unreadTotal: 137, subscriptionsTotal: 150, truncated: true });
    mount();
    // sk-551.10 — the caveat before the list is now «showing 100» on the
    // filter line, beside the number it qualifies; the copy under the
    // last card stays.
    const leading = document.querySelector('.watching-filter-shown')!;
    expect(leading).not.toBeNull();
    expect(leading.textContent).toMatch(/showing 100/);
    const firstCard = document.querySelector('.watching-card')!;
    // DOCUMENT_POSITION_FOLLOWING — the leading caveat precedes the first card.
    expect(
      leading.compareDocumentPosition(firstCard) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Announced once, not twice: the line above is the live region, the
    // repeat under the list is hidden from the reader.
    expect(leading.closest('[role="status"]')).not.toBeNull();
    const trailing = Array.from(document.querySelectorAll('.watching-truncated'));
    expect(trailing).toHaveLength(1);
    expect(trailing[0].getAttribute('aria-hidden')).toBe('true');
  });

  test('a complete list gets neither copy', () => {
    watching = response({ items: [sub('sk-1', 1, [])] });
    mount();
    expect(document.querySelectorAll('.watching-truncated')).toHaveLength(0);
    expect(document.querySelector('.watching-filter-shown')).toBeNull();
  });

  test('a complete list makes no such claim', () => {
    watching = response({ items: [sub('sk-1', 1, [])] });
    mount();
    expect(document.querySelector('.watching-truncated')).toBeNull();
  });
});

/**
 * sk-303.13.2.10 (W3) — the queue picker keeps the promise its role makes.
 *
 * The finding this suite was written for: the column's queue selector
 * declared `role="tablist"`, which promises the WAI-ARIA tabs keyboard
 * model, and implemented none of it — every tab sat in the normal tab
 * order and the arrow keys did nothing.
 *
 * The strip itself is gone: sk-285.7 (T027) replaced the pill row with a
 * single Mantine `<Select>`, because four pills wrapped onto two lines at
 * the column's default width. That is why these tests no longer look for
 * `role="tab"` — but the PROMISE is exactly the same one, so it is still
 * checked here rather than dropped with the widget. A combobox owes: one
 * tab stop, arrows that walk the options, Home / End to the ends, and a
 * key it does not claim left to the browser.
 */
describe('sk-303.13.2.10 (W3) — the queue picker keeps the promise its role makes', () => {
  const picker = () => screen.getByRole('textbox', { name: 'Queue' }) as HTMLInputElement;
  // Mantine's combobox reads `event.code`, not `event.key`; a keyDown
  // without it is silently ignored and every assertion below would pass
  // vacuously in the "nothing happened" direction.
  const press = (key: string) => fireEvent.keyDown(picker(), { key, code: key });

  test('the picker is ONE tab stop, not one per queue', () => {
    mount();
    // The whole point of the replacement: three pills were three stops
    // in the Tab order (or, with a roving tabindex, three elements whose
    // tabindex had to be kept in step). A combobox is one control.
    expect(screen.getAllByRole('textbox', { name: 'Queue' })).toHaveLength(1);
    expect(picker().getAttribute('tabindex')).not.toBe('-1');
  });

  test('arrows walk the queues and Enter commits', () => {
    mount();
    picker().focus();
    // The first ArrowDown opens the list on the CURRENT selection
    // (Watching, last of the three); the second wraps to the first.
    press('ArrowDown');
    expect(screen.getAllByRole('option')).toHaveLength(3);
    press('ArrowDown');
    press('Enter');
    // Asserted on the setter, not on the input's value: `inboxTab` is a
    // module-level let in this file's stub, so writing it does not
    // re-render the column the way the real provider would.
    expect(setInboxTab).toHaveBeenLastCalledWith('inbox');
  });

  test('Home and End jump to the ends', () => {
    // These two are the column's own handler, not Mantine's: checked in
    // @mantine/core 7.17.8, the combobox target owns ArrowDown, ArrowUp,
    // Enter, Escape and Space and lets Home / End through untouched. They
    // commit on the move (automatic activation), the way they did on the
    // tab strip this replaced — so there is no Enter after them.
    mount();
    picker().focus();
    press('Home');
    expect(setInboxTab).toHaveBeenLastCalledWith('inbox');
    cleanup();
    setInboxTab.mockClear();
    inboxTab = 'inbox';
    mount();
    picker().focus();
    press('End');
    expect(setInboxTab).toHaveBeenLastCalledWith('watching');
  });

  test('a key the pattern does not claim is left to the browser', () => {
    mount();
    const ev = new KeyboardEvent('keydown', {
      key: 'a',
      code: 'KeyA',
      bubbles: true,
      cancelable: true,
    });
    picker().dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  test('Escape closes the list and leaves the selection alone', () => {
    mount();
    picker().focus();
    press('ArrowDown');
    expect(screen.getAllByRole('option')).toHaveLength(3);
    press('Escape');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(picker().value).toMatch(/^Watching /);
  });
});

describe('sk-303.13.2.10 (W7) — a quiet subscription is not a faded one', () => {
  test('a card with nothing unread is not dimmed', () => {
    // The stylesheet greyed every acknowledged card to opacity 0.55,
    // which on the honest quiet state ("40 subscriptions, no events yet")
    // painted forty live subscriptions as if the user had left them.
    watching = response({ items: [sub('sk-1', 0, [])], unreadTotal: 0, subscriptionsTotal: 1, truncated: false });
    mount();
    expect(cards()[0].className).not.toContain('dimmed');
  });

  test('…and neither is one with unread events', () => {
    watching = response({ items: [sub('sk-1', 3, [ev(1, 'sk-1')])] });
    mount();
    expect(cards()[0].className).not.toContain('dimmed');
  });
});

// ── 4: the four empty states ───────────────────────────────────────

describe('row 42 — an empty feed names its cause and links to settings', () => {
  test('no subscriptions at all', () => {
    watching = response({ items: [], unreadTotal: 0, subscriptionsTotal: 0, truncated: false });
    mount();
    const block = document.querySelector('[data-empty-kind="no-subscriptions"]');
    expect(block).not.toBeNull();
    expect(block!.textContent).toMatch(/You're not watching/);
    expect(block!.textContent).not.toMatch(/feed channel is off/);
    expect(
      screen.getByRole('link', { name: 'Notification settings' }).getAttribute('href'),
    ).toBe('/settings/notifications');
  });

  test('subscriptions exist but nothing arrived — cards stay, explanation appears', () => {
    // The state the old single line got most wrong: forty live
    // subscriptions and a quiet week, reported as "not watching
    // anything". Note the cards ARE on screen; the explanation is not an
    // alternative to the list, it is a caption on it.
    watching = response({ items: [sub('sk-1', 0, [])], unreadTotal: 0, subscriptionsTotal: 40, truncated: false });
    channelsOff = false;
    mount();
    const block = document.querySelector('[data-empty-kind="no-matching-events"]');
    expect(block!.textContent).toContain(tx('watching.empty.no-matching-events', { total: 40 }));
    expect(block!.textContent).not.toMatch(/feed channel is off/);
    expect(block!.textContent).not.toMatch(/have been read/);
    expect(screen.getByRole('button', { name: /Task sk-1/ })).toBeTruthy();
  });

  test('every feed channel off — the link becomes the fix', () => {
    watching = response({ items: [sub('sk-1', 0, [])], unreadTotal: 0, subscriptionsTotal: 40, truncated: false });
    channelsOff = true;
    mount();
    const block = document.querySelector('[data-empty-kind="feed-channels-off"]');
    expect(block!.textContent).toMatch(/feed channel is off/);
    expect(block!.textContent).not.toMatch(/No new events/);
    expect(block!.textContent).not.toMatch(/have been read/);
    expect(
      screen.getByRole('link', { name: 'Enable channels in notification settings' }),
    ).toBeTruthy();
  });

  test('an unknown settings answer does not become an accusation', () => {
    watching = response({ items: [sub('sk-1', 0, [])], unreadTotal: 0, subscriptionsTotal: 40, truncated: false });
    channelsOff = null;
    mount();
    expect(document.querySelector('[data-empty-kind="feed-channels-off"]')).toBeNull();
    expect(document.querySelector('[data-empty-kind="no-matching-events"]')).not.toBeNull();
  });

  test('all read is not "no events yet" — the caption matches the timeline', () => {
    // sk-303.13.2.10 (FE-G2 / W1). The card below carries a delivered,
    // already-read comment; the old caption asserted above it that no
    // events had arrived.
    watching = response({
      items: [sub('sk-1', 0, [{ ...ev(1, 'sk-1'), readAt: '2026-08-30T11:00:00Z' }])],
      unreadTotal: 0,
      subscriptionsTotal: 1,
      truncated: false,
    });
    channelsOff = false;
    mount();
    const block = document.querySelector('[data-empty-kind="all-read"]');
    expect(block).not.toBeNull();
    expect(block!.textContent).toMatch(/have been read/);
    expect(block!.textContent).not.toMatch(/No new events/);
    expect(document.querySelector('[data-empty-kind="no-matching-events"]')).toBeNull();
  });

  test('with activity there is no empty-state block at all', () => {
    watching = response({ items: [sub('sk-1', 3, [ev(1, 'sk-1')])] });
    mount();
    expect(document.querySelector('[data-empty-kind]')).toBeNull();
  });
});

// ── sk-551.10: the Open / Closed / All filter ───────────────────────

describe('sk-551.10 — the filter and its number', () => {
  test('the list asks for open subscriptions first', () => {
    watching = response({ items: [sub('sk-1', 0, [])] });
    mount();
    expect(useWatchingSpy).toHaveBeenLastCalledWith('open');
    expect(screen.getByRole('radio', { name: 'Open' })).toHaveProperty('checked', true);
  });

  test('choosing «Closed» re-asks the server for closed ones', () => {
    watching = response({ items: [sub('sk-1', 0, [])] });
    mount();
    fireEvent.click(screen.getByRole('radio', { name: 'Closed' }));
    expect(useWatchingSpy).toHaveBeenLastCalledWith('closed');
  });

  test('the line under the filter is the size of the variant the numbers belong to', () => {
    watching = response({
      items: [sub('sk-1', 0, [])],
      state: 'closed',
      stateTotal: 2976,
      subscriptionsTotal: 3356,
      openTotal: 380,
      closedTotal: 2976,
    });
    mount();
    const line = document.querySelector('.watching-filter-total')!;
    expect(line.textContent).toBe('Closed: 2,976');
  });

  test('an empty variant says so, instead of «unavailable» or «not watching»', () => {
    watching = response({
      items: [],
      unreadTotal: 5,
      state: 'closed',
      stateTotal: 0,
      subscriptionsTotal: 12,
      openTotal: 12,
      closedTotal: 0,
    });
    mount();
    const block = document.querySelector('[data-empty-kind="filter-empty"]');
    expect(block!.textContent).toBe(tx('watching.filterEmpty.closed'));
    expect(document.querySelector('[data-empty-kind="no-subscriptions"]')).toBeNull();
    expect(screen.queryByText(/currently unavailable/)).toBeNull();
  });

  test('ⓘ explains what watching is, on hover', async () => {
    watching = response({ items: [sub('sk-1', 0, [])] });
    mount();
    const explain = screen.getByRole('button', { name: /what is watching/ });
    fireEvent.mouseEnter(explain);
    expect(
      (await screen.findByRole('tooltip')).textContent,
    ).toMatch(/doesn't assign anything to you/);
  });

  test('the queue number is explained: unread updates, not subscriptions', async () => {
    watching = response({ items: [sub('sk-1', 3, [])], unreadTotal: 3 });
    mount();
    const picker = screen.getByRole('textbox', { name: 'Queue' });
    fireEvent.mouseEnter(picker);
    expect((await screen.findByRole('tooltip')).textContent).toMatch(
      /Watching 3 — unread updates on issues you watch/,
    );
  });
});

// ── sk-551.10: bulk unwatch ─────────────────────────────────────────

describe('sk-551.10 — stop watching many at once', () => {
  const closedFilter = (over: Partial<WatchingListResponse> = {}) =>
    response({
      items: [sub('sk-1', 0, []), sub('sk-2', 0, [])],
      state: 'closed',
      stateTotal: 5,
      subscriptionsTotal: 9,
      openTotal: 4,
      closedTotal: 5,
      closedAutoTotal: 3,
      ...over,
    });

  test('«Stop watching closed» is offered on Closed, with what it will take', () => {
    watching = closedFilter();
    mount();
    expect(screen.getByRole('button', { name: 'Stop watching closed · 3' })).toBeTruthy();
  });

  test('…and not on Open, where it would sweep what is still needed', () => {
    watching = response({
      items: [sub('sk-1', 0, [])],
      state: 'open',
      closedTotal: 5,
      closedAutoTotal: 3,
    });
    mount();
    expect(screen.queryByRole('button', { name: /Stop watching closed/ })).toBeNull();
  });

  test('…nor when every closed subscription is manual', () => {
    watching = closedFilter({ closedAutoTotal: 0 });
    mount();
    expect(screen.queryByRole('button', { name: /Stop watching closed/ })).toBeNull();
  });

  test('it asks first, names the number and the kept manual ones, then sweeps by state', async () => {
    watching = closedFilter();
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Stop watching closed · 3' }));
    expect(bulkUnwatchMutate).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    // By dictionary key and number, not by wording (§5): the body names the
    // auto-total, the second paragraph the kept manual ones.
    expect(dialog.textContent).toContain(tx('watching.actions.confirmBody', { n: '3' }));
    expect(dialog.textContent).toContain(tx('watching.actions.confirmKeptManual', { n: '2' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop watching · 3' }));
    expect(bulkUnwatchMutate).toHaveBeenCalledTimes(1);
    expect(bulkUnwatchMutate.mock.calls[0][0]).toEqual({ state: 'closed' });
  });

  test('multi-select stops exactly the ticked cards', () => {
    watching = response({ items: [sub('sk-1', 0, []), sub('sk-2', 0, []), sub('sk-3', 0, [])] });
    mount();
    enterSelectMode();
    const stop = screen.getByRole('button', { name: /^Stop watching · \d/ });
    expect(stop).toHaveProperty('disabled', true);
    fireEvent.click(cardHead('sk-1'));
    fireEvent.click(cardHead('sk-3'));
    expect(screen.getByText('Selected 2')).toBeTruthy();
    // Ticking a card is not opening the issue.
    expect(selectInboxIssue).not.toHaveBeenCalled();
    fireEvent.click(stop);
    expect(bulkUnwatchMutate.mock.calls[0][0]).toEqual({ issueIds: ['sk-1', 'sk-3'] });
  });

  test('the × says the automatic subscription will not come back', async () => {
    watching = response({ items: [sub('sk-1', 0, [])] });
    mount();
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Unsubscribe from sk-1' }));
    expect((await screen.findByRole('tooltip')).textContent).toMatch(
      /automatic subscription won't come back/,
    );
  });
});

describe('sk-551.10 — a reason chip explains itself', () => {
  test('«creator» says what it means and that agents\' subtasks do not subscribe', async () => {
    watching = response({ items: [sub('sk-1', 0, [])] });
    mount();
    const chip = document.querySelector('.watching-card-reason.creator')!;
    fireEvent.mouseEnter(chip);
    const tip = (await screen.findByRole('tooltip')).textContent ?? '';
    expect(tip).toMatch(/you created this issue/);
    expect(tip).toMatch(/subtasks your agents file don't subscribe you/);
  });
});

describe('sk-551.10 review — no bulk action on a placeholder list', () => {
  test('while the chosen filter loads, the previous cards offer neither sweep nor selection', () => {
    watching = response({
      items: [sub('sk-1', 0, [])],
      state: 'closed',
      closedTotal: 3,
      closedAutoTotal: 3,
    });
    placeholder = true;
    mount();
    expect(screen.queryByRole('button', { name: /Stop watching closed/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Select several' })).toBeNull();
    // sk-551.33 — nor the Ctrl / Cmd click: it opens the card as a plain
    // click does, and no select mode starts.
    fireEvent.click(cardHead('sk-1'), { ctrlKey: true });
    expect(screen.queryByText(/^Selected/)).toBeNull();
    expect(selectInboxIssue).toHaveBeenCalledWith('sk-1', 'sk');
  });
});

describe('sk-551.10 review — keyboard reach', () => {
  test('a reason hint is part of the card button description, not only a hover', () => {
    watching = response({ items: [sub('sk-1', 0, [])] });
    mount();
    const card = screen.getByRole('button', { name: /Task sk-1/ });
    const ids = (card.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean);
    const described = ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
    expect(described).toMatch(/you created this issue/);
  });

  test('leaving select mode by «Cancel» returns focus to the select-mode icon', () => {
    watching = response({ items: [sub('sk-1', 0, [])] });
    mount();
    enterSelectMode();
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    cancel.focus();
    fireEvent.click(cancel);
    expect(document.activeElement).toBe(selectIcon());
  });

  test('…and so does a finished «Stop watching selected»', () => {
    watching = response({ items: [sub('sk-1', 0, []), sub('sk-2', 0, [])] });
    bulkUnwatchMutate.mockImplementationOnce(
      (_input: unknown, opts?: { onSuccess?: (r: BulkUnwatchResult) => void }) =>
        opts?.onSuccess?.({ unwatched: 1, keptManual: 0, historicalRemoved: 0 }),
    );
    mount();
    enterSelectMode();
    fireEvent.click(cardHead('sk-1'));
    fireEvent.click(screen.getByRole('button', { name: /^Stop watching · \d/ }));
    expect(document.activeElement).toBe(selectIcon());
  });

  test('the confirmation spells the number as the button does', async () => {
    watching = response({
      items: [sub('sk-1', 0, [])],
      state: 'closed',
      closedTotal: 2980,
      closedAutoTotal: 2976,
    });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Stop watching closed · 2,976' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain(tx('watching.actions.confirmBody', { n: '2,976' }));
    expect(within(dialog).getByRole('button', { name: 'Stop watching · 2,976' })).toBeTruthy();
  });
});

describe('sk-551.10 review — a bulk unwatch that empties the list', () => {
  function emptyOnSuccess() {
    bulkUnwatchMutate.mockImplementationOnce(
      (_input: unknown, opts?: { onSuccess?: (r: BulkUnwatchResult) => void }) => {
        // What the hook's own onSuccess does to the cache before the
        // call-site callback runs: the stopped card is gone.
        watching = response({ items: [], subscriptionsTotal: 3, stateTotal: 0, openTotal: 0 });
        opts?.onSuccess?.({ unwatched: 1, keptManual: 0, historicalRemoved: 0 });
      },
    );
  }
  function stopTheOnlyCard() {
    enterSelectMode();
    fireEvent.click(cardHead('sk-1'));
    fireEvent.click(screen.getByRole('button', { name: /^Stop watching · \d/ }));
  }

  test('focus goes to the selected filter segment, not to <body>', () => {
    watching = response({ items: [sub('sk-1', 0, [])] });
    emptyOnSuccess();
    mount();
    stopTheOnlyCard();
    expect(screen.queryByRole('button', { name: 'Select several' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Open' }));
  });

  test('…or to the compact dropdown when the column is narrow', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(150);
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(215);
    try {
      watching = response({ items: [sub('sk-1', 0, [])] });
      emptyOnSuccess();
      mount();
      stopTheOnlyCard();
      expect(document.activeElement).toBe(
        screen.getByRole('textbox', { name: tx('watching.filter.aria') }),
      );
    } finally {
      vi.restoreAllMocks();
    }
  });
});

/**
 * sk-551.33 — select mode without a «Select» row and without a checkbox
 * that pushes the text aside (variant G + Ctrl / Cmd click). The
 * acceptance list, case by case: the icon on the counter line enters, a
 * click on the card toggles it, the × gives way to a check, Ctrl / Cmd
 * click outside the mode ticks and enters, Esc leaves.
 */
describe('sk-551.33 — select mode by icon, card click and Ctrl / Cmd click', () => {
  const three = () =>
    response({
      items: [sub('sk-1', 0, [ev(11, 'sk-1')]), sub('sk-2', 0, []), sub('sk-3', 0, [])],
    });

  test('there is no «Select» row: the way in is one icon, a toggle, named «Select several»', async () => {
    watching = three();
    mount();
    expect(screen.queryByRole('button', { name: 'Select' })).toBeNull();
    const icon = selectIcon();
    expect(icon.getAttribute('aria-pressed')).toBe('false');
    fireEvent.mouseEnter(icon);
    expect((await screen.findByRole('tooltip')).textContent).toBe('Select several');
    enterSelectMode();
    expect(selectIcon().getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Selected 0')).toBeTruthy();
  });

  test('in the mode a card head is a toggle: a click ticks it, a second unticks, nothing opens', () => {
    watching = three();
    mount();
    expect(cardHead('sk-2').getAttribute('aria-pressed')).toBeNull();
    enterSelectMode();
    expect(cardHead('sk-2').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(cardHead('sk-2'));
    expect(cardHead('sk-2').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Selected 1')).toBeTruthy();
    fireEvent.click(cardHead('sk-2'));
    expect(cardHead('sk-2').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText('Selected 0')).toBeTruthy();
    expect(selectInboxIssue).not.toHaveBeenCalled();
    expect(markCardReadMutate).not.toHaveBeenCalled();
  });

  test('a click on the activity part of the card ticks it too, and the row stops being «Open»', () => {
    watching = three();
    mount();
    expect(screen.getByRole('button', { name: /^Open sk-1:/ })).toBeTruthy();
    enterSelectMode();
    expect(screen.queryByRole('button', { name: /^Open sk-1:/ })).toBeNull();
    fireEvent.click(cards()[0].querySelector('.watching-card-events li')!);
    expect(cardHead('sk-1').getAttribute('aria-pressed')).toBe('true');
    expect(selectInboxIssue).not.toHaveBeenCalled();
  });

  test('the × gives way while the mode is on and comes back after it', () => {
    watching = three();
    mount();
    expect(screen.getByRole('button', { name: 'Unsubscribe from sk-1' })).toBeTruthy();
    enterSelectMode();
    expect(screen.queryByRole('button', { name: /^Unsubscribe from/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Unsubscribe from sk-1' })).toBeTruthy();
  });

  test.each([
    ['Ctrl', { ctrlKey: true }],
    ['Cmd', { metaKey: true }],
  ] as const)('%s click outside the mode ticks the card and starts the mode', (_key, mod) => {
    watching = three();
    mount();
    fireEvent.click(cardHead('sk-3'), mod);
    expect(selectInboxIssue).not.toHaveBeenCalled();
    expect(selectIcon().getAttribute('aria-pressed')).toBe('true');
    expect(cardHead('sk-3').getAttribute('aria-pressed')).toBe('true');
    expect(cardHead('sk-1').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText('Selected 1')).toBeTruthy();
  });

  test('Ctrl click on the × selects instead of unsubscribing', () => {
    watching = three();
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe from sk-2' }), { ctrlKey: true });
    expect(unwatchMutate).not.toHaveBeenCalled();
    expect(cardHead('sk-2').getAttribute('aria-pressed')).toBe('true');
  });

  // sk-551.33 review — the × and the row buttons are
  // gone in the mode; focus must land on the card head, which stays, or
  // the column's Esc stops hearing the key.
  test.each([
    ['the ×', () => screen.getByRole('button', { name: 'Unsubscribe from sk-1' })],
    ['an activity row', () => screen.getByRole('button', { name: /^Open sk-1:/ })],
  ] as const)('Ctrl click on %s leaves focus on that card head, and Esc then works', (_what, target) => {
    watching = three();
    mount();
    const el = target();
    el.focus();
    fireEvent.click(el, { ctrlKey: true });
    expect(document.activeElement).toBe(cardHead('sk-1'));
    expect(cardHead('sk-1').getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByText(/^Selected/)).toBeNull();
  });

  test('a plain click in the mode puts focus on the card head it ticked', () => {
    watching = three();
    mount();
    enterSelectMode();
    fireEvent.click(cards()[0].querySelector('.watching-card-events li')!);
    expect(document.activeElement).toBe(cardHead('sk-1'));
  });

  test('the icon takes focus when clicked, so Esc right after entering works', () => {
    watching = three();
    mount();
    enterSelectMode();
    expect(document.activeElement).toBe(selectIcon());
    fireEvent.keyDown(selectIcon(), { key: 'Escape' });
    expect(selectIcon().getAttribute('aria-pressed')).toBe('false');
  });

  test('the strip stops the ticked cards, Ctrl-clicked one included', () => {
    watching = three();
    mount();
    fireEvent.click(cardHead('sk-3'), { ctrlKey: true });
    fireEvent.click(cardHead('sk-1'));
    fireEvent.click(screen.getByRole('button', { name: /^Stop watching · \d/ }));
    expect(bulkUnwatchMutate.mock.calls[0][0]).toEqual({ issueIds: ['sk-1', 'sk-3'] });
  });

  test('Esc leaves the mode, drops the selection, returns focus to the icon — and goes no further', () => {
    watching = three();
    const windowEsc = vi.fn();
    window.addEventListener('keydown', windowEsc);
    try {
      mount();
      enterSelectMode();
      fireEvent.click(cardHead('sk-1'));
      cardHead('sk-1').focus();
      fireEvent.keyDown(cardHead('sk-1'), { key: 'Escape' });
      expect(screen.queryByText(/^Selected/)).toBeNull();
      expect(selectIcon().getAttribute('aria-pressed')).toBe('false');
      expect(cardHead('sk-1').getAttribute('aria-pressed')).toBeNull();
      expect(document.activeElement).toBe(selectIcon());
      // The Details column closes the open issue on a window-level Esc;
      // the keystroke that only left select mode must not reach it.
      expect(windowEsc).not.toHaveBeenCalled();
      // Re-entering starts from nothing ticked.
      enterSelectMode();
      expect(screen.getByText('Selected 0')).toBeTruthy();
    } finally {
      window.removeEventListener('keydown', windowEsc);
    }
  });

  test('the icon is also the way out', () => {
    watching = three();
    mount();
    enterSelectMode();
    fireEvent.click(cardHead('sk-2'));
    fireEvent.click(selectIcon());
    expect(screen.queryByText(/^Selected/)).toBeNull();
    expect(cardHead('sk-2').getAttribute('aria-pressed')).toBeNull();
  });
});

// ── sk-622.21 (No. 85): historical cards ────────────────────────────

/** A card without a subscription: no reasons, no subscription time (US-5). */
function historical(id: string, unread: number, events: NotificationItem[]): WatchingItem {
  return { ...sub(id, unread, events), reasons: [], since: null };
}

describe('No. 85 — a historical card is shown, and its action is "remove", never "unsubscribe"', () => {
  test('the card is on screen without a reasons row, and says why it is still there', () => {
    watching = response({ items: [historical('sk-9', 1, [ev(1, 'sk-9')])], subscriptionsTotal: 0, stateTotal: 1, openTotal: 1 });
    mount();
    expect(cards()).toHaveLength(1);
    expect(screen.getByText('Task sk-9')).toBeTruthy();
    expect(cards()[0].querySelector('.watching-card-reasons')).toBeNull();
    expect(within(cards()[0]).getByText(/You no longer watch this/)).toBeTruthy();
  });

  // Review fix — the subtree note used to claim a subscription on a
  // card that has none. By key (§5): the historical note, never the
  // subscription one, while the card still says the activity is below.
  test('with activity below, the note does not speak of a subscription', () => {
    watching = response({ items: [historical('sk-9', 1, [ev(1, 'sk-9.1')])], subscriptionsTotal: 0, stateTotal: 1, openTotal: 1 });
    mount();
    const card = within(cards()[0]);
    expect(card.getByText(tx('watchingCard.subtreeNoteHistorical'))).toBeTruthy();
    expect(card.queryByText(tx('watchingCard.subtreeNote'))).toBeNull();
  });

  test('its × removes the card and is named so — no unsubscribe is offered', () => {
    watching = response({ items: [historical('sk-9', 0, [])], subscriptionsTotal: 0, stateTotal: 1, openTotal: 1 });
    mount();
    expect(screen.queryByRole('button', { name: /Unsubscribe/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove card sk-9' }));
    expect(unwatchMutate).toHaveBeenCalledWith('sk-9');
    // The × is not a click on the card.
    expect(selectInboxIssue).not.toHaveBeenCalled();
  });

  test('its hint speaks of removing the card, not of a subscription that will not come back', async () => {
    watching = response({ items: [historical('sk-9', 0, [])], subscriptionsTotal: 0, stateTotal: 1, openTotal: 1 });
    mount();
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Remove card sk-9' }));
    // By key (§5): the remove hint, not the unsubscribe one.
    const tip = (await screen.findByRole('tooltip')).textContent ?? '';
    expect(tip).toBe(tx('watchingCard.removeHint'));
    expect(tip).not.toBe(tx('watchingCard.unsubscribeHint'));
  });

  test('a subscribed card next to it keeps its unsubscribe', () => {
    watching = response({ items: [historical('sk-9', 0, []), sub('sk-1', 0, [])], subscriptionsTotal: 1, stateTotal: 2, openTotal: 2 });
    mount();
    expect(screen.getByRole('button', { name: 'Unsubscribe from sk-1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove card sk-9' })).toBeTruthy();
  });

  test('selecting only historical cards offers «Remove», and sends them by id', () => {
    watching = response({ items: [historical('sk-9', 0, []), sub('sk-1', 0, [])], subscriptionsTotal: 1, stateTotal: 2, openTotal: 2 });
    mount();
    enterSelectMode();
    fireEvent.click(cardHead('sk-9'));
    expect(screen.queryByRole('button', { name: /^Stop watching/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove · 1' }));
    expect(bulkUnwatchMutate.mock.calls[0][0]).toEqual({ issueIds: ['sk-9'] });
  });

  test('a mixed selection names both actions', () => {
    watching = response({ items: [historical('sk-9', 0, []), sub('sk-1', 0, [])], subscriptionsTotal: 1, stateTotal: 2, openTotal: 2 });
    mount();
    enterSelectMode();
    fireEvent.click(cardHead('sk-9'));
    fireEvent.click(cardHead('sk-1'));
    fireEvent.click(screen.getByRole('button', { name: 'Stop watching / remove · 2' }));
    expect(bulkUnwatchMutate.mock.calls[0][0]).toEqual({ issueIds: ['sk-9', 'sk-1'] });
  });

  test.each([
    ['only historical', ['sk-9'], 'Remove · 1', /Remove the selected cards/],
    ['only subscribed', ['sk-1'], 'Stop watching · 1', /Stop watching the selected issues/],
    ['both kinds', ['sk-9', 'sk-1'], 'Stop watching / remove · 2', /remove the selected cards without one/],
  ])('the select strip hint matches the selection — %s', async (_kind, ids, name, hint) => {
    watching = response({ items: [historical('sk-9', 0, []), sub('sk-1', 0, [])], subscriptionsTotal: 1, stateTotal: 2, openTotal: 2 });
    mount();
    enterSelectMode();
    for (const id of ids) fireEvent.click(cardHead(id));
    fireEvent.mouseEnter(screen.getByRole('button', { name }));
    expect((await screen.findByRole('tooltip')).textContent).toMatch(hint);
  });

  test('a click on a historical card with unread sends «read card X» and opens it', () => {
    watching = response({ items: [historical('sk-9', 2, [ev(1, 'sk-9')])], subscriptionsTotal: 0, stateTotal: 1, openTotal: 1 });
    mount();
    fireEvent.click(cardHead('sk-9'));
    expect(markCardReadMutate).toHaveBeenCalledWith('sk-9');
    expect(selectInboxIssue).toHaveBeenCalledWith('sk-9', 'sk');
  });

  // Regression: `unreadEventsCount` counts the
  // unread INSIDE the Watching window; «read card X» (US-7) also reads the
  // card's unread outside it. A card whose window is all read can still
  // hold an older unread notification — the click must send the read
  // anyway. Red while the click was gated on `unreadEventsCount > 0`.
  test.each([
    ['a subscribed card', () => sub('sk-9', 0, [ev(1, 'sk-9')])],
    ['a historical card', () => historical('sk-9', 0, [ev(1, 'sk-9')])],
  ])('%s with nothing unread in the window still sends «read card X» on click', (_kind, make) => {
    watching = response({ items: [make()], stateTotal: 1, openTotal: 1 });
    mount();
    fireEvent.click(cardHead('sk-9'));
    expect(markCardReadMutate).toHaveBeenCalledTimes(1);
    expect(markCardReadMutate).toHaveBeenCalledWith('sk-9');
    expect(selectInboxIssue).toHaveBeenCalledWith('sk-9', 'sk');
  });

  // Review fix — the caption above the cards counts the cards, both
  // kinds: over a column of historical cards only it used to read «0»
  // (subscriptions) above two visible cards.
  test('the caption over a column of historical cards counts those cards', () => {
    const read = { ...ev(1, 'sk-9'), readAt: '2026-08-30T11:00:00Z' };
    watching = response({
      items: [historical('sk-9', 0, [read]), historical('sk-8', 0, [read])],
      subscriptionsTotal: 0,
      stateTotal: 2,
      openTotal: 2,
    });
    channelsOff = false;
    mount();
    const block = document.querySelector('[data-empty-kind="all-read"]');
    expect(block!.textContent).toContain(tx('watching.empty.all-read', { total: 2 }));
  });

  test('a filter left empty while only historical cards exist says the filter is empty', () => {
    watching = response({
      items: [],
      state: 'open',
      stateTotal: 0,
      subscriptionsTotal: 0,
      openTotal: 0,
      closedTotal: 2,
    });
    mount();
    expect(document.querySelector('[data-empty-kind="filter-empty"]')).not.toBeNull();
    expect(document.querySelector('[data-empty-kind="no-subscriptions"]')).toBeNull();
  });
});

describe('No. 85 — the queue runs dry when the CARDS run out, not the subscriptions', () => {
  // Review fix: the column's content is cards of both kinds (US-5).
  // Leaving the last subscription while a historical card stays is not
  // the queue running dry, and must not fold the column.
  const withCards = (items: WatchingItem[], subscriptionsTotal: number) =>
    response({ items, subscriptionsTotal, stateTotal: items.length, openTotal: items.length });

  test('the last subscription goes, a historical card stays — no fall is reported', () => {
    watching = withCards([sub('sk-1', 0, []), historical('sk-9', 0, [])], 1);
    const view = mount();
    watching = withCards([historical('sk-9', 0, [])], 0);
    view.rerender(columnTree());
    expect(reportQueueFell).not.toHaveBeenCalled();
  });

  test('the last card goes — the fall is reported once', () => {
    watching = withCards([historical('sk-9', 0, [])], 0);
    const view = mount();
    watching = withCards([], 0);
    view.rerender(columnTree());
    expect(reportQueueFell).toHaveBeenCalledTimes(1);
  });
});

describe('No. 85 — a failed bulk action names the action that failed', () => {
  // Review fix: the failure toast always said «couldn't stop
  // watching», also for «Remove». By key (§5), one per selection kind.
  test.each([
    ['only historical', ['sk-9'], 'watching.actions.failedRemove'],
    ['only subscribed', ['sk-1'], 'watching.actions.failed'],
    ['both kinds', ['sk-9', 'sk-1'], 'watching.actions.failedMixed'],
  ])('%s', (_kind, ids, key) => {
    watching = response({ items: [historical('sk-9', 0, []), sub('sk-1', 0, [])], subscriptionsTotal: 1, stateTotal: 2, openTotal: 2 });
    bulkUnwatchMutate.mockImplementationOnce(
      (_input: unknown, opts?: { onError?: (e: Error) => void }) => opts?.onError?.(new Error('boom')),
    );
    mount();
    enterSelectMode();
    for (const id of ids) fireEvent.click(cardHead(id));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`· ${ids.length}$`) }));
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith(tx(key));
  });

  test('the sweep of closed ones keeps «stop watching»', async () => {
    watching = response({
      items: [sub('sk-1', 0, [])],
      state: 'closed',
      stateTotal: 1,
      openTotal: 0,
      closedTotal: 1,
      closedAutoTotal: 1,
    });
    bulkUnwatchMutate.mockImplementationOnce(
      (_input: unknown, opts?: { onError?: (e: Error) => void }) => opts?.onError?.(new Error('boom')),
    );
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Stop watching closed · 1' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop watching · 1' }));
    expect(toastError).toHaveBeenCalledWith(tx('watching.actions.failed'));
  });
});

// Review fix — the contract of US-6 is WHICH confirmation and WHICH
// numbers (`historicalRemoved` among them), not the sentence: asserted by
// dictionary key and values (§5), so a copy edit leaves these green.
describe('No. 85 — the bulk answer with and without `historicalRemoved`', () => {
  function finishWith(result: BulkUnwatchResult) {
    bulkUnwatchMutate.mockImplementationOnce(
      (_input: unknown, opts?: { onSuccess?: (r: BulkUnwatchResult) => void }) =>
        opts?.onSuccess?.(result),
    );
  }
  function stopFirstCard() {
    enterSelectMode();
    fireEvent.click(cardHead('sk-9'));
    fireEvent.click(screen.getByRole('button', { name: /· 1$/ }));
  }

  test('only historical cards went — the confirmation counts them', () => {
    watching = response({ items: [historical('sk-9', 0, [])], subscriptionsTotal: 0, stateTotal: 1, openTotal: 1 });
    finishWith({ unwatched: 0, keptManual: 0, historicalRemoved: 1 });
    mount();
    stopFirstCard();
    expect(toastSuccess).toHaveBeenCalledWith(tx('watching.actions.removedOnly', { h: 1 }));
  });

  test('both kinds went — the confirmation names both numbers', () => {
    watching = response({ items: [historical('sk-9', 0, [])], subscriptionsTotal: 0, stateTotal: 1, openTotal: 1 });
    finishWith({ unwatched: 3, keptManual: 0, historicalRemoved: 2 });
    mount();
    stopFirstCard();
    expect(toastSuccess).toHaveBeenCalledWith(
      tx('watching.actions.doneWithRemoved', { n: 3, h: 2 }),
    );
  });

  test('no historical card went — the confirmation is the plain one', () => {
    watching = response({ items: [sub('sk-9', 0, [])] });
    finishWith({ unwatched: 1, keptManual: 0, historicalRemoved: 0 });
    mount();
    stopFirstCard();
    expect(toastSuccess).toHaveBeenCalledWith(tx('watching.actions.done', { n: 1 }));
  });
});
