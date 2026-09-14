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

const renderCursor = new Map<AtomContext<any>, unknown[]>();

export function readRenderValue<T>(ctx: AtomContext<T>): T {
  const stack = renderCursor.get(ctx);
  if (stack && stack.length > 0) return stack[stack.length - 1] as T;
  return ctx.defaultValue;
}

export function pushRenderValue<T>(ctx: AtomContext<T>, value: T): void {
  let stack = renderCursor.get(ctx);
  if (!stack) {
    stack = [];
    renderCursor.set(ctx, stack);
  }
  stack.push(value);
}

export function popRenderValue(ctx: AtomContext<any>): void {
  const stack = renderCursor.get(ctx);
  if (!stack || stack.length === 0) return;
  stack.pop();
  if (stack.length === 0) renderCursor.delete(ctx);
}

export function resetRenderCursor(): void {
  if (renderCursor.size > 0) renderCursor.clear();
}

interface CtxChange {
  ctx: AtomContext<any>;
  value: unknown;
  inst: unknown;
  hadLast: boolean;
  lastOld: unknown;
}

const ctxJournal: CtxChange[] = [];

export function snapshotContextQueue(): number {
  return ctxJournal.length;
}

export function rollbackContextQueue(snap: number): void {
  if (ctxJournal.length <= snap) return;
  const dropped = ctxJournal.splice(snap);
  const restored = new Set<unknown>();
  for (let i = dropped.length - 1; i >= 0; i--) {
    const entry = dropped[i];
    if (entry.inst != null && !restored.has(entry.inst)) {
      restored.add(entry.inst);
      try {
        if (entry.hadLast) (entry.inst as any).__atomLastValue = entry.lastOld;
        else delete (entry.inst as any).__atomLastValue;
      } catch {}
    }
  }
  pendingCtx.clear();
  for (const kept of ctxJournal) pendingCtx.set(kept.ctx, kept.value);
}

export function flushPendingContexts(): void {
  if (pendingCtx.size === 0) {
    ctxJournal.length = 0;
    return;
  }
  const entries = [...pendingCtx.entries()];
  pendingCtx.clear();
  ctxJournal.length = 0;
  const changed: Array<[AtomContext<any>, unknown]> = [];
  for (const [ctx, value] of entries) {
    if (!Object.is(ctx._current, value)) changed.push([ctx, value]);
  }
  for (const [ctx] of changed) {
    ctx._version++;
  }
  for (const [ctx, value] of changed) {
    try {
      ctx._current = value as never;
    } catch {}
  }
  for (const [ctx] of changed) {
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
      const inst = currentInstance;
      if (!inst) return { type: FRAGMENT, props: {}, children: normalizeChildren(props.children), key: null };
      const prev = readRenderValue(ctx);
      const stack = ((inst as any).__atomProvidesStack ??= []) as Array<{ ctx: AtomContext<any>; prev: unknown }>;
      stack.push({ ctx, prev });
      pushRenderValue(ctx, props.value);
      const hadLast = !!inst && '__atomLastValue' in (inst as any);
      const last = hadLast ? (inst as any).__atomLastValue : undefined;
      if (!hadLast || !Object.is(last, props.value)) {
        ctxJournal.push({ ctx, value: props.value, inst: inst ?? null, hadLast, lastOld: last });
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
  const value = readRenderValue(ctx);
  useEffect(() => {
    const onNotify = () => {
      if (lastVersion.current !== ctx._version) {
        lastVersion.current = ctx._version;
        setTick((t) => t + 1);
      }
    };
    ctx._subs.add(onNotify);
    if (lastVersion.current !== ctx._version) {
      lastVersion.current = ctx._version;
      setTick((t) => t + 1);
    }
    return () => {
      ctx._subs.delete(onNotify);
    };
  }, [ctx]);
  return value;
}
