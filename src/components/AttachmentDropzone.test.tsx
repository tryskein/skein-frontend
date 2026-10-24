import { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the upload helper before importing the component under test.
// The mock captures the AbortSignal so tests can assert on abortion.
vi.mock('../api/attachments', async (importActual) => {
  const actual = await importActual<typeof import('../api/attachments')>();
  return {
    ...actual,
    uploadAttachment: vi.fn(),
  };
});

import { BusinessError } from '../api/client';
import { uploadAttachment } from '../api/attachments';
import { AttachmentDropzone } from './AttachmentDropzone';

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return (
    <MantineProvider forceColorScheme="dark">
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </MantineProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('AttachmentDropzone — unmount cancels in-flight upload', () => {
  test('unmounting while upload is pending fires abort on the AbortSignal', async () => {
    // Build a pending promise that resolves only when we say so. The
    // mock captures the signal so the test can observe abortion.
    let capturedSignal: AbortSignal | undefined;
    let resolveUpload: ((v: unknown) => void) | undefined;
    let rejectUpload: ((reason: unknown) => void) | undefined;

    vi.mocked(uploadAttachment).mockImplementation(
      (_issueId, _file, _onProgress, signal) => {
        capturedSignal = signal;
        return new Promise((res, rej) => {
          resolveUpload = res as (v: unknown) => void;
          rejectUpload = rej;
          // Surface abortion as a rejection (matches the real helper's
          // behaviour: the XHR onabort path rejects with a DOMException).
          signal?.addEventListener('abort', () => {
            rej(new DOMException('aborted', 'AbortError'));
          });
        }) as Promise<never>;
      },
    );

    const { unmount } = render(
      <Wrapper>
        <AttachmentDropzone issueId="demo-1" />
      </Wrapper>,
    );

    // Trigger an upload by simulating a file selection on the hidden
    // input. fireEvent + Object.defineProperty is the canonical way to
    // attach a FileList — userEvent.upload doesn't interact with
    // visually-hidden inputs reliably.
    const input = screen.getByTestId('attachment-file-input') as HTMLInputElement;
    const file = new File(['hello world'], 'hello.txt', { type: 'text/plain' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => {
      fireEvent.change(input);
      // Let the kicked-off async work yield once so the helper is called.
      await Promise.resolve();
    });

    // Sanity: helper was called and we captured the signal.
    expect(uploadAttachment).toHaveBeenCalledTimes(1);
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(false);

    // Now unmount the component while the upload is still pending.
    unmount();

    // The cleanup effect must have called controller.abort() — which
    // in turn flips the captured signal's aborted flag.
    expect(capturedSignal!.aborted).toBe(true);

    // Drain the rejection so vitest doesn't flag an unhandled promise.
    rejectUpload?.(new DOMException('aborted', 'AbortError'));
    // Avoid the unused-variable lint: make sure resolveUpload is referenced.
    void resolveUpload;
  });

  test('upload helper receives a non-aborted signal at the start', async () => {
    let capturedSignal: AbortSignal | undefined;
    vi.mocked(uploadAttachment).mockImplementation(
      (_issueId, _file, _onProgress, signal) => {
        capturedSignal = signal;
        // Return a promise that never resolves — the upload "is in flight".
        return new Promise(() => {}) as Promise<never>;
      },
    );

    const { unmount } = render(
      <Wrapper>
        <AttachmentDropzone issueId="demo-1" />
      </Wrapper>,
    );

    const input = screen.getByTestId('attachment-file-input') as HTMLInputElement;
    const file = new File(['x'], 'x.txt', { type: 'text/plain' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => {
      fireEvent.change(input);
      await Promise.resolve();
    });

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(false);

    unmount();
  });
});

/**
 * sk-285.6.9 — the zone is folded away at rest, so it is normally
 * mounted BY a press on an "Upload file" button that unmounts itself
 * in the same flush. `autoOpen` is what keeps that press worth one
 * press: the picker opens, and the focus the vanished button gave up
 * lands here instead of on <body>.
 */
describe('AttachmentDropzone — autoOpen carries the press that revealed it', () => {
  test('opens the file picker and takes focus on mount', async () => {
    render(
      <Wrapper>
        <AttachmentDropzone issueId="demo-1" autoOpen />
      </Wrapper>,
    );

    const input = screen.getByTestId('attachment-file-input') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click');
    const trigger = screen.getByRole('button', { name: /attach/i });

    // The work is deferred to the frame after React commits the mount —
    // a .focus() on a node React has not attached yet is a silent no-op.
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
  });

  test('without autoOpen nothing is opened and nothing is stolen', async () => {
    render(
      <Wrapper>
        <AttachmentDropzone issueId="demo-1" />
      </Wrapper>,
    );

    const input = screen.getByTestId('attachment-file-input') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click');

    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });

    // A zone unfolded by an incoming DRAG mounts exactly like this: the
    // user is already holding the file, and an OS dialog on top of a
    // drag — or a focus jump mid-gesture — is the worst answer there is.
    expect(clickSpy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
  });
});

/**
 * sk-414.3 — the four faces of the uploader (artboard 4b).
 *
 * Every one of them is a state the API cannot describe: the backend
 * lists `status='ready'` rows and nothing else, so the invitation, the
 * armed target, the bytes going up and the three typed failures exist
 * only here. If they are not pinned here they are not pinned anywhere.
 */
describe('AttachmentDropzone — the states of the zone itself', () => {
  test('at rest it invites, and states the limit before a file is chosen', () => {
    render(
      <Wrapper>
        <AttachmentDropzone issueId="demo-1" />
      </Wrapper>,
    );

    const trigger = screen.getByRole('button', { name: /attach/i });
    expect(trigger.getAttribute('data-state')).toBe('idle');
    expect(trigger.textContent).toContain('click to choose a file, or drop one here');
    // The aside is the half a reader needs BEFORE the upload, not in
    // the error afterwards — and it is one element, so it can be
    // painted a step quieter than the sentence it trails.
    const hint = trigger.querySelector('.detail-dropzone-hint');
    expect(hint?.textContent).toBe('up to 500.0 MB, one file');
    expect(trigger.querySelector('svg')?.getAttribute('class')).toContain(
      'tabler-icon-upload',
    );
  });

  test('a file over the CARD arms the target and names what it will land on', () => {
    render(
      <Wrapper>
        <AttachmentDropzone issueId="demo-1" armed />
      </Wrapper>,
    );

    const trigger = screen.getByRole('button', { name: /attach/i });
    // Armed by the CARD's drag, not by the pointer reaching this
    // element: a target that only lights up under the cursor is one the
    // user has to find before they can aim at it.
    expect(trigger.getAttribute('data-state')).toBe('dragover');
    // The id, because a card sits beside a list of other cards and
    // "release to attach" without one is an invitation to guess.
    expect(trigger.textContent).toContain('Release to attach to demo-1');
    expect(trigger.querySelector('svg')?.getAttribute('class')).toContain(
      'tabler-icon-file-plus',
    );
  });

  test('a file over the limit is refused before a byte is sent, in the reader\'s language', async () => {
    render(
      <Wrapper>
        <AttachmentDropzone issueId="demo-1" />
      </Wrapper>,
    );

    const input = screen.getByTestId('attachment-file-input') as HTMLInputElement;
    const huge = new File(['x'], 'bank-export-full.zip', { type: 'application/zip' });
    // 640 MB against the 500 MiB cap — the artboard's own example.
    Object.defineProperty(huge, 'size', { value: 640 * 1024 * 1024 });
    Object.defineProperty(input, 'files', { value: [huge], configurable: true });
    await act(async () => {
      fireEvent.change(input);
      await Promise.resolve();
    });

    // Nothing left this browser: the guard is what saves a multi-minute
    // upload on a hopeless file.
    expect(uploadAttachment).not.toHaveBeenCalled();

    const alert = screen.getByRole('alert');
    expect(alert.className).toContain('detail-alert');
    expect(alert.textContent).toContain('File is too large.');
    // The detail names the file AND both numbers — «too large» without
    // them tells the reader nothing they can act on.
    expect(alert.textContent).toContain('bank-export-full.zip');
    expect(alert.textContent).toContain('640.0 MB');
    expect(alert.textContent).toContain('500.0 MB');

    // The zone is still there, and it now asks for a different file
    // rather than repeating the invitation that just failed.
    const trigger = screen.getByRole('button', { name: /attach/i });
    expect(trigger.textContent).toContain('Choose another file or drop one here');

    // …and the plaque can be dismissed without touching the zone.
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: /attach/i })).toBeTruthy();
  });

  test('a typed server failure is named, not echoed', async () => {
    vi.mocked(uploadAttachment).mockRejectedValue(
      new BusinessError(422, 'mime blocked', 'mime_blocked'),
    );

    render(
      <Wrapper>
        <AttachmentDropzone issueId="demo-1" />
      </Wrapper>,
    );

    const input = screen.getByTestId('attachment-file-input') as HTMLInputElement;
    const file = new File(['x'], 'setup.exe', { type: 'application/octet-stream' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => {
      fireEvent.change(input);
      await Promise.resolve();
    });

    const alert = await screen.findByRole('alert');
    // Until sk-414.2 laid these keys down the sentence was an English
    // literal in the component, shown untranslated to every reader.
    expect(alert.textContent).toContain('File type is not allowed.');
    expect(alert.textContent).toContain('setup.exe');
    // The wire message is not what a person is told.
    expect(alert.textContent).not.toContain('mime blocked');
  });

  test('bytes in flight: the counter, the stripe, Cancel — and the focus', async () => {
    let capturedProgress: ((loaded: number, total: number) => void) | undefined;
    vi.mocked(uploadAttachment).mockImplementation(
      (_issueId, _file, onProgress) => {
        capturedProgress = onProgress;
        return new Promise(() => {}) as Promise<never>;
      },
    );

    const { container } = render(
      <Wrapper>
        <AttachmentDropzone issueId="demo-1" />
      </Wrapper>,
    );

    const trigger = screen.getByRole('button', { name: /attach/i });
    // The keyboard user is standing on the trigger — this is where the
    // OS picker returns focus after a file is chosen.
    trigger.focus();

    const input = screen.getByTestId('attachment-file-input') as HTMLInputElement;
    const file = new File(['x'], 'bank-export-2026-08-full.zip', { type: 'application/zip' });
    Object.defineProperty(file, 'size', { value: 12 * 1024 * 1024 });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => {
      fireEvent.change(input);
      await Promise.resolve();
    });
    await act(async () => {
      capturedProgress?.(2.4 * 1024 * 1024, 12 * 1024 * 1024);
    });

    const card = container.querySelector('.detail-upload');
    expect(card).not.toBeNull();
    // Bytes AND percent: "20%" alone does not say how long is left, and
    // "2.4 MB" alone does not say how far along that is.
    expect(card!.textContent).toContain('2.4 MB of 12.0 MB · 20%');
    expect(card!.textContent).toContain('bank-export-2026-08-full.zip');
    const fill = card!.querySelector('.detail-upload-bar-fill') as HTMLElement;
    expect(fill.style.width).toBe('20%');

    // The zone has given its place to the card…
    expect(screen.queryByRole('button', { name: /attach/i })).toBeNull();
    // …and the focus it was holding went with it, to the control that
    // replaced it. Without the hand-off the reader is dropped onto
    // <body> and tabs the whole card again (WCAG 2.4.3) — the same
    // defect `autoOpen` exists to prevent one step earlier.
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    expect(document.activeElement).toBe(cancel);
  });

  test('the pending row is reported up, and taken back', async () => {
    let resolveUpload: ((v: unknown) => void) | undefined;
    vi.mocked(uploadAttachment).mockImplementation(
      () =>
        new Promise((res) => {
          resolveUpload = res as (v: unknown) => void;
        }) as Promise<never>,
    );
    const reports: (string | null)[] = [];

    render(
      <Wrapper>
        <AttachmentDropzone issueId="demo-1" onUploadingChange={(n) => reports.push(n)} />
      </Wrapper>,
    );

    const input = screen.getByTestId('attachment-file-input') as HTMLInputElement;
    const file = new File(['x'], 'worker-3.log', { type: 'text/plain' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => {
      fireEvent.change(input);
      await Promise.resolve();
    });

    // This is the ONLY channel by which the sibling list can learn that
    // a file is on its way up — the API will not show it until it is
    // confirmed (epic decision 1).
    expect(reports.at(-1)).toBe('worker-3.log');

    await act(async () => {
      resolveUpload?.(undefined);
      await Promise.resolve();
    });

    // And it is taken back on success, or the list would keep a pending
    // row beside the real one the refetch just brought in.
    expect(reports.at(-1)).toBeNull();
  });
});

/**
 * sk-416 (review finding 1) — a cancelled upload whose bytes beat the
 * abort must not land on the NEXT one.
 *
 * `onCancel` calls `controller.abort()` and clears the local state
 * synchronously, but abort is a request, not a rollback: an XHR that
 * already reached `load` resolves anyway, and its continuation runs
 * later — by then the user may have started a second file. The success
 * branch used to clear `uploading` / `filename` / `abortRef` and the
 * input unconditionally, so upload B lost its progress card, its name
 * and its Cancel while its bytes were still going up. The error branch
 * was already guarded (`ctrl.signal.aborted`); this is the same guard
 * on the other side, written as «is this controller still the current
 * one».
 */
describe('AttachmentDropzone — a late completion may not touch the next upload', () => {
  test('cancelled-but-delivered upload A leaves upload B alone', async () => {
    const resolvers: Array<(v: unknown) => void> = [];
    vi.mocked(uploadAttachment).mockImplementation(
      () =>
        new Promise((res) => {
          resolvers.push(res as (v: unknown) => void);
        }) as Promise<never>,
    );
    const reports: (string | null)[] = [];

    const { container } = render(
      <Wrapper>
        <AttachmentDropzone issueId="demo-1" onUploadingChange={(n) => reports.push(n)} />
      </Wrapper>,
    );

    const input = screen.getByTestId('attachment-file-input') as HTMLInputElement;
    const pick = async (name: string) => {
      const file = new File(['x'], name, { type: 'text/plain' });
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      await act(async () => {
        fireEvent.change(input);
        await Promise.resolve();
      });
    };

    await pick('first.log');
    expect(reports.at(-1)).toBe('first.log');

    // The user changes their mind. The zone comes back; the XHR,
    // meanwhile, is already on the wire.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(reports.at(-1)).toBeNull();

    await pick('second.log');
    expect(reports.at(-1)).toBe('second.log');
    expect(uploadAttachment).toHaveBeenCalledTimes(2);

    // …and NOW the first upload reports success, out of turn.
    await act(async () => {
      resolvers[0]?.(undefined);
      await Promise.resolve();
    });

    // Everything on screen still belongs to the second upload.
    const card = container.querySelector('.detail-upload');
    expect(card, 'the progress card of the live upload was torn down').not.toBeNull();
    expect(card!.textContent).toContain('second.log');
    // Cancel is the only way out of an upload — losing it strands the
    // user with bytes they cannot stop.
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    // The zone must NOT be back: it is drawn only when nothing is going up.
    expect(screen.queryByRole('button', { name: /attach/i })).toBeNull();
    // The pending row in the sibling list is fed from here, so a stale
    // report puts it out too.
    expect(reports.at(-1)).toBe('second.log');
  });

  test('cancelled-but-delivered upload still refreshes the list — the file IS on the server', async () => {
    const resolvers: Array<(v: unknown) => void> = [];
    vi.mocked(uploadAttachment).mockImplementation(
      () =>
        new Promise((res) => {
          resolvers.push(res as (v: unknown) => void);
        }) as Promise<never>,
    );

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries');

    render(
      <MantineProvider forceColorScheme="dark">
        <QueryClientProvider client={qc}>
          <AttachmentDropzone issueId="demo-1" />
        </QueryClientProvider>
      </MantineProvider>,
    );

    const input = screen.getByTestId('attachment-file-input') as HTMLInputElement;
    const file = new File(['x'], 'first.log', { type: 'text/plain' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => {
      fireEvent.change(input);
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await act(async () => {
      resolvers[0]?.(undefined);
      await Promise.resolve();
    });

    // Cancelling is not undoing: the row exists server-side, so the
    // list has to be told even though this component's own state was
    // handed to somebody else.
    expect(
      invalidate.mock.calls.some(
        ([arg]) =>
          JSON.stringify((arg as { queryKey?: unknown })?.queryKey) ===
          JSON.stringify(['issues', 'demo-1', 'attachments']),
      ),
      'the attachment list was never invalidated for a file that did land',
    ).toBe(true);
  });
});
