export const TEXT = 'TEXT_NODE';
export const FRAGMENT = 'FRAGMENT_NODE';
export const SLOT = 'SLOT_NODE';
export const SLOTTABLE = 'SLOTTABLE_NODE';

export type ComponentType = (props: Record<string, any>) => VNode;

export interface VNode {
  type: string | ComponentType | typeof TEXT | typeof FRAGMENT;
  props: Record<string, any>;
  children: VNode[];
  key: string | number | null;
  dom?: Node | null;
  componentInstance?: ComponentInstance | null;
}

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
  // Root this instance belongs to (assigned by render.ts for top-level
  // instances; nested instances fall back to the default root on setState).
  rootRef?: unknown;

  constructor(component: ComponentType, props: Record<string, any>) {
    this.component = component;
    this.props = props;
    this.displayName = (component as any).displayName || component.name || '(anonymous)';
  }

  render(): VNode {
    setCurrentInstance(this);
    this.hookIndex = 0;
    try {
      return this.component(this.props);
    } finally {
      // Hooks called outside a render must never silently attach to the last
      // rendered component.
      setCurrentInstance(null);
    }
  }
}

export let currentInstance: ComponentInstance | null = null;

export function setCurrentInstance(inst: ComponentInstance | null) {
  currentInstance = inst;
}

// Root currently being mounted/patched. The reconciler stamps every newly
// created ComponentInstance with it so setState inside nested components
// schedules the correct root in multi-root setups.
let mountRoot: unknown = null;

export function setMountRoot(root: unknown): void {
  mountRoot = root;
}

export function getMountRoot(): unknown {
  return mountRoot;
}

const MEMO_CACHE = new WeakMap<ComponentInstance, { props: Record<string, any>; vnode: VNode }>();

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

export function memo(component: ComponentType): ComponentType {
  const wrapped: ComponentType = (props) => {
    const inst = currentInstance;
    if (!inst) return component(props);

    const cached = MEMO_CACHE.get(inst);
    if (cached && !inst._dirty && shallowEqual(cached.props, props) && !hasDirtySubtree(cached.vnode)) {
      return cached.vnode;
    }
    const vnode = component(props);
    MEMO_CACHE.set(inst, { props, vnode });
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
