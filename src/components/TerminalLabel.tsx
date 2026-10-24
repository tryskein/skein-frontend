import * as React from 'react';

/**
 * TerminalLabel renders a child label wrapped in `[ ... ]` brackets where
 * the brackets themselves are decorative chrome — `aria-hidden="true"` so
 * screen readers announce only the inner content. Use inside <Button> /
 * <Link> contents instead of writing the brackets in raw text.
 */
export function TerminalLabel({ children }: { children: React.ReactNode }) {
  return (
    <>
      <span aria-hidden="true">[ </span>
      {children}
      <span aria-hidden="true"> ]</span>
    </>
  );
}
