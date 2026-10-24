import { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * ErrorFrame renders an inline error block — single-line title from
 * `.skein-error-frame-title`, body in `--ink`. Used everywhere a 422
 * needs to be shown next to a form field, plus generic load-failure
 * surfaces.
 *
 * sk-521 — the body ink was `var(--skein-fg)`, i.e. the bridge: ember
 * cream on `:root`, `--ink` under `.col-details`. Only `CommentsThread`
 * renders this frame and only inside the details column, so the value on
 * screen is unchanged — but the read was ancestor-dependent, and cream
 * body text on the light page is the defect the first move out of that
 * column would have shipped.
 */
export interface ErrorFrameProps {
  /** Default: the translated `common:errorTitle`. */
  title?: string;
  /** Either pass `message` or render arbitrary children. */
  message?: ReactNode;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function ErrorFrame({
  title,
  message,
  children,
  className,
  style,
}: ErrorFrameProps) {
  // Resolved in the body rather than as a default parameter: `t` does
  // not exist yet in the parameter list, and the fallback has to follow
  // the active language rather than the module's load order.
  const { t } = useTranslation('common');
  const resolvedTitle = title ?? t('errorTitle');
  return (
    <div
      className={['skein-error-frame', className].filter(Boolean).join(' ')}
      style={style}
      role="alert"
    >
      <div className="skein-error-frame-title">! {resolvedTitle}</div>
      <div style={{ color: 'var(--ink)' }}>{children ?? message}</div>
    </div>
  );
}
