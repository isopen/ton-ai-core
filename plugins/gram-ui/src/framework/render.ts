import { ComponentInstance, setCurrentInstance, type VNode, type ComponentType } from './vdom.js';
import { __setReroot } from './hooks.js';
import { createDOM, patch } from './reconciler.js';

interface RootData {
  instance: ComponentInstance;
  oldVNode: VNode;
  container: HTMLElement;
  rootDom: Node;
}

let rootData: RootData | null = null;
let renderScheduled = false;

function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  queueMicrotask(() => {
    renderScheduled = false;
    if (rootData) {
      const { instance, oldVNode, rootDom } = rootData;
      instance.props = {};
      setCurrentInstance(instance);
      instance.hookIndex = 0;
      const newVNode = instance.component({});
      instance.vnode = newVNode;
      newVNode.componentInstance = instance;

      if (rootDom && oldVNode) {
        patch(rootDom, oldVNode, newVNode);
      }
      rootData.oldVNode = newVNode;
    }
  });
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
  return dom;
}
