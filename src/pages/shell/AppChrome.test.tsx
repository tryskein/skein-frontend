/**
 * AppChrome — the route-level header wrapper for the pages that don't
 * render HeaderBar themselves (`/legacy/*` and `/activity`).
 *
 * What's pinned here:
 *   1. the header IS rendered above the routed page (the whole point —
 *      no page in the app may be a dead end without global nav);
 *   2. the routed page still renders inside it (the <Outlet/> is not
 *      swallowed);
 *
 * HeaderBar itself is stubbed: its own render contract is covered in
 * HeaderBar.test.tsx, and mounting the real one here would drag in the
 * auth/query/i18n stack for a routing assertion.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('./HeaderBar', () => ({
  HeaderBar: () => <header data-testid="header-bar" className="header-bar" />,
}));

import { AppChrome } from './AppChrome';

afterEach(() => {
  cleanup();
});

function renderAt(pathname: string) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter initialEntries={[pathname]}>
      <Routes>
        <Route element={<AppChrome />}>
          <Route path="/legacy" element={<div>legacy page</div>} />
        </Route>
        <Route element={<AppChrome scroll="page" />}>
          <Route path="/activity" element={<div>activity page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AppChrome', () => {
  test('puts the header above a legacy page and keeps the page rendered', () => {
    renderAt('/legacy');

    const header = screen.getByTestId('header-bar');
    const page = screen.getByText('legacy page');
    // Header first, page body second — the page never covers the nav,
    // and the reading order says so.
    expect(header.compareDocumentPosition(page) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('/activity gets the header too, with its page rendered below it', () => {
    renderAt('/activity');
    const header = screen.getByTestId('header-bar');
    const page = screen.getByText('activity page');
    expect(header.compareDocumentPosition(page) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
