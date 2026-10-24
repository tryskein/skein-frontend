/**
 * sk-285.7 T035 — the width the jsdom environment reports, and a
 * `matchMedia` that answers consistently with it.
 *
 * ## Why this module exists
 *
 * jsdom does not implement `matchMedia` AT ALL. Verified against the
 * version this repo pins rather than remembered: `jsdom@25.0.1` is the
 * only copy under `node_modules`, nothing beneath `jsdom/lib/` so much
 * as names `matchMedia` or `MediaQueryList`, and a `JSDOM` window built
 * with the options vitest passes (`pretendToBeVisual`,
 * `runScripts: 'dangerously'`) reports `typeof matchMedia ===
 * 'undefined'`. `window.innerWidth` is different: it IS real there, and
 * reports 1024.
 *
 * So a width question has always been answered by a stub of ours, never
 * by the environment — and the stub that stood here before this module
 * answered `matches: false` to every query at every width. That is
 * invisible while nothing reads a width query, and it stops being
 * invisible the moment the width mode (T016, decision R7) starts asking
 * `matchMedia` which of the three ranges the window is in: both of its
 * subscriptions would answer `false`, every test in the suite would
 * silently render the MOBILE layout, and the files that pin the desktop
 * zone structure would fail for a reason that has nothing to do with
 * what they test.
 *
 * So the environment gets one number — the viewport width — and both
 * surfaces are derived from it. `window.innerWidth` is an accessor over
 * that number and `matchMedia` evaluates `min-width` / `max-width`
 * against the same number, which makes THOSE TWO impossible to disagree
 * rather than merely unlikely to.
 *
 * ## The one width this module does NOT own
 *
 * `document.documentElement.clientWidth` is a third width the
 * environment reports, and jsdom answers 0 for it because it has no
 * layout engine. This module leaves it alone on purpose. It is a
 * LAYOUT measurement, not a media-query one: Floating UI reads it to
 * decide whether an anchor is clipped, and handing it a viewport would
 * change how every popup test resolves — for a number this module has
 * no honest value for anyway (there is no height here, and half a
 * viewport is worse than none). A test that needs a laid-out viewport
 * declares it itself; `pages/shell/__tests__/ProjectHoverPopup.test.tsx`
 * is the one that does, and it takes it back down in `afterEach`.
 *
 * ## The default is desktop, deliberately
 *
 * `DEFAULT_TEST_VIEWPORT_WIDTH` is above the app's floor
 * (`--app-min-width` in `src/index.css`), so a test that says nothing
 * about width gets the desktop layout — which is the layout the existing
 * suite was written against, and the only default under which "I did not
 * mention width" keeps meaning "this test is not about width". Note that
 * this is NOT what jsdom would give us by accident: jsdom's own 1024 is
 * BELOW the floor, so inheriting it would put the whole suite in the
 * tablet range. The default is a decision: bump the floor past this number and
 * update it here in the same change.
 *
 * ## What a test gets to say
 *
 * `setViewportWidth(px)` — nothing else. There is no `setMobile()` /
 * `setTablet()` pair on purpose: naming the modes here would mean
 * spelling their thresholds here, and the plan is explicit that the
 * tablet/desktop threshold IS the floor and gets no second token (R7).
 * A test that wants mobile passes a mobile width, which is exactly how
 * the product decides, and the boundary cases are the boundary widths.
 *
 * Width changes propagate the way a browser propagates them: every live
 * `MediaQueryList` whose answer changed fires `change` at its
 * subscribers IN REGISTRATION ORDER — `onchange` is a subscriber like
 * any other and fires where it was assigned, not first — across all
 * three shapes (`addEventListener`, the legacy `addListener`, and
 * `onchange`); then `window` gets a `resize` event. A subscriber written
 * against the real DOM therefore needs no test-only branch.
 *
 * Isolation is the setup file's job (`setup.ts` resets after every test),
 * so a width one test declares can never leak into the next one.
 */

/**
 * The width every test starts at: a common laptop width, comfortably
 * above the 1284px floor. See the docblock for why "above the floor"
 * is the requirement and 1024 (jsdom's own) is not acceptable.
 */
export const DEFAULT_TEST_VIEWPORT_WIDTH = 1440;

let currentWidth = DEFAULT_TEST_VIEWPORT_WIDTH;

/** The current viewport width — the single number both surfaces read. */
export function getViewportWidth(): number {
  return currentWidth;
}

/** One `(min-width: Npx)` / `(max-width: Npx)` term, whole. */
const WIDTH_CLAUSE = /^\(\s*(min|max)-width\s*:\s*(\d+(?:\.\d+)?)px\s*\)$/;

/**
 * Media types that say nothing about width, so a query naming one is
 * still a query about the window this module measures. Anything else —
 * `print`, `speech`, and the `not` / `only` prefixes that change what
 * the whole query means — is a construct this module does not read.
 */
const TRANSPARENT_MEDIA_TYPES: ReadonlySet<string> = new Set(['screen', 'all']);

