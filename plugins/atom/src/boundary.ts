import { getLogger } from '@ton-ai/gram-debug';
import { currentInstance, normalizeChild, normalizeChildren, FRAGMENT, type VNode } from './vdom.js';

const log = getLogger('atom');

interface BoundaryState {
  hasError: boolean;
  error: any;
  prevKeys?: any[];
}

function stateOf(inst: any): BoundaryState {
  if (!inst.__atomBoundaryState) inst.__atomBoundaryState = { hasError: false, error: null };
  return inst.__atomBoundaryState as BoundaryState;
}

function keysChanged(a?: any[], b?: any[]): boolean {
  if (a === undefined || b === undefined) return a !== b;
  if (a.length !== b.length) return true;
  return a.some((v, i) => !Object.is(v, b[i]));
}

function toFallback(fallback: any, error: any): VNode | null {
  const v = typeof fallback === 'function' ? fallback(error) : fallback;
  return normalizeChild(v);
}

export interface ErrorBoundaryProps {
  fallback: VNode | ((error: any) => VNode | null) | null;
  resetKeys?: any[];
  children?: any;
}

export function ErrorBoundary(props: ErrorBoundaryProps): VNode | null {
  const inst = currentInstance;
  if (!inst) return normalizeChild(props.children);
  const st = stateOf(inst);
  if (props.resetKeys && st.prevKeys && keysChanged(st.prevKeys, props.resetKeys)) {
    st.hasError = false;
    st.error = null;
  }
  st.prevKeys = props.resetKeys;
  if (st.hasError) return toFallback(props.fallback, st.error);
  (inst as any).__atomBoundary = {
    kind: 'error',
    handle: (thrown: any) => {
      if (thrown && typeof thrown.then === 'function') return false;
      st.hasError = true;
      st.error = thrown;
      log.error('[atom] ErrorBoundary caught in ' + inst.displayName + ':', thrown);
      return true;
    },
    renderFallback: () => toFallback(props.fallback, st.error),
  };
  return { type: FRAGMENT, props: {}, children: normalizeChildren(props.children), key: null };
}
