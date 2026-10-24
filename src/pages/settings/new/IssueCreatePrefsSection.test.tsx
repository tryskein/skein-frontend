/**
 * sk-565 (T033, matrix rows 52–55) — the «Issue creation» panel, mounted
 * alone against a mocked client.
 *
 *   - row 52: the switch position after load is the SERVER's, both ways;
 *   - row 53: while the load hangs and after it fails the switch is
 *     unavailable; a failed load is an alert inside the panel;
 *   - row 54: a click saves at once, in both directions, with ONE call and the
 *     body derived from the stored value; while the PUT hangs the switch is
 *     unavailable and still shows the stored value (no optimistic update);
 *     after success the screen shows the value the ANSWER carries;
 *   - row 55: a failed PUT shows an alert, leaves the stored value on screen
 *     and makes the switch usable again.
 *
 * Panel strings, the page mount and independence from the other forms are
 * row 56 (`NotificationsPage.test.tsx`); this file does not look at copy.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type {
  IssueCreatePrefs,
  UpdateIssueCreatePrefsInput,
} from '../../../api/issue-create-prefs';

const getSpy = vi.fn<() => Promise<IssueCreatePrefs>>();
const putSpy = vi.fn<(input: UpdateIssueCreatePrefsInput) => Promise<IssueCreatePrefs>>();

vi.mock('../../../api/issue-create-prefs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/issue-create-prefs')>();
  return {
    ...actual,
    getIssueCreatePrefs: () => getSpy(),
    updateIssueCreatePrefs: (input: UpdateIssueCreatePrefsInput) => putSpy(input),
  };
});

import i18n from '../../../i18n/config';
import { IssueCreatePrefsSection, issueCreatePrefsQueryKey } from './IssueCreatePrefsSection';

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function mount(qc: QueryClient = newClient()) {
  const view = render(
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <IssueCreatePrefsSection />
      </QueryClientProvider>
    </MantineProvider>,
  );
  return { ...view, qc };
}

/**
 * Lets every queued microtask and one macrotask run. A negative assertion
 * («nothing was sent») right after a click is otherwise vacuous: TanStack
 * Query starts `mutationFn` only after awaiting `onMutate`, so a mutation the
 * click DID start would still be invisible to a synchronous check.
 */
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** A promise the test settles by hand — the window «request in flight». */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const toggle = () => screen.getByTestId('issue-create-assign-to-me') as HTMLInputElement;
const panel = () => toggle().closest('section') as HTMLElement;

/** Waits for the first load to land: the switch becomes available. */
async function loaded() {
  await waitFor(() => expect(toggle().disabled).toBe(false));
}

beforeEach(() => {
  getSpy.mockReset();
  putSpy.mockReset();
});

afterEach(() => cleanup());

describe('row 52 — position after load comes from the server', () => {
  test.each([true, false])('server %s → switch checked = %s', async (server) => {
    getSpy.mockResolvedValue({ assignAgentIssuesToMe: server });
    mount();
    await loaded();
    expect(toggle().checked).toBe(server);
  });
});

