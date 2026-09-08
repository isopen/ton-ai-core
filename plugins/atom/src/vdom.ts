export const TEXT = 'TEXT_NODE';
export const FRAGMENT = 'FRAGMENT_NODE';
export const SLOT = 'SLOT_NODE';
export const SLOTTABLE = 'SLOTTABLE_NODE';
export const PORTAL = 'PORTAL_NODE';

export interface BoundaryFrame {
  instance: ComponentInstance;
  kind: 'error' | 'suspense';
  handle: (thrown: any) => boolean;
  renderFallback: () => VNode | null;
}

export const boundaryStack: BoundaryFrame[] = [];

export function takeBoundaryFrame(instance: ComponentInstance): BoundaryFrame | null {
  const frame = (instance as any).__atomBoundary as BoundaryFrame | undefined;
  if (!frame) return null;
  delete (instance as any).__atomBoundary;
  frame.instance = instance;
  return frame;
}

export type ComponentType = (props: Record<string, any>) => VNode;

export interface VNode {
  type: string | ComponentType | typeof TEXT | typeof FRAGMENT | typeof PORTAL;
  props: Record<string, any>;
  children: VNode[];
  key: string | number | null;
  dom?: Node | null;
  componentInstance?: ComponentInstance | null;
}

import { getLogger } from '@ton-ai/gram-debug';
import { isDevWarnings } from './dev.js';

const log = getLogger('atom');

export class ComponentInstance {
  hookStates: any[] = [];
  hookIndex: number = 0;
  component: ComponentType;
  props: Record<string, any>;
  cleanupFns: (() => void)[] = [];
  vnode: VNode | null = null;
  unmountCleanups: (() => void)[] = [];
  pendingEffects: Array<{ fn: () => (() => void) | void; oldCleanup?: (() => void); cleanupIdx: number }> = [];
  displayName: string;
  _dirty: boolean = false;
  _mounted: boolean = true;

  rootRef?: unknown;
  hookCount: number = -1;

  constructor(component: ComponentType, props: Record<string, any>) {
    this.component = component;
    this.props = props;
    this.displayName = (component as any).displayName || component.name || '(anonymous)';
  }

  render(): VNode {
    setCurrentInstance(this);
    this.hookIndex = 0;
    try {
      const vnode = this.component(this.props);
      if (isDevWarnings() && this.hookCount !== -1 && this.hookIndex !== this.hookCount) {
        log.warn('[atom] hook count changed in ' + this.displayName + ': was ' + this.hookCount + ', now ' + this.hookIndex);
      }
      this.hookCount = this.hookIndex;
      return vnode;
    } finally {
      setCurrentInstance(null);
    }
  }
}

export let currentInstance: ComponentInstance | null = null;

export function setCurrentInstance(inst: ComponentInstance | null) {
  currentInstance = inst;
}

let mountRoot: unknown = null;

export function setMountRoot(root: unknown): void {
  mountRoot = root;
}

export function getMountRoot(): unknown {
  return mountRoot;
}

const MEMO_CACHE = new WeakMap<ComponentInstance, { props: Record<string, any>; vnode: VNode; hookCount: number }>();

function hasDirtySubtree(vnode: VNode | null): boolean {
  if (!vnode) return false;
  if (typeof vnode.type === 'function') {
    const child = vnode.componentInstance;
    if (!child) return false;
    if (child._dirty) return true;
    return hasDirtySubtree(child.vnode);
  }
  for (const child of vnode.children) {
    if (hasDirtySubtree(child)) return true;
  }
  return false;
}

export type MemoCompare = (prevProps: Record<string, any>, nextProps: Record<string, any>) => boolean;

export function memo(component: ComponentType, areEqual?: MemoCompare): ComponentType {
  const wrapped: ComponentType = (props) => {
    const inst = currentInstance;
    if (!inst) return component(props);

    const cached = MEMO_CACHE.get(inst);
    if (cached && !inst._dirty && !hasDirtySubtree(cached.vnode)) {
      const same = areEqual ? areEqual(cached.props, props) : shallowEqual(cached.props, props);
      if (same) {
        inst.hookIndex = cached.hookCount ?? 0;
        return cached.vnode;
      }
    }
    const vnode = component(props);
    MEMO_CACHE.set(inst, { props, vnode, hookCount: inst.hookIndex });
    return vnode;
  };
  (wrapped as any).displayName = (component as any).displayName || component.name || '(memo)';
  return wrapped;
}

function shallowEqual(a: Record<string, any>, b: Record<string, any>): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

export function normalizeChild(child: any): VNode | null {
  if (child == null || child === false || child === true) return null;
  if (typeof child === 'string' || typeof child === 'number') {
    return { type: TEXT, props: { nodeValue: String(child) }, children: [], key: null };
  }

  if (typeof child === 'object' && !child.type) {
    if (typeof console !== 'undefined') {
      console.warn('[atom] non-vnode object in children rendered as text:', Object.keys(child).join(','));
    }
    return { type: TEXT, props: { nodeValue: String(child.text ?? '') }, children: [], key: null };
  }
  return child as VNode;
}

export function normalizeChildren(children: any): VNode[] {
  if (children == null || children === false || children === true) return [];
  if (!Array.isArray(children)) children = [children];
  const result: VNode[] = [];
  for (const child of children) {
    if (Array.isArray(child)) {
      result.push(...normalizeChildren(child));
    } else {
      const n = normalizeChild(child);
      if (n) result.push(n);
    }
  }
  return result;
}
