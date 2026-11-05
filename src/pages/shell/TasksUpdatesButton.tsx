import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { hashKey, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { IconAlertTriangle, IconHourglass, IconRefresh } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { SkeinTooltip } from '../../components/SkeinTooltip';
import { applyHeldLists, onUpdatesApplied, useListState } from '../../lib/liveListDirty';

interface TasksUpdatesButtonProps {
  /**
   * The key of the list the column shows: `useTasks().cacheKey`, or — the
   * tree view with a link lens beyond parent-child — the key of the
   * project's layered tree the body draws (`TasksColumn.tsx#readsLayeredTree`).
   */
  listKey: QueryKey;
  /**
   * The second source of the same surface, when it has one: the task list
   * behind the column's layered tree, which decides the body around the
   * tree (loading, failure, an empty filtered set). The button offers, runs
   * and retries the updates of both as one.
   */
  alsoKey?: QueryKey;
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
 * brought to its start, the list is read again — a task list from its first
 * page, a layered tree as it is — in one request. A surface of two sources
 * (the layered tree and the task list behind it, `alsoKey`) is one offer: it
 * is shown while either owes updates, runs until both reads end, fails when
 * either fails, and its retry reads again only the sources still owed (a
 * marked or a failed one) — each once. «The list is updated» is told, and
 * the focus moved, only when every read of the attempt landed. No number is
 * printed — the client does not know how many rows changed.
 *
 * The chrome is the shell's accent ghost action (`.empty-section-add`:
 * 16px icon + words, the «Add» / «Retry» buttons of the details pane). The
 * three states differ by their words AND their glyph (refresh, hourglass,
 * warning), so they stay apart where the words are not drawn (a phone).
 *
 * The apply is the lists' own attempt (`applyHeldLists`): this button only
 * shows it, so a button mounted again while it runs (it moved between the
 * header and the filters row) shows it running and tells its end, and a
 * second press joins it. One instance per (client, lists): nothing of an
 * apply on another client or list shows here. A status line beside the
 * button, outside it, tells assistive technology what happened.
 */
export function TasksUpdatesButton(props: TasksUpdatesButtonProps) {
  const qc = useQueryClient();
  const lists = props.alsoKey === undefined ? hashKey(props.listKey) : `${hashKey(props.listKey)}|${hashKey(props.alsoKey)}`;
  return <UpdatesButtonOfList key={`${clientId(qc)}:${lists}`} {...props} />;
}

function UpdatesButtonOfList({ listKey, alsoKey, onApply, focusAfter }: TasksUpdatesButtonProps) {
  const { t } = useTranslation('tasks');
  const qc = useQueryClient();
  // One state per source (the second is the first again when there is none).
  const first = useListState(listKey);
  const second = useListState(alsoKey ?? listKey);
  const sources = alsoKey === undefined
    ? [{ key: listKey, ...first }]
    : [{ key: listKey, ...first }, { key: alsoKey, ...second }];
  // «The list is updated» — announced once every read of an attempt on exactly these lists landed.
  const [applied, setApplied] = useState(false);
  const firstQuery = first.query;
  const secondQuery = alsoKey === undefined ? undefined : second.query;
  // The button element while it holds the focus (`SkeinTooltip` owns its
  // ref), and the column header it sits in, kept while the element is in
  // the document: a removed element has no header to find.
  const focused = useRef<HTMLButtonElement | null>(null);
  const headerOf = useRef<HTMLElement | null>(null);
  const focusAfterRef = useRef(focusAfter);
  focusAfterRef.current = focusAfter;

  useEffect(
    () =>
      onUpdatesApplied((surface) => {
        // Only the end of THIS surface: the same lists, all of them — not
        // another surface that shares one of them.
        const mine = secondQuery === undefined ? [firstQuery] : [firstQuery, secondQuery];
        if (mine.some((q) => q === undefined)) return;
        const own = new Set(mine);
        if (surface.length !== own.size || !surface.every((q) => own.has(q))) return;
        setApplied(true);
      }),
    [firstQuery, secondQuery],
  );

  const dirty = sources.some((s) => s.dirty);
  const applying = sources.some((s) => s.phase === 'applying');
  const failed = !applying && sources.some((s) => s.phase === 'failed');
  const visible = dirty || applying || failed;

  // The button leaves (nothing is owed, runs or failed any more), whatever
  // ended it — this surface's own apply, another one's on a list it shares,
  // a read of the list by a mount. If it held the focus, the focus goes to
  // the column (`focusAfter`, else its header) rather than falling to the
  // page. Focus the reader moved to another control stays there; a button
  // that stays (updates owed again) keeps its focus. Only this transition
  // moves it: a re-render of a shown button does not.
  const wasVisible = useRef(visible);
  useLayoutEffect(() => {
    const was = wasVisible.current;
    wasVisible.current = visible;
    if (!was || visible) return;
    const el = focused.current;
    focused.current = null;
    if (el === null) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body && active !== el) return;
    (focusAfterRef.current?.() ?? headerOf.current)?.focus({ preventScroll: true });
  }, [visible]);
  const label = applying ? t('updatesApplying') : failed ? t('updatesFailed') : t('updatesAvailable');
  const status = applying ? t('updatesApplying') : failed ? t('updatesFailed') : applied ? t('updatesApplied') : '';
  const Icon = applying ? IconHourglass : failed ? IconAlertTriangle : IconRefresh;

  return (
    <>
      {visible ? (
        <SkeinTooltip position="bottom" content={t('updatesTooltip')}>
          <button
            type="button"
            className="empty-section-add col-tasks-updates"
            // Not `disabled`: a disabled button drops the keyboard focus. A
            // press while the read runs joins it (`applyHeldLists`).
            aria-disabled={applying || undefined}
            onFocus={(e) => {
              focused.current = e.currentTarget;
              headerOf.current = e.currentTarget.closest<HTMLElement>('.col-header');
            }}
            // Focus moved to another element: the button no longer holds
            // it. A blur to nowhere (the element removed, the window left)
            // leaves that to the check above, which looks at the document.
            onBlur={(e) => { if (e.relatedTarget !== null) focused.current = null; }}
            onClick={() => {
              if (applying) return;
              // The sources still owed: marked, or failed last time.
              const owed = sources.filter((s) => s.dirty || s.phase === 'failed');
              setApplied(false);
              onApply();
              applyHeldLists(qc, sources.map((s) => s.key), owed.map((s) => s.key));
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
