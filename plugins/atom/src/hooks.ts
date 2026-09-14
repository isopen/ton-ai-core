import { getLogger } from '@ton-ai/gram-debug';
import { currentInstance, type ComponentInstance } from './vdom.js';

const log = getLogger('atom');

let reroot: ((inst?: ComponentInstance) => void) | null = null;

interface EffectEntry {
  inst: ComponentInstance;
  fn: () => (() => void) | void;
  oldCleanup?: (() => void);
  cleanupIdx: number;
  depsIdx: number;
  oldDeps: any[] | undefined;
}

const pendingEffects: EffectEntry[] = [];

export function __setReroot(fn: (inst?: ComponentInstance) => void) {
  reroot = fn;
}

export function requestRerender(inst?: ComponentInstance) {
  reroot?.(inst);
}

function getInstance(): ComponentInstance {
  if (!currentInstance) throw new Error('Hooks must be called within a component');
  return currentInstance;
}

export function useState<T>(initial: T | (() => T)): [T, (v: T | ((prev: T) => T)) => void] {
  const inst = getInstance();
  const idx = inst.hookIndex++;

  if (inst.hookStates.length <= idx) {
    const value = typeof initial === 'function' ? (initial as () => T)() : initial;
    hookJournal.push({ inst, idx, prevLen: inst.hookStates.length, prevVal: undefined, had: false });
    inst.hookStates[idx] = value;
  }

  const cache = ((inst as unknown as { __stateSetters?: Map<number, (v: T | ((prev: T) => T)) => void> }).__stateSetters ??= new Map());
  let setState = cache.get(idx);
  if (!setState) {
    setState = (v: T | ((prev: T) => T)) => {
      if (!inst._mounted) return;
      const newVal = typeof v === 'function' ? (v as (prev: T) => T)(inst.hookStates[idx]) : v;
      if (!Object.is(newVal, inst.hookStates[idx])) {
        inst.hookStates[idx] = newVal;
        inst._dirty = true;
        reroot?.(inst);
      }
    };
    cache.set(idx, setState);
  }

  return [inst.hookStates[idx] as T, setState];
}

export function useEffect(fn: () => (() => void) | void, deps?: any[]) {
  const inst = getInstance();
  const depsIdx = inst.hookIndex++;
  const cleanupIdx = inst.hookIndex++;

  const oldDeps = inst.hookStates[depsIdx] as any[] | undefined;
  let changed = true;

  if (oldDeps !== undefined && deps !== undefined) {
    changed = deps.length !== oldDeps.length || deps.some((d, i) => !Object.is(d, oldDeps[i]));
  }

  if (changed) {
    const old = inst.hookStates[depsIdx] as any[] | undefined;
    inst.hookStates[depsIdx] = deps ? [...deps] : deps;
    pendingEffects.push({
      inst,
      fn,
      oldCleanup: inst.hookStates[cleanupIdx] as (() => void) | undefined,
      cleanupIdx,
      depsIdx,
      oldDeps: old,
    });
  }
}

interface HookStateEntry {
  inst: ComponentInstance;
  idx: number;
  prevLen: number;
  prevVal: unknown;
  had: boolean;
}

const hookJournal: HookStateEntry[] = [];

export function snapshotEffectQueues(): [number, number, number] {
  return [pendingEffects.length, pendingLayoutEffects.length, hookJournal.length];
}

export function rollbackEffectQueues(snap: [number, number, number]): void {
  if (pendingEffects.length > snap[0]) {
    for (let i = pendingEffects.length - 1; i >= snap[0]; i--) {
      const entry = pendingEffects[i];
      try {
        entry.inst.hookStates[entry.depsIdx] = entry.oldDeps;
      } catch {}
    }
    pendingEffects.length = snap[0];
  }
  if (pendingLayoutEffects.length > snap[1]) {
    for (let i = pendingLayoutEffects.length - 1; i >= snap[1]; i--) {
      const entry = pendingLayoutEffects[i];
      try {
        entry.inst.hookStates[entry.depsIdx] = entry.oldDeps;
      } catch {}
    }
    pendingLayoutEffects.length = snap[1];
  }
  if (hookJournal.length > snap[2]) {
    for (let i = hookJournal.length - 1; i >= snap[2]; i--) {
      const entry = hookJournal[i];
      try {
        if (entry.had) {
          entry.inst.hookStates[entry.idx] = entry.prevVal;
        } else if (entry.inst.hookStates.length > entry.prevLen) {
          entry.inst.hookStates.length = entry.prevLen;
        }
      } catch {}
    }
    hookJournal.length = snap[2];
  }
}

