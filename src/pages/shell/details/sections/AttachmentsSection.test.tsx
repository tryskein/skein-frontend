/**
 * sk-285.6.9 — the upload zone is folded away at rest.
 *
 * The dashed ~70px "click to pick a file, or drag one here" rectangle
 * used to sit in every card permanently, with "no attachments yet"
 * printed underneath it — one place saying the same thing twice. These
 * tests pin the states that replaced it, the duplication that must
 * never come back, and the three ways the folding can quietly cost
 * more than the 92px it saves:
 *
 *   - reading "not loaded yet" as "none", which buries the list's own
 *     loading and error frames;
 *   - charging a second click for the file picker;
 *   - unmounting the drop target on the very flush its drop started an
 *     upload, which aborts that upload without a word.
 *
 * The dropzone and the list are stubbed: what is under test is the
 * section's composition (which child exists when, and with what), not
 * the upload pipeline, which this change deliberately did not touch.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Attachment } from '../../../../api/attachments';
import { en } from '../../../../i18n/locales/en';

/** Records what the section handed the dropzone on its last render. */
const dropzoneProps: { autoOpen?: boolean; armed?: boolean }[] = [];
/** Records what the section handed the LIST on its last render. */
const listProps: { pendingName?: string | null; dimmed?: boolean }[] = [];
/** The last `onUploadingChange` the section gave the dropzone. */
const report: { fn?: (name: string | null) => void } = {};
/** Bumped by the stub's unmount cleanup — the abort the real zone does. */
const dropzoneUnmounts = { count: 0 };

vi.mock('../../../../components/AttachmentDropzone', () => ({
  AttachmentDropzone: ({
    autoOpen,
    armed,
    onUploadingChange,
  }: {
    autoOpen?: boolean;
    armed?: boolean;
    onUploadingChange?: (name: string | null) => void;
  }) => {
    dropzoneProps.push({ autoOpen, armed });
    report.fn = onUploadingChange;
    // The callback ref stands in for the real component's unmount
    // cleanup, which aborts any upload in flight
    // (AttachmentDropzone.tsx) — the damage a fold-on-drop does.
    return <div data-testid="dropzone" ref={registerUnmount} />;
  },
}));

/** Callback ref: fires with null when the node leaves the tree. */
function registerUnmount(node: HTMLElement | null) {
  if (node === null) dropzoneUnmounts.count += 1;
}

vi.mock('../../../../components/AttachmentList', () => ({
  AttachmentList: ({
    pendingName,
    dimmed,
  }: {
    pendingName?: string | null;
    dimmed?: boolean;
  }) => {
    listProps.push({ pendingName, dimmed });
    return <div data-testid="attachment-list" />;
  },
}));

import { AttachmentsSection } from './AttachmentsSection';

function att(id: string): Attachment {
  return {
    id,
    issueId: 'sk-1',
    filename: `${id}.txt`,
    contentType: 'text/plain',
    sizeBytes: 10,
    status: 'ready',
    uploadedBy: 'u-1',
    uploadedAt: '2026-01-01T00:00:00Z',
  };
}

afterEach(() => {
  cleanup();
  dropzoneProps.length = 0;
  listProps.length = 0;
  report.fn = undefined;
  dropzoneUnmounts.count = 0;
});

