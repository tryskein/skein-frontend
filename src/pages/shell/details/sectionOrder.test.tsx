/**
 * sk-421.2 T014 (US-1, INV-6, SC-001, F-11, F-13) — the SECTION ORDER of the card.
 *
 * The epic section goes right after the people chain: above the alarm block,
 * the close reason, the acknowledgement flag and the description. On a NON-epic card the
 * order does not change at all.
 *
 * ─── Why by rendering and not by reading the source ─────────────────
 *
 * The existing fidelity guard reads the text of the file and itself warns
 * that it does not catch a conditional reorder. Here both participants are conditional: the epic
 * section hangs on `issue.type === 'epic' && issue.epic`, the alarm block on
 * `hasReminders`. An order assembled from two conditions is visible only in the
 * rendered tree, so the test looks at the DOM.
 *
 * ─── How this harness differs from `sections/reviewOnCard.test.tsx` ───
 *
 * That harness is the model, but it cannot be carried over verbatim, and both differences
 * are not cosmetic:
 *
 *   1. There the section stubs are `() => null`. For "is there a section" that is enough,
 *      for ORDER it is not: `null` leaves nothing in the DOM that could be
 *      lined up in a sequence. Here every stub draws a node with
 *      its own `data-testid`.
 *   2. There `useIssueReminders` is mocked as `() => ({ data: [], isLoading: false })`.
 *      The real hook returns an ARRAY — the panel counts `issueReminders.length > 0`
 *      (IssueDetailPanel.tsx:166-167). An object has no `length`, i.e. with that
 *      mock `hasReminders` is always false, the alarm block is never rendered,
 *      and the assertion "the epic section is above the alarm" would pass VACUOUSLY. Here
 *      the mock returns an array, and its content is switched per test.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { IssueDetail } from '../../../api/issues';
import i18n from '../../../i18n/config';

// ─────────────────────── Section stubs ───────────────────────
// Each draws one node with an identifying `data-testid`: the test reads them
// in document order and compares with the expected sequence.

// The stub is written in each factory SEPARATELY, without a shared helper: the `vi.mock` calls
// are hoisted to the top of the file, and any reference to a top-level
// variable AT THE MOMENT the factory runs fails with "Cannot access before
// initialization". (References inside the BODY of a mock — `mockIssue`, `mockReminders` —
// are safe: they are read lazily, when the mocked hook is already called.)

vi.mock('./DetailsHeader', () => ({
  DetailsHeader: () => <div data-testid="sec-header" />,
}));
vi.mock('./IssueTitleEdit', () => ({
  IssueTitleEdit: () => <div data-testid="sec-title" />,
}));
vi.mock('./PeopleChain', () => ({
  PeopleChain: () => <div data-testid="sec-people" />,
}));
// sk-421.1 T014 — the properties row. Without its own stub the test does not go red, it
// goes blind: the real row leaves no `sec-…` node, and a new section does not
// get into the assembled order at all.
vi.mock('./sections/IssuePropertiesRow', () => ({
  // sk-421.1 row 39 (ii), the panel half — the stub remembers the project
  // the panel passed it (the variable is read lazily, at render time,
  // so the `vi.mock` hoisting does not get in its way).
  IssuePropertiesRow: ({ projectId }: { projectId: string }) => {
    propertiesRowProjectIds.push(projectId);
    return <div data-testid="sec-properties" />;
  },
}));
// sk-421.1 T015 — the "Blocked" block, the second element of the properties area.
// The real block draws nothing for an unblocked task, so without
// a stub the order would not see it at all.
vi.mock('./sections/BlockedBySection', () => ({
  BlockedBySection: () => <div data-testid="sec-blocked" />,
}));
// sk-479 — the row about links to tasks from inaccessible projects, the third and
// last element of the properties area. The real one draws nothing without such links,
// so without a stub the order would not see it.
vi.mock('./sections/UnavailableLinksNote', () => ({
  UnavailableLinksNote: () => <div data-testid="sec-unavailable-links" />,
}));
vi.mock('./sections/ActivitySection', () => ({
  ActivitySection: () => <div data-testid="sec-activity" />,
}));
vi.mock('./sections/AttachmentsSection', () => ({
  AttachmentsSection: () => <div data-testid="sec-attachments" />,
}));
vi.mock('./sections/ClosedReasonSection', () => ({
  ClosedReasonSection: () => <div data-testid="sec-closed-reason" />,
}));
vi.mock('./sections/CommentsSection', () => ({
  CommentsSection: () => <div data-testid="sec-comments" />,
}));
vi.mock('./sections/CommitsSection', () => ({
  CommitsSection: () => <div data-testid="sec-commits" />,
}));
vi.mock('./sections/DependenciesSection', () => ({
  DependenciesSection: () => <div data-testid="sec-dependencies" />,
}));
vi.mock('./sections/EpicProgressSection', () => ({
  EpicProgressSection: () => <div data-testid="sec-epic" />,
}));
vi.mock('./sections/RemindersSection', () => ({
  RemindersSection: () => <div data-testid="sec-reminders" />,
}));
vi.mock('./sections/ReviewFlagSection', () => ({
  ReviewFlagSection: () => <div data-testid="sec-review-flag" />,
}));
vi.mock('./sections/WatchersSection', () => ({
  WatchersSection: () => <div data-testid="sec-watchers" />,
}));

// One and the same component stands on the card three times (description, acceptance,
// notes), so the stub tells them apart by field, not by position.
vi.mock('./sections/EditableTextSection', () => ({
  // sk-421.1 row 56 (1) — the stub also remembers by `field` what the
  // panel passed it: the save handler and the labels. The variable is read
  // lazily, at render time, so the `vi.mock` hoisting does not get in its way.
  EditableTextSection: (props: {
    field: string;
    title: string;
    emptyAddLabel: string;
    updateField: (patch: unknown) => unknown;
  }) => {
    editableSectionProps[props.field] = props;
    return <div data-testid={`sec-${props.field}`} />;
  },
}));

// ─────────────────────────── Hooks ────────────────────────────────

vi.mock('../../../lib/useProjectByHandle', () => ({
  useProjectByHandle: () => ({
    project: { id: 'proj-uuid-test', idPrefix: 'test', name: 'test' },
    isLoading: false,
    isUnresolved: false,
  }),
}));

// RETURNS AN ARRAY — see item 2 in the file header.
let mockReminders: unknown[] = [];
vi.mock('../../../lib/useReminders', () => ({
  useIssueReminders: () => mockReminders,
}));

vi.mock('../../../components/Toaster', () => ({
  useToaster: () => ({ error: vi.fn(), success: vi.fn() }),
}));

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u-author', username: 'author', role: 'user' },
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

let mockIssue: IssueDetail;
// sk-421.1 row 56 (1) — next to mockIssue/mockReminders, by the same method:
// declared at module level, read lazily in the mock bodies.
/** Props received by the text-section stub, by field. */
let editableSectionProps: Record<
  string,
  { field: string; title: string; emptyAddLabel: string; updateField: (patch: unknown) => unknown }