function hasNewerEntry(queue: Array<{ inst: ComponentInstance; cleanupIdx: number }>, from: number, inst: ComponentInstance, cleanupIdx: number): boolean {
  for (let i = from; i < queue.length; i++) {
    if (queue[i].inst === inst && queue[i].cleanupIdx === cleanupIdx) return true;
  }
  return false;
}

export function flushAllEffects() {
  while (pendingEffects.length > 0) {
    const head = pendingEffects[0];
    if (hasNewerEntry(pendingEffects, 1, head.inst, head.cleanupIdx)) {
      pendingEffects.shift();
      continue;
    }
    const { inst, fn, oldCleanup, cleanupIdx } = pendingEffects.shift()!;
    if (!inst._mounted) continue;
    if (oldCleanup) {
      try { oldCleanup(); } catch (e) { log.error('useEffect cleanup error:', e); }
      const ci = inst.unmountCleanups.indexOf(oldCleanup);
      if (ci !== -1) inst.unmountCleanups.splice(ci, 1);
    }
    let cleanup: (() => void) | void;
    try {
      cleanup = fn();
    } catch (e) {
      log.error('useEffect error:', e);
      cleanup = undefined;
    }
    inst.hookStates[cleanupIdx] = typeof cleanup === 'function' ? cleanup : undefined;
    if (typeof cleanup === 'function') {
      inst.unmountCleanups.push(cleanup);
    }
  }
}

export function useRef<T>(initial: T): { current: T } {
  const inst = getInstance();
  const idx = inst.hookIndex++;

  if (inst.hookStates.length <= idx) {
    hookJournal.push({ inst, idx, prevLen: inst.hookStates.length, prevVal: undefined, had: false });
    inst.hookStates[idx] = { current: initial };
  }

  return inst.hookStates[idx] as { current: T };
}

export function useMemo<T>(fn: () => T, deps: any[]): T {
  const inst = getInstance();
  const idx = inst.hookIndex++;

  const oldDeps = inst.hookStates[idx] as { deps: any[]; value: T } | undefined;
  let changed = true;

  if (oldDeps !== undefined && deps != null && oldDeps.deps != null) {
    changed = deps.length !== oldDeps.deps.length || deps.some((d, i) => !Object.is(d, oldDeps.deps[i]));
  }

  if (changed) {
    const had = inst.hookStates.length > idx;
    hookJournal.push({ inst, idx, prevLen: inst.hookStates.length, prevVal: inst.hookStates[idx], had });
    const value = fn();
    inst.hookStates[idx] = { deps: deps ? [...deps] : deps, value };
    return value;
  }

  return oldDeps!.value;
}

export function useCallback<T extends (...args: any[]) => any>(fn: T, deps: any[]): T {
  return useMemo(() => fn, deps);
}

export type DomEventTarget =
  | Window | Document | Element
  | null | undefined
  | (() => Window | Document | Element | null | undefined);

export function useDomEvent(
  target: DomEventTarget,
  type: string,
  handler: ((e: any) => void) | null | undefined,
  deps: any[] = [],
  options?: AddEventListenerOptions,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const targetRef = useRef(target);
  targetRef.current = target;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  useEffect(() => {
    const t = typeof targetRef.current === 'function' ? targetRef.current() : targetRef.current;
    const opts = optionsRef.current;
    if (!t || !handlerRef.current || typeof (t as any).addEventListener !== 'function') return;
    const dispatch = (e: any) => handlerRef.current?.(e);
    t.addEventListener(type, dispatch, opts);
    return () => t.removeEventListener(type, dispatch, opts);
  }, [type, target, options?.capture, options?.passive, options?.once, options?.signal, ...deps]);
}

export function useReducer<S, A>(
  reducer: (prev: S, action: A) => S,
  initialState: S | (() => S),
): [S, (action: A) => void];
export function useReducer<S, A, I>(
  reducer: (prev: S, action: A) => S,
  initializerArg: I,
  initializer: (arg: I) => S,
): [S, (action: A) => void];
export function useReducer<S, A>(
  reducer: (prev: S, action: A) => S,
  initial: any,
  init?: (v: any) => S,
): [S, (action: A) => void] {
  const [state, setState] = useState<S>(() => {
    if (init) return init(initial);
    return typeof initial === 'function' ? (initial as () => S)() : initial;
  });
  const dispatchRef = useRef<((action: A) => void) | null>(null);
  const reducerRef = useRef(reducer);
  reducerRef.current = reducer;
  if (!dispatchRef.current) {
    dispatchRef.current = (action: A) => {
      const latest = reducerRef.current;
      setState((prev) => latest(prev, action));
    };
  }
  return [state, dispatchRef.current];
}

