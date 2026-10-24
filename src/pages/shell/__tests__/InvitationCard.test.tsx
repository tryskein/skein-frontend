/**
 * sk-674.18 T054 — the invitation card of the Inbox (spec US-5; screens 1.3).
 *
 * Driven through the real `InboxColumn` on the Inbox tab, with the real
 * invitation reads (`useMyInvitations`) over a stubbed server and the real
 * `LiveEventsProvider` delivering the personal signal on its hub
 * connection — a card in isolation would pass with the column not showing
 * invitations at all, and a direct call of the invalidation helper would
 * pass with the signal wired to the wrong keys.
 *
 *  - "Accept" joins the space: the card goes, a toast "You are in Acme" offers
 *    "Open" to the place of the space without moving there by itself;
 *  - "Decline" asks nothing and the card goes;
 *  - mail on and the email not confirmed (`canAccept=false`,
 *    `email_unconfirmed`): "Accept" is off and says why, "Decline" stays,
 *    the confirmation email can be sent from the hint;
 *  - the personal signal `inbox` (the email just got confirmed) turns
 *    "Accept" on in the same tab, without a reload; another area does not
 *    re-read the invitations;
 *  - an invitation that is no longer valid answers so, and the card goes.
 *
 * The SignalR mock is the one of `livePersonalSignal.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MantineProvider } from '@mantine/core';
import { Notifications, notifications } from '@mantine/notifications';
import * as signalr from '@microsoft/signalr';
import i18n from '../../../i18n/config';
import { LiveEventsProvider } from '../../../hooks/useLiveEvents';
import { LIVE_INVALIDATION_WINDOW_MS } from '../../../lib/liveInvalidationBatcher';
import type { MyInvitation } from '../../../api/invitations';
import { InboxColumn } from '../InboxColumn';

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u-1', username: 'u1', role: 'user' }, logout: () => Promise.resolve() }),
  useAuthOptional: () => ({ user: { id: 'u-1', username: 'u1', role: 'user' } }),
}));

vi.mock('../../../lib/useLayoutState', () => ({
  useLayoutState: () => ({
    setInboxCollapsed: vi.fn(),
    selectedIssue: null,
    selectInboxIssue: vi.fn(),
    inboxTab: 'inbox',
    setInboxTab: vi.fn(),
    reportQueueFell: vi.fn(),
  }),
}));
// The issue half of the queue is empty: the column shows invitations only.
vi.mock('../../../lib/useInbox', () => ({
  useInbox: () => ({ data: { items: [] }, isSuccess: true }),
}));
vi.mock('../../../lib/useMentions', () => ({
  useMentions: () => ({ data: { items: [] }, isSuccess: true }),
}));
vi.mock('../../../lib/useWatching', () => ({
  useWatching: () => ({ data: undefined, isSuccess: false }),
}));
vi.mock('../../../lib/useReasonPrefsProbe', () => ({ useFeedChannelsAllOff: () => null }));
vi.mock('../../../lib/useProjectsList', () => ({ useProjectsList: () => ({ data: { items: [] } }) }));
vi.mock('../../../lib/useMarkNotificationsRead', () => ({
  useMarkNotificationsRead: () => ({ mutate: vi.fn() }),
}));
vi.mock('../../../lib/useMarkWatchingCardRead', () => ({
  useMarkWatchingCardRead: () => ({ mutate: vi.fn() }),
}));
vi.mock('../../../lib/useUnwatch', () => ({ useUnwatch: () => ({ mutate: vi.fn() }) }));
vi.mock('../../../lib/useBulkUnwatch', () => ({
  useBulkUnwatch: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../../../lib/useReminders', () => ({ useRingingIssueIds: () => new Set() }));

vi.mock('@microsoft/signalr', () => {
  const HubConnectionState = {
    Disconnected: 'Disconnected',
    Connecting: 'Connecting',
    Connected: 'Connected',
    Reconnecting: 'Reconnecting',
  } as const;
  const LogLevel = { Trace: 0, Debug: 1, Information: 2, Warning: 3, Error: 4, Critical: 5, None: 6 } as const;
  const registry: { handlers: Map<string, (payload: unknown) => void> } = { handlers: new Map() };
  class FakeConn {
    state: string = HubConnectionState.Disconnected;
    on = vi.fn((method: string, cb: (payload: unknown) => void) => {
      registry.handlers.set(method, cb);
    });
    onclose = vi.fn();
    onreconnecting = vi.fn();
    onreconnected = vi.fn();
    invoke = vi.fn(() => Promise.resolve({ accepted: [], rejected: [] }));
    stop = vi.fn(() => { this.state = HubConnectionState.Disconnected; return Promise.resolve(); });
    start = vi.fn(function (this: FakeConn) {
      this.state = HubConnectionState.Connected;
      return Promise.resolve();
    });
  }
  class HubConnectionBuilder {
    withUrl() { return this; }
    withAutomaticReconnect() { return this; }
    configureLogging() { return this; }
    build() { return new FakeConn(); }
  }
  return { HubConnectionBuilder, HubConnectionState, LogLevel, __mock: registry };
});

const mock = (signalr as unknown as {
  __mock: { handlers: Map<string, (payload: unknown) => void> };
}).__mock;

const ACME = 'k3x9p2qa';

/** The invitation as GET /me/invitations lists it. */
function invitation(over: Partial<MyInvitation> = {}): MyInvitation {
  return {
    id: 'inv-1',
    spaceId: ACME,
    spaceName: 'Acme',
    invitedBy: 'anna',
    expiresAt: '2026-10-18T12:00:00Z',
    canAccept: true,
    cannotAcceptReason: null,
    ...over,
  };
}

