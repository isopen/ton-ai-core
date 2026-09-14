import { currentInstance, clearBoundaryFrame, normalizeChild, normalizeChildren, FRAGMENT, type ComponentInstance, type VNode } from './vdom.js';
import { requestRerender } from './hooks.js';

interface SuspenseState {
  pending: Promise<any> | null;
  pendingEpoch: number;
  error: any;
  hasError: boolean;
  errorEpoch: number;
}

let suspendEpoch = 0;

function stateOf(inst: any): SuspenseState {
  if (!inst.__atomSuspenseState) inst.__atomSuspenseState = { pending: null, pendingEpoch: suspendEpoch, error: null, hasError: false, errorEpoch: suspendEpoch };
  return inst.__atomSuspenseState as SuspenseState;
}

export interface SuspenseProps {
  fallback: any;
  children?: any;
}

export function Suspense(props: SuspenseProps): VNode | null {
  const inst = currentInstance;
  if (!inst) return normalizeChild(props.children);
  const st = stateOf(inst);
  if (st.hasError) {
    if (st.errorEpoch !== suspendEpoch) {
      st.hasError = false;
      st.error = null;
    } else {
      clearBoundaryFrame(inst);
      throw st.error;
    }
  }
  if (st.pending) {
    if (st.pendingEpoch !== suspendEpoch) {
      st.pending = null;
    } else {
      clearBoundaryFrame(inst);
      return normalizeChild(props.fallback);
    }
  }
  (inst as any).__atomBoundary = {
    kind: 'suspense',
    handle: (thrown: any) => {
      if (!thrown || typeof thrown.then !== 'function') return false;
      if (st.pending !== thrown) {
        st.pending = thrown;
        st.pendingEpoch = suspendEpoch;
        thrown.then(
          () => {
            if (st.pending === thrown) {
              st.pending = null;
              requestRerender(inst);
            }
          },
          (err: any) => {
            if (st.pending === thrown) {
              st.pending = null;
              st.hasError = true;
              st.error = err;
              st.errorEpoch = suspendEpoch;
              requestRerender(inst);
            }
          },
        );
      }
      return true;
    },
    renderFallback: () => normalizeChild(props.fallback),
  };
  return { type: FRAGMENT, props: {}, children: normalizeChildren(props.children), key: null };
}

interface SuspendEntry {
  status: 'pending' | 'ok' | 'fail';
  value?: any;
  error?: any;
  promise?: Promise<any>;
  owners?: Set<ComponentInstance | null>;
}

const suspendCache = new Map<string, SuspendEntry>();

const SUSPEND_CACHE_LIMIT = 500;

function suspendTouch(key: string, entry: SuspendEntry): void {
  suspendCache.delete(key);
  suspendCache.set(key, entry);
}

function suspendSet(key: string, entry: SuspendEntry): void {
  suspendCache.set(key, entry);
  if (suspendCache.size > SUSPEND_CACHE_LIMIT) {
    const oldest = suspendCache.keys().next();
    if (!oldest.done && oldest.value !== key) suspendCache.delete(oldest.value);
  }
}

function rerenderOwners(key: string): void {
  const owners = suspendCache.get(key)?.owners;
  if (!owners || owners.size === 0) return;
  const wake = [...owners];
  owners.clear();
  for (const owner of wake) {
    try {
      requestRerender(owner ?? undefined);
    } catch {}
  }
}

export function suspend<T>(key: string, loader: () => Promise<T>): T {
  const owner: ComponentInstance | null = currentInstance;
  const entry = suspendCache.get(key);
  if (entry) {
    suspendTouch(key, entry);
    if (entry.status === 'pending') {
      (entry.owners ??= new Set()).add(owner);
    }
    if (entry.status === 'ok') return entry.value as T;
    if (entry.status === 'fail') throw entry.error;
    throw entry.promise;
  }
  let raw: Promise<T>;
  try {
    raw = loader();
  } catch (error) {
    suspendSet(key, { status: 'fail', error });
    throw error;
  }
  raw.then(
    (value: T) => {
      if (suspendCache.get(key)?.promise !== raw) return;
      suspendSet(key, { status: 'ok', value, owners: suspendCache.get(key)?.owners });
      rerenderOwners(key);
    },
    (error: any) => {
      if (suspendCache.get(key)?.promise !== raw) return;
      suspendSet(key, { status: 'fail', error, owners: suspendCache.get(key)?.owners });
      rerenderOwners(key);
    },
  );
  suspendSet(key, { status: 'pending', promise: raw, owners: new Set([owner]) });
  throw raw;
}

export function clearSuspended(key?: string): void {
  if (key === undefined) suspendCache.clear();
  else suspendCache.delete(key);
  suspendEpoch++;
}