interface LayoutEffectEntry {
  inst: ComponentInstance;
  fn: () => (() => void) | void;
  oldCleanup?: (() => void);
  cleanupIdx: number;
  depsIdx: number;
  oldDeps: any[] | undefined;
}

const pendingLayoutEffects: LayoutEffectEntry[] = [];

export function useLayoutEffect(fn: () => (() => void) | void, deps?: any[]) {
  const inst = getInstance();
  const depsIdx = inst.hookIndex++;
  const cleanupIdx = inst.hookIndex++;

  const oldDeps = inst.hookStates[depsIdx] as any[] | undefined;
  let changed = true;

  if (oldDeps !== undefined && deps !== undefined) {
    changed = deps.length !== oldDeps.length || deps.some((d, i) => !Object.is(d, oldDeps[i]));
  }

  if (changed) {
    const old = inst.hookStates[depsIdx] as any[] | undefined;
    inst.hookStates[depsIdx] = deps ? [...deps] : deps;
    pendingLayoutEffects.push({
      inst,
      fn,
      oldCleanup: inst.hookStates[cleanupIdx] as (() => void) | undefined,
      cleanupIdx,
      depsIdx,
      oldDeps: old,
    });
  }
}

export function flushLayoutEffects() {
  while (pendingLayoutEffects.length > 0) {
    const head = pendingLayoutEffects[0];
    if (hasNewerEntry(pendingLayoutEffects, 1, head.inst, head.cleanupIdx)) {
      pendingLayoutEffects.shift();
      continue;
    }
    const { inst, fn, oldCleanup, cleanupIdx } = pendingLayoutEffects.shift()!;
    if (!inst._mounted) continue;
    if (oldCleanup) {
      try { oldCleanup(); } catch (e) { log.error('useLayoutEffect cleanup error:', e); }
      const ci = inst.unmountCleanups.indexOf(oldCleanup);
      if (ci !== -1) inst.unmountCleanups.splice(ci, 1);
    }
    let cleanup: (() => void) | void;
    try {
      cleanup = fn();
    } catch (e) {
      log.error('useLayoutEffect error:', e);
      cleanup = undefined;
    }
    inst.hookStates[cleanupIdx] = typeof cleanup === 'function' ? cleanup : undefined;
    if (typeof cleanup === 'function') {
      inst.unmountCleanups.push(cleanup);
    }
  }
}

export function purgeDeadEffects(): void {
  for (let i = pendingEffects.length - 1; i >= 0; i--) {
    if (!pendingEffects[i].inst._mounted) pendingEffects.splice(i, 1);
  }
  for (let i = pendingLayoutEffects.length - 1; i >= 0; i--) {
    if (!pendingLayoutEffects[i].inst._mounted) pendingLayoutEffects.splice(i, 1);
  }
}

export function useSyncExternalStore<T>(
  subscribe: (onChange: () => void) => () => void,
  getSnapshot: () => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const inst = getInstance();
  const nextSnapshot = getSnapshot();
  const [, setTick] = useState(0);
  const ref = useRef<{ snapshot: T; getSnapshot: () => T }>({ snapshot: nextSnapshot, getSnapshot });
  if (!isEqual(ref.current.snapshot, nextSnapshot)) ref.current.snapshot = nextSnapshot;
  ref.current.getSnapshot = getSnapshot;
  void inst;
  useEffect(() => {
    const check = () => {
      const next = ref.current.getSnapshot();
      if (!isEqual(ref.current.snapshot, next)) {
        ref.current.snapshot = next;
        setTick((t) => t + 1);
      }
    };
    check();
    return subscribe(check);
  }, [subscribe, getSnapshot]);
  return ref.current.snapshot;
}

export interface SelectorStore<S> {
  subscribe: (onChange: () => void) => () => void;
  getState: () => S;
}

export function useSelector<S, T>(
  store: SelectorStore<S>,
  selector: (state: S) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const selected = selector(store.getState());
  const ref = useRef<{ value: T; selector: typeof selector; isEqual: typeof isEqual }>({
    value: selected,
    selector,
    isEqual,
  });
  ref.current.selector = selector;
  ref.current.isEqual = isEqual;
  if (!ref.current.isEqual(ref.current.value, selected)) {
    ref.current.value = selected;
  }
  const getSnapshot = useCallback(() => {
    const next = ref.current.selector(store.getState());
    if (!ref.current.isEqual(ref.current.value, next)) {
      ref.current.value = next;
    }
    return ref.current.value;
  }, [store]);
  const checkEqual = useCallback((a: T, b: T) => ref.current.isEqual(a, b), []);
  useSyncExternalStore(store.subscribe, getSnapshot, checkEqual);
  return ref.current.value;
}
