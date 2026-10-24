/**
 * sk-285.1.3 — inline editing must not move the card.
 *
 * Three user complaints drive these tests:
 *   1. the card SHRANK on entering edit mode — the textarea sized itself
 *      from `\n` count while the read body wrapped to far more visual
 *      lines. Now the read box is measured and handed to the textarea
 *      as a height floor, and both modes share one geometry class.
 *   2. you couldn't tell where the caret landed — the caret now goes to
 *      the clicked character (mapped through `sourceCaretFromClick`).
 *   3. leaving edit mode must be symmetric — same surface class, same
 *      footer, so the card returns to the height it had.
 *
 * jsdom has no layout engine, so "same geometry" is asserted structurally
 * (both modes carry `.inline-edit-surface`; the footer exists in both;
 * the measured height reaches the textarea as an explicit min-height).
 */

import { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { IssueDetail } from '../../../../api/issues';
import { EditableTextSection } from './EditableTextSection';

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return (
    <MantineProvider forceColorScheme="dark">
      <QueryClientProvider client={qc}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
}

function makeIssue(description: string): IssueDetail {
  return {
    id: 'sk-42',
    projectId: 'p1',
    version: 1,
    title: 't',
    description,
    type: 'task',
    priority: 2,
    status: 'open',
    pinned: false,
    source: 'human',
    design: '',
    acceptanceCriteria: '',
    notes: '',
    createdBy: 'user-alice',
    createdAt: '2026-05-15T10:00:00Z',
    updatedAt: '2026-05-15T10:00:00Z',
    metadata: {},
    componentIds: [],
    labels: [],
    commentsCount: 0,
    commitRefs: [],
    mentions: [],
    isBlocked: false,
    blockers: [],
    assignee: 'bob',
    previousAssignees: [],
    dismissedBy: [],
  };
}

function renderSection(description: string) {
  const updateField = vi.fn(async (): Promise<IssueDetail> => makeIssue(description));
  const view = render(
    <Wrapper>
      <EditableTextSection
        title="Description"
        field="description"
        emptyAddLabel="Add description"
        issue={makeIssue(description)}
        updateField={updateField}
      />
    </Wrapper>,
  );
  return { ...view, updateField };
}

/**
 * jsdom ships neither caret API, so the tests install one. The cast goes
 * through `unknown` because lib.dom's `CaretPosition` carries a
 * `getClientRect()` the stub has no use for.
 */
type CaretHit = { offsetNode: Node; offset: number };

function stubCaretApi(hit: () => CaretHit | null): void {
  (document as unknown as Record<string, unknown>).caretPositionFromPoint = hit;
}

function clearCaretApi(): void {
  Reflect.deleteProperty(document, 'caretPositionFromPoint');
}

const READ_HEIGHT = 240;
let rectSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  // jsdom returns all-zero rects; pretend the read body is 240px tall so
  // the measured-floor path is exercised.
  rectSpy = vi
    .spyOn(HTMLDivElement.prototype, 'getBoundingClientRect')
    .mockReturnValue({
      x: 0,
      y: 0,
      width: 600,
      height: READ_HEIGHT,
      top: 0,
      left: 0,
      right: 600,
      bottom: READ_HEIGHT,
      toJSON: () => ({}),
    } as DOMRect);
});

afterEach(() => {
  rectSpy?.mockRestore();
  rectSpy = null;
  clearCaretApi();
  cleanup();
});

