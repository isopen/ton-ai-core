import { getLogger } from '@ton-ai/gram-debug';
import { currentInstance, type ComponentInstance } from './vdom.js';

const log = getLogger('atom');

let reroot: ((inst?: ComponentInstance) => void) | null = null;

const pendingEffects: Array<{ inst: ComponentInstance; fn: () => (() => void) | void; oldCleanup?: (() => void); cleanupIdx: number }> = [];

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
    inst.hookStates[idx] = typeof initial === 'function' ? (initial as () => T)() : initial;
  }

  const setState = (v: T | ((prev: T) => T)) => {
    const newVal = typeof v === 'function' ? (v as (prev: T) => T)(inst.hookStates[idx]) : v;
    if (newVal !== inst.hookStates[idx]) {
      inst.hookStates[idx] = newVal;
      inst._dirty = true;
      reroot?.(inst);
    }
  };

  return [inst.hookStates[idx] as T, setState];
}

export function useEffect(fn: () => (() => void) | void, deps?: any[]) {
  const inst = getInstance();
  const depsIdx = inst.hookIndex++;
  const cleanupIdx = inst.hookIndex++;

  const oldDeps = inst.hookStates[depsIdx] as any[] | undefined;
  let changed = true;

  if (oldDeps !== undefined && deps !== undefined) {
    changed = deps.length !== oldDeps.length || deps.some((d, i) => d !== oldDeps[i]);
  }

  if (changed) {
    inst.hookStates[depsIdx] = deps;
    pendingEffects.push({
      inst,
      fn,
      oldCleanup: inst.hookStates[cleanupIdx] as (() => void) | undefined,
      cleanupIdx,
    });
  }
}

export function flushAllEffects() {
  while (pendingEffects.length > 0) {
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
    inst.hookStates[idx] = { current: initial };
  }

  return inst.hookStates[idx] as { current: T };
}

export function useMemo<T>(fn: () => T, deps: any[]): T {
  const inst = getInstance();
  const idx = inst.hookIndex++;

  const oldDeps = inst.hookStates[idx] as { deps: any[]; value: T } | undefined;
  let changed = true;

  if (oldDeps !== undefined) {
    changed = deps.length !== oldDeps.deps.length || deps.some((d, i) => d !== oldDeps.deps[i]);
  }

  if (changed) {
    const value = fn();
    inst.hookStates[idx] = { deps, value };
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
  useEffect(() => {
    const t = typeof target === 'function' ? target() : target;
    if (!t || !handler || typeof (t as any).addEventListener !== 'function') return;
    t.addEventListener(type, handler, options);
    return () => t.removeEventListener(type, handler, options);
  }, deps);
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
  if (!dispatchRef.current) {
    dispatchRef.current = (action: A) => {
      setState((prev) => reducer(prev, action));
    };
  }
  return [state, dispatchRef.current];
}

interface LayoutEffectEntry {
  inst: ComponentInstance;
  fn: () => (() => void) | void;
  oldCleanup?: (() => void);
  cleanupIdx: number;
}

const pendingLayoutEffects: LayoutEffectEntry[] = [];

export function useLayoutEffect(fn: () => (() => void) | void, deps?: any[]) {
  const inst = getInstance();
  const depsIdx = inst.hookIndex++;
  const cleanupIdx = inst.hookIndex++;

  const oldDeps = inst.hookStates[depsIdx] as any[] | undefined;
  let changed = true;

  if (oldDeps !== undefined && deps !== undefined) {
    changed = deps.length !== oldDeps.length || deps.some((d, i) => d !== oldDeps[i]);
  }

  if (changed) {
    inst.hookStates[depsIdx] = deps;
    pendingLayoutEffects.push({
      inst,
      fn,
      oldCleanup: inst.hookStates[cleanupIdx] as (() => void) | undefined,
      cleanupIdx,
    });
  }
}

export function flushLayoutEffects() {
  while (pendingLayoutEffects.length > 0) {
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

export function useSyncExternalStore<T>(
  subscribe: (onChange: () => void) => () => void,
  getSnapshot: () => T,
): T {
  const inst = getInstance();
  const snapshot = getSnapshot();
  const [, setTick] = useState(0);
  const ref = useRef<{ snapshot: T; getSnapshot: () => T }>({ snapshot, getSnapshot });
  ref.current.snapshot = snapshot;
  ref.current.getSnapshot = getSnapshot;
  void inst;
  useEffect(() => {
    const check = () => {
      const next = ref.current.getSnapshot();
      if (!Object.is(ref.current.snapshot, next)) {
        ref.current.snapshot = next;
        setTick((t) => t + 1);
      }
    };
    check();
    return subscribe(check);
  }, [subscribe]);
  return snapshot;
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
  useSyncExternalStore(store.subscribe, getSnapshot);
  return ref.current.value;
}
