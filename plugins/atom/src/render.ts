import { getLogger } from '@ton-ai/gram-debug';
import { ComponentInstance, setMountRoot, PORTAL, SLOT, type VNode, type ComponentType } from './vdom.js';
import { __setReroot, flushAllEffects, flushLayoutEffects, snapshotEffectQueues, rollbackEffectQueues, purgeDeadEffects } from './hooks.js';
import { snapshotContextQueue, rollbackContextQueue, flushPendingContexts, resetRenderCursor } from './context.js';
import { createDOM, patch, flushPendingRefs, removePortalNodes, dropPendingRefsFor } from './reconciler.js';
import { inTransition, drainTransitionSettled, setTransitionFlusher, setTransitionDiscarder, getTransitionGen } from './scheduler.js';

const log = getLogger('atom');

interface RootData {
  instance: ComponentInstance;
  oldVNode: VNode;
  container: HTMLElement;
  rootDom: Node;
  retried?: boolean;
  tgen?: number;
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
  if (inTransition()) {
    rd.tgen = getTransitionGen();
    transitionRoots.add(rd);
    scheduleTransitionFlush();
    return;
  }
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

const transitionRoots = new Set<RootData>();
let transitionScheduled = false;

function scheduleTransitionFlush() {
  if (transitionScheduled) return;
  transitionScheduled = true;
  const run = () => {
    transitionScheduled = false;
    flushTransitionRoots();
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else setTimeout(run, 16);
}

function flushTransitionRoots() {
  const list = [...transitionRoots];
  transitionRoots.clear();
  for (const rd of list) flushRenderInternal(rd);
  drainTransitionSettled();
}

setTransitionFlusher(scheduleTransitionFlush);
setTransitionDiscarder((gen: number) => {
  for (const rd of [...transitionRoots]) {
    if (rd.tgen === gen) transitionRoots.delete(rd);
  }
});

function flushPending() {
  renderScheduled = false;
  rafId = null;
  const list = pendingRoots ? [...pendingRoots] : [];
  pendingRoots = null;
  for (const rd of list) flushRenderInternal(rd);
}

function flushRenderInternal(rd: RootData) {
  resetRenderCursor();
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

  const fxSnap = snapshotEffectQueues();
  const ctxSnap = snapshotContextQueue();
  let newVNode: VNode;
  try {
    instance.props = {};
    newVNode = instance.render();
  } catch (e) {
    log.error('[atom] render error in ' + instance.displayName + ' — keeping previous DOM:', e);
    rollbackEffectQueues(fxSnap);
    rollbackContextQueue(ctxSnap);
    if (!rd.retried) {
      rd.retried = true;
      instance._dirty = true;
      scheduleFlush(rd);
    } else {
      rd.retried = false;
      instance._dirty = false;
    }
    return;
  }

  try {
    if (rootDom && oldVNode) {
      setMountRoot(rd);
      rd.rootDom = patch(rootDom, oldVNode, newVNode);
      flushPendingRefs();
    }
  } catch (e) {
    log.error('[atom] patch error in ' + instance.displayName + ' — keeping previous tree:', e);
    rollbackEffectQueues(fxSnap);
    rollbackContextQueue(ctxSnap);
    if (!rd.retried) {
      rd.retried = true;
      instance._dirty = true;
      scheduleFlush(rd);
    } else {
      rd.retried = false;
      instance._dirty = false;
    }
    return;
  } finally {
    setMountRoot(null);
  }
  rd.retried = false;
  instance._dirty = false;
  instance.vnode = newVNode;
  rd.oldVNode = newVNode;

  flushPendingContexts();
  flushLayoutEffects();
  flushAllEffects();
}

export function flushRender(rd?: RootData): void {
  const target = rd ?? defaultRoot;
  if (!target) return;
  flushRenderInternal(target);
}

export function render(component: ComponentType, container: HTMLElement): Node {
  resetRenderCursor();
  const existing = roots.get(container);
  if (existing) {
    log.warn('[atom] render() on an already-mounted container — unmounting previous tree');
    unmountRoot(container);
  }

  const instance = new ComponentInstance(component, {});
  const fxSnap = snapshotEffectQueues();
  const ctxSnap = snapshotContextQueue();
  let vnode: VNode;
  try {
    vnode = instance.render();
  } catch (e) {
    rollbackEffectQueues(fxSnap);
    rollbackContextQueue(ctxSnap);
    throw e;
  }
  instance.vnode = vnode;
  const rd: RootData = { instance, oldVNode: vnode, container, rootDom: null as unknown as Node };
  instance.rootRef = rd;
  setMountRoot(rd);
  let dom: Node;
  try {
    dom = createDOM(vnode);
  } catch (e) {
    rollbackEffectQueues(fxSnap);
    rollbackContextQueue(ctxSnap);
    throw e;
  } finally {
    setMountRoot(null);
  }
  container.appendChild(dom);
  flushPendingRefs();
  rd.rootDom = dom;
  roots.set(container, rd);

  defaultRoot = rd;

  __setReroot((inst) => {
    if (inst && !inst._mounted) return;
    const target = (inst?.rootRef as RootData | undefined) ?? defaultRoot;
    if (!target) return;
    for (const rd of roots.values()) {
      if (rd === target) {
        scheduleFlush(target);
        return;
      }
    }
  });

  flushPendingContexts();
  flushLayoutEffects();
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
  if (pendingRoots) pendingRoots.delete(rd);
  transitionRoots.delete(rd);
  const inst = rd.instance;
  inst._mounted = false;
  inst.rootRef = undefined;
  for (const fn of inst.unmountCleanups) {
    try { fn(); } catch (e) { log.error('[atom] unmount cleanup error:', e); }
  }
  inst.unmountCleanups.length = 0;
  runUnmountTree(rd.instance.vnode);
  purgeDeadEffects();
  if (rd.rootDom && rd.rootDom.parentNode) {
    rd.rootDom.parentNode.removeChild(rd.rootDom);
  }
}

function runUnmountTree(vnode: VNode | null): void {
  if (!vnode) return;
  if (vnode.type === PORTAL) {
    for (const child of vnode.children) runUnmountTree(child);
    removePortalNodes(vnode);
    return;
  }
  const inst = typeof vnode.type === 'function' ? vnode.componentInstance : undefined;
  if (inst) {
    inst._mounted = false;
    inst.rootRef = undefined;
    try {
      const ref = (vnode as VNode).props.ref;
      if (typeof ref === 'function') ref(null);
      else if (ref && typeof ref === 'object') (ref as any).current = null;
    } catch (e) { log.error('[atom] unmount ref release error:', e); }
    for (const fn of inst.unmountCleanups) {
      try { fn(); } catch (e) { log.error('[atom] unmount cleanup error:', e); }
    }
    inst.unmountCleanups.length = 0;

    if (inst.vnode && inst.vnode !== vnode) {
      runUnmountTree(inst.vnode);
    }
    return;
  }
  if (vnode.type === SLOT) {
    const resolved = (vnode as any).__resolved as VNode | undefined;
    if (resolved) {
      runUnmountTree(resolved);
      return;
    }
  }
  if (typeof vnode.type === 'string' && vnode.props && vnode.props.ref != null) {
    const dom = vnode.dom as Element | undefined;
    if (dom) {
      dropPendingRefsFor(dom);
      try {
        const ref = vnode.props.ref;
        if (typeof ref === 'function') ref(null);
        else if (typeof ref === 'object') ref.current = null;
      } catch (e) { log.error('[atom] unmount ref release error:', e); }
    }
  }
  for (const child of vnode.children) runUnmountTree(child);
}

function inspectTree(inst?: ComponentInstance): any {
  if (!inst) return { name: '(no root)', props: {}, state: [], children: [] };
  const children: any[] = [];
  const walk = (vnode: VNode) => {
    for (const child of vnode.children) {
      if (typeof child.type === 'function' && child.componentInstance) {
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
