/**
 * sk-194.5.2.8.2 — regression guard for `memo(TaskCard)`.
 *
 * Profiling (sk-238) attributed
 * the LINEAR term of the keystroke cost in the Tasks column
 * (`≈16 ms + 0,053 ms × rows`) to every loaded row re-rendering on every
 * keystroke, even though the row data had not moved (the list query is
 * debounced 200 ms; the search state lives above the list).
 *
 * `memo()` on its own is not enough — it is only load-bearing while the call
 * site hands over referentially-stable props. The second test here is the
 * control: it reproduces the OLD per-row `onSelect={() => onSelect(item)}`
 * thunk and shows the memo goes dead. If someone reintroduces a per-row
 * closure at a call site, the first test fails and explains why.
 *
 * Render counting is done by spying on `highlightMatch`, which `TaskCard`
 * calls exactly once per render.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { useMemo, useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { EMPTY_REMINDERS_LIST } from '../../../api/reminders';
import { remindersListKey } from '../../../lib/useReminders';
import type { IssueSummary } from '../../../api/issues';

vi.mock('../../../lib/highlightMatch', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../lib/highlightMatch')>();
  return { highlightMatch: vi.fn(actual.highlightMatch) };
});

import { highlightMatch } from '../../../lib/highlightMatch';
import { TaskCard } from '../TaskCard';
import {
  LIST_DEFAULT_CARD_FIELDS,
  listCardFieldsMask,
} from '../../../lib/listCardFields';

/** Module-level so it is the SAME number on every render of the harness. */
const FIELDS = listCardFieldsMask(LIST_DEFAULT_CARD_FIELDS);

const renderCount = () => (highlightMatch as ReturnType<typeof vi.fn>).mock.calls.length;

function issue(): IssueSummary {
  return {
    id: 'sk-1',
    projectId: 'p-1',
    title: 'A task',
    type: 'task',
    status: 'open',
    priority: 3,
    pinned: false,
    isBlocked: false,
    componentIds: [],
    labels: [],
    assignee: 'alice',
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
  } as unknown as IssueSummary;
}

/**
 * Mounts one TaskCard under a parent that can be forced to re-render
 * without any of the card's inputs changing — the exact shape of "user
 * typed one more character in the filter box".
 *
 * `perRowThunk` switches between the current (stable handler) and the old
 * (fresh closure per row per render) call-site style.
 */
function Harness({ perRowThunk }: { perRowThunk: boolean }) {
  const [tick, setTick] = useState(0);
  const item = useMemo(issue, []);
  const componentNames = useMemo(() => new Map<string, string>(), []);
  const onSelect = useMemo(() => () => {}, []);
  return (
    <>
      <button type="button" onClick={() => setTick(tick + 1)}>
        rerender parent
      </button>
      <TaskCard
        item={item}
        selected={false}
        searchQuery=""
        componentNames={componentNames}
        // sk-194.5.2.8.5 — the lifted ringing flag. A primitive, so it is
        // referentially stable across parent renders by construction; that is
        // exactly why the lift could not hand down the `Set` instead.
        isRinging={false}
        // A NUMBER, and a constant one: the mask is the other prop that
        // had to stay primitive for this memo to hold at all.
        fields={FIELDS}
        onSelect={perRowThunk ? () => onSelect() : onSelect}
      />
    </>
  );
}

function renderHarness(perRowThunk: boolean) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // sk-194.5.2.8.5 — the card no longer reads the reminders query at all
  // (`isRinging` is a prop now), so nothing here can fire an async state
  // update behind the render counter. The seed stays as a tripwire: if
  // someone reintroduces a query subscription inside TaskCard it resolves
  // synchronously instead of quietly skewing the counts, and the
  // zero-observer assertion in TaskCard.test.tsx is what fails loudly.
  client.setQueryData(remindersListKey, EMPTY_REMINDERS_LIST);
  return render(
    <QueryClientProvider client={client}>
      <MantineProvider forceColorScheme="dark">
        <MemoryRouter>
          <Harness perRowThunk={perRowThunk} />
        </MemoryRouter>
      </MantineProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.mocked(highlightMatch).mockClear();
});

describe('memo(TaskCard)', () => {
  test('a parent re-render with unchanged props does NOT re-render the card', () => {
    renderHarness(false);
    expect(renderCount()).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'rerender parent' }));
    fireEvent.click(screen.getByRole('button', { name: 'rerender parent' }));
    // Still one — the memo held across two parent renders.
    expect(renderCount()).toBe(1);
  });

  test('control: a per-row onSelect thunk kills the memo', () => {
    renderHarness(true);
    expect(renderCount()).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'rerender parent' }));
    // The thunk is a new function identity each parent render, so the
    // shallow prop comparison fails and the card re-renders. This is the
    // behaviour the sk-194.5.2.8.2 signature change removed.
    expect(renderCount()).toBe(2);
  });
});
