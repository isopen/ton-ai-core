import { getLogger } from '@ton-ai/gram-debug';
import { ComponentInstance, setMountRoot, type VNode, type ComponentType } from './vdom.js';
import { __setReroot, flushAllEffects } from './hooks.js';
import { createDOM, patch, flushPendingRefs } from './reconciler.js';

const log = getLogger('atom');

interface RootData {
  instance: ComponentInstance;
  oldVNode: VNode;
  container: HTMLElement;
  rootDom: Node;
}

const roots = new Map<HTMLElement, RootData>();
let defaultRoot: RootData | null = null;
let pendingRoots: Set<RootData> | null = null;
let renderScheduled = false;
let rafId: number | null = null;
let useRafBatching = false;

const MAX_SAME_TASK_RENDERS = 500;
const SAME_TASK_WINDOW_MS = 1000;
let sameTaskRenders = 0;
let sameTaskWindowStart = 0;
let runawayLoggedAt = 0;

export function setUseRafBatching(v: boolean) {
  useRafBatching = v;
}

function scheduleFlush(rd: RootData) {
  if (!pendingRoots) pendingRoots = new Set();
  pendingRoots.add(rd);
  if (renderScheduled) return;
  renderScheduled = true;
  if (useRafBatching) {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(flushPending);
  } else {
    queueMicrotask(flushPending);
  }
}

function flushPending() {
  renderScheduled = false;
  rafId = null;
  const list = pendingRoots ? [...pendingRoots] : [];
  pendingRoots = null;
  for (const rd of list) flushRenderInternal(rd);
}

function flushRenderInternal(rd: RootData) {
  const now = Date.now();
  if (now - sameTaskWindowStart > SAME_TASK_WINDOW_MS) {
    sameTaskWindowStart = now;
    sameTaskRenders = 0;
  }
  if (++sameTaskRenders > MAX_SAME_TASK_RENDERS) {
    if (now - runawayLoggedAt > 5000) {
      runawayLoggedAt = now;
      log.error('[atom] runaway render loop detected (> ' + MAX_SAME_TASK_RENDERS + ' renders/s) — suspending scheduling. Check for setState-in-render/effect loops in:', rd.instance.displayName);
    }
    rd.instance._dirty = false;
    return;
  }

  const { instance, oldVNode, rootDom } = rd;

  let newVNode: VNode;
  try {
    instance.props = {};
    newVNode = instance.render();
  } catch (e) {
    log.error('[atom] render error in ' + instance.displayName + ' — keeping previous DOM:', e);
    instance._dirty = false;
    return;
  }
  instance._dirty = false;
  instance.vnode = newVNode;
  newVNode.componentInstance = instance;

  try {
    if (rootDom && oldVNode) {
      setMountRoot(rd);
      rd.rootDom = patch(rootDom, oldVNode, newVNode);
      flushPendingRefs();
    }
  } catch (e) {
    log.error('[atom] patch error in ' + instance.displayName + ' — keeping previous tree:', e);
    return;
  } finally {
    setMountRoot(null);
  }
  rd.oldVNode = newVNode;

  flushAllEffects();
}

export function flushRender(rd?: RootData): void {
  const target = rd ?? defaultRoot;
  if (!target) return;
  flushRenderInternal(target);
}

export function render(component: ComponentType, container: HTMLElement): Node {
  const existing = roots.get(container);
  if (existing) {
    log.warn('[atom] render() on an already-mounted container — unmounting previous tree');
    unmountRoot(container);
  }

  const instance = new ComponentInstance(component, {});
  const vnode = instance.render();
  instance.vnode = vnode;
  vnode.componentInstance = instance;
  const rd: RootData = { instance, oldVNode: vnode, container, rootDom: null as unknown as Node };
  instance.rootRef = rd;
  setMountRoot(rd);
  let dom: Node;
  try {
    dom = createDOM(vnode);
  } finally {
    setMountRoot(null);
  }
  container.appendChild(dom);
  flushPendingRefs();
  rd.rootDom = dom;
  roots.set(container, rd);

  defaultRoot = rd;

  __setReroot((inst) => {
    const target = (inst?.rootRef as RootData | undefined) ?? defaultRoot;
    if (target) scheduleFlush(target);
  });

  flushAllEffects();

  if (typeof window !== 'undefined') {
    (window as any).__ATOM_DEVTOOLS__ = {
      getRoot: () => defaultRoot?.instance || null,
      inspect: (inst?: ComponentInstance) => inspectTree(inst ?? defaultRoot?.instance),
      getRoots: () => [...roots.values()].map((r) => r.instance),
    };
  }

  const handle = { rerender: () => scheduleFlush(rd), unmount: () => unmountRoot(container), container };

  (dom as any).__atomRoot = handle;
  return dom;
}

function unmountRoot(container: HTMLElement): void {
  const rd = roots.get(container);
  if (!rd) return;
  roots.delete(container);
  if (defaultRoot === rd) defaultRoot = null;
  runUnmountTree(rd.instance.vnode);
  if (rd.rootDom && rd.rootDom.parentNode) {
    rd.rootDom.parentNode.removeChild(rd.rootDom);
  }
}

function runUnmountTree(vnode: VNode | null): void {
  if (!vnode) return;
  const inst = vnode.componentInstance;
  if (inst) {
    inst._mounted = false;
    for (const fn of inst.unmountCleanups) {
      try { fn(); } catch (e) { log.error('[atom] unmount cleanup error:', e); }
    }
    inst.unmountCleanups.length = 0;

    if (inst.vnode) {
      for (const child of inst.vnode.children) runUnmountTree(child);
    }
    return;
  }
  for (const child of vnode.children) runUnmountTree(child);
}

function inspectTree(inst?: ComponentInstance): any {
  if (!inst) return { name: '(no root)', props: {}, state: [], children: [] };
  const children: any[] = [];
  const walk = (vnode: VNode) => {
    for (const child of vnode.children) {
      if (child.componentInstance) {
        children.push(inspectTree(child.componentInstance));
      }
      walk(child);
    }
  };
  if (inst.vnode) walk(inst.vnode);
  return {
    name: inst.displayName,
    props: inst.props,
    state: [...inst.hookStates],
    children,
  };
}
