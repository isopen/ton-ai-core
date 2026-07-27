import { currentInstance, type ComponentInstance } from './vdom.js';

let reroot: (() => void) | null = null;

export function __setReroot(fn: () => void) {
  reroot = fn;
}

function getInstance(): ComponentInstance {
  if (!currentInstance) throw new Error('Hooks must be called within a component');
  return currentInstance;
}

export function useState<T>(initial: T): [T, (v: T | ((prev: T) => T)) => void] {
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
      if (reroot) reroot();
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
    const oldCleanup = inst.hookStates[cleanupIdx] as (() => void) | undefined;
    if (oldCleanup) {
      try { oldCleanup(); } catch (e) { console.error('useEffect cleanup error:', e); }
      const ci = inst.unmountCleanups.indexOf(oldCleanup);
      if (ci !== -1) inst.unmountCleanups.splice(ci, 1);
    }
    inst.hookStates[depsIdx] = deps;
    const cleanup = fn();
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
