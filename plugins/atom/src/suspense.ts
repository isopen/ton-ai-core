import { currentInstance, normalizeChild, normalizeChildren, FRAGMENT, type VNode } from './vdom.js';
import { requestRerender } from './hooks.js';

interface SuspenseState {
  pending: Promise<any> | null;
  error: any;
  hasError: boolean;
}

function stateOf(inst: any): SuspenseState {
  if (!inst.__atomSuspenseState) inst.__atomSuspenseState = { pending: null, error: null, hasError: false };
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
  if (st.hasError) throw st.error;
  if (st.pending) return normalizeChild(props.fallback);
  (inst as any).__atomBoundary = {
    kind: 'suspense',
    handle: (thrown: any) => {
      if (!thrown || typeof thrown.then !== 'function') return false;
      if (st.pending !== thrown) {
        st.pending = thrown;
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
}

const suspendCache = new Map<string, SuspendEntry>();

export function suspend<T>(key: string, loader: () => Promise<T>): T {
  const entry = suspendCache.get(key);
  if (entry) {
    if (entry.status === 'ok') return entry.value as T;
    if (entry.status === 'fail') throw entry.error;
    throw entry.promise;
  }
  const raw = loader();
  raw.then(
    (value: T) => {
      suspendCache.set(key, { status: 'ok', value });
    },
    (error: any) => {
      suspendCache.set(key, { status: 'fail', error });
    },
  );
  suspendCache.set(key, { status: 'pending', promise: raw });
  throw raw;
}

export function clearSuspended(key?: string): void {
  if (key === undefined) suspendCache.clear();
  else suspendCache.delete(key);
}