describe('AttachmentsSection — the uploader unfolds on demand', () => {
  test('with no attachments the section is one row and mounts neither child', () => {
    const { container } = render(
      <AttachmentsSection issueId="sk-1" attachments={[]} />,
    );

    expect(container.querySelector('.detail-section--empty')).not.toBeNull();
    expect(screen.queryByTestId('dropzone')).toBeNull();
    // The duplicate line is gone BY CONSTRUCTION: the list, which is
    // what printed "no attachments yet", is not mounted at all.
    expect(screen.queryByTestId('attachment-list')).toBeNull();
    expect(screen.getByRole('button', { name: 'Upload file' })).toBeTruthy();
  });

  test('pressing the upload affordance unfolds the dropzone — and only the dropzone', async () => {
    const user = userEvent.setup();
    render(<AttachmentsSection issueId="sk-1" attachments={[]} />);

    await user.click(screen.getByRole('button', { name: 'Upload file' }));

    expect(screen.getByTestId('dropzone')).toBeTruthy();
    // One place, one message: once the real target is on screen the
    // one-line button that summoned it is gone.
    expect(screen.queryByRole('button', { name: 'Upload file' })).toBeNull();
    // …and the list stays away. This is the state the empty-collapse
    // does NOT cover (the section is expanded here, so children DO
    // render): drop the list's own guard and "no attachments yet"
    // reappears right under the open dropzone — the exact duplication
    // sk-285.6.9 removed.
    expect(screen.queryByTestId('attachment-list')).toBeNull();
  });

  test('the press opens the file picker itself — one click, one dialog', async () => {
    const user = userEvent.setup();
    render(<AttachmentsSection issueId="sk-1" attachments={[]} />);

    await user.click(screen.getByRole('button', { name: 'Upload file' }));

    // `autoOpen` is the whole contract: the dropzone opens the picker
    // and takes focus, so the press that revealed it is not merely the
    // first of two presses.
    expect(dropzoneProps.at(-1)?.autoOpen).toBe(true);
  });

  test('a file dragged over the card unfolds the drop target without a click', () => {
    render(<AttachmentsSection issueId="sk-1" attachments={[]} dragActive />);

    expect(screen.getByTestId('dropzone')).toBeTruthy();
    // No picker: the user is already holding the file, and an OS dialog
    // on top of a drag would be the worst possible answer.
    expect(dropzoneProps.at(-1)?.autoOpen).toBe(false);
  });

  test('the drop target survives its own drop', () => {
    // The real sequence, in the order the browser delivers it: the drop
    // lands on the zone (starting an upload), then bubbles to the card,
    // where the watch clears `dragActive` and counts the drop — in ONE
    // React flush. Folding on that flush unmounts the zone mid-upload
    // and its cleanup aborts the request in silence.
    const { rerender } = render(
      <AttachmentsSection
        issueId="sk-1"
        attachments={[]}
        dragActive
        dropCount={0}
      />,
    );
    expect(screen.getByTestId('dropzone')).toBeTruthy();

    rerender(
      <AttachmentsSection
        issueId="sk-1"
        attachments={[]}
        dragActive={false}
        dropCount={1}
      />,
    );

    expect(screen.queryByTestId('dropzone')).not.toBeNull();
    expect(dropzoneUnmounts.count).toBe(0);
  });

  test('a drag that wandered off again folds the target back away', () => {
    // The other ending: no drop, so nothing is uploading and the card
    // must not keep a dashed rectangle it was never asked for.
    const { container, rerender } = render(
      <AttachmentsSection
        issueId="sk-1"
        attachments={[]}
        dragActive
        dropCount={0}
      />,
    );

    rerender(
      <AttachmentsSection
        issueId="sk-1"
        attachments={[]}
        dragActive={false}
        dropCount={0}
      />,
    );

    expect(screen.queryByTestId('dropzone')).toBeNull();
    expect(container.querySelector('.detail-section--empty')).not.toBeNull();
  });

  test('with attachments the list shows and the uploader is still one line', () => {
    const { container } = render(
      <AttachmentsSection issueId="sk-1" attachments={[att('a'), att('b')]} />,
    );

    expect(container.querySelector('.detail-section--empty')).toBeNull();
    expect(screen.getByTestId('attachment-list')).toBeTruthy();
    expect(screen.queryByTestId('dropzone')).toBeNull();
    expect(screen.getByRole('button', { name: 'Upload file' })).toBeTruthy();
    expect(container.querySelector('.detail-section-count')!.textContent).toBe(
      '2',
    );
  });

  test('an unanswered list is not "none": the section stays open and mounts the list', () => {
    // `undefined` is the attachments query in flight — or failed. The
    // list is the only thing that renders "loading…" and "could not
    // load", so collapsing here would make a 500 read as an empty
    // section, permanently and silently.
    const { container } = render(
      <AttachmentsSection issueId="sk-1" attachments={undefined} />,
    );

    expect(container.querySelector('.detail-section--empty')).toBeNull();
    expect(screen.getByTestId('attachment-list')).toBeTruthy();
    // No count chip either — we do not know the number.
    expect(container.querySelector('.detail-section-count')).toBeNull();
  });
});

/**
 * sk-414.3 — the section is what carries an upload from the zone that
 * runs it to the list that draws it.
 *
 * The API never returns a file that is still going up (`status='ready'`
 * rows only; the epic's decision 1 keeps the backend out of this
 * entirely), so the pending row exists ONLY as a piece of local state
 * travelling up out of the dropzone and back down into the list. This
 * section is the junction, and these are its two obligations: hand the
 * name across, and keep the list mounted while it matters.
 */
describe('AttachmentsSection — the pending row travels through here', () => {
  test('an upload keeps the section open and mounts the list to hold its row', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <AttachmentsSection issueId="sk-1" attachments={[]} />,
    );
    // Nothing in flight, nothing on the issue: one collapsed row, and
    // deliberately NO list.
    expect(container.querySelector('.detail-section--empty')).not.toBeNull();
    expect(screen.queryByTestId('attachment-list')).toBeNull();

    // The only way an upload can start is through the zone, so the zone
    // has to be on screen first — this is the real sequence.
    await user.click(screen.getByRole('button', { name: 'Upload file' }));
    act(() => {
      // The zone reporting that it has begun — the only event that can
      // say so, since the API will not list the file until it lands.
      report.fn?.('worker-3.log');
    });

    // The section may not collapse: a collapsed section drops its
    // children from the tree, and the row announcing the upload would
    // go with them while the upload is still running.
    expect(container.querySelector('.detail-section--empty')).toBeNull();
    expect(screen.getByTestId('attachment-list')).toBeTruthy();
    expect(listProps.at(-1)?.pendingName).toBe('worker-3.log');
  });

  test('a card-level drag reaches BOTH children, not just the target', () => {
    render(<AttachmentsSection issueId="sk-1" attachments={[att('a')]} dragActive />);

    // The zone arms before the pointer reaches it…
    expect(dropzoneProps.at(-1)?.armed).toBe(true);
    // …and the list steps back, so the target is the only live-looking
    // thing on screen. Half of this pair is worse than neither: an
    // undimmed list beside an armed target reads as two drop zones.
    expect(listProps.at(-1)?.dimmed).toBe(true);
  });

  test('switching issues drops the pending row with the upload it described', async () => {
    const user = userEvent.setup();
    const { container, rerender } = render(
      <AttachmentsSection issueId="sk-1" attachments={[]} />,
    );
    await user.click(screen.getByRole('button', { name: 'Upload file' }));
    act(() => report.fn?.('worker-3.log'));
    expect(screen.getByTestId('attachment-list')).toBeTruthy();

    // The zone unmounts with the switch and its cleanup aborts the
    // request, so a surviving pending name would advertise an upload
    // that is no longer running — on someone else's issue.
    rerender(<AttachmentsSection issueId="sk-2" attachments={[]} />);
    expect(container.querySelector('.detail-section--empty')).not.toBeNull();
    expect(screen.queryByTestId('attachment-list')).toBeNull();
  });
});

