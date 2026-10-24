import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatRelative, formatTimestamp } from './format';

export interface TimeLabelProps {
  /** ISO-8601 instant. Null/undefined renders the shared em-dash. */
  iso: string | null | undefined;
  /** Optional text placed before the label inside the same `<time>`. */
  prefix?: ReactNode;
  className?: string;
  style?: CSSProperties;
  /**
   * DOM id. Needed where the label is the DESCRIPTION of a control that
   * sits beside it — a Watching activity row points its
   * `aria-describedby` here rather than copying the time into the
   * button's own accessible name.
   */
  id?: string;
}

/**
 * sk-285.6.7 — the one way to print an instant in the UI.
 *
 * Renders `formatRelative(iso)` (relative while fresh, `YYYY-MM-DD UTC`
 * once past `RELATIVE_UNTIL_MS`) and ALWAYS carries the full
 * `YYYY-MM-DD HH:MM UTC` stamp as the element's title, so the precise
 * value is one hover away wherever the short one is shown. That pairing
 * is the whole point of the component: a bare `formatRelative()` call
 * drops the exact time on the floor, and the card was full of them.
 *
 * `<time dateTime>` rather than `<span>`: the machine-readable instant
 * belongs on the element, not only in a tooltip, and it costs nothing.
 *
 * The title is NOT an `aria-label`. A screen reader announcing
 * "2026-08-31 07:01 UTC" instead of "9 days ago" would lose the
 * quick-scan reading that the visible text exists to give; the `title`
 * is surfaced by AT as a description, after the text, which is the
 * right order.
 */
export function TimeLabel({ iso, prefix, className, style, id }: TimeLabelProps) {
  // sk-514 (15) — a SUBSCRIPTION, not an in-place translation. Both labels are built by
  // `format.ts` outside React, so a language change by itself would not
  // make this component re-render: the English labels would stay
  // on screen until the next unrelated update. `useTranslation` subscribes
  // the component to the language change event — that is why it stands here.
  useTranslation();
  const full = formatTimestamp(iso);
  return (
    <time
      // A falsy iso has no machine-readable value — omit the attribute
      // rather than emit `dateTime=""`, which is invalid HTML.
      dateTime={iso ?? undefined}
      id={id}
      className={className}
      style={style}
      title={full}
    >
      {prefix}
      {formatRelative(iso)}
    </time>
  );
}
