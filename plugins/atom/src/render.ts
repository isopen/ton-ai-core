import { ComponentInstance, setCurrentInstance, type VNode, type ComponentType } from './vdom.js';
import { __setReroot, flushAllEffects } from './hooks.js';
import { createDOM, patch } from './reconciler.js';

interface RootData {
  instance: ComponentInstance;
  oldVNode: VNode;
  container: HTMLElement;
  rootDom: Node;
}

let rootData: RootData | null = null;
let renderScheduled = false;
let rafId: number | null = null;
let useRafBatching = false;

export function setUseRafBatching(v: boolean) {
  useRafBatching = v;
}

export function flushRender() {
  renderScheduled = false;
  rafId = null;
  if (!rootData) return;
  const { instance, oldVNode, rootDom } = rootData;
  instance._dirty = false;
  instance.props = {};
  setCurrentInstance(instance);
  instance.hookIndex = 0;
  const newVNode = instance.component({});
  instance.vnode = newVNode;
  newVNode.componentInstance = instance;

  if (rootDom && oldVNode) {
    rootData.rootDom = patch(rootDom, oldVNode, newVNode);
  }
  rootData.oldVNode = newVNode;

  flushAllEffects();
}

function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  if (useRafBatching) {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(flushRender);
  } else {
    queueMicrotask(flushRender);
  }
}

export function render(component: ComponentType, container: HTMLElement): Node {
  const instance = new ComponentInstance(component, {});
  setCurrentInstance(instance);
  const vnode = instance.render();
  instance.vnode = vnode;
  vnode.componentInstance = instance;
  const dom = createDOM(vnode);
  container.appendChild(dom);

  rootData = { instance, oldVNode: vnode, container, rootDom: dom };

  __setReroot(() => scheduleRender());

  flushAllEffects();

  if (typeof window !== 'undefined') {
    (window as any).__ATOM_DEVTOOLS__ = {
      getRoot: () => rootData?.instance || null,
      inspect: () => inspectTree(instance),
    };
  }

  return dom;
}

function inspectTree(inst: ComponentInstance): any {
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