describe('row 53 — loading and a failed load', () => {
  test('while the load hangs the switch is unavailable', async () => {
    getSpy.mockReturnValue(new Promise<IssueCreatePrefs>(() => {}));
    mount();
    await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(1));
    expect(toggle().disabled).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('a failed load is an alert in the panel, and the switch stays unavailable', async () => {
    getSpy.mockRejectedValue(new Error('network unavailable'));
    mount();
    const alert = await screen.findByRole('alert');
    expect(panel().contains(alert)).toBe(true);
    expect(toggle().disabled).toBe(true);
    // A disabled switch swallows the click; nothing may be sent.
    fireEvent.click(toggle());
    await settle();
    expect(putSpy).not.toHaveBeenCalled();
  });
});

describe('row 54 — immediate save, both directions, no optimistic update', () => {
  test.each([true, false])('stored %s: one PUT with the opposite value, switch frozen on the stored value while it hangs', async (stored) => {
    getSpy.mockResolvedValue({ assignAgentIssuesToMe: stored });
    const put = deferred<IssueCreatePrefs>();
    putSpy.mockReturnValue(put.promise);
    mount();
    await loaded();

    // No Save button: the click itself is the save.
    expect(within(panel()).queryAllByRole('button')).toHaveLength(0);

    fireEvent.click(toggle());

    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    expect(putSpy.mock.calls[0][0]).toEqual({ assignAgentIssuesToMe: !stored });
    // In flight: unavailable, and still the STORED value — the click did not
    // move the switch.
    await waitFor(() => expect(toggle().disabled).toBe(true));
    expect(toggle().checked).toBe(stored);
    // A second click in the window sends nothing.
    fireEvent.click(toggle());
    await settle();
    expect(putSpy).toHaveBeenCalledTimes(1);

    put.resolve({ assignAgentIssuesToMe: !stored });
    await waitFor(() => expect(toggle().disabled).toBe(false));
    expect(toggle().checked).toBe(!stored);
    expect(putSpy).toHaveBeenCalledTimes(1);
  });

  test('after success the screen shows the value the ANSWER carries, not the one clicked', async () => {
    // The server is the authority: when its answer disagrees with the click
    // (a concurrent write from elsewhere committed last), the answer wins.
    getSpy.mockResolvedValue({ assignAgentIssuesToMe: true });
    putSpy.mockResolvedValue({ assignAgentIssuesToMe: true });
    mount();
    await loaded();

    fireEvent.click(toggle());
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    expect(putSpy.mock.calls[0][0]).toEqual({ assignAgentIssuesToMe: false });
    await waitFor(() => expect(toggle().disabled).toBe(false));
    expect(toggle().checked).toBe(true);
  });
});

describe('row 55 — a failed save', () => {
  test.each([true, false])('stored %s: alert shown, stored value kept, switch usable again', async (stored) => {
    getSpy.mockResolvedValue({ assignAgentIssuesToMe: stored });
    putSpy.mockRejectedValue(new Error('server said no'));
    mount();
    await loaded();
    expect(screen.queryByRole('alert')).toBeNull();

    fireEvent.click(toggle());

    const alert = await screen.findByRole('alert');
    expect(panel().contains(alert)).toBe(true);
    await waitFor(() => expect(toggle().disabled).toBe(false));
    expect(toggle().checked).toBe(stored);

    // Usable again means a second attempt is actually sent.
    fireEvent.click(toggle());
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(2));
    expect(putSpy.mock.calls[1][0]).toEqual({ assignAgentIssuesToMe: !stored });
  });
});

/**
 * Review fix sk-565/skein-frontend/1 — the cache holds a value and a fetch
 * runs in the background (remount within gcTime, reconnect). Regressions for
 * the BLOCKER and the two MAJOR/MINOR findings of the wave review.
 */