> = {};
/** The updateField spy of the detail hook — one per file, read lazily. */
let mockUpdateField = vi.fn();
vi.mock('../../../lib/useIssueDetail', () => ({
  issueWatchersKey: (id: string) => ['issue', id, 'watchers'] as const,
  issueDetailKey: (id: string) => ['issues', 'detail', id] as const,
  isStatusChangeFailure: () => false,
  useIssueDetail: () => ({
    issue: mockIssue,
    isLoading: false,
    isError: false,
    error: null,
    comments: [],
    attachments: [],
    dependencies: undefined,
    activity: [],
    watchers: [],
    issueQuery: { isLoading: false, isError: false },
    // sk-421.1 row 56 (1) — ONE hoisted spy, not a new vi.fn() on
    // each hook call: otherwise "the call reached the hook" is not checkable.
    updateField: mockUpdateField,
    changeStatus: vi.fn(),
    accept: vi.fn(),
    changeReviewRequired: vi.fn(),
    markResultReviewed: vi.fn(),
    reviewPending: false,
  }),
}));

import { IssueDetailPanel } from './IssueDetailPanel';

// ───────────────────────── Fixtures ──────────────────────────────

function issue(over: Partial<IssueDetail> = {}): IssueDetail {
  return {
    id: 'sk-1',
    projectId: 'proj-uuid-test',
    version: 3,
    title: 'task',
    description: '',
    type: 'task',
    priority: 2,
    status: 'open',
    pinned: false,
    source: 'human',
    design: '',
    acceptanceCriteria: '',
    notes: '',
    createdBy: 'u-author',
    createdByUsername: 'author',
    createdAt: '2026-05-01T09:00:00Z',
    updatedAt: '2026-05-01T10:00:00Z',
    metadata: {},
    componentIds: [],
    labels: [],
    commentsCount: 0,
    commitRefs: [],
    mentions: [],
    isBlocked: false,
    blockers: [],
    closedAt: null,
    closedReason: null,
    assignee: 'bob',
    reviewRequired: false,
    ...over,
  } as unknown as IssueDetail;
}