/** What the server answers to GET /me/invitations now. */
let pending: MyInvitation[];
/** GET /me/invitations fails with 500 while set. */
let invitationsDown = false;
/** The answer to POST …/accept and …/decline. */
let refusal: { status: number; body: unknown } | null;
let location = '';

function LocationProbe() {
  location = useLocation().pathname;
  return null;
}

function json(body: unknown, status = 200): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const calls = () => vi.mocked(fetch).mock.calls.map(([u, init]) => `${init?.method ?? 'GET'} ${String(u)}`);

async function mount(): Promise<void> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => {
    render(
      <MantineProvider>
        {/* As in `main.tsx`: the toasts render outside the router. */}
        <Notifications />
        <QueryClientProvider client={qc}>
          <MemoryRouter initialEntries={['/']}>
            <LiveEventsProvider>
              <Routes>
                <Route
                  path="*"
                  element={
                    <>
                      <LocationProbe />
                      <InboxColumn collapsed={false} width={320} />
                    </>
                  }
                />
              </Routes>
            </LiveEventsProvider>
          </MemoryRouter>
        </QueryClientProvider>
      </MantineProvider>,
    );
  });
  await flush();
}

/** Let the reads and the mutations answer. */
async function flush(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
}

function deliver(areas: string[]): void {
  const handler = mock.handlers.get('signal');
  if (!handler) throw new Error('no signal handler registered');
  act(() => handler({ areas, sentAt: '2026-10-13T10:00:00Z' }));
}

async function wave(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(LIVE_INVALIDATION_WINDOW_MS);
  });
  await flush();
}

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** «Invited by anna · valid until <date>» — the date as the reader's locale prints it. */
const metaPattern = () => {
  const [before, after] = i18n.t('inbox:invitation.meta', { inviter: 'anna', date: '\u0000' }).split('\u0000');
  return new RegExp(`^${escapeRe(before)}.+${escapeRe(after)}$`);
};
/** The hint under the buttons while the email is not confirmed. */
const hintPattern = () => new RegExp(escapeRe(i18n.t('inbox:invitation.unconfirmedHint')));
const acceptButton = () => screen.queryByRole('button', { name: i18n.t('inbox:invitation.acceptAria', { space: 'Acme' }) });
const declineButton = () => screen.queryByRole('button', { name: i18n.t('inbox:invitation.declineAria', { space: 'Acme' }) });

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  mock.handlers.clear();
  location = '';
  pending = [invitation()];
  refusal = null;
  invitationsDown = false;
  await i18n.changeLanguage('ru');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/api/v1/me/invitations') && method === 'GET') {
        if (invitationsDown) return json({ error: 'internal', message: 'boom' }, 500);
        return json({ items: pending });
      }
      if (url.endsWith('/api/v1/me/invitations/inv-1/accept')) {
        if (refusal) return json(refusal.body, refusal.status);
        pending = [];
        return json({
          space: {
            id: ACME, slug: 'acme', name: 'Acme', kind: 'regular', myRole: 'member', adminAccess: false,
            canCreateProject: true, memberCount: 2, memberLimit: null, pendingInvitations: 0,
            projectCount: 0, projectQuota: null, storageUsedBytes: 0, storageQuotaBytes: null,
          },
        });
      }
      if (url.endsWith('/api/v1/me/invitations/inv-1/decline')) {
        if (refusal) return json(refusal.body, refusal.status);
        pending = [];
        return json(null, 204);
      }
      if (url.endsWith('/api/v1/me/email/confirmation')) return json(null, 204);
      if (url.endsWith('/api/v1/me/spaces')) {
        return json({ items: [], ownedCount: 0, ownedLimit: null, canCreate: true, cannotCreateReason: null });
      }
      return json({ items: [] });
    }),
  );
});