describe('background reads and the confirmed write', () => {
  test('(a1) seeded cache, background GET in flight → switch unavailable until it lands', async () => {
    const qc = newClient();
    qc.setQueryData(issueCreatePrefsQueryKey, { assignAgentIssuesToMe: true });
    const get = deferred<IssueCreatePrefs>();
    getSpy.mockReturnValue(get.promise);
    mount(qc);

    await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(1));
    expect(toggle().checked).toBe(true);
    expect(toggle().disabled).toBe(true);

    get.resolve({ assignAgentIssuesToMe: true });
    await loaded();
  });

  test('(a2) a GET started before the PUT was confirmed does not overwrite the PUT answer', async () => {
    getSpy.mockResolvedValueOnce({ assignAgentIssuesToMe: true });
    const put = deferred<IssueCreatePrefs>();
    putSpy.mockReturnValue(put.promise);
    const { qc } = mount();
    await loaded();

    fireEvent.click(toggle());
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));

    // A read starts while the write is in flight; the server answers it with
    // the value from BEFORE the write, and that answer arrives late.
    const lateGet = deferred<IssueCreatePrefs>();
    getSpy.mockReturnValueOnce(lateGet.promise);
    void qc.refetchQueries({ queryKey: issueCreatePrefsQueryKey });
    await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(2));

    put.resolve({ assignAgentIssuesToMe: false });
    await waitFor(() => expect(toggle().checked).toBe(false));
    lateGet.resolve({ assignAgentIssuesToMe: true });
    await settle();
    await waitFor(() => expect(toggle().disabled).toBe(false));
    expect(toggle().checked).toBe(false);
  });

  test('(b) seeded cache, failed background refetch → alert and switch unavailable', async () => {
    const qc = newClient();
    qc.setQueryData(issueCreatePrefsQueryKey, { assignAgentIssuesToMe: true });
    getSpy.mockRejectedValue(new Error('network unavailable'));
    mount(qc);

    const alert = await screen.findByRole('alert');
    expect(panel().contains(alert)).toBe(true);
    expect(toggle().disabled).toBe(true);
    fireEvent.click(toggle());
    await settle();
    expect(putSpy).not.toHaveBeenCalled();
  });

  test('(c) remount while the PUT hangs → the new panel is unavailable too', async () => {
    getSpy.mockResolvedValue({ assignAgentIssuesToMe: true });
    const put = deferred<IssueCreatePrefs>();
    putSpy.mockReturnValue(put.promise);
    const first = mount();
    await loaded();

    fireEvent.click(toggle());
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    first.unmount();

    mount(first.qc);
    // Let the remount's own background read land, so what is left holding
    // the switch is the write alone.
    await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(2));
    await settle();
    expect(toggle().disabled).toBe(true);
    fireEvent.click(toggle());
    await settle();
    expect(putSpy).toHaveBeenCalledTimes(1);

    put.resolve({ assignAgentIssuesToMe: false });
    await waitFor(() => expect(toggle().disabled).toBe(false));
  });
});

describe('waiting is announced in words, not only by the spinner', () => {
  const phrase = (key: 'loading' | 'saving') =>
    i18n.getFixedT('en', 'notifications')(`issueCreate.${key}`);
  const status = () => within(panel()).getByRole('status');

  test('the polite live region names loading, then saving, then falls silent', async () => {
    const get = deferred<IssueCreatePrefs>();
    getSpy.mockReturnValue(get.promise);
    const put = deferred<IssueCreatePrefs>();
    putSpy.mockReturnValue(put.promise);
    mount();

    await waitFor(() => expect(status().textContent).toBe(phrase('loading')));
    expect(status().getAttribute('aria-live')).toBe('polite');

    get.resolve({ assignAgentIssuesToMe: true });
    await loaded();
    expect(status().textContent).toBe('');

    fireEvent.click(toggle());
    await waitFor(() => expect(status().textContent).toBe(phrase('saving')));

    put.resolve({ assignAgentIssuesToMe: false });
    await waitFor(() => expect(toggle().disabled).toBe(false));
    expect(status().textContent).toBe('');
  });
});

/**
 * T024, Stryker survivors (row 58): the cancellation around the save is
 * scoped to THIS panel's query. A save that cancelled every query of the app
 * would silently drop whatever another surface was reading at that moment.
 */
describe('the save cancels only its own query', () => {
  test('a foreign read in flight across the whole save still lands its data', async () => {
    getSpy.mockResolvedValue({ assignAgentIssuesToMe: true });
    const put = deferred<IssueCreatePrefs>();
    putSpy.mockReturnValue(put.promise);
    const { qc } = mount();
    await loaded();

    // Another surface's read, started before the click and answered only
    // after the PUT has been confirmed — so it spans both cancellation points.
    const foreign = deferred<string>();
    const foreignKey = ['some-other-surface'] as const;
    const foreignFetch = qc
      .fetchQuery({ queryKey: foreignKey, queryFn: () => foreign.promise })
      .catch(() => undefined);

    fireEvent.click(toggle());
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    put.resolve({ assignAgentIssuesToMe: false });
    await waitFor(() => expect(toggle().checked).toBe(false));

    foreign.resolve('foreign data');
    await foreignFetch;
    expect(qc.getQueryData(foreignKey)).toBe('foreign data');
  });
});