/** An epic card: the type + a non-empty summary, both render conditions of the section. */
function epicIssue(over: Partial<IssueDetail> = {}): IssueDetail {
  return issue({
    type: 'epic',
    epic: {
      totalChildren: 13,
      closedChildren: 4,
      openChildren: 6,
      inProgressChildren: 2,
      blockedChildren: 1,
      standingChildren: 0,
      deferredChildren: 0,
      unavailableChildren: 0,
      eligibleForClose: false,
    },
    ...over,
  } as Partial<IssueDetail>);
}

function mountPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <IssueDetailPanel issueId="sk-1" projectHandle="test" />
      </QueryClientProvider>
    </MantineProvider>,
  );
}

/** Identifying marks of the sections in document order. */
function order(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-testid^="sec-"]')).map(
    (el) => el.getAttribute('data-testid')!.replace(/^sec-/, ''),
  );
}

afterEach(() => {
  cleanup();
  mockReminders = [];
  vi.clearAllMocks();
});

describe('sk-421.2 US-1 — the epic section right after the people chain', () => {
  test('on an epic card it is above the alarm, the close reason, the flag and the description', () => {
    mockIssue = epicIssue();
    mockReminders = [{ id: 'r-1' }]; // there IS an alarm — otherwise the top slot is empty
    const { container } = mountPanel();

    expect(order(container)).toEqual([
      'header',
      'title',
      'people',
      // sk-421.1 US-1 — the properties area right after the people chain, before the epic:
      // the properties row, then the "Blocked" block (T015).
      'properties',
      'blocked',
      'unavailable-links',
      'epic',
      'reminders',
      'closed-reason',
      'review-flag',
      'description',
      'acceptanceCriteria',
      'notes',
      // sk-421.1 T017 (US-9, SC-009) — "Design" after "Notes", before "Attachments".
      'design',
      'attachments',
      'dependencies',
      'comments',
      'commits',
      'activity',
      'watchers',
    ]);
  });

  test('without an alarm the epic section is still right after the people', () => {
    mockIssue = epicIssue();
    mockReminders = []; // the alarm block moves to the very bottom
    const { container } = mountPanel();
    const got = order(container);

    // sk-421.1 US-1 — index 3 is now the properties area, the epic right after it.
    expect(got.slice(0, 4)).toEqual(['header', 'title', 'people', 'properties']);
    // sk-421.1 T015 — after the properties row the "Blocked" block, the epic after it.
    expect(got[4]).toBe('blocked');
    // sk-479 — the row about inaccessible links closes the properties area.
    expect(got[5]).toBe('unavailable-links');
    expect(got[6]).toBe('epic');
    // and it really moved to the bottom, not vanished
    expect(got[got.length - 1]).toBe('reminders');
  });

  test('on a NON-epic card the order is the old one and there is no epic section', () => {
    mockIssue = issue();
    mockReminders = [{ id: 'r-1' }];
    const { container } = mountPanel();

    expect(order(container)).toEqual([
      'header',
      'title',
      'people',
      // sk-421.1 US-1 — the properties area on a non-epic card too: the properties
      // row, then the "Blocked" block (T015).
      'properties',
      'blocked',
      'unavailable-links',
      'reminders',
      'closed-reason',
      'review-flag',
      'description',
      'acceptanceCriteria',
      'notes',
      // sk-421.1 T017 (US-9, SC-009) — "Design" after "Notes", before "Attachments".
      'design',
      'attachments',
      'dependencies',
      'comments',
      'commits',
      'activity',
      'watchers',
    ]);
  });

  test('an epic without a summary does not count as a section — the render condition is double', () => {
    // `issue.epic` did not arrive: the section is not rendered, the order is as for a non-epic.
    mockIssue = issue({ type: 'epic' });
    mockReminders = [{ id: 'r-1' }];
    const { container } = mountPanel();

    expect(order(container)).not.toContain('epic');
    // sk-421.1 US-1 — index 3 is the properties area, the alarm after it.
    expect(order(container).slice(0, 4)).toEqual([
      'header',
      'title',
      'people',
      'properties',
    ]);
  });
});

// ─────────── sk-421.1 row 39 (ii) — the project for the directory ───────────

/** Projects passed to the properties row stub, in render order. */
let propertiesRowProjectIds: string[] = [];

describe('sk-421.1 US-3 — the properties row gets the project of the TASK, not of the route', () => {
  test('a task of project B on the route of project A → the row gets B', () => {
    // `useProjectByHandle` here resolves the route to `proj-uuid-test` (A);
    // the task lies in another project (the inbox overlay).
    propertiesRowProjectIds = [];
    mockIssue = issue({ projectId: 'proj-b-other' });
    mountPanel();

    expect(propertiesRowProjectIds.length).toBeGreaterThan(0);
    expect(new Set(propertiesRowProjectIds)).toEqual(new Set(['proj-b-other']));
  });
});