/**
 * Evaluate a width query against `width`.
 *
 * ## What is read
 *
 * A conjunction of `(min-width: Npx)` / `(max-width: Npx)` terms,
 * optionally led by the media type `screen` or `all`. EVERY term is
 * read: `(min-width: 640px) and (max-width: 1023px)` is the range it
 * says it is, in either clause order. `min-width` is inclusive (`>=`)
 * and `max-width` is inclusive (`<=`), as CSS defines them — which is
 * also what makes a threshold belong to the upper range, the property
 * the width mode leans on to be unambiguous exactly ON a boundary.
 *
 * ## What is refused, and why refusal is the answer
 *
 * Everything else answers `false`, at every width, INCLUDING a query
 * that contains a width term this module could have read on its own:
 * a `not` / `only` prefix, a media type other than the two above, a
 * feature that is not a width (`(orientation: landscape)`,
 * `(pointer: coarse)`, `(prefers-color-scheme: dark)`), the range
 * syntax (`(width >= 640px)`), and a media-query LIST (`a, b` — a
 * disjunction). A query naming no width term at all — a bare `screen` —
 * is refused too: it is not a question about this module's number.
 *
 * All of those refusals come from ONE rule rather than from a list of
 * special cases: a term that is neither a whole width clause nor a
 * transparent media type refuses the entire query. The list and the
 * range have no case of their own because they cannot survive it — a
 * comma or a `>=` lands inside some term, and the term match is
 * anchored.
 *
 * The alternative — picking the width term out of a query whose other
 * half was not understood — is worse than useless: it answers a question
 * nobody asked, with confidence. `print and (min-width: 100px)` would
 * come back `true` on a screen; `not all and (min-width: 100px)` would
 * come back `true` when it means the exact opposite; and one range
 * written in two clause orders would get two different answers. That is
 * a test environment quietly lying, which is the whole failure mode
 * T035 exists to remove.
 *
 * `false` — rather than a throw — is the refusal because it is where
 * every non-width query already sat before this module existed: those
 * callers (`(prefers-color-scheme: dark)` in `useTheme`, and the
 * `(pointer: coarse)` probes) are pinned on `false`, and a throw would
 * turn their tests red for asking a question they are entitled to ask.
 */
export function evaluateMediaQuery(query: string, width: number): boolean {
  let widthTerms = 0;
  let matches = true;
  for (const term of query.trim().toLowerCase().split(/\s+and\s+/)) {
    const clause = WIDTH_CLAUSE.exec(term);
    if (clause !== null) {
      widthTerms += 1;
      const px = Number(clause[2]);
      if (!(clause[1] === 'min' ? width >= px : width <= px)) matches = false;
      continue;
    }
    if (TRANSPARENT_MEDIA_TYPES.has(term)) continue;
    return false;
  }
  // No width term: not a question about this module's number.
  return widthTerms > 0 && matches;
}

type ChangeHandler =
  | ((event: MediaQueryListEvent) => void)
  | { handleEvent(event: MediaQueryListEvent): void };

/**
 * One subscriber, in registration order.
 *
 * `onchange` occupies a slot rather than a fixed position because in a
 * browser it IS an ordinary listener: it is registered once, at the
 * first non-null assignment, and fires in that place among the
 * `addEventListener` handlers. Assigning it a second time replaces the
 * function without moving the slot; assigning `null` removes it.
 */
type Slot = { kind: 'listener'; handler: ChangeHandler } | { kind: 'onchange' };

interface LiveQuery {
  media: string;
  /** The answer the subscribers were last told about. */
  notified: boolean;
  slots: Slot[];
  onchange: ((event: MediaQueryListEvent) => void) | null;
  list: MediaQueryList;
}

/**
 * Every `MediaQueryList` that currently has at least one subscriber.
 *
 * A list JOINS when it gets its first subscriber and LEAVES when the
 * last one goes — which is exactly what an unmounted component's effect
 * cleanup does. So the registry does not grow for the lifetime of a test
 * file, and a list nothing listens to is not re-evaluated on every width
 * change.
 *
 * Membership decides only who to NOTIFY. `matches` is computed on read
 * from the current width, so a list that is in nobody's hands — or that
 * sat unsubscribed across a width change — still answers correctly.
 */
const live = new Set<LiveQuery>();

/**
 * How many `MediaQueryList`s are currently in the notify registry.
 *
 * Introspection for tests of subscriber cleanup. The
 * promise that the registry SHRINKS when the last subscriber goes has
 * no other observable consequence — a list nobody listens to notifies
 * nobody whether it is still in the set or not — so without this it
 * would be a claim the guard could not lose, which is the same as no
 * claim at all.
 */
export function liveQueryCount(): number {
  return live.size;
}

/**
 * Add or drop `record` from {@link live} to match its subscriber count.
 *
 * Re-anchors `notified` on the way IN: a list that was unsubscribed
 * across a width change must not fire `change` for a transition nobody
 * was listening to.
 */
function syncSubscription(record: LiveQuery): void {
  if (record.slots.length === 0) {
    live.delete(record);
    return;
  }
  if (!live.has(record)) {
    record.notified = evaluateMediaQuery(record.media, currentWidth);
    live.add(record);
  }
}

