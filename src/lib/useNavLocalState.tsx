/**
 * sk-551.8 (plan P6) — the local state of the navigation, lifted out of
 * the Projects and Queues columns so it can outlive them and be dropped
 * on purpose.
 *
 * What lives here: the Projects search text, the Watching filter
 * (Open / Closed / All), the subscription select mode and its marks, and
 * the scroll of the two bodies. Nothing else — the selected and open
 * task, its unfinished comment, how the task is shown, the selected
 * queue, the lenses and the open file are never part of it (US-15).
 *
 * WHY a provider. The sections layout draws the same columns in another
 * structure, and crossing a width threshold (desktop ↔ tablet ↔ phone)
 * remounts them; their own `useState` would lose the search and the marks
 * on every crossing, which US-15 forbids. Held here, inside the shell, the
 * state survives folding a section or the column and every threshold; it
 * is dropped only by `reset()`, which the shell calls on a change of
 * layout on desktop or tablet (US-15: a phone changes no layout, so it
 * resets nothing). A refused save that rolls the layout back does not
 * bring the dropped state back.
 *
 * Without the provider (other pages, unit tests that mount a column
 * alone) every reader falls back to a plain `useState` of its own —
 * exactly the behaviour before this provider existed.
 *
 * The scroll of the bodies is remembered only with the sections setting
 * (`rememberScroll`): in the side-by-side layout the columns stay mounted
 * across thresholds as before, and nothing is added to them.
 *
 * Each value has its own subscribers, so typing in the Projects search
 * does not re-render the Queues column.
 */
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from 'react';
import type { WatchingState } from '../api/notifications';

/** Every value this provider holds, by key. */
export interface NavLocalValues {
  projectsSearch: string;
  watchingState: WatchingState;
  watchingSelectMode: boolean;
  watchingCheckedIds: ReadonlySet<string>;
}

export type NavLocalKey = keyof NavLocalValues;
export type NavScrollKey = 'projects' | 'queues';

class NavLocalStore {
  private values = new Map<string, unknown>();
  private listeners = new Map<string, Set<() => void>>();
  private scroll = new Map<NavScrollKey, number>();


  read<K extends NavLocalKey>(key: K, initial: NavLocalValues[K]): NavLocalValues[K] {
    if (!this.values.has(key)) this.values.set(key, initial);
    return this.values.get(key) as NavLocalValues[K];
  }

  write<K extends NavLocalKey>(key: K, value: NavLocalValues[K]): void {
    if (this.values.get(key) === value) return;
    this.values.set(key, value);
    this.listeners.get(key)?.forEach((l) => l());
  }

  subscribe(key: NavLocalKey, listener: () => void): () => void {
    let set = this.listeners.get(key);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(listener);
    return () => set!.delete(listener);
  }

  readScroll(key: NavScrollKey): number | undefined {
    return this.scroll.get(key);
  }

  writeScroll(key: NavScrollKey, top: number): void {
    this.scroll.set(key, top);
  }

  /** Back to the initial values; every reader re-renders with them. */
  reset(): void {
    const keys = [...this.values.keys()];
    this.values.clear();
    this.scroll.clear();
    for (const key of keys) this.listeners.get(key)?.forEach((l) => l());
  }
}

interface NavLocalContextValue {
  store: NavLocalStore;
  /**
   * Remember the bodies' scroll — a value of the context, not a field of
   * the store, so a change of the setting re-runs the scroll readers
   * (attaches or drops their listeners) on the same store.
   */
  rememberScroll: boolean;
}

const NavLocalContext = createContext<NavLocalContextValue | null>(null);

export interface NavLocalStateApi {
  /** Drop every value (US-15: a change of layout on desktop or tablet). */
  reset: () => void;
}

const ResetContext = createContext<NavLocalStateApi | null>(null);

export function NavLocalStateProvider({
  rememberScroll,
  children,
}: {
  /** Remember the bodies' scroll: only with the sections setting. */
  rememberScroll: boolean;
  children: ReactNode;
}) {
  const [store] = useState(() => new NavLocalStore());
  const value = useMemo(() => ({ store, rememberScroll }), [store, rememberScroll]);
  const api = useMemo<NavLocalStateApi>(() => ({ reset: () => store.reset() }), [store]);
  return (
    <NavLocalContext.Provider value={value}>
      <ResetContext.Provider value={api}>{children}</ResetContext.Provider>
    </NavLocalContext.Provider>
  );
}

/** The provider's `reset`, or `null` without a provider. */
export function useNavLocalStateApi(): NavLocalStateApi | null {
  return useContext(ResetContext);
}

const noopUnsubscribe = () => {};

/**
 * `useState`, held by the provider when there is one. `initial` is read
 * on the first render only (as `useState` does) and is the value a reset
 * goes back to.
 */
export function useNavLocalState<K extends NavLocalKey>(
  key: K,
  initial: NavLocalValues[K],
): [NavLocalValues[K], Dispatch<SetStateAction<NavLocalValues[K]>>] {
  const ctx = useContext(NavLocalContext);
  const store = ctx?.store ?? null;
  const initialRef = useRef(initial);
  const [own, setOwn] = useState<NavLocalValues[K]>(initial);

  const subscribe = useCallback(
    (onChange: () => void) => (store === null ? noopUnsubscribe : store.subscribe(key, onChange)),
    [store, key],
  );
  const getSnapshot = useCallback(
    () => (store === null ? initialRef.current : store.read(key, initialRef.current)),
    [store, key],
  );
  const held = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setHeld = useCallback<Dispatch<SetStateAction<NavLocalValues[K]>>>(
    (action) => {
      if (store === null) return;
      const prev = store.read(key, initialRef.current);
      const next =
        typeof action === 'function'
          ? (action as (p: NavLocalValues[K]) => NavLocalValues[K])(prev)
          : action;
      store.write(key, next);
    },
    [store, key],
  );

  return store === null ? [own, setOwn] : [held, setHeld];
}

/**
 * Remember and restore a body's scroll, with the provider and the
 * sections setting only. The position is restored when the body mounts
 * (a threshold crossing remounts the columns) and recorded as it
 * scrolls; a reset forgets it.
 */
export function useNavScrollMemory(key: NavScrollKey, ref: RefObject<HTMLElement | null>): void {
  const ctx = useContext(NavLocalContext);
  const store = ctx?.store ?? null;
  const remember = ctx?.rememberScroll ?? false;
  useLayoutEffect(() => {
    const el = ref.current;
    if (store === null || el === null || !remember) return;
    const saved = store.readScroll(key);
    if (saved !== undefined) el.scrollTop = saved;
    const onScroll = () => store.writeScroll(key, el.scrollTop);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [store, remember, key, ref]);
}