// ─────────── sk-421.1 row 56 (1) — "Design": mounting and wiring ───────────

describe('sk-421.1 US-9 — "Design" is mounted with the design field and the same handler', () => {
  test('field=design, the handler is the same as for "Notes", and it reaches the hook', () => {
    editableSectionProps = {};
    mockUpdateField = vi.fn();
    mockIssue = issue();
    mountPanel();

    const design = editableSectionProps.design;
    const notes = editableSectionProps.notes;
    expect(design, 'the panel mounted the section with field="design"').toBeDefined();
    expect(notes).toBeDefined();

    // The same detail.updateField as for "Notes" — not a stub and not a noop.
    expect(design.updateField).toBe(notes.updateField);
    design.updateField({ design: 'text' });
    expect(mockUpdateField).toHaveBeenCalledWith({ design: 'text' });
  });

  test('the "Design" labels are its own: not a copy of "Notes", from the dictionary', () => {
    editableSectionProps = {};
    mockIssue = issue();
    mountPanel();

    const design = editableSectionProps.design;
    const notes = editableSectionProps.notes;
    expect(design.title).not.toBe(notes.title);
    expect(design.emptyAddLabel).not.toBe(notes.emptyAddLabel);
    expect(design.title).toBe(i18n.t('details:sections.design'));
    expect(design.emptyAddLabel).toBe(i18n.t('details:addDesign'));
  });
});

// ─────────── sk-421.1 T018 — the final order of the card sections ───────────
//
// The order of this run (its code is the last), on an epic and a non-epic card,
// with and without an alarm:
//   header → people chain → PROPERTIES AREA (properties row, then the
//   "Blocked" block) → epic section (epic only) → alarm (if any)
//   → close reason → acknowledgement flag → description → acceptance criteria →
//   notes → DESIGN → attachments → dependencies → comments → commits →
//   activity → watchers → (an alarm without an active one — at the very bottom).
//
// Checked by rendering with distinguishable stubs, not by reading the source: both
// conditional neighbours (epic, alarm) are not mutually ordered in the text of the file.
// Each expected order is compared whole (`toEqual`), and all its elements
// are distinct, so a swap of ANY two adjacent sections gives a different
// sequence and fails the check.

const TOP = ['header', 'title', 'people', 'properties', 'blocked', 'unavailable-links'];
const BODY = [
  'closed-reason',
  'review-flag',
  'description',
  'acceptanceCriteria',
  'notes',
  'design',
  'attachments',
  'dependencies',
  'comments',
  'commits',
  'activity',
  'watchers',
];

const FINAL_ORDER = {
  epicWithReminder: [...TOP, 'epic', 'reminders', ...BODY],
  epicNoReminder: [...TOP, 'epic', ...BODY, 'reminders'],
  taskWithReminder: [...TOP, 'reminders', ...BODY],
  taskNoReminder: [...TOP, ...BODY, 'reminders'],
};

describe('sk-421.1 T018 — the final section order (US-1, US-9, SC-009, SC-015)', () => {
  test.each([
    ['epic, alarm present', 'epicWithReminder', true, true],
    ['epic, no alarm', 'epicNoReminder', true, false],
    ['non-epic, alarm present', 'taskWithReminder', false, true],
    ['non-epic, no alarm', 'taskNoReminder', false, false],
  ] as Array<[string, keyof typeof FINAL_ORDER, boolean, boolean]>)(
    '%s → full order',
    (_name, key, epic, withReminder) => {
      mockIssue = epic ? epicIssue() : issue();
      mockReminders = withReminder ? [{ id: 'r-1' }] : [];
      const { container } = mountPanel();
      expect(order(container)).toEqual(FINAL_ORDER[key]);
    },
  );

  test('the properties area right after the people chain, the epic right after the area, "Design" between "Notes" and "Attachments"', () => {
    mockIssue = epicIssue();
    mockReminders = [{ id: 'r-1' }];
    const got = order(mountPanel().container);
    const at = (id: string) => got.indexOf(id);

    expect(at('properties')).toBe(at('people') + 1);
    expect(at('blocked')).toBe(at('properties') + 1);
    expect(at('unavailable-links')).toBe(at('blocked') + 1);
    expect(at('epic')).toBe(at('unavailable-links') + 1);
    expect(at('reminders')).toBe(at('epic') + 1);
    expect(at('design')).toBe(at('notes') + 1);
    expect(at('attachments')).toBe(at('design') + 1);
  });
});