function createMediaQueryList(query: string): MediaQueryList {
  const record: LiveQuery = {
    media: query,
    notified: evaluateMediaQuery(query, currentWidth),
    slots: [],
    onchange: null,
    list: null as unknown as MediaQueryList,
  };

  const subscribe = (handler: ChangeHandler | null | undefined): void => {
    if (!handler) return;
    // The DOM ignores a second identical listener on the same type;
    // `addListener` is defined as an alias of `addEventListener('change')`,
    // so the two share one pool.
    if (record.slots.some((s) => s.kind === 'listener' && s.handler === handler)) return;
    record.slots.push({ kind: 'listener', handler });
    syncSubscription(record);
  };

  const unsubscribe = (handler: ChangeHandler | null | undefined): void => {
    if (!handler) return;
    const at = record.slots.findIndex((s) => s.kind === 'listener' && s.handler === handler);
    if (at === -1) return;
    record.slots.splice(at, 1);
    syncSubscription(record);
  };

  const list = {
    get media(): string {
      return record.media;
    },
    get matches(): boolean {
      return evaluateMediaQuery(record.media, currentWidth);
    },
    get onchange(): ((event: MediaQueryListEvent) => void) | null {
      return record.onchange;
    },
    set onchange(handler: ((event: MediaQueryListEvent) => void) | null) {
      const had = record.onchange !== null;
      record.onchange = typeof handler === 'function' ? handler : null;
      const has = record.onchange !== null;
      if (has && !had) {
        record.slots.push({ kind: 'onchange' });
      } else if (!has && had) {
        const at = record.slots.findIndex((s) => s.kind === 'onchange');
        if (at !== -1) record.slots.splice(at, 1);
      }
      syncSubscription(record);
    },
    addEventListener(type: string, handler: ChangeHandler | null): void {
      if (type === 'change') subscribe(handler);
    },
    removeEventListener(type: string, handler: ChangeHandler | null): void {
      if (type === 'change') unsubscribe(handler);
    },
    // Legacy Safari shape — Mantine and other libraries still feature-detect it.
    addListener(handler: ChangeHandler | null): void {
      subscribe(handler);
    },
    removeListener(handler: ChangeHandler | null): void {
      unsubscribe(handler);
    },
    dispatchEvent: (): boolean => false,
  } as unknown as MediaQueryList;

  record.list = list;
  return list;
}

function notify(record: LiveQuery, matches: boolean): void {
  const event = { matches, media: record.media, type: 'change' } as MediaQueryListEvent;
  // Copied before iteration: a handler is allowed to unsubscribe itself.
  for (const slot of [...record.slots]) {
    if (slot.kind === 'onchange') {
      record.onchange?.call(record.list, event);
      continue;
    }
    const { handler } = slot;
    if (typeof handler === 'function') handler.call(record.list, event);
    else handler.handleEvent(event);
  }
}

/**
 * Declare the window width for the current test.
 *
 * Updates `window.innerWidth`, re-evaluates every subscribed media query
 * and fires `change` on the ones whose answer moved, then dispatches
 * `resize` on `window` — the same order a browser reports a resize in.
 */
export function setViewportWidth(width: number): void {
  if (!Number.isFinite(width) || width <= 0) {
    throw new Error(`setViewportWidth: ${width} is not a usable viewport width`);
  }
  if (width === currentWidth) return;
  currentWidth = width;

  // Collected first: a handler may subscribe or unsubscribe during
  // dispatch, and `live` must not be mutated mid-iteration.
  const changed: Array<[LiveQuery, boolean]> = [];
  for (const record of live) {
    const matches = evaluateMediaQuery(record.media, currentWidth);
    if (matches !== record.notified) {
      record.notified = matches;
      changed.push([record, matches]);
    }
  }
  for (const [record, matches] of changed) notify(record, matches);

  if (typeof window !== 'undefined') window.dispatchEvent(new Event('resize'));
}

/** Back to the documented desktop default. Called after every test. */
export function resetViewportWidth(): void {
  setViewportWidth(DEFAULT_TEST_VIEWPORT_WIDTH);
}

/**
 * Point `window.matchMedia` and `window.innerWidth` at the width above.
 *
 * Installed UNCONDITIONALLY — and NOT because something is already
 * there: jsdom supplies `innerWidth` but no `matchMedia` at all (see
 * the module docblock). The reason is that a "only if missing" guard
 * would make this environment depend on two things it has no business
 * depending on. On the jsdom VERSION: a release that adds a
 * non-evaluating `matchMedia` would switch the guard off and silently
 * restore the answers-`false`-to-everything behaviour this module
 * exists to remove. And on setup ORDER: any other setup file, or a
 * test's own stub, that got here first would win. Overwriting is the
 * only install that says the same thing in all of those worlds.
 */
export function installTestViewport(): void {
  if (typeof window === 'undefined') return;

  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    get: () => currentWidth,
  });
  Object.defineProperty(window, 'outerWidth', {
    configurable: true,
    get: () => currentWidth,
  });

  window.matchMedia = (query: string): MediaQueryList => createMediaQueryList(query);
}
