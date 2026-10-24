/**
 * sk-303.13 / T023 — the single notification-settings form.
 *
 * Row 36 of the coverage matrix. What is asserted:
 *
 *   - the form renders one row per reason, with two channel switches;
 *   - a channel a reason does not have shows a dash carrying an explanation,
 *     not an off switch — an off switch promises that turning it on would do
 *     something;
 *   - the caption under a reason is the SERVER's, so a row whose two channels
 *     reach different audiences says so instead of averaging them;
 *   - agent-action suppression sits OUTSIDE the reason table and still saves;
 *   - a reason this build does not understand renders neutrally and SURVIVES
 *     a save — the body names only what the user touched;
 *   - saving sends a PARTIAL body — and, still, no `defaultInboxScope` (the
 *     sk-88 regression: the server never read it, and a rewrite of the form
 *     is exactly the moment it could sneak back).
 *
 * SettingsLayout and the device block are stubbed to thin pass-throughs so the
 * page body is exercised without the full HeaderBar / service-worker stack.
 */
import { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  act, render, screen, cleanup, waitFor, fireEvent, within,
} from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'u', role: 'user' } }),
}));

vi.mock('./SettingsLayout', async (importActual) => {
  const actual = await importActual<typeof import('./SettingsLayout')>();
  return {
    ...actual,
    SettingsLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  };
});

vi.mock('./PushDevicesSection', () => ({
  PushDevicesSection: () => <div data-testid="push-devices" />,
}));

const getReasonPrefsSpy = vi.fn();
const updateReasonPrefsSpy = vi.fn();
const getReviewPrefsSpy = vi.fn();
const updateReviewPrefsSpy = vi.fn();
const getIssueCreatePrefsSpy = vi.fn();
const updateIssueCreatePrefsSpy = vi.fn();

/**
 * The review-mechanic panel sits on this page and fetches its own settings.
 * It is mocked with a RESOLVING answer on purpose: leaving the request
 * unresolved renders a page the browser never shows — the panel stuck on its
 * loader, its Save button absent — and every query below would then be
 * unambiguous for the wrong reason.
 */
vi.mock('../../../api/review-prefs', async (importActual) => {
  const actual = await importActual<typeof import('../../../api/review-prefs')>();
  return {
    ...actual,
    getReviewPrefs: () => getReviewPrefsSpy(),
    updateReviewPrefs: (input: unknown) => updateReviewPrefsSpy(input),
  };
});

/**
 * sk-565 — the «Issue creation» panel also fetches its own setting. Mocked
 * with a RESOLVING answer for the same reason as the review panel above: an
 * unresolved request keeps the panel on its loader, a state the page never
 * settles in.
 */
vi.mock('../../../api/issue-create-prefs', async (importActual) => {
  const actual = await importActual<typeof import('../../../api/issue-create-prefs')>();
  return {
    ...actual,
    getIssueCreatePrefs: () => getIssueCreatePrefsSpy(),
    updateIssueCreatePrefs: (input: unknown) => updateIssueCreatePrefsSpy(input),
  };
});

vi.mock('../../../api/notification-reasons', async (importActual) => {
  const actual =
    await importActual<typeof import('../../../api/notification-reasons')>();
  return {
    ...actual,
    getReasonPrefs: () => getReasonPrefsSpy(),
    updateReasonPrefs: (input: unknown) => updateReasonPrefsSpy(input),
  };
});

import i18n, { DEFAULT_LANGUAGE } from '../../../i18n/config';
import { NewNotificationsPage } from './NotificationsPage';
import type { ReasonPrefs } from '../../../api/notification-reasons';
import type { ReviewPrefs } from '../../../api/review-prefs';

