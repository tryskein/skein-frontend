import { useEffect, useRef, useState } from 'react';
import { hashKey, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { IconAlertTriangle, IconHourglass, IconRefresh } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { SkeinTooltip } from '../../components/SkeinTooltip';
import { applyHeldList, onApplyOutcome, useListState } from '../../lib/liveListDirty';

interface TasksUpdatesButtonProps {
  /** `useTasks().cacheKey` of the list the column shows. */
  listKey: QueryKey;
  /**
   * Called as the updates are applied, BEFORE the list is cut to its first
   * page: the column goes to the top first, so the cut list is not shown
   * from a scroll offset the browser clamps to its end.
   */
  onApply: () => void;
  /**
   * Where the focus goes when the button leaves while it holds the focus;
   * by default the column header the button sits in (`.col-header`, which
   * takes focus by script).
   */
  focusAfter?: () => HTMLElement | null;
}

/** A stable identity per QueryClient, so another client is another button. */
const clientIds = new WeakMap<QueryClient, number>();
let nextClientId = 1;
function clientId(qc: QueryClient): number {
  let id = clientIds.get(qc);
  if (id === undefined) {
    id = nextClientId++;
    clientIds.set(qc, id);
  }
  return id;
}

/**
 * sk-763 — «Updates available» in the Tasks column.
 *
 * While the person reads a loaded list, the background keeps it
 * (`lib/liveListDirty.ts`); a change the client could not apply in place
 * marks the list, and this button is the one way to apply it: the column is
 * brought to its start, the list is read again from its first page, in one
 * request. No number is printed — the client does not know how many rows
 * changed.
 *
 * The chrome is the shell's accent ghost action (`.empty-section-add`:
 * 16px icon + words, the «Add» / «Retry» buttons of the details pane). The
 * three states differ by their words AND their glyph (refresh, hourglass,
 * warning), so they stay apart where the words are not drawn (a phone).
 *
 * The apply is the list's own operation (`applyHeldList`): this button only
 * shows it, so the list mounted again while it runs shows it running, and a
 * second press joins it. One instance per (client, list): nothing of an
 * apply on another client or list shows here. A status line beside the
 * button, outside it, tells assistive technology what happened.
 */
export function TasksUpdatesButton(props: TasksUpdatesButtonProps) {
  const qc = useQueryClient();
  return <UpdatesButtonOfList key={`${clientId(qc)}:${hashKey(props.listKey)}`} {...props} />;
}

function UpdatesButtonOfList({ listKey, onApply, focusAfter }: TasksUpdatesButtonProps) {
  const { t } = useTranslation('tasks');
  const qc = useQueryClient();
  const { dirty, phase, query } = useListState(listKey);
  // «The list is updated» — announced once the apply of THIS list landed.
  const [applied, setApplied] = useState(false);
  // The button element while it has the focus (`SkeinTooltip` owns its ref).
  const focused = useRef<HTMLButtonElement | null>(null);
  const focusAfterRef = useRef(focusAfter);
  focusAfterRef.current = focusAfter;

  useEffect(
    () =>
      onApplyOutcome((q, outcome) => {
        if (q !== query) return;
        if (outcome !== 'applied') return;
        setApplied(true);
        // The button is about to leave: if it holds the focus, the focus
        // goes to the header rather than falling to the page; focus the
        // reader moved elsewhere stays where it is.
        const el = focused.current;
        if (el !== null && document.activeElement === el) {
          (focusAfterRef.current?.() ?? el.closest<HTMLElement>('.col-header'))?.focus();
        }
      }),
    [query],
  );

  const applying = phase === 'applying';
  const failed = phase === 'failed';
  const label = applying ? t('updatesApplying') : failed ? t('updatesFailed') : t('updatesAvailable');
  const status = applying ? t('updatesApplying') : failed ? t('updatesFailed') : applied ? t('updatesApplied') : '';
  const Icon = applying ? IconHourglass : failed ? IconAlertTriangle : IconRefresh;

  return (
    <>
      {dirty || applying || failed ? (
        <SkeinTooltip position="bottom" content={t('updatesTooltip')}>
          <button
            type="button"
            className="empty-section-add col-tasks-updates"
            // Not `disabled`: a disabled button drops the keyboard focus. A
            // press while the read runs joins it (`applyHeldList`).
            aria-disabled={applying || undefined}
            onFocus={(e) => { focused.current = e.currentTarget; }}
            onBlur={() => { focused.current = null; }}
            onClick={() => {
              if (applying) return;
              setApplied(false);
              onApply();
              applyHeldList(qc, listKey);
            }}
          >
            <Icon size={16} stroke={1.75} aria-hidden />
            <span className="col-tasks-updates-label">{label}</span>
          </button>
        </SkeinTooltip>
      ) : null}
      <span className="sr-only" role="status" aria-live="polite">{status}</span>
    </>
  );
}
