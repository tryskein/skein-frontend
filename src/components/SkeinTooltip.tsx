import {
  autoUpdate,
  flip,
  FloatingPortal,
  hide,
  offset,
  shift,
  size,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
} from '@floating-ui/react';
import {
  cloneElement,
  isValidElement,
  useEffect,
  useState,
  type HTMLProps,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';

/**
 * Skein's general-purpose hover tooltip.
 *
 * Direct `@floating-ui/react` primitive (no Mantine HoverCard). Per
 * the project's tooltip rule:
 *
 *   "Tooltips open instantly — 0ms delay.
 *    No delay, timeout, or appearance animations."
 *
 * The hard rule is encoded in the `useHover` config: `delay: { open: 0,
 * close: 0 }, restMs: 0`. Do NOT add per-call-site overrides — the whole
 * point of the wrapper is that no consumer can re-introduce delay or fade.
 *
 * Why bypass Mantine HoverCard:
 *   Mantine wraps Floating UI but doesn't expose
 *   `whileElementsMounted: autoUpdate`. Without that hook, the floating
 *   element is not pinned through scroll/resize/target re-render, and
 *   on aggressively-rerendering trees (Projects column with per-project
 *   background queries, caret toggles, SignalR invalidations) Floating
 *   UI occasionally reads a stale (0,0) target rect for one frame,
 *   producing a visible top-left flicker. `autoUpdate` keeps the
 *   floating element pinned through every observable mutation.
 *
 * Visual styling lives in `index.css` under `.skein-tooltip`.
 *
 * ── sk-285.1.11: where the popup lives, and how it goes away ─────────────
 * Three properties this component owes every call site:
 *
 *   ONE LAYER. Every popup is portalled into `#skein-floating-layer`
 *   (see `ensureFloatingLayer`), a single fixed, `isolation: isolate`
 *   element. Popups stack against each other inside it and the group is
 *   ordered against the app once, by `--z-floating` — no per-component
 *   z-index bidding war.
 *
 *   NEVER A HIT TARGET. The layer and `.skein-tooltip` are
 *   `pointer-events: none`. A hover popup describes what the pointer is
 *   already on; it must not swallow the clicks meant for whatever it
 *   covers (a project row's popup lands squarely on the Tasks column's
 *   view toggle), and it must not be able to steal the hover from its own
 *   anchor and flicker itself open/closed.
 *
 *   IT ALWAYS CLOSES. `mouseleave` and Escape are the primary path; the
 *   effect below covers the cases where neither event is ever dispatched
 *   (anchor scrolled/folded away, pointer out of the window, tab or
 *   window losing focus).
 *
 * ── Cost, measured (sk-194.5.2.8.3) ──────────────────────────────────────
 * jsdom A/B, 800 instances, median of 11 interleaved runs of one parent
 * re-render:
 *
 *   no tooltip wrapper at all           8,2 ms
 *   SkeinTooltip, middleware inline    63,4 ms
 *   SkeinTooltip, middleware hoisted   57,0 ms   ← current
 *
 * So the floating-ui hook stack costs ~0,06 ms per instance per render and
 * dominates the render cost of a tooltip-dense list; hoisting the middleware
 * (below) takes ~11 % off that. The remaining ~49 ms is the hook stack
 * itself, which runs in full even for a tooltip that is closed — and a
 * tooltip is closed essentially always.
 *
 * The obvious next step is to NOT mount the floating-ui hooks until the
 * pointer/focus first reaches the target (the `NONE` line above is the
 * ceiling: ~7× cheaper). It is deliberately NOT done here, because getting
 * it right means reproducing floating-ui's own open predicates in the cold
 * path — `useFocus` opens only when the target matches `:focus-visible` and
 * suppresses itself after `reference-press` / `escape-key` / window blur, so
 * a naive "arm on focus, open immediately" would flash a tooltip on every
 * mouse click of a tooltipped button. There is also a race: if the pointer
 * leaves between the arming event and the commit that attaches floating-ui's
 * native `mouseleave` listener, the tooltip sticks open. Both need a real
 * browser in the loop to verify, which the change that produced these
 * numbers did not have.
 */
export type SkeinTooltipPlacement =
  | 'top'
  | 'top-start'
  | 'top-end'
  | 'right'
  | 'right-start'
  | 'right-end'
  | 'bottom'
  | 'bottom-start'
  | 'bottom-end'
  | 'left'
  | 'left-start'
  | 'left-end';

export interface SkeinTooltipProps {
  /** Tooltip body — any ReactNode. Can be a string for trivial labels. */
  content: ReactNode;
  /** Element the tooltip attaches to. Must be a single React element
   *  whose ref forwards to a DOM node. Native DOM elements (`button`,
   *  `div`, `a`, `span`, …) work out of the box. Custom components must
   *  use `forwardRef`. */
  children: ReactNode;
  /** Position relative to target. Default: 'right'. */
  position?: SkeinTooltipPlacement;
  /** Disable when no useful content is available (e.g. pseudo-rows). */
  disabled?: boolean;
  /** Optional className appended to the dropdown body. */
  className?: string;
  /** Width in px. If omitted, content drives natural width. */
  width?: number;
  /**
   * sk-551.8 (D1) — Escape closes this tooltip and travels on to the
   * page's own Esc handlers instead of stopping at the tooltip. Default
   * `false`: the tooltip consumes the Escape that closes it, so an Esc on
   * a tooltip inside a dialog closes only the tooltip. Turn on only where
   * the tooltip can open in the middle of an Esc meant for something else
   * (see the avatar in `HeaderBar`).
   */
  escapePassesThrough?: boolean;
}

/**
 * Internal: the type cloneElement allows for the `ref` prop on a generic
 * React element. We don't know the underlying DOM node type at the
 * SkeinTooltip layer.
 */
type AnyChildProps = Record<string, unknown> & { ref?: Ref<unknown> };

/**
 * sk-194.5.2.8.3 — hoisted out of the component body.
 *
 * Every SkeinTooltip used the same three middleware with the same options,
 * but the array (and the three middleware objects inside it) was rebuilt on
 * every render. `@floating-ui/react-dom`'s `useFloating` compares the
 * incoming middleware against the previous one on EVERY render (`deepEqual`,
 * which for functions falls back to comparing `fn.toString()` — i.e. it
 * materialises and compares the function source). A module-level constant
 * short-circuits that comparison on identity and drops 4 allocations per
 * tooltip per render.
 *
 * Safe to share: floating-ui middleware are stateless config objects — the
 * per-instance state is passed into `fn(state)` at call time.
 */
const TOOLTIP_MIDDLEWARE = [
  offset(8),
  flip({ padding: 8 }),
  shift({ padding: 8 }),
  // sk-285.1.11 — hand the measured free space to CSS as a custom
  // property instead of a hard `width`. A custom property is invisible to
  // React's style diffing, so writing it imperatively here can never be
  // clobbered by the next render (the documented Floating UI pattern).
  size({
    padding: 8,
    apply({ availableWidth, elements }) {
      // Floor: a popup squeezed below ~180px stops being readable (the
      // `dl` grid collapses to one word per line), so past that point we
      // let it overhang and stay legible rather than shrink to a ribbon.
      elements.floating.style.setProperty(
        '--skein-tooltip-max-w',
        `${Math.max(180, Math.round(availableWidth))}px`,
      );
    },
  }),
  // sk-285.1.11 — flags the ANCHOR as FULLY clipped out of its scroll
  // container (`referenceHidden`; a partly-visible anchor is still a
  // legitimate hover target and does NOT flag). Drives the scroll-away
  // auto-close below. Last in the chain so it measures the final
  // placement, and reads `hide()`'s default `referenceHidden` strategy.
  hide({ padding: 4 }),
];

/**
 * sk-285.1.11 — id of the single DOM element every popup is portalled
 * into. Styled in `index.css` (`#skein-floating-layer`): fixed, full
 * viewport, `isolation: isolate`, `pointer-events: none`, ordered against
 * the app exactly once via `--z-floating`.
 *
 * One shared layer — not one portal per tooltip appended straight to
 * `<body>` — is what turns popup stacking from a per-component z-index
 * race into a single ordered decision: inside an isolated stacking
 * context the popups can only stack against each other.
 */
export const FLOATING_LAYER_ID = 'skein-floating-layer';

/**
 * Create the layer if it isn't there yet, and hand it back. Idempotent:
 * the id lookup is the whole guard, so calling this on every render of an
 * open tooltip costs one `getElementById`.
 *
 * It has to run during RENDER, not in an effect: `<FloatingPortal id>`
 * looks the element up in its own layout effect, and child effects run
 * before the parent's — an effect here would always be too late on the
 * first open, and Floating UI would silently fall back to appending its
 * own (unstyled, duplicated-id) wrapper to `<body>`.
 */
function ensureFloatingLayer(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const existing = document.getElementById(FLOATING_LAYER_ID);
  if (existing) return existing;
  const layer = document.createElement('div');
  layer.id = FLOATING_LAYER_ID;
  layer.className = 'skein-floating-layer';
  document.body.appendChild(layer);
  return layer;
}

export function SkeinTooltip({
  content,
  children,
  position = 'right',
  disabled,
  className,
  width,
  escapePassesThrough = false,
}: SkeinTooltipProps) {
  const [isOpen, setIsOpen] = useState(false);

  const { refs, floatingStyles, context, isPositioned, middlewareData, placement } =
    useFloating({
      open: isOpen,
      onOpenChange: setIsOpen,
      placement: position,
      // `fixed` is viewport-relative; immune to transformed/contain'd
      // ancestors that would break absolute positioning.
      strategy: 'fixed',
      middleware: TOOLTIP_MIDDLEWARE,
      // Keeps the floating element pinned to the target through scroll,
      // resize, target re-render, mutation observer changes, and animation
      // frames. This is the whole reason we bypass Mantine HoverCard.
      whileElementsMounted: autoUpdate,
    });

  const hover = useHover(context, { delay: { open: 0, close: 0 }, restMs: 0 });
  const focus = useFocus(context);
  // By default floating-ui stops the Escape at the document: the key
  // closes the tooltip and nothing else. `escapePassesThrough` lets it
  // bubble on (sk-551.8 D1).
  const dismiss = useDismiss(context, { bubbles: { escapeKey: escapePassesThrough } });
  const role = useRole(context, { role: 'tooltip' });

  const { getReferenceProps, getFloatingProps } = useInteractions([
    hover,
    focus,
    dismiss,
    role,
  ]);

  /**
   * sk-285.1.11 — auto-close safety nets.
   *
   * `useHover` closes on `mouseleave` and `useDismiss` closes on Escape,
   * and both are the primary path. But BOTH depend on an event the
   * pointer has to generate, and there are three ways for the popup to
   * outlive the hover that opened it without any such event ever firing:
   *
   *   • the anchor scrolls out of its column (or its subtree is folded
   *     away) while the pointer sits still — no `mouseleave` is
   *     dispatched, and Floating UI's own scroll-close path only runs
   *     when a `handleClose` handler is configured, which a 0-delay
   *     tooltip has none of. `autoUpdate` then keeps the popup pinned to
   *     an anchor nobody can see;
   *   • the pointer leaves the window entirely (out of the top edge, onto
   *     browser chrome) — the last element under it never gets a leave;
   *   • the window loses focus / the tab is hidden — a focus-opened popup
   *     has no blur to react to when the switch is made with the keyboard.
   *
   * Each of these ends with a popup stuck on screen, which is the
   * user-visible bug this task is about. They are cheap to close for,
   * and every one of them closes into the same `setIsOpen(false)`.
   */
  const referenceHidden = middlewareData.hide?.referenceHidden ?? false;
  useEffect(() => {
    if (!isOpen) return;
    // Anchor clipped away by a scroll container. Guarded on a real,
    // measurable anchor box: in a layout-less environment (jsdom) every
    // rect is 0×0 and `hide()` reports "hidden" for a perfectly visible
    // anchor, which would close every tooltip the moment it opened.
    if (referenceHidden) {
      const anchor = refs.reference.current as Element | null;
      const box = anchor?.getBoundingClientRect();
      if (box && (box.width > 0 || box.height > 0)) {
        setIsOpen(false);
        return;
      }
    }

    const close = () => setIsOpen(false);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') close();
    };

    // Pointer left the document — the anchor's `mouseleave` fires for a
    // move to another ELEMENT, not for a move out of the window.
    document.documentElement.addEventListener('mouseleave', close);
    window.addEventListener('blur', close);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.documentElement.removeEventListener('mouseleave', close);
      window.removeEventListener('blur', close);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [isOpen, referenceHidden, refs]);

  if (disabled) return <>{children}</>;

  const dropdownClassName = className
    ? `skein-tooltip ${className}`
    : 'skein-tooltip';

  // Must happen before the portal below mounts — see ensureFloatingLayer.
  if (isOpen) ensureFloatingLayer();

  // `isPositioned` flips true after Floating UI runs the FIRST measurement.
  // Until then, `floatingStyles.transform` is `translate(0px, 0px)` and the
  // element would render at viewport (0, 0) for one frame — visible as a
  // top-left flicker on every hover. Hide via `visibility` (not `display`)
  // so the layout still computes and the measurement can complete.
  const floatingNode = isOpen ? (
    <FloatingPortal id={FLOATING_LAYER_ID}>
      <div
        ref={refs.setFloating}
        style={{
          ...floatingStyles,
          ...(width !== undefined ? { width } : null),
          visibility: isPositioned ? 'visible' : 'hidden',
        }}
        className={dropdownClassName}
        // The placement Floating UI actually resolved to (after flip /
        // shift), not the one we asked for. Purely observational — it
        // makes "which side did it land on" assertable in tests and
        // readable in DevTools.
        data-placement={placement}
        {...getFloatingProps()}
      >
        {content}
      </div>
    </FloatingPortal>
  ) : null;

  // Mirror Mantine HoverCard.Target: clone the single child element and
  // attach Floating UI ref + interaction props. The child must be a real
  // React element (not Fragment / string / array). For non-element
  // children we fall back to wrapping in a span — preserves backwards
  // compat with any consumer that ever passed a string.
  if (!isValidElement(children)) {
    return (
      <>
        <span
          ref={refs.setReference as Ref<HTMLSpanElement>}
          {...getReferenceProps()}
        >
          {children}
        </span>
        {floatingNode}
      </>
    );
  }

  const childElement = children as ReactElement<AnyChildProps>;
  // `getReferenceProps` is typed against `HTMLProps<Element>`. The
  // child is a generic React element with arbitrary props; we cast at
  // the call site since Floating UI only reads/merges DOM-level event
  // handlers and aria attributes.
  const childProps = childElement.props as HTMLProps<Element>;
  const childWithRef = cloneElement(childElement, {
    ref: refs.setReference as Ref<unknown>,
    // Merge the consumer's existing props so Floating UI's interaction
    // handlers (onMouseEnter, onFocus, onKeyDown for dismiss, …) compose
    // with whatever the consumer attached (onClick, etc.) instead of
    // overwriting them.
    ...getReferenceProps(childProps),
  });

  return (
    <>
      {childWithRef}
      {floatingNode}
    </>
  );
}
