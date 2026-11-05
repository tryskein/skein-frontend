/**
 * sk-763 — test support: stand in for the Tasks column showing a list.
 *
 * Mounts a tiny component that reports, through the column's real hook
 * (`lib/liveListDirty.ts#useReportReadingPosition`), that the list `key` is
 * shown as the column's ordinary list. Used by tests
 * that drive a list with a bare query observer instead of the column.
 */
import { createElement, useRef } from 'react';
import { render } from '@testing-library/react';
import { QueryClientProvider, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { useReportReadingPosition } from '../lib/liveListDirty';

function ShownList({ listKey }: { listKey: QueryKey }) {
  const root = useRef<HTMLDivElement | null>(null);
  useReportReadingPosition(listKey, { shown: true, root });
  return createElement('div', { ref: root });
}

/** The column shows the list `key` of `qc` (until the test's cleanup). */
export function showReadingList(qc: QueryClient, key: QueryKey): void {
  render(createElement(QueryClientProvider, { client: qc }, createElement(ShownList, { listKey: key })));
}