afterEach(() => {
  act(() => notifications.clean());
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('row 241 — the invitation card: accept, decline', () => {
  test('the card names the space, the inviter and the expiry, with both actions', async () => {
    await mount();
    expect(screen.getByText(i18n.t('inbox:invitation.title', { space: 'Acme' }))).toBeTruthy();
    expect(screen.getByText(metaPattern())).toBeTruthy();
    expect(acceptButton()?.hasAttribute('disabled')).toBe(false);
    expect(declineButton()?.hasAttribute('disabled')).toBe(false);
    // Nothing to confirm: no hint.
    expect(screen.queryByText(hintPattern())).toBeNull();
  });

  test('"Accept" joins: the card goes, the toast offers "Open" and the place opens only on its click', async () => {
    await mount();
    fireEvent.click(acceptButton()!);
    await flush();

    expect(calls()).toContain('POST /api/v1/me/invitations/inv-1/accept');
    expect(acceptButton()).toBeNull();
    expect(screen.getByText(new RegExp(`^${escapeRe(i18n.t('inbox:invitation.joined', { space: 'Acme' }))}`))).toBeTruthy();
    // Offered, not made.
    expect(location).toBe('/');

    const open = screen.getByRole('link', { name: i18n.t('inbox:invitation.open') });
    expect(open.getAttribute('href')).toBe(`/spaces/${ACME}-acme`);
    fireEvent.click(open);
    await flush();
    // Moved inside the app (the router), not by loading the page.
    expect(location).toBe(`/spaces/${ACME}-acme`);
  });

  test('"Decline" asks nothing and the card goes', async () => {
    await mount();
    fireEvent.click(declineButton()!);
    await flush();
    expect(calls()).toContain('POST /api/v1/me/invitations/inv-1/decline');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(declineButton()).toBeNull();
  });

  test('an invitation no longer valid → "The invitation is no longer valid", the card goes', async () => {
    refusal = { status: 422, body: { error: 'invitation_invalid', message: 'gone' } };
    await mount();
    pending = [];
    fireEvent.click(acceptButton()!);
    await flush();
    expect(screen.getByText(i18n.t('inbox:invitation.noLongerValid'))).toBeTruthy();
    expect(acceptButton()).toBeNull();
  });
});

describe('row 241 — email not confirmed, then confirmed in the open tab', () => {
  beforeEach(() => {
    pending = [invitation({ canAccept: false, cannotAcceptReason: 'email_unconfirmed' })];
  });

  test('"Accept" is off and says why; "Decline" stays; the confirmation email is sent from the hint', async () => {
    await mount();
    const accept = acceptButton()!;
    expect(accept.hasAttribute('disabled')).toBe(true);
    const hint = screen.getByText(hintPattern());
    // The reason is tied to the button it explains.
    expect(accept.getAttribute('aria-describedby')).toBe(hint.id);
    expect(declineButton()?.hasAttribute('disabled')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: i18n.t('inbox:invitation.sendConfirmation') }));
    await flush();
    const sent = vi.mocked(fetch).mock.calls.find(([u]) => String(u).endsWith('/api/v1/me/email/confirmation'));
    expect(sent?.[1]?.method).toBe('POST');
    expect(JSON.parse(String(sent?.[1]?.body))).toEqual({ language: 'ru' });
    expect(screen.getByText(i18n.t('inbox:invitation.confirmationSent'))).toBeTruthy();
  });

  test('the signal `inbox` turns "Accept" on without a reload', async () => {
    await mount();
    expect(acceptButton()?.hasAttribute('disabled')).toBe(true);

    // The email got confirmed elsewhere; the server now allows accepting.
    pending = [invitation()];
    deliver(['inbox']);
    await wave();

    expect(acceptButton()?.hasAttribute('disabled')).toBe(false);
    expect(screen.queryByText(hintPattern())).toBeNull();
  });

  test('a signal of another area does not re-read the invitations', async () => {
    await mount();
    pending = [invitation()];
    deliver(['mentions']);
    await wave();
    expect(acceptButton()?.hasAttribute('disabled')).toBe(true);
  });
});

