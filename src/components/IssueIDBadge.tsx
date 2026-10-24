import { CSSProperties, useState, type MouseEvent } from 'react';
import { useToaster } from './Toaster';

/**
 * IssueIDBadge renders a hierarchical issue id (e.g. `demo-42` or
 * `demo-42.1.1`) where the parent prefix is dim and the last segment is
 * bright accent — making the leaf segment scannable in long lists.
 *
 * ─── The tones are ROLES, and the same on every surface ────────────
 *
 * `--primary` for the leaf (and for the pin ★), `--ink-3` for the parent
 * prefix, `--ink-2` for a leaf that is not emphasised. Handoff §6
 * "Task list" writes the id as "mono 12 `--primary` on the right", and the
 * Details panel paints the identical tones at a larger size.
 *
 * They used to be the `--skein-*` bridge, on the argument that a surface
 * could re-tone the badge by rebinding those properties on an ancestor.
 * In practice no surface ever wanted a different tone: all ten shell
 * surfaces that draw a badge re-pointed the bridge at THESE THREE ROLES,
 * in three copies of the same three declarations. What the indirection
 * actually bought was a way to get it wrong — a surface that forgot the
 * knobs painted `legacy.css`'s `:root` ember `#ff7a3d`, which reads 2.36
 * on `--bg` in light, and six of the ten did exactly that for a release
 * (sk-285.7.2.29). sk-521 removed the indirection: the roles are read
 * here, the ember is unreachable, and there is nothing left to agree.
 *
 * ⚠ The SIZE is still a knob, and still a per-surface decision —
 * `--issue-id-font-size`, declared on an ANCESTOR of the badge. That one
 * genuinely differs: 12px in every list, 16px on the Details panel where
 * the issue is the subject rather than a chip beside a bigger title
 * (sk-285.1.1, re-decided at 12px by handoff §6 / sk-362). A custom
 * property inherits DOWN and never sideways: the knob sat on
 * `.task-card-title-block` for a whole release while the badge rendered
 * in a sibling element and reached nothing — silently, because the
 * fallback below is a valid value.
 *
 * `pinned` adds a leading ★ before the id (terminal-style indicator).
 *
 * `copyable=true` turns the badge into a button that copies the current
 * page URL to the clipboard on click — used in DetailsHeader so the
 * user can grab a permalink to the open issue with one click. List
 * surfaces (cards / tree rows) keep `copyable=false` so the badge
 * doesn't intercept the row-click navigation.
 */
export interface IssueIDBadgeProps {
  id: string;
  pinned?: boolean;
  /** Optional emphasis on the last segment (default true). */
  emphasizeLeaf?: boolean;
  className?: string;
  style?: CSSProperties;
  /** When true, click copies window.location.href to clipboard. */
  copyable?: boolean;
}

export function IssueIDBadge({
  id,
  pinned,
  emphasizeLeaf = true,
  className,
  style,
  copyable,
}: IssueIDBadgeProps) {
  const dotIdx = id.lastIndexOf('.');
  const head = dotIdx >= 0 ? id.slice(0, dotIdx + 1) : '';
  const tail = dotIdx >= 0 ? id.slice(dotIdx + 1) : id;
  const toast = useToaster();
  const [justCopied, setJustCopied] = useState(false);

  const onCopy = async (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(window.location.href);
      setJustCopied(true);
      toast.info(`Link to ${id} copied`);
      setTimeout(() => setJustCopied(false), 1200);
    } catch (err) {
      toast.error('Clipboard write failed');
    }
  };

  const content = (
    <>
      {pinned ? (
        <span style={{ color: 'var(--primary)', marginRight: 4 }}>★</span>
      ) : null}
      {head ? (
        <span style={{ color: 'var(--ink-3)' }}>{head}</span>
      ) : null}
      <span
        style={{
          color: emphasizeLeaf ? 'var(--primary)' : 'var(--ink-2)',
        }}
      >
        {tail}
      </span>
    </>
  );

  const baseStyle: CSSProperties = {
    fontFamily: 'var(--font-mono)',
    // sk-285.1.1 — body size by default, but a surface where the id
    // shares a line with something that must be read FIRST can step it
    // down by setting `--issue-id-font-size` on an ANCESTOR (the shell's
    // issue rows do, in `.task-card-id-line`). A CSS knob rather than a
    // prop: the size belongs to the surface's type hierarchy, not to the
    // individual call site.
    fontSize: 'var(--issue-id-font-size, var(--font-base))',
    whiteSpace: 'nowrap',
    ...style,
  };

  if (copyable) {
    // sk-285.7.2.44 — the button's chrome (transparent ground, no
    // border, no padding, pointer cursor, inherited ink) is `.issue-id-copy`
    // in `src/index.css`, NOT an inline style object. It lived here once,
    // and an inline declaration outranks every non-important selector: the
    // hover hint could only reach the control as
    // `background: var(--elev) !important`, and the pressed recipe — which
    // is not important — never landed at all, so the control drew the ghost
    // ring over an unchanged ground. Chrome that belongs to every copyable
    // badge belongs in the class; what a CALLER passes still arrives inline
    // through `baseStyle`, which is the escape hatch and is meant to win.
    return (
      <button
        type="button"
        className={['issue-id-badge', 'issue-id-copy', className].filter(Boolean).join(' ')}
        title={justCopied ? 'Copied!' : `Copy link to ${id}`}
        onClick={onCopy}
        style={baseStyle}
      >
        {content}
      </button>
    );
  }

  return (
    <span
      className={['issue-id-badge', className].filter(Boolean).join(' ')}
      style={baseStyle}
    >
      {content}
    </span>
  );
}
