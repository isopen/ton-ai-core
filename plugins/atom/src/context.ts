import { currentInstance, FRAGMENT, normalizeChildren, type ComponentType, type VNode } from './vdom.js';
import { useEffect, useState, useRef } from './hooks.js';

export interface AtomContext<T> {
  Provider: ComponentType;
  defaultValue: T;
  _current: T;
  _version: number;
  _subs: Set<() => void>;
}

const pendingCtx = new Map<AtomContext<any>, unknown>();

export function snapshotContextQueue(): number {
  return pendingCtx.size;
}

export function rollbackContextQueue(snap: number): void {
  if (pendingCtx.size === snap) return;
  const keys = [...pendingCtx.keys()];
  for (let i = snap; i < keys.length; i++) pendingCtx.delete(keys[i]);
}

export function flushPendingContexts(): void {
  if (pendingCtx.size === 0) return;
  const entries = [...pendingCtx.entries()];
  pendingCtx.clear();
  for (const [ctx] of entries) {
    ctx._version++;
  }
  for (const [ctx] of entries) {
    const subs = [...ctx._subs];
    for (const cb of subs) {
      try { cb(); } catch {}
    }
  }
}

export function createContext<T>(defaultValue: T): AtomContext<T> {
  const ctx: AtomContext<T> = {
    defaultValue,
    _current: defaultValue,
    _version: 0,
    _subs: new Set(),
    Provider: (props: Record<string, any>): VNode => {
      const prev = ctx._current;
      const inst = currentInstance;
      if (inst) {
        const stack = ((inst as any).__atomProvidesStack ??= []) as Array<{ ctx: AtomContext<any>; prev: unknown }>;
        stack.push({ ctx, prev });
      }
      ctx._current = props.value;
      const hadLast = !!inst && '__atomLastValue' in (inst as any);
      const last = hadLast ? (inst as any).__atomLastValue : undefined;
      if (!hadLast || !Object.is(last, props.value)) {
        if (inst) (inst as any).__atomLastValue = props.value;
        pendingCtx.set(ctx, props.value);
      }
      return { type: FRAGMENT, props: {}, children: normalizeChildren(props.children), key: null };
    },
  };
  return ctx;
}

export function useContext<T>(ctx: AtomContext<T>): T {
  const [, setTick] = useState(0);
  const lastVersion = useRef(ctx._version);
  lastVersion.current = ctx._version;
  const value = ctx._current;
  useEffect(() => {
    const onNotify = () => {
      if (lastVersion.current !== ctx._version) {
        lastVersion.current = ctx._version;
        setTick((t) => t + 1);
      }
    };
    ctx._subs.add(onNotify);
    return () => {
      ctx._subs.delete(onNotify);
    };
  }, [ctx]);
  return value;
}