// sk-674.18 T054 (review TS-W1) — the Inbox tab is two reads. A failed read
// of the invitations is not an empty queue: it is said in place, with a way
// to read again, and the ordinary «no incoming tasks» is not shown.
describe('row 241 — the invitations could not be read', () => {
  test('a failed read is said, not passed off as an empty Inbox; «retry» brings the card', async () => {
    invitationsDown = true;
    await mount();
    await vi.waitFor(() => expect(screen.getByRole('alert').textContent).toContain(i18n.t('inbox:error.invitations')));
    expect(screen.queryByText(i18n.t('inbox:empty.inbox'))).toBeNull();

    invitationsDown = false;
    fireEvent.click(screen.getByRole('button', { name: i18n.t('inbox:retry') }));
    await flush();
    expect(acceptButton()).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

// sk-674.18 T054 (review TS-W2; spec E-26, screens 2.9) — after a
// confirmation email was sent, sending again is off for a minute and comes
// back after it; the second send is a request of its own.
describe('row 241 — the confirmation email: a minute before sending again', () => {
  beforeEach(() => {
    pending = [invitation({ canAccept: false, cannotAcceptReason: 'email_unconfirmed' })];
  });

  const sendButton = () =>
    screen.getByRole('button', { name: i18n.t('inbox:invitation.sendConfirmation') });
  const sends = () =>
    vi.mocked(fetch).mock.calls.filter(([u]) => String(u).endsWith('/api/v1/me/email/confirmation')).length;

  test('off for a minute after a send, on again after it; the second send goes out', async () => {
    await mount();
    fireEvent.click(sendButton());
    await flush();
    expect(sends()).toBe(1);
    expect(sendButton().hasAttribute('disabled')).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_000);
    });
    expect(sendButton().hasAttribute('disabled')).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(sendButton().hasAttribute('disabled')).toBe(false);
    fireEvent.click(sendButton());
    await flush();
    expect(sends()).toBe(2);
  });
});

describe('sk-733.3 — the invitations are a block of their own, pinned above the tasks', () => {
  test('all pending invitations sit in one group named with their number', async () => {
    pending = [invitation(), { ...invitation(), id: 'inv-2', spaceName: 'Beta' }];
    await mount();
    const group = screen.getByRole('group', { name: i18n.t('inbox:invitation.groupAria', { count: 2 }) });
    expect(within(group).getByRole('button', { name: i18n.t('inbox:invitation.acceptAria', { space: 'Acme' }) })).toBeTruthy();
    expect(within(group).getByRole('button', { name: i18n.t('inbox:invitation.acceptAria', { space: 'Beta' }) })).toBeTruthy();
  });

  test('no invitations — no group', async () => {
    pending = [];
    await mount();
    expect(screen.queryByRole('group', { name: /./ })).toBeNull();
  });
});

describe('sk-733.5 — "Accept" and "Decline" are glyph buttons named by their tooltips', () => {
  test.each([
    ['accept', 'inbox:invitation.acceptAria', 'inbox:invitation.accept'],
    ['decline', 'inbox:invitation.declineAria', 'inbox:invitation.decline'],
  ])('%s carries no label of its own and says what it does on hover', async (_, aria, tip) => {
    pending = [invitation()];
    await mount();
    const btn = screen.getByRole('button', { name: i18n.t(aria, { space: 'Acme' }) });
    expect(btn.textContent).toBe('');
    await act(async () => {
      fireEvent.mouseEnter(btn);
      fireEvent.pointerEnter(btn);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole('tooltip').textContent).toBe(i18n.t(tip));
  });
});