/**
 * sk-414.8 — three gaps the mutation run found in this file.
 *
 * The section measured 92.54, and the survivors were not exotic: the
 * two words the collapsed row is made of, and the one term of the
 * `empty` condition that no test had ever been the deciding one for.
 *
 * The copy first. Every existing test reaches the affordance by its
 * ACCESSIBLE name, which comes from `aria-label` — so the visible
 * label beside the plus, and the section's own heading, could both be
 * blanked without a single assertion noticing. The heading is not
 * decoration either: `Section`'s docblock says in as many words that
 * an empty section keeps its heading precisely so a reader keeps
 * learning the field exists.
 *
 * Then the condition. `empty` is four terms ANDed together, and a test
 * only kills the term that decides ITS case; `pendingName === null`
 * was never the decider, because every existing upload test has the
 * drop target open at the same time and `!showDropzone` settles it
 * first. The state where the term matters on its own is reachable and
 * is exactly the accident the latch exists to prevent — see the test.
 */
describe('sk-414.8 — the words, and the term nothing decided', () => {
  test('the collapsed row shows a word, not only an accessible name', async () => {
    // Two different strings on one control: `aria-label` is the whole
    // phrase («Upload file»), the visible label is the one word beside
    // `ti-plus`. Querying by role reads the first and never the second.
    render(<AttachmentsSection issueId="sk-1" attachments={[]} />);

    const add = screen.getByRole('button', { name: en.details.addAttachment });
    expect(add.textContent?.trim()).toBe(en.details.emptyAdd.upload);
    // …and the two really are different strings, so the assertion above
    // is not quietly re-reading the accessible name.
    expect(en.details.emptyAdd.upload).not.toBe(en.details.addAttachment);
  });

  test('the section is headed with the field’s name', () => {
    // A blank title leaves a block on the card with a count and no
    // subject. `Section` renders the heading whether the section is
    // empty or filled, so this is asserted on the empty one — the state
    // whose entire purpose is to keep advertising the field.
    render(<AttachmentsSection issueId="sk-1" attachments={[]} />);

    expect(
      screen.getByRole('heading', { name: en.details.sectionsMore.attachments }),
    ).toBeTruthy();
  });

  test('an upload outlives a later drag that changed its mind', () => {
    // The sequence, and every step of it is one the card really does:
    //
    //   1. a file is dropped → the zone starts uploading and LATCHES
    //      open, so `showDropzone` is true and the pending row shows;
    //   2. a SECOND drag wanders over the card and leaves without
    //      dropping → the latch releases and the zone folds away;
    //   3. the first upload is still running.
    //
    // At step 3 `pendingName` is the only term left saying the section
    // is not empty. Drop it and the section collapses, taking the list
    // — and with it the row announcing an upload that is still in
    // flight — out of the tree.
    const { container, rerender } = render(
      <AttachmentsSection issueId="sk-1" attachments={[]} dragActive dropCount={0} />,
    );
    // 1 — the drop lands: dragActive clears in the same flush that
    // counts it, and the latch keeps the zone mounted.
    rerender(
      <AttachmentsSection issueId="sk-1" attachments={[]} dragActive={false} dropCount={1} />,
    );
    act(() => report.fn?.('worker-3.log'));
    expect(screen.getByTestId('dropzone')).toBeTruthy();
    expect(listProps.at(-1)?.pendingName).toBe('worker-3.log');

    // 2 — a second gesture, and this one leaves empty-handed.
    rerender(
      <AttachmentsSection issueId="sk-1" attachments={[]} dragActive dropCount={1} />,
    );
    rerender(
      <AttachmentsSection issueId="sk-1" attachments={[]} dragActive={false} dropCount={1} />,
    );

    // 3 — the target is gone, and the upload is not.
    expect(screen.queryByTestId('dropzone')).toBeNull();
    expect(container.querySelector('.detail-section--empty')).toBeNull();
    expect(screen.getByTestId('attachment-list')).toBeTruthy();
    expect(listProps.at(-1)?.pendingName).toBe('worker-3.log');
  });
});
