import { useRef, useState, type DragEvent } from 'react';

/**
 * sk-285.6.9 — "is a FILE being dragged over this element right now?"
 *
 * The issue card folds its upload zone to a single line at rest, so a
 * file dragged anywhere over the card has to unfold it: you cannot aim
 * a file at a one-line button. This hook is the observer that decides
 * when to unfold.
 *
 * It only OBSERVES. No `preventDefault`, no drop handling, no upload —
 * the real drop target is the dropzone that unfolding reveals, and the
 * upload pipeline is untouched by this change. A drop that lands
 * anywhere else keeps whatever the browser did with it before.
 *
 * Two details that are easy to get wrong and are the reason this is a
 * hook with tests rather than four inline handlers:
 *
 *   1. `dragenter` / `dragleave` fire in PAIRS as the pointer crosses
 *      into and out of descendants, so a naive "enter → true, leave →
 *      false" flickers off the moment the cursor reaches any child.
 *      They are counted instead — the same depth counter
 *      AttachmentDropzone uses for its own border state.
 *   2. Only drags CARRYING FILES count. Without the `types` check a
 *      dragged text selection, a link, or a reordered row would open
 *      the uploader.
 */
export interface FileDragWatch {
  /** True while a file-carrying drag is over the watched element. */
  active: boolean;
  /**
   * How many drops have landed on the watched element so far.
   *
   * `active` goes false for two very different endings — the file was
   * dropped, or the drag wandered back out — and a consumer that
   * UNFOLDS on the drag has to tell them apart. A revealed drop target
   * must survive its own drop: the drop handler starts an upload, and
   * unmounting the target in the same React flush aborts it silently
   * (that is exactly what this counter was added to stop). A drag that
   * never landed should fold the target back away.
   *
   * Monotonic and never reset — compare it against the value you last
   * saw, don't test it for truthiness.
   */
  dropCount: number;
  /** Spread onto the element that should notice the drag. */
  handlers: {
    onDragEnter: (e: DragEvent<HTMLElement>) => void;
    onDragLeave: () => void;
    onDrop: () => void;
    onDragEnd: () => void;
  };
}

export function useFileDragWatch(): FileDragWatch {
  const [active, setActive] = useState(false);
  const [dropCount, setDropCount] = useState(0);
  const depth = useRef(0);

  return {
    active,
    dropCount,
    handlers: {
      onDragEnter: (e) => {
        // `types` is the only thing readable about a drag's payload
        // before the drop — the files themselves are withheld until
        // then, by design.
        if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return;
        depth.current += 1;
        setActive(true);
      },
      onDragLeave: () => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setActive(false);
      },
      // A completed drop and an aborted drag both end the gesture, so
      // the counter is reset outright rather than decremented: there is
      // no further `dragleave` coming to balance it.
      onDrop: () => {
        depth.current = 0;
        setActive(false);
        // Both updates land in the SAME React flush as the drop, so a
        // consumer reading the pair never sees "no longer dragging"
        // without also seeing "…because it landed".
        setDropCount((n) => n + 1);
      },
      onDragEnd: () => {
        depth.current = 0;
        setActive(false);
      },
    },
  };
}