describe('EditableTextSection — no geometry jump (sk-285.1.3)', () => {
  test('read and edit modes render the same geometry surface', async () => {
    const { container } = renderSection('Hello **bold** world');

    const read = container.querySelector('.markdown-clickable');
    expect(read).toBeTruthy();
    expect(read!.classList.contains('inline-edit-surface')).toBe(true);
    // sk-285.7.2.58 — the constant-height row is the HEADING slot now,
    // not a trailing footer. It exists in read mode and in edit mode,
    // and that is what the swap's no-nudge promise rests on.
    expect(container.querySelector('.inline-edit-foot'), 'the footer is gone').toBeNull();
    expect(container.querySelector('.inline-edit-head-slot')).toBeTruthy();

    fireEvent.click(read!);

    const textarea = await screen.findByLabelText<HTMLTextAreaElement>(
      'Description',
    );
    expect(textarea.classList.contains('inline-edit-surface')).toBe(true);
    expect(container.querySelector('.inline-edit-head-slot')).toBeTruthy();
    expect(container.querySelector('.inline-edit-foot')).toBeNull();
  });

  test('textarea gets the measured read height as its floor', async () => {
    const { container } = renderSection('a long body');

    fireEvent.click(container.querySelector('.markdown-clickable')!);

    const textarea = await screen.findByLabelText<HTMLTextAreaElement>(
      'Description',
    );
    expect(textarea.style.minHeight).toBe(`${READ_HEIGHT}px`);
  });

  test('leaving edit mode restores the read surface and the heading slot', async () => {
    const { container } = renderSection('unchanged text');

    fireEvent.click(container.querySelector('.markdown-clickable')!);
    const textarea = await screen.findByLabelText<HTMLTextAreaElement>(
      'Description',
    );
    fireEvent.blur(textarea);

    await waitFor(() => {
      const read = container.querySelector('.markdown-clickable');
      expect(read).toBeTruthy();
      expect(read!.classList.contains('inline-edit-surface')).toBe(true);
    });
    expect(container.querySelector('.inline-edit-head-slot')).toBeTruthy();
    // Nothing was typed, so no save was attempted and the body is intact.
    expect(screen.getByText(/unchanged text/)).toBeTruthy();
  });

  test('the Edit button lives on the HEADING row, not in the body or the foot', async () => {
    // sk-285.7.2.54 (audit D2B-5) — §6: «Description (h3 14/600 + Edit
    // ghost)», and `Sk Details.dc.html` draws the pair as one
    // `space-between` row. It used to sit in the trailing footer, below
    // the text and flush left.
    const { container } = renderSection('body text');
    const editBtn = screen.getByRole('button', { name: 'Edit Description' });
    expect(editBtn.closest('.detail-section-head')).toBeTruthy();
    expect(editBtn.closest('.inline-edit-foot')).toBeNull();
    expect(editBtn.closest('.markdown-clickable')).toBeNull();
    // sk-285.7.2.58 — and it shares the slot with the save status.
    expect(editBtn.closest('.inline-edit-head-slot')).toBeTruthy();
    // The heading is its sibling on that row, in that order.
    const head = editBtn.closest('.detail-section-head')!;
    expect(head.firstElementChild!.className).toBe('detail-section-title');
    expect(head.lastElementChild!.className).toBe('detail-section-head-action');

    // …and it carries §8's `pencil`, not a bare word: §6 draws the
    // control as an icon plus a label, and the panel's zone count is
    // what sk-285.7.2.45 was opened for.
    expect(editBtn.querySelectorAll('svg')).toHaveLength(1);
    expect((editBtn.textContent ?? '').trim()).toBe('Edit');

    fireEvent.click(editBtn);
    await screen.findByLabelText('Description');
    // In edit mode the button is gone — and the HEADING ROW keeps its
    // slot, which is what rule 3's no-nudge promise now rests on.
    // sk-285.7.2.58: it used to rest on a trailing footer while this
    // very row collapsed onto the bare `<h2>` (203px read vs 188 edit,
    // measured), so the assertion moved to where the promise is.
    expect(screen.queryByRole('button', { name: 'Edit Description' })).toBeNull();
    expect(container.querySelector('.inline-edit-foot')).toBeNull();
    expect(container.querySelector('.detail-section-head')).toBeTruthy();
    expect(container.querySelector('.inline-edit-head-slot')).toBeTruthy();
  });
});

/**
 * sk-285.7.2.58 — the swap changes ONE box, and it is the surface.
 *
 * ── Why this is a separate claim from the ones above ────────────────
 *
 * The tests above check that both modes carry `.inline-edit-surface`
 * and that the constant-height row exists in both. Neither of them
 * could see the defect this task is about, and the reason is worth
 * writing down: what moved the layout was a row that was CORRECT in
 * both modes individually and PRESENT in only one of them.
 * `headerAction` was `null` while editing, so `.detail-section-head`
 * was not rendered at all and the heading collapsed onto the bare
 * `<h2>`. Measured in Chromium at 1440 on a Description with a body:
 *
 *   read   section 203px   head 36px   foot 36px
 *   edit   section 188px   head —      foot 36px
 *
 * i.e. everything below the section jumped 15px on every entry and
 * every exit — the exact nudge rule 3 of sk-285.1.3 exists to prevent,
 * paid for by a trailing band that held nothing visible.
 *
 * ── What is asserted, given that jsdom has no layout ────────────────
 *
 * Not a height: `getBoundingClientRect()` is zeros here (and is stubbed
 * for the read body, which is why a height comparison would be circular
 * on top of being unavailable). What IS available, and is what actually
 * differed, is the ROW INVENTORY: the sequence of height-bearing boxes
 * the section is built from. A row that appears in one mode and not the
 * other cannot be height-neutral no matter what either mode's CSS says.
 *
 * The heights those rows resolve to are pinned separately, by the CSS
 * contract below and by `EmptySectionAddSize.test.ts`, which measures
 * the floor through the cascade.
 */
