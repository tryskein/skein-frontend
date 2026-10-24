/**
 * sk-118 (§6, decision §11.8) — the "Create subtask" affordance's CREATE
 * FLOW. The sibling CreateSubtaskAffordance.standing.test.tsx asserts the
 * button RENDERS on a standing issue (and not on an open one); this file
 * fills the genuine F-AUDIT gap: the button's actual behavior — opening
 * the modal, the empty-title guard, and (the load-bearing contract) the
 * `createIssue` POST carrying the standing parent's id as `parentId`.
 *
 * Acting on a standing task means spawning a child cycle with
 * skein_create(parentId=<standing>); if this wiring regressed (wrong
 * parentId, missing type, no validation), the whole standing working
 * model would silently break with zero test coverage. These tests mock
 * only the network boundary (`createIssue`) and exercise the real
 * component logic.
 */

import { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { IssueDetail } from '../../../api/issues';
import { LayoutProvider } from '../../../lib/useLayoutState';

// Mock only the network boundary: createIssue. Everything else (modal,
// validation, mutation wiring) is the real component under test.
vi.mock('../../../api/issues', async () => {
  const actual = await vi.importActual<typeof import('../../../api/issues')>(
    '../../../api/issues',
  );
  return {
    ...actual,
    createIssue: vi.fn(),
  };
});

import { createIssue } from '../../../api/issues';
import { CreateSubtaskButton } from './CreateSubtaskButton';

const createIssueMock = vi.mocked(createIssue);

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return (
    <MantineProvider forceColorScheme="dark">
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <LayoutProvider>{children}</LayoutProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
}

function childDetail(): IssueDetail {
  return {
    id: 'sk-42.1',
    projectId: 'p1',
    version: 1,
    title: 'merge upstream v2.3.1',
    description: '',
    type: 'task',
    priority: 3,
    status: 'open',
    pinned: false,
    source: 'human',
    design: '',
    acceptanceCriteria: '',
    notes: '',
    createdBy: 'user-bob',
    createdAt: '2026-06-20T10:00:00Z',
    updatedAt: '2026-06-20T10:00:00Z',
    metadata: {},
    componentIds: [],
    labels: [],
    commentsCount: 0,
    commitRefs: [],
    mentions: [],
    isBlocked: false,
    blockers: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('CreateSubtaskButton — sk-118 create flow', () => {
  test('renders the affordance and opens the cycle modal on click', async () => {
    render(
      <Wrapper>
        <CreateSubtaskButton parentId="sk-42" projectHandle="sk" />
      </Wrapper>,
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: /Create subtask under standing task sk-42/i,
      }),
    );
    // Mantine Modal mounts via Portal — the title references the standing
    // parent id so the user knows which obligation they're spawning under.
    expect(await screen.findByText(/New cycle under sk-42/i)).toBeTruthy();
    expect(
      await screen.findByPlaceholderText(/merge upstream v2\.3\.1/i),
    ).toBeTruthy();
  });

  test('empty title shows the required-field guard and does NOT call createIssue', async () => {
    render(
      <Wrapper>
        <CreateSubtaskButton parentId="sk-42" projectHandle="sk" />
      </Wrapper>,
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: /Create subtask under standing task sk-42/i,
      }),
    );
    // Submit with an empty (whitespace) title via the modal's Create button.
    const createBtn = await screen.findByRole('button', { name: 'Create' });
    fireEvent.click(createBtn);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Title is required/i);
    expect(createIssueMock).not.toHaveBeenCalled();
  });

  test('submitting a title POSTs createIssue with the standing parentId + task type', async () => {
    createIssueMock.mockResolvedValue(childDetail());
    const onCreated = vi.fn();

    render(
      <Wrapper>
        <CreateSubtaskButton
          parentId="sk-42"
          projectHandle="sk"
          onCreated={onCreated}
        />
      </Wrapper>,
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: /Create subtask under standing task sk-42/i,
      }),
    );

    const input = await screen.findByPlaceholderText(/merge upstream v2\.3\.1/i);
    fireEvent.change(input, { target: { value: '  merge upstream v2.3.1  ' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Create' }));

    // The load-bearing contract: the child is created under the STANDING
    // parent (parentId), with a trimmed title and the default task type.
    await vi.waitFor(() => {
      expect(createIssueMock).toHaveBeenCalledTimes(1);
    });
    expect(createIssueMock).toHaveBeenCalledWith('sk', {
      parentId: 'sk-42',
      title: 'merge upstream v2.3.1',
      type: 'task',
    });
    // onSuccess fires the optional callback with the created child.
    await vi.waitFor(() => {
      expect(onCreated).toHaveBeenCalledTimes(1);
    });
    expect(onCreated).toHaveBeenCalledWith(childDetail());
  });
});
