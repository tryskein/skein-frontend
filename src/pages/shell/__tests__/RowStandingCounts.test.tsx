/**
 * sk-118 — ProjectRow + ComponentRow Standing counter
 * MUST respect the global `outboxMode` lens invariant (CLAUDE.md):
 *
 *   outboxMode OFF → row shows the unscoped `standingCount`.
 *   outboxMode ON  → row shows the outbox-scoped `myOutboxStandingCount`.
 *
 * The feature wires this in ProjectRow.tsx / ComponentRow.tsx but no test
 * proved the flip is observable. We seed DIFFERING values for the two
 * fields so a regression that always reads one field would surface as a
 * wrong on-screen number. The standing chip renders as `∞{count}` and its
 * value is also folded into the counts container's aria-label, so we
 * assert against the aria-label (stable, not styling-dependent).
 *
 * `outboxMode` comes from `useLayoutState`; we mock that hook directly so
 * the flip is deterministic and independent of localStorage / router.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import type { ProjectListItem } from '../../../api/projects';
import type { Component } from '../../../api/components';
import { ProjectRow } from '../ProjectRow';
import { ComponentRow } from '../ComponentRow';

// ── Mock the global lens hook. Both rows only read `outboxMode` +
//    `onMeMode`; we drive them per-test via this mutable holder. ────────
const layoutState = { outboxMode: false, onMeMode: false };
vi.mock('../../../lib/useLayoutState', () => ({
  useLayoutState: () => layoutState,
}));

function project(over: Partial<ProjectListItem> = {}): ProjectListItem {
  return {
    id: 'proj-1',
    name: 'Orion',
    idPrefix: 'orn',
    defaultIdMode: 'counter',
    description: '',
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    openCount: 3,
    inProgressCount: 1,
    blockedCount: 0,
    // The two values under test — deliberately DIFFERENT so the flip is
    // observable: unscoped 9, outbox-scoped 2.
    standingCount: 9,
    myOutboxStandingCount: 2,
    myOutboxOpenCount: 3,
    myOutboxInProgressCount: 1,
    myOutboxBlockedCount: 0,
    ...over,
  };
}

function component(over: Partial<Component> = {}): Component {
  return {
    id: 'comp-1',
    projectId: 'proj-1',
    name: 'gateway',
    description: '',
    paths: [],
    createdBy: 'u-1',
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    openCount: 3,
    inProgressCount: 1,
    blockedCount: 0,
    standingCount: 9,
    myOutboxStandingCount: 2,
    myOutboxOpenCount: 3,
    myOutboxInProgressCount: 1,
    myOutboxBlockedCount: 0,
    ...over,
  };
}

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MantineProvider forceColorScheme="dark">
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </MantineProvider>
  );
}

beforeEach(() => {
  layoutState.outboxMode = false;
  layoutState.onMeMode = false;
});

afterEach(() => cleanup());

describe('ProjectRow — sk-118 standing counter respects outboxMode', () => {
  test('outboxMode OFF → shows the unscoped standingCount (9)', () => {
    layoutState.outboxMode = false;
    render(
      <Wrapper>
        <ProjectRow project={project()} selected={false} searchQuery="" onSelect={() => {}} />
      </Wrapper>,
    );
    const counts = screen.getByLabelText(/standing/i);
    expect(counts.getAttribute('aria-label')).toMatch(/9 standing/);
    expect(counts.getAttribute('aria-label')).not.toMatch(/2 standing/);
    // Visible chip text mirrors the unscoped value.
    expect(screen.getByText('∞9')).toBeTruthy();
  });

  test('outboxMode ON → shows the outbox-scoped myOutboxStandingCount (2)', () => {
    layoutState.outboxMode = true;
    render(
      <Wrapper>
        <ProjectRow project={project()} selected={false} searchQuery="" onSelect={() => {}} />
      </Wrapper>,
    );
    const counts = screen.getByLabelText(/standing/i);
    expect(counts.getAttribute('aria-label')).toMatch(/2 standing/);
    expect(counts.getAttribute('aria-label')).not.toMatch(/9 standing/);
    expect(screen.getByText('∞2')).toBeTruthy();
  });
});

describe('ComponentRow — sk-118 standing counter respects outboxMode', () => {
  test('outboxMode OFF → shows the unscoped standingCount (9)', () => {
    layoutState.outboxMode = false;
    render(
      <Wrapper>
        <ComponentRow component={component()} selected={false} onSelect={() => {}} />
      </Wrapper>,
    );
    const counts = screen.getByLabelText(/standing/i);
    expect(counts.getAttribute('aria-label')).toMatch(/9 standing/);
    expect(counts.getAttribute('aria-label')).not.toMatch(/2 standing/);
    expect(screen.getByText('∞9')).toBeTruthy();
  });

  test('outboxMode ON → shows the outbox-scoped myOutboxStandingCount (2)', () => {
    layoutState.outboxMode = true;
    render(
      <Wrapper>
        <ComponentRow component={component()} selected={false} onSelect={() => {}} />
      </Wrapper>,
    );
    const counts = screen.getByLabelText(/standing/i);
    expect(counts.getAttribute('aria-label')).toMatch(/2 standing/);
    expect(counts.getAttribute('aria-label')).not.toMatch(/9 standing/);
    expect(screen.getByText('∞2')).toBeTruthy();
  });
});
