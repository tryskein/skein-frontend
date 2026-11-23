/**
 * sk-1048.37 — the Inspect mode lifecycle (`useInspectMode`).
 *
 * Contract: while on, hovering an element marks it and moving on (or leaving
 * the mode) gives the element back its own inline outline; a click on the page
 * picks that element — exactly one `POST /api/v1/me/theme/inspect` with its
 * selector — without running the element's own action, and ends the mode;
 * Escape ends it without picking; a click on the toggle itself is the toggle's
 * own (a second click turns the mode off, nothing is picked); once off, the
 * page's listeners are gone.
 *
 * What the mark looks like is not asserted (TEST_GUIDELINES §7): only that the
 * element's own inline style comes back unchanged.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { useInspectMode } from '../useInspectMode';

const fetchSpy = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchSpy.mockReset();
  fetchSpy.mockImplementation(async () => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Every request to the selection endpoint, whatever its method. */
const inspectCalls = () =>
  fetchSpy.mock.calls.filter(([url]) => String(url) === '/api/v1/me/theme/inspect');

/** The pick is sent after lazy imports; let them finish before asserting nothing was sent. */
async function settled() {
  await act(async () => {
    await vi.dynamicImportSettled();
  });
}

function Host({ onTarget }: { onTarget: () => void }) {
  const inspect = useInspectMode();
  return (
    <div className="page">
      <button type="button" data-inspect-toggle onClick={inspect.toggle}>
        inspect
      </button>
      <span data-testid="state">{inspect.enabled ? 'on' : 'off'}</span>
      <button type="button" className="card-title" style={{ outline: '2px solid red' }} onClick={onTarget}>
        target
      </button>
      <p className="other">other</p>
    </div>
  );
}

function mount() {
  const onTarget = vi.fn();
  render(<Host onTarget={onTarget} />);
  const state = () => screen.getByTestId('state').textContent;
  const toggle = screen.getByRole('button', { name: 'inspect' });
  const target = screen.getByRole('button', { name: 'target' });
  const other = screen.getByText('other');
  return { onTarget, state, toggle, target, other };
}

describe('useInspectMode', () => {
  test('hovering marks an element and moving on gives it back its own inline outline', () => {
    const { toggle, target, other } = mount();
    fireEvent.click(toggle);

    fireEvent.mouseMove(target);
    expect(target.style.outline).not.toBe('2px solid red');

    fireEvent.mouseMove(target);
    fireEvent.mouseMove(other);
    expect(target.style.outline).toBe('2px solid red');
    expect(other.style.outline).not.toBe('');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(other.style.outline).toBe('');
  });

  test('a click picks the element once, without its own action, and ends the mode', async () => {
    const { toggle, target, onTarget, state } = mount();
    fireEvent.click(toggle);
    expect(state()).toBe('on');

    const notCancelled = fireEvent.click(target);

    expect(notCancelled).toBe(false);
    expect(onTarget).not.toHaveBeenCalled();
    expect(state()).toBe('off');
    await waitFor(() => expect(inspectCalls()).toHaveLength(1));
    await settled();
    expect(inspectCalls()).toHaveLength(1);
    expect(inspectCalls()[0][1]?.method).toBe('POST');
    const body = JSON.parse(String(inspectCalls()[0][1]?.body));
    expect(Array.isArray(body.tokens)).toBe(true);
    expect(typeof body.computedStyle).toBe('object');
    expect(body.selector).toBe('.card-title');
    expect(body.parents[0]).toBe('.page');
  });

  test('Escape ends the mode without picking anything; other keys leave it on', async () => {
    const { toggle, state } = mount();
    fireEvent.click(toggle);

    fireEvent.keyDown(document, { key: 'a' });
    expect(state()).toBe('on');

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(state()).toBe('off');
    await settled();
    expect(inspectCalls()).toHaveLength(0);
  });

  test('the toggle is not picked: a second click on it turns the mode off', async () => {
    const { toggle, state } = mount();
    fireEvent.click(toggle);
    expect(state()).toBe('on');

    fireEvent.click(toggle);

    expect(state()).toBe('off');
    await settled();
    expect(inspectCalls()).toHaveLength(0);
  });

  test('after the mode ends the page behaves as before: clicks act, hovers mark nothing', async () => {
    const { toggle, target, onTarget } = mount();
    fireEvent.click(toggle);
    fireEvent.keyDown(document, { key: 'Escape' });

    fireEvent.mouseMove(target);
    fireEvent.click(target);

    expect(target.style.outline).toBe('2px solid red');
    expect(onTarget).toHaveBeenCalledTimes(1);
    await settled();
    expect(inspectCalls()).toHaveLength(0);
  });
});
