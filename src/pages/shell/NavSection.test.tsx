/**
 * The section chevron from the keyboard (US-3; `NavSectionFrame`): ← folds an
 * open section, → opens a folded one, and pressing the same arrow again keeps
 * the state it reached; ↑ / ↓ move focus to the other section chevron of the
 * same nav column, never into another column.
 *
 * The stand: two real sections in one `data-nav-column` with their folding in
 * state, the way the shell keeps it, and a third section in another column.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NavSectionFrame } from './NavSection';

afterEach(cleanup);

const toggles = { projects: vi.fn(), queues: vi.fn() };

function Section({ kind, title, initiallyCollapsed }: {
  kind: 'projects' | 'queues';
  title: string;
  initiallyCollapsed: boolean;
}) {
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  return (
    <NavSectionFrame
      kind={kind}
      title={title}
      count={1}
      collapsed={collapsed}
      onToggle={() => {
        toggles[kind]();
        setCollapsed((c) => !c);
      }}
    >
      <p>{title} body</p>
    </NavSectionFrame>
  );
}

function renderColumns() {
  toggles.projects.mockClear();
  toggles.queues.mockClear();
  render(
    <>
      <nav data-nav-column>
        <Section kind="projects" title="Projects" initiallyCollapsed={false} />
        <Section kind="queues" title="Queues" initiallyCollapsed />
      </nav>
      <nav data-nav-column>
        <Section kind="projects" title="Elsewhere" initiallyCollapsed={false} />
      </nav>
    </>,
  );
  return {
    projects: screen.getByRole('button', { name: 'Projects' }),
    queues: screen.getByRole('button', { name: 'Queues' }),
    elsewhere: screen.getByRole('button', { name: 'Elsewhere' }),
  };
}

const expanded = (el: HTMLElement) => el.getAttribute('aria-expanded');

describe('NavSectionFrame — keyboard', () => {
  test('← folds an open section and a second ← keeps it folded', async () => {
    const user = userEvent.setup();
    const { projects } = renderColumns();
    projects.focus();

    await user.keyboard('{ArrowLeft}');
    expect(expanded(projects)).toBe('false');
    await user.keyboard('{ArrowLeft}');
    expect(expanded(projects)).toBe('false');
    expect(toggles.projects).toHaveBeenCalledTimes(1);
  });

  test('→ opens a folded section and a second → keeps it open', async () => {
    const user = userEvent.setup();
    const { queues } = renderColumns();
    queues.focus();

    await user.keyboard('{ArrowRight}');
    expect(expanded(queues)).toBe('true');
    await user.keyboard('{ArrowRight}');
    expect(expanded(queues)).toBe('true');
    expect(toggles.queues).toHaveBeenCalledTimes(1);
  });

  test('→ on an open section and ← on a folded one change nothing', async () => {
    const user = userEvent.setup();
    const { projects, queues } = renderColumns();

    projects.focus();
    await user.keyboard('{ArrowRight}');
    queues.focus();
    await user.keyboard('{ArrowLeft}');

    expect(expanded(projects)).toBe('true');
    expect(expanded(queues)).toBe('false');
    expect(toggles.projects).not.toHaveBeenCalled();
    expect(toggles.queues).not.toHaveBeenCalled();
  });

  test('↓ and ↑ move focus to the other chevron of the same column', async () => {
    const user = userEvent.setup();
    const { projects, queues } = renderColumns();
    projects.focus();

    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(queues);
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(projects);
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(queues);

    expect(expanded(projects)).toBe('true');
    expect(expanded(queues)).toBe('false');
  });

  test('a lone section of a column keeps focus on ↓', async () => {
    const user = userEvent.setup();
    const { elsewhere } = renderColumns();
    elsewhere.focus();

    await user.keyboard('{ArrowDown}');

    expect(document.activeElement).toBe(elsewhere);
  });
  test('the arrows are taken by the chevron, not left to scroll the page', () => {
    const { projects } = renderColumns();

    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      // `fireEvent` answers false when a handler called preventDefault.
      expect(fireEvent.keyDown(projects, { key }), key).toBe(false);
    }
  });

  test('another key neither moves focus nor folds', async () => {
    const user = userEvent.setup();
    const { projects } = renderColumns();
    // One key at a time from the same focus: two presses that each moved
    // focus would bring it back and hide the move.
    for (const key of ['{Home}', 'a', '{End}']) {
      projects.focus();
      await user.keyboard(key);
      expect(document.activeElement, key).toBe(projects);
    }
    expect(expanded(projects)).toBe('true');
    expect(toggles.projects).not.toHaveBeenCalled();
  });
});