function Wrap({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
}

const PREFS: ReasonPrefs = {
  reasons: [
    {
      key: 'comment',
      label: 'Comment',
      hint: 'feed — on issues I watch',
      feed: { applicable: true, audience: 'subscribers', enabled: false },
      push: { applicable: false, audience: '', enabled: false },
    },
    {
      key: 'reminder',
      label: 'Reminder',
      hint: 'does not go to the feed: the ring is driven by reminder state',
      feed: { applicable: false, audience: '', enabled: false },
      push: { applicable: true, audience: 'reminder_owner', enabled: true },
    },
  ],
  suppressAgentActions: false,
  unwatchOnClose: false,
};

/**
 * The same payload plus a reason from a server newer than this build: an
 * unfamiliar key AND an unfamiliar audience code. Neither may be narrowed
 * into a client-side union, so both have to survive rendering and saving.
 */
const PREFS_WITH_UNKNOWN: ReasonPrefs = {
  ...PREFS,
  reasons: [
    ...PREFS.reasons,
    {
      key: 'quantum_entanglement',
      label: 'Quantum entanglement',
      hint: 'a reason this build knows nothing about',
      feed: { applicable: true, audience: 'time_travellers', enabled: true },
      push: { applicable: false, audience: '', enabled: false },
    },
  ],
};

const REVIEW_PREFS: ReviewPrefs = {
  mechanicEnabled: true,
  reviewRequiredDefault: false,
  burstCount: 2,
  unacceptedIntervalMinutes: null,
  unreviewedIntervalMinutes: 720,
  effective: {
    burstCount: 2,
    unacceptedIntervalMinutes: 180,
    unreviewedIntervalMinutes: 720,
  },
  bounds: {
    burstCount: { min: 0, max: 6, factory: 3 },
    unacceptedIntervalMinutes: { min: 15, max: 527040, factory: 180 },
    unreviewedIntervalMinutes: { min: 15, max: 527040, factory: 720 },
  },
};

beforeEach(() => {
  getReasonPrefsSpy.mockReset().mockResolvedValue(PREFS);
  updateReasonPrefsSpy.mockReset().mockResolvedValue(PREFS);
  getReviewPrefsSpy.mockReset().mockResolvedValue(REVIEW_PREFS);
  updateReviewPrefsSpy.mockReset().mockResolvedValue(REVIEW_PREFS);
  getIssueCreatePrefsSpy.mockReset().mockResolvedValue({ assignAgentIssuesToMe: true });
  updateIssueCreatePrefsSpy.mockReset().mockResolvedValue({ assignAgentIssuesToMe: false });
});

/**
 * The reason form's Save — asked for by ROLE and by its exact accessible
 * name. `getByText('Save')` would also match the review panel's button,
 * whose visible label is the same word.
 */
const reasonsSave = () => screen.getByRole('button', { name: 'Save' });

afterEach(() => cleanup());

describe('NotificationsPage — reason × channel form', () => {
  test('renders one row per reason with both channel columns', async () => {
    render(<Wrap><NewNotificationsPage /></Wrap>);
    await waitFor(() => expect(screen.getByText('Comment')).toBeTruthy());
    expect(screen.getByText('Reminder')).toBeTruthy();
    expect(screen.getByText('Feed')).toBeTruthy();
    expect(screen.getByText('Push')).toBeTruthy();
    // The caption is the server's, verbatim.
    expect(
      screen.getByText('feed — on issues I watch'),
    ).toBeTruthy();
  });

  test('an inapplicable channel is a dash, not a switch', async () => {
    render(<Wrap><NewNotificationsPage /></Wrap>);
    await waitFor(() => expect(screen.getByText('Comment')).toBeTruthy());

    // "Comment" has no push channel and "Reminder" no feed channel, so
    // exactly two switches exist across the two rows — one per applicable
    // cell — and the other two cells are dashes.
    expect(screen.queryByLabelText('Comment: Push')).toBeNull();
    expect(screen.queryByLabelText('Reminder: Feed')).toBeNull();
    expect(screen.getByLabelText('Comment: Feed')).toBeTruthy();
    expect(screen.getByLabelText('Reminder: Push')).toBeTruthy();
    // The explanation is TEXT in the cell, not an `aria-label` on a roleless
    // span: only real content is reliably announced there.
    expect(
      screen.getByText('Comment: this reason has no Push channel'),
    ).toBeTruthy();
    expect(
      screen.queryByLabelText('Comment: this reason has no Push channel'),
    ).toBeNull();
  });

  test('save sends only the touched reason and never defaultInboxScope', async () => {
    render(<Wrap><NewNotificationsPage /></Wrap>);
    await waitFor(() => expect(screen.getByText('Comment')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('Comment: Feed'));
    fireEvent.click(reasonsSave());

    await waitFor(() => expect(updateReasonPrefsSpy).toHaveBeenCalledTimes(1));
    const body = updateReasonPrefsSpy.mock.calls[0][0] as Record<string, unknown>;
    expect('defaultInboxScope' in body).toBe(false);
    expect(body.reasons).toEqual([{ reason: 'comment', feed: true }]);
    // Untouched suppression is not named either — partial means partial.
    expect('suppressAgentActions' in body).toBe(false);
  });

  test('save is disabled until something changes', async () => {
    render(<Wrap><NewNotificationsPage /></Wrap>);
    await waitFor(() => expect(screen.getByText('Comment')).toBeTruthy());
    expect(reasonsSave().hasAttribute('disabled')).toBe(true);
  });

  test('a reason with differing channel audiences carries the server caption', async () => {
    getReasonPrefsSpy.mockResolvedValue({
      reasons: [
        {
          key: 'delegated_status',
          label: 'Delegated-issue status',
          hint: 'feed — any status change on issues I watch; push — only on issues I delegated',
          feed: { applicable: true, audience: 'subscribers', enabled: true },
          push: {
            applicable: true,
            audience: 'delegating_creator',
            enabled: true,
          },
        },
      ],
      suppressAgentActions: false,
      unwatchOnClose: false,
    } satisfies ReasonPrefs);

    render(<Wrap><NewNotificationsPage /></Wrap>);
    await waitFor(() =>
      expect(screen.getByText('Delegated-issue status')).toBeTruthy(),
    );
    // The caption must not promise "delegated only" for the feed —
    // that is the whole reason it is the server's text and not ours.
    expect(
      screen.getByText(
        'feed — any status change on issues I watch; push — only on issues I delegated',
      ),
    ).toBeTruthy();
  });

  test('agent-action suppression sits outside the table and saves on its own', async () => {
    render(<Wrap><NewNotificationsPage /></Wrap>);
    await waitFor(() => expect(screen.getByText('Comment')).toBeTruthy());

    const suppression = screen.getByLabelText(
      "Don't notify about agent actions",
    );
    const table = screen.getByRole('table');
    expect(table.contains(suppression)).toBe(false);

    // The panel description is this checkbox's explanation, and the legacy
    // page tied them together — the rewrite left the text unreachable from
    // the control.
    const helpId = suppression.getAttribute('aria-describedby');
    expect(helpId).toBeTruthy();
    const help = document.getElementById(helpId!)?.textContent ?? '';

    // sk-335: the setting no longer means "my" agents, and the text is the
    // ONLY place a user learns what it now does. Two facts are load-bearing
    // and are asserted, not left to a reviewer's eye:
    //   1. it covers ANY agent — the old wording said "your agents (by
    //      API key)", which described a filter that never fired;
    //   2. personal signals still arrive — without that, the checkbox reads as
    //      "switch my notifications off", which is not what it does.
    expect(help).toContain("anyone's, not only yours");
    expect(help).toContain('merely watch');
    // sk-343: the setting is on by default, and the promise that "personal
    // still arrives" covers the feed, not only push. The copy must name
    // both facts — otherwise someone who sees the checkbox already on will
    // conclude that personally-addressed events were hidden from them too.
    expect(help).toContain('On by default');
    expect(help).toContain('both the feed and push');
    for (const personal of ['assigned', 'accepted', 'delegated', 'mentioned', 'reminder']) {
      expect(help).toContain(personal);
    }
    // And the discredited wording must not come back.
    expect(help).not.toContain('by API key');
    expect(help).not.toContain('my agents');

    fireEvent.click(suppression);
    fireEvent.click(reasonsSave());
    await waitFor(() => expect(updateReasonPrefsSpy).toHaveBeenCalledTimes(1));
    expect(updateReasonPrefsSpy.mock.calls[0][0]).toEqual({
      suppressAgentActions: true,
    });
  });

  test('sk-551.10 — «stop watching on close» is off by default and saves on its own', async () => {
    render(<Wrap><NewNotificationsPage /></Wrap>);
    await waitFor(() => expect(screen.getByText('Comment')).toBeTruthy());

    const box = screen.getByLabelText('Stop watching issues when they are closed') as HTMLInputElement;
    expect(box.checked).toBe(false);
    // The panel text is the checkbox's explanation; it has to say that a
    // manual subscription stays and that the removal is not permanent.
    const help = document.getElementById(box.getAttribute('aria-describedby')!)?.textContent ?? '';
    expect(help).toContain('Off by default');
    expect(help).toContain('by hand stay');
    expect(help).toContain('reopened, the subscription comes back');

    fireEvent.click(box);
    fireEvent.click(reasonsSave());
    await waitFor(() => expect(updateReasonPrefsSpy).toHaveBeenCalledTimes(1));
    expect(updateReasonPrefsSpy.mock.calls[0][0]).toEqual({ unwatchOnClose: true });
  });

  test('an unknown reason renders neutrally and survives a save untouched', async () => {
    getReasonPrefsSpy.mockResolvedValue(PREFS_WITH_UNKNOWN);
    render(<Wrap><NewNotificationsPage /></Wrap>);
    await waitFor(() =>
      expect(screen.getByText('Quantum entanglement')).toBeTruthy(),
    );

    // Rendered like any other row — a switch on its applicable channel, a
    // dash on the one it does not have. No error, no blank cell.
    expect(
      screen.getByLabelText('Quantum entanglement: Feed'),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Quantum entanglement: this reason has no Push channel',
      ),
    ).toBeTruthy();

    // Touch a DIFFERENT row and save: the unknown one must not be named, or
    // the server would take the body as an instruction about it.
    fireEvent.click(screen.getByLabelText('Comment: Feed'));
    fireEvent.click(reasonsSave());
    await waitFor(() => expect(updateReasonPrefsSpy).toHaveBeenCalledTimes(1));
    const body = updateReasonPrefsSpy.mock.calls[0][0] as {
      reasons?: { reason: string }[];
    };
    expect(body.reasons).toEqual([{ reason: 'comment', feed: true }]);
  });

  test('a failed load ends in an error with a retry, not an endless spinner', async () => {
    getReasonPrefsSpy.mockRejectedValue(new Error('network unavailable'));
    const { container } = render(<Wrap><NewNotificationsPage /></Wrap>);

    await waitFor(() => expect(screen.getByText('Error')).toBeTruthy());
    // The form cannot be drawn without the registry — but "no data" must not
    // read as "still loading": the alert used to sit beside a spinner that
    // never stopped, on a query that neither retries nor refetches on focus.
    expect(container.querySelector('.settings-loading')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();

    // …and there is something to press.
    expect(getReasonPrefsSpy).toHaveBeenCalledTimes(1);
    getReasonPrefsSpy.mockResolvedValue(PREFS);
    fireEvent.click(screen.getByText('Retry'));
    await waitFor(() => expect(screen.getByText('Comment')).toBeTruthy());
    expect(screen.queryByText('Error')).toBeNull();
  });

  test('the reason table carries an accessible name', async () => {
    render(<Wrap><NewNotificationsPage /></Wrap>);
    await waitFor(() => expect(screen.getByText('Comment')).toBeTruthy());
    // Table-by-table navigation lands on a named grid — this page has a
    // second block (devices) below it.
    expect(
      screen.getByRole('table', {
        name: 'Notification reasons: feed channel and push channel',
      }),
    ).toBeTruthy();
  });

  test('device management stays a separate block on the page', async () => {
    render(<Wrap><NewNotificationsPage /></Wrap>);
    await waitFor(() => expect(screen.getByText('Comment')).toBeTruthy());
    expect(screen.getByTestId('push-devices')).toBeTruthy();
    // …and it is not a row of the reason table.
    const table = screen.getByRole('table');
    expect(within(table).queryByTestId('push-devices')).toBeNull();
  });
});

/**
 * sk-303.14 (T029) — the review-mechanic panel, asserted FROM THE PAGE.
 *
 * Its own test mounts the component directly, so it says nothing about the
 * page: with these two assertions missing, deleting `<ReviewPrefsSection />`
 * from this page — or dropping it back inside the reason form — left the
 * whole suite green. Both are properties of the page, so they are pinned
 * here.
 */
describe('the review panel is on the page, and it is not inside the reason form', () => {
  const reviewSave = () =>
    screen.getByRole('button', { name: 'Save review settings' });

  test('the panel is rendered, with its own controls and its own Save', async () => {
    render(<Wrap><NewNotificationsPage /></Wrap>);
    await waitFor(() => expect(screen.getByText('Comment')).toBeTruthy());

    expect(
      await screen.findByText('Review of results'),
    ).toBeTruthy();
    expect(screen.getByTestId('review-mechanic-enabled')).toBeTruthy();
    expect(screen.getByTestId('review-burst-count')).toBeTruthy();
    expect(reviewSave()).toBeTruthy();
  });

  test('its form is a form of its own, with no form above it', async () => {
    render(<Wrap><NewNotificationsPage /></Wrap>);
    await waitFor(() => expect(screen.getByText('Comment')).toBeTruthy());
    await screen.findByTestId('review-mechanic-enabled');

    const reviewForm = reviewSave().closest('form');
    const reasonsForm = reasonsSave().closest('form');

    expect(reviewForm).not.toBeNull();
    expect(reasonsForm).not.toBeNull();
    expect(reviewForm).not.toBe(reasonsForm);
    // A nested form is markup the browser silently drops, and the panel's
    // Save would then submit the REASON form instead of its own.
    expect(reviewForm!.parentElement?.closest('form')).toBeNull();
    expect(reasonsForm!.contains(reviewForm!)).toBe(false);
  });

  test('the two Save buttons on the page are told apart by name', async () => {
    render(<Wrap><NewNotificationsPage /></Wrap>);
    await waitFor(() => expect(screen.getByText('Comment')).toBeTruthy());
    await screen.findByTestId('review-mechanic-enabled');

    // Two buttons, two names. Before this, both answered to "Save" and
    // nothing but the panel around them said which form they belonged to.
    expect(reasonsSave()).not.toBe(reviewSave());
    expect(screen.getAllByRole('button', { name: 'Save' })).toHaveLength(1);
  });
});

/**
 * sk-565 (T033, matrix row 56) — the «Issue creation» panel, asserted FROM
 * THE PAGE.
 *
 * Its own test (`IssueCreatePrefsSection.test.tsx`) mounts the panel alone,
 * so it cannot see that the panel is on the page, which strings reach the
 * screen, or that the two neighbouring forms neither carry nor are carried
 * by it.
 *
 * Strings are compared with the RESOLUTION of their keys in the active
 * language, never with a literal: on the en harness a literal hard-coded in
 * the component would match an en literal in the test just as well, so the
 * same assertions run a second time under `ru`. The expected text comes from
 * i18next itself (`getFixedT`), not from a second copy of the translation.
 */
describe('sk-565 — the «Issue creation» panel on the page', () => {
  const ISSUE_CREATE_KEYS = [
    'title', 'label', 'description', 'loadFailed', 'saveFailed', 'loading', 'saving',
  ] as const;
  type IssueCreateKey = (typeof ISSUE_CREATE_KEYS)[number];
  const resolve = (lang: string, key: IssueCreateKey) =>
    i18n.getFixedT(lang, 'notifications')(`issueCreate.${key}`);

  const toggle = () => screen.getByTestId('issue-create-assign-to-me') as HTMLInputElement;
  const reviewSave = () => screen.getByRole('button', { name: 'Save review settings' });

  afterEach(async () => {
    if (i18n.language !== DEFAULT_LANGUAGE) await i18n.changeLanguage(DEFAULT_LANGUAGE);
  });

  test('the en and ru resolutions of every panel key differ, so the second run can tell them apart', () => {
    for (const key of ISSUE_CREATE_KEYS) {
      expect(resolve('ru', key), key).not.toBe(resolve('en', key));
    }
  });

  describe.each(['en', 'ru'])('strings resolve from the dictionary — %s', (lang) => {
    beforeEach(async () => {
      await i18n.changeLanguage(lang);
    });

    test('panel title, switch label and its explanation', async () => {
      render(<Wrap><NewNotificationsPage /></Wrap>);
      await waitFor(() => expect(toggle().disabled).toBe(false));

      expect(screen.getByRole('heading', { name: resolve(lang, 'title') })).toBeTruthy();
      // The label and the explanation are both text of the switch's own
      // <label> (Mantine renders the description inside it), so each is
      // looked up as text and then tied to THIS switch through that label.
      const ownLabel = document.querySelector(`label[for="${toggle().id}"]`);
      expect(ownLabel).not.toBeNull();
      expect(ownLabel!.contains(screen.getByText(resolve(lang, 'label')))).toBe(true);
      expect(ownLabel!.contains(screen.getByText(resolve(lang, 'description')))).toBe(true);
    });

    test('the live-status phrase while the setting loads', async () => {
      getIssueCreatePrefsSpy.mockReturnValue(new Promise(() => {}));
      render(<Wrap><NewNotificationsPage /></Wrap>);

      const phrase = await screen.findByText(resolve(lang, 'loading'));
      expect(phrase.closest('[role="status"]')).not.toBeNull();
    });

    test('the load-failure alert', async () => {
      getIssueCreatePrefsSpy.mockRejectedValue(new Error('boom'));
      render(<Wrap><NewNotificationsPage /></Wrap>);

      const title = await screen.findByText(resolve(lang, 'loadFailed'));
      expect(title.closest('[role="alert"]')).not.toBeNull();
    });

    test('the save-failure alert', async () => {
      updateIssueCreatePrefsSpy.mockRejectedValue(new Error('boom'));
      render(<Wrap><NewNotificationsPage /></Wrap>);
      await waitFor(() => expect(toggle().disabled).toBe(false));

      fireEvent.click(toggle());
      const title = await screen.findByText(resolve(lang, 'saveFailed'));
      expect(title.closest('[role="alert"]')).not.toBeNull();
    });
  });

  test('the switch sits in no form — neither the reason form nor the review form', async () => {
    render(<Wrap><NewNotificationsPage /></Wrap>);
    await waitFor(() => expect(screen.getByText('Comment')).toBeTruthy());
    await screen.findByTestId('review-mechanic-enabled');
    await waitFor(() => expect(toggle().disabled).toBe(false));

    // Both forms exist on the page, so «no form above the switch» is a
    // statement about placement, not about a page with no forms at all.
    expect(reasonsSave().closest('form')).not.toBeNull();
    expect(reviewSave().closest('form')).not.toBeNull();
    expect(toggle().closest('form')).toBeNull();
  });

  test('flipping the switch saves only this setting and leaves the review Save untouched', async () => {
    render(<Wrap><NewNotificationsPage /></Wrap>);
    await screen.findByTestId('review-mechanic-enabled');
    await waitFor(() => expect(toggle().disabled).toBe(false));
    expect(reviewSave().hasAttribute('disabled')).toBe(true);

    fireEvent.click(toggle());

    await waitFor(() => expect(updateIssueCreatePrefsSpy).toHaveBeenCalledTimes(1));
    expect(updateIssueCreatePrefsSpy.mock.calls[0][0]).toEqual({ assignAgentIssuesToMe: false });
    await waitFor(() => expect(toggle().disabled).toBe(false));
    expect(updateReviewPrefsSpy).not.toHaveBeenCalled();
    expect(updateReasonPrefsSpy).not.toHaveBeenCalled();
    expect(reviewSave().hasAttribute('disabled')).toBe(true);
  });

  // T024, Stryker survivor (row 58): «a save is in flight» is THIS panel's
  // save, not any mutation of the page. A pending review save must not lock
  // the switch.
  test('a review save in flight leaves the switch available', async () => {
    updateReviewPrefsSpy.mockReturnValue(new Promise(() => {}));
    render(<Wrap><NewNotificationsPage /></Wrap>);
    await screen.findByTestId('review-mechanic-enabled');
    await waitFor(() => expect(toggle().disabled).toBe(false));

    fireEvent.click(screen.getByTestId('review-mechanic-enabled'));
    fireEvent.click(reviewSave());
    await waitFor(() => expect(updateReviewPrefsSpy).toHaveBeenCalledTimes(1));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(toggle().disabled).toBe(false);
  });

  test('saving the review form does not save this setting', async () => {
    render(<Wrap><NewNotificationsPage /></Wrap>);
    await screen.findByTestId('review-mechanic-enabled');
    await waitFor(() => expect(toggle().disabled).toBe(false));

    fireEvent.click(screen.getByTestId('review-mechanic-enabled'));
    fireEvent.click(reviewSave());

    await waitFor(() => expect(updateReviewPrefsSpy).toHaveBeenCalledTimes(1));
    // Let any mutation the clicks might have started reach its mutationFn
    // (TanStack Query awaits onMutate first) before asserting it did not.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(updateIssueCreatePrefsSpy).not.toHaveBeenCalled();
  });
});