describe('sk-285.7.2.58 — read and edit build the section from the same rows', () => {
  /** The section's structural rows, outermost first, as class chains. */
  function rowInventory(container: HTMLElement): string[] {
    const section = container.querySelector('.detail-section');
    expect(section, 'no section rendered').not.toBeNull();
    return [...section!.children].map((child) => {
      const own = child.className || child.tagName.toLowerCase();
      // One level down as well: the head's own content is what
      // disappeared, and a check that stopped at the section's children
      // would have watched `.detail-section-head` come and go without
      // noticing what it was carrying.
      const inner = [...child.children]
        .map((g) => g.className || g.tagName.toLowerCase())
        .join('+');
      return inner === '' ? own : `${own}[${inner}]`;
    });
  }

  test('the inventory is identical in both modes', async () => {
    const { container } = renderSection('a body worth editing');
    const read = rowInventory(container);

    fireEvent.click(container.querySelector('.markdown-clickable')!);
    await screen.findByLabelText('Description');
    const edit = rowInventory(container);

    expect(edit).toEqual(read);
    // Vacuity: an inventory of one row (or of none) would compare equal
    // for the wrong reason. The section really is a heading row plus a
    // body.
    expect(read.length).toBe(2);
    expect(read[0]).toContain('detail-section-head');
    expect(read[1]).toContain('detail-section-body');
  });

  test('…and the constant-height row is in it, in both modes', async () => {
    const { container } = renderSection('a body worth editing');
    const slot = () => container.querySelector('.detail-section-head .inline-edit-head-slot');
    expect(slot(), 'read mode has no heading slot').not.toBeNull();

    fireEvent.click(container.querySelector('.markdown-clickable')!);
    await screen.findByLabelText('Description');
    expect(slot(), 'edit mode has no heading slot').not.toBeNull();
  });

  test('the trailing band is gone — no row under the text holds nothing', async () => {
    // The other half of the task: `.inline-edit-foot` read as 36px of
    // empty space under every filled section once the Edit button left
    // it. Asserted as an absence rather than as "it is empty", because
    // an empty box that still occupies a floor is the defect.
    const { container } = renderSection('a body worth editing');
    expect(container.querySelector('.inline-edit-foot')).toBeNull();
    fireEvent.click(container.querySelector('.markdown-clickable')!);
    await screen.findByLabelText('Description');
    expect(container.querySelector('.inline-edit-foot')).toBeNull();
  });

  test('the save status is still mounted after the editor closes', async () => {
    // The reason the row could not simply be deleted: a blur-triggered
    // flush finishes AFTER the textarea is gone, and the user still has
    // to be told «saving…» or shown the error. The live region has to
    // survive the swap, in the same place, or the announcement is lost.
    const { container } = renderSection('a body worth editing');
    const live = () => container.querySelector('.inline-edit-status[role="status"]');
    expect(live()).not.toBeNull();

    fireEvent.click(container.querySelector('.markdown-clickable')!);
    const textarea = await screen.findByLabelText<HTMLTextAreaElement>('Description');
    expect(live()).not.toBeNull();

    fireEvent.blur(textarea);
    await waitFor(() => expect(container.querySelector('.markdown-clickable')).not.toBeNull());
    expect(live(), 'the status vanished with the editor').not.toBeNull();
    expect(live()!.getAttribute('aria-live')).toBe('polite');
  });

  test('the collapsed empty row carries the status too', async () => {
    // It could not before: the footer lived inside the `!isEmpty`
    // branch, so a flush that finished after a section had been cleared
    // to empty reported nowhere at all.
    const { container } = renderSection('');
    expect(container.querySelector('.detail-section--empty')).not.toBeNull();
    expect(container.querySelector('.inline-edit-status[role="status"]')).not.toBeNull();
  });
});

describe('EditableTextSection — caret follows the click (sk-285.1.3)', () => {
  test('caret lands on the clicked word, not at the end', async () => {
    const source = 'Hello **bold** world';
    const { container } = renderSection(source);
    const read = container.querySelector('.markdown-clickable') as HTMLElement;

    // Pretend the pointer hit the "w" of "world" in the rendered body.
    const rendered = read.textContent ?? '';
    const renderedIdx = rendered.indexOf('world');
    const walker = document.createTreeWalker(read, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    let consumed = 0;
    while (node && consumed + (node.textContent?.length ?? 0) <= renderedIdx) {
      consumed += node.textContent?.length ?? 0;
      node = walker.nextNode();
    }
    const hitNode = node!;
    const hitOffset = renderedIdx - consumed;
    stubCaretApi(() => ({ offsetNode: hitNode, offset: hitOffset }));

    fireEvent.click(read, { clientX: 100, clientY: 20 });

    const textarea = await screen.findByLabelText<HTMLTextAreaElement>(
      'Description',
    );
    await waitFor(() => {
      expect(textarea.selectionStart).toBe(source.indexOf('world'));
    });
    expect(textarea.selectionEnd).toBe(source.indexOf('world'));
  });

  test('without a caret API the caret falls back to the end of the text', async () => {
    const source = 'plain body';
    const { container } = renderSection(source);

    fireEvent.click(container.querySelector('.markdown-clickable')!);

    const textarea = await screen.findByLabelText<HTMLTextAreaElement>(
      'Description',
    );
    await waitFor(() => {
      expect(textarea.selectionStart).toBe(source.length);
    });
  });
});
