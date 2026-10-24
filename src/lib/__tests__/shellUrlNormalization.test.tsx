/**
 * sk-303.13 (T027, test matrix row 41) — the routed half of the
 * parameter contract.
 *
 * Two things need a real router to be provable at all:
 *   - a value the app cannot honour is corrected with `replace`, so the
 *     correction is not a place the user can press Back into (a pushed
 *     correction makes Back bounce between the bad address and its fix,
 *     forever);
 *   - the shell parameters survive a change of PATH — picking a project
 *     or a task must not silently drop the tab and the lens the user is
 *     looking through. `?file=` is the documented exception: it names an
 *     attachment of the issue being left behind.
 *
 * The pure parameter arithmetic is in `shellUrlState.test.ts`; "the
 * address beats storage" is row 40 in `shellAddressability.test.tsx`.
 */

import { beforeEach, describe, expect, test } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { LayoutProvider, useLayoutState } from '../useLayoutState';

let layout: ReturnType<typeof useLayoutState> | null = null;
let go: ReturnType<typeof useNavigate> | null = null;

function Probe() {
  layout = useLayoutState();
  go = useNavigate();
  const loc = useLocation();
  return (
    <>
      <span data-testid="url">{`${loc.pathname}${loc.search}`}</span>
      <span data-testid="state">{JSON.stringify(loc.state ?? null)}</span>
    </>
  );
}

function url(): string {
  return screen.getByTestId('url').textContent ?? '';
}

function navState(): unknown {
  return JSON.parse(screen.getByTestId('state').textContent ?? 'null');
}

function mountAt(entry: string) {
  const element = (
    <LayoutProvider>
      <Probe />
    </LayoutProvider>
  );
  return render(
    <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/" element={element} />
        <Route path="/issues/:id" element={element} />
        <Route path="/projects/:alias" element={element} />
        <Route path="/projects/:alias/issues/:id" element={element} />
        <Route path="/projects/:alias/components/:cid" element={element} />
        <Route
          path="/projects/:alias/components/:cid/issues/:id"
          element={element}
        />
      </Routes>
    </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  layout = null;
  go = null;
  cleanup();
});

describe('T027 — an unhonourable value is corrected in place', () => {
  test('the unknown values are gone from the address, the rest survives', () => {
    mountAt('/?tab=bogus&lens=nope&file=att-1');
    expect(url()).toBe('/?file=att-1');
    // …and the shell reads as "no opinion in the address": default tab,
    // no lens, viewer still open.
    expect(layout!.inboxTab).toBe('inbox');
    expect(layout!.onMeMode).toBe(false);
    expect(layout!.outboxMode).toBe(false);
    expect(layout!.budilnikMode).toBe(false);
    expect(layout!.selectedAttachment).toBe('att-1');
  });

  test('the correction adds no history entry — Back skips past it', () => {
    // Start somewhere identifiable, then walk INTO the bad address so
    // there is a previous entry to come back to.
    mountAt('/projects/sk');
    act(() => go!('/?tab=bogus&lens=nope'));
    expect(url()).toBe('/');

    act(() => go!(-1));
    // One step back is the page we came from. If the correction had
    // been pushed, this would be the bad address again.
    expect(url()).toBe('/projects/sk');
  });

  test('the correction keeps location.state (overlay flags are not collateral)', () => {
    // sk-405 — the fixture key was `fromInbox` until that task retired
    // the flag. What the correction promises has nothing to do with
    // which key it is (it copies `location.state` wholesale), so the
    // fixture is a neutral marker; naming a flag the app no longer
    // writes would quietly assert that it still exists.
    mountAt('/projects/sk');
    act(() => go!('/projects/sk/issues/sk-42?tab=bogus', { state: { carriedThrough: true } }));
    expect(url()).toBe('/projects/sk/issues/sk-42');
    expect(navState()).toEqual({ carriedThrough: true });
  });

  test('a good address is left exactly as it was written', () => {
    mountAt('/projects/sk/issues/sk-42?tab=mentions&lens=on-me&file=att-1');
    expect(url()).toBe('/projects/sk/issues/sk-42?tab=mentions&lens=on-me&file=att-1');
  });
});

describe('T027 — the shell parameters survive a change of path', () => {
  test('selecting a project keeps tab and lens', () => {
    mountAt('/?tab=watching&lens=delegated');
    act(() => layout!.setSelectedProject('sk'));
    expect(url()).toBe('/projects/sk?tab=watching&lens=delegated');
    expect(layout!.inboxTab).toBe('watching');
    expect(layout!.outboxMode).toBe(true);
  });

  test('selecting a task keeps them too, and drops the viewer of the task left behind', () => {
    mountAt('/projects/sk/issues/sk-1?tab=mentions&file=att-1');
    act(() => layout!.setSelectedIssue('sk-2', 'sk'));
    expect(url()).toBe('/projects/sk/issues/sk-2?tab=mentions');
    expect(layout!.selectedAttachment).toBeNull();
  });

  test('deselecting a task, and the component route, keep them as well', () => {
    mountAt('/projects/sk/components/c-1/issues/sk-1?tab=inbox&lens=on-me');
    act(() => layout!.clearSelectedIssue());
    expect(url()).toBe('/projects/sk/components/c-1?tab=inbox&lens=on-me');

    act(() => layout!.setSelectedComponent(null, 'sk'));
    expect(url()).toBe('/projects/sk?tab=inbox&lens=on-me');
  });

  test('a queue click keeps them and plants no nav state at all', () => {
    // sk-405 — this used to end `expect(navState()).toEqual({ fromInbox:
    // true })`, and that flag was the whole mechanism by which opening a
    // queue card unmounted the Projects and Tasks columns. The owner
    // asked for those columns to stay, so the flag went; the assertion
    // is inverted rather than deleted, because "writes nothing" is the
    // property that has to survive — put the tag back at this call site
    // and this line turns red at the source, one step before
    // `InboxSelectionKeepsColumns.test.tsx` catches it at the shell.
    mountAt('/?tab=inbox&lens=delegated');
    act(() => layout!.selectInboxIssue('sk-7', 'sk'));
    expect(url()).toBe('/projects/sk/issues/sk-7?tab=inbox&lens=delegated');
    expect(navState()).toBeNull();
  });

  test('opening and closing an attachment leaves tab and lens alone', () => {
    mountAt('/projects/sk/issues/sk-1?tab=watching&lens=budilnik');
    act(() => layout!.openAttachment('att-9'));
    expect(url()).toBe('/projects/sk/issues/sk-1?tab=watching&lens=budilnik&file=att-9');

    act(() => layout!.closeAttachment());
    expect(url()).toBe('/projects/sk/issues/sk-1?tab=watching&lens=budilnik');
    expect(layout!.inboxTab).toBe('watching');
    expect(layout!.budilnikMode).toBe(true);
  });
});
