import { TEXT, FRAGMENT, SLOT, SLOTTABLE, ComponentInstance, setCurrentInstance, type VNode, type ComponentType } from './vdom.js';

function runUnmountCleanups(vnode: VNode) {
  if (vnode.componentInstance) {
    const inst = vnode.componentInstance;
    const cleanups = inst.unmountCleanups;
    for (const fn of cleanups) {
      try { fn(); } catch (e) { console.error('useEffect unmount cleanup error:', e); }
    }
    cleanups.length = 0;
    if (inst.vnode) {
      for (const child of inst.vnode.children) {
        runUnmountCleanups(child);
      }
    }
    return;
  }
  for (const child of vnode.children) {
    runUnmountCleanups(child);
  }
}

const SVG_TAGS = new Set(['svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'g', 'text', 'use', 'defs', 'stop', 'linearGradient', 'radialGradient', 'clipPath', 'mask', 'filter', 'image']);

function isSvgTag(tag: string): boolean {
  return SVG_TAGS.has(tag);
}

function createElementNS(tag: string): Element {
  return document.createElementNS('http://www.w3.org/2000/svg', tag);
}

function createElement(tag: string): Element {
  if (isSvgTag(tag)) return createElementNS(tag);
  return document.createElement(tag);
}

function isEventProp(name: string): boolean {
  return name.startsWith('on');
}

function eventNameFromProp(name: string): string {
  return name.slice(2).toLowerCase();
}

function setProp(el: Element, key: string, value: any) {
  if (key === 'key' || key === 'children') return;
  if (key === 'ref') {
    if (typeof value === 'function') value(el);
    else if (value && typeof value === 'object') value.current = el;
    return;
  }
  if (key === 'class' || key === 'className') {
    el.setAttribute('class', value ?? '');
    return;
  }
  if (key === 'style') {
    if (typeof value === 'string') {
      el.setAttribute('style', value);
    } else if (typeof value === 'object' && value !== null) {
      for (const k in value) {
        (el as HTMLElement).style[k as any] = value[k];
      }
    }
    return;
  }
  if (key === 'dangerouslySetInnerHTML') {
    if (value && value.__html != null) {
      el.innerHTML = value.__html;
    }
    return;
  }
  if (isEventProp(key)) {
    const eventName = eventNameFromProp(key);
    el.addEventListener(eventName, value);
    return;
  }
  if (typeof value === 'boolean') {
    if (value) el.setAttribute(key, '');
    else el.removeAttribute(key);
    return;
  }
  if (key === 'value') {
    const tag = el.tagName;
    if (tag === 'SELECT') {
      requestAnimationFrame(() => { (el as HTMLSelectElement).value = String(value); });
    } else if (tag === 'INPUT' || tag === 'TEXTAREA') {
      (el as HTMLInputElement).value = String(value);
    }
    return;
  }
  if (value === '') {
    el.setAttribute(key, '');
    return;
  }
  if (value != null && value !== false) {
    el.setAttribute(key, String(value));
  }
}

function removeProp(el: Element, key: string, oldValue: any) {
  if (key === 'key' || key === 'children' || key === 'ref') return;
  if (key === 'class' || key === 'className') {
    el.removeAttribute('class');
    return;
  }
  if (key === 'style') {
    el.removeAttribute('style');
    return;
  }
  if (key === 'dangerouslySetInnerHTML') return;
  if (isEventProp(key)) {
    el.removeEventListener(eventNameFromProp(key), oldValue);
    return;
  }
  el.removeAttribute(key);
}

function updateProp(el: Element, key: string, oldValue: any, newValue: any) {
  if (oldValue === newValue) return;
  if (key === 'style' && typeof oldValue === 'object' && typeof newValue === 'object') {
    for (const k in oldValue) {
      if (!(k in (newValue || {}))) {
        (el as HTMLElement).style[k as any] = '';
      }
    }
    for (const k in newValue) {
      if (oldValue[k] !== newValue[k]) {
        (el as HTMLElement).style[k as any] = newValue[k];
      }
    }
    return;
  }
  if (newValue == null || newValue === false) {
    removeProp(el, key, oldValue);
    return;
  }
  if (isEventProp(key)) {
    removeProp(el, key, oldValue);
  }
  setProp(el, key, newValue);
}

function updateProps(el: Element, oldProps: Record<string, any>, newProps: Record<string, any>) {
  const allKeys = new Set([...Object.keys(oldProps), ...Object.keys(newProps)]);
  for (const key of allKeys) {
    if (key === 'key' || key === 'children') continue;
    const oldVal = oldProps[key];
    const newVal = newProps[key];
    if (newVal === undefined || newVal === null) {
      if (oldVal !== undefined && oldVal !== null) {
        removeProp(el, key, oldVal);
      }
    } else if (oldVal !== newVal) {
      updateProp(el, key, oldVal, newVal);
    }
  }
}

function mergeSlotProps(childProps: Record<string, any>, slotProps: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  const allKeys = new Set([...Object.keys(childProps), ...Object.keys(slotProps)]);
  for (const key of allKeys) {
    if (key === 'key' || key === 'children') continue;
    const cv = childProps[key];
    const sv = slotProps[key];
    if (key === 'class' || key === 'className') {
      const merged = ((cv || '') + ' ' + (sv || '')).trim();
      if (merged) result.class = merged;
      continue;
    }
    if (key === 'style') {
      result.style = { ...(cv || {}), ...(sv || {}) };
      continue;
    }
    if (key.startsWith('on') && cv && sv) {
      result[key] = (e: any) => { cv(e); sv(e); };
      continue;
    }
    if (key in slotProps) {
      if (sv !== undefined && sv !== null) result[key] = sv;
    } else if (cv !== undefined && cv !== null) {
      result[key] = cv;
    }
  }
  return result;
}

function resolveSlotVNode(vnode: VNode): VNode {
  if (vnode.type !== SLOT) return vnode;
  const child = vnode.children[0];
  if (!child) return vnode;
  const merged: VNode = {
    ...child,
    props: mergeSlotProps(child.props, vnode.props),
  };
  return merged;
}

export function createDOM(vnode: VNode): Node {
  if (!vnode) return document.createTextNode('');

  if (vnode.type === TEXT) {
    const node = document.createTextNode(vnode.props.nodeValue ?? '');
    vnode.dom = node;
    return node;
  }

  if (vnode.type === FRAGMENT || vnode.type === SLOTTABLE) {
    const fragment = document.createDocumentFragment();
    for (const child of vnode.children) {
      fragment.appendChild(createDOM(child));
    }
    return fragment;
  }

  if (vnode.type === SLOT) {
    return createDOM(resolveSlotVNode(vnode));
  }

    if (typeof vnode.type === 'function') {
      const component = vnode.type as ComponentType;
      const instance = new ComponentInstance(component, vnode.props);
      setCurrentInstance(instance);
      const result = instance.render();
      instance.vnode = result;
      if (result) {
        result.componentInstance = instance;
        const dom = createDOM(result);
        vnode.dom = dom;
        vnode.componentInstance = instance;
        return dom;
      }
      const empty = document.createTextNode('');
      vnode.dom = empty;
      vnode.componentInstance = instance;
      return empty;
    }

  const el = createElement(vnode.type as string);
  vnode.dom = el;

  for (const [key, value] of Object.entries(vnode.props)) {
    if (key === 'key' || key === 'children') continue;
    if (value !== undefined && value !== null) {
      setProp(el, key, value);
    }
  }

  for (const child of vnode.children) {
    const childDom = createDOM(child);
    if (childDom) el.appendChild(childDom);
  }

  return el;
}

function findDomNode(vnode: VNode): Node | null {
  if (vnode.dom) return vnode.dom;
  if (vnode.type === FRAGMENT || vnode.type === SLOTTABLE || vnode.type === SLOT) {
    for (const child of vnode.children) {
      const dom = findDomNode(child);
      if (dom) return dom;
    }
    return null;
  }
  if (typeof vnode.type === 'function') {
    return vnode.componentInstance?.vnode ? findDomNode(vnode.componentInstance.vnode) : null;
  }
  return null;
}

function findAllDomNodes(vnode: VNode): Node[] {
  if (vnode.type === FRAGMENT || vnode.type === SLOTTABLE || vnode.type === SLOT) {
    const nodes: Node[] = [];
    for (const child of vnode.children) {
      nodes.push(...findAllDomNodes(child));
    }
    return nodes;
  }
  if (typeof vnode.type === 'function') {
    return vnode.componentInstance?.vnode ? findAllDomNodes(vnode.componentInstance.vnode) : [];
  }
  if (vnode.dom) return [vnode.dom];
  return [];
}

function isSameNodeType(a: VNode, b: VNode): boolean {
  if (a.type === SLOT || b.type === SLOT) return a.type === b.type;
  if (typeof a.type === 'function' && typeof b.type === 'function') {
    return a.type === b.type;
  }
  return a.type === b.type;
}

function getKey(vnode: VNode, index: number): string | number {
  return vnode.key ?? index;
}

export function patch(dom: Node, oldVNode: VNode, newVNode: VNode): Node {
  if (!isSameNodeType(oldVNode, newVNode)) {
    runUnmountCleanups(oldVNode);
    const newDom = createDOM(newVNode);
    if (dom.parentNode) {
      dom.parentNode.replaceChild(newDom, dom);
    }
    return newDom;
  }

  if (newVNode.type === TEXT) {
    if ((dom as Text).nodeValue !== newVNode.props.nodeValue) {
      (dom as Text).nodeValue = newVNode.props.nodeValue;
    }
    newVNode.dom = dom;
    return dom;
  }

  if (newVNode.type === FRAGMENT || newVNode.type === SLOTTABLE) {
    reconcileChildren(dom.parentNode || dom, oldVNode.children, newVNode.children, findDomNode(oldVNode) || dom);
    newVNode.dom = dom;
    return dom;
  }

  if (newVNode.type === SLOT) {
    const resolved = resolveSlotVNode(newVNode);
    return patch(dom, resolveSlotVNode(oldVNode), resolved);
  }

  if (typeof newVNode.type === 'function') {
    const component = newVNode.type as ComponentType;
    let instance = oldVNode.componentInstance;
    const fnName = component.name || (typeof component === 'function' ? '(anonymous)' : String(component));
    if (!instance) {
      instance = new ComponentInstance(component, newVNode.props);
    } else {
      instance.props = newVNode.props;
    }
    newVNode.componentInstance = instance;

    setCurrentInstance(instance);
    const result = instance.render();

    const oldResult = oldVNode.componentInstance?.vnode || oldVNode;
    instance.vnode = result;

    if (!result) {
      if (dom && dom.nodeType === 3) {
        newVNode.dom = dom;
        return dom;
      }
      const empty = document.createTextNode('');
      newVNode.dom = empty;
      return empty;
    }

    result.componentInstance = instance;
    const newDom = patch(dom, oldResult, result);
    newVNode.dom = newDom;
    return newDom;
  }

  const el = dom as HTMLElement;
  newVNode.dom = el;

  updateProps(el, oldVNode.props, newVNode.props);
  reconcileChildren(el, oldVNode.children, newVNode.children, null);

  return el;
}

function reconcileChildren(
  parentEl: Node,
  oldChildren: VNode[],
  newChildren: VNode[],
  anchor: Node | null
) {
  const oldLen = oldChildren.length;
  const newLen = newChildren.length;

  const oldKeyed = new Map<string | number, { vnode: VNode; nodes: Node[]; matchedKey: string | number }>();
  for (let i = 0; i < oldLen; i++) {
    const key = getKey(oldChildren[i], i);
    const nodes = findAllDomNodes(oldChildren[i]);
    oldKeyed.set(key, { vnode: oldChildren[i], nodes, matchedKey: key });
  }

  const usedKeys = new Set<string | number>();
  const patches: { vnode: VNode; dom: Node }[] = [];

  for (let i = 0; i < newLen; i++) {
    const newChild = newChildren[i];
    const key = getKey(newChild, i);
    const oldEntry = oldKeyed.get(key);

    if (oldEntry && !usedKeys.has(key)) {
      usedKeys.add(key);
      const oldDom = oldEntry.nodes[0];
      if (oldDom && oldDom.parentNode) {
        const newDom = patch(oldDom, oldEntry.vnode, newChild);
        newChild.dom = newDom;
        patches.push({ vnode: newChild, dom: newDom });
      } else {
        const newDom = createDOM(newChild);
        patches.push({ vnode: newChild, dom: newDom });
      }
    } else {
      const newDom = createDOM(newChild);
      patches.push({ vnode: newChild, dom: newDom });
    }
  }

  for (const [, entry] of oldKeyed) {
    if (!usedKeys.has(entry.matchedKey)) {
      runUnmountCleanups(entry.vnode);
      for (const node of entry.nodes) {
        if (node.parentNode) {
          node.parentNode.removeChild(node);
        }
      }
    }
  }

  const parent = parentEl as HTMLElement;
  const baseOffset = (() => {
    if (oldChildren.length === 0) return 0;
    const firstNodes = findAllDomNodes(oldChildren[0]);
    if (firstNodes.length === 0) return 0;
    const idx = Array.from(parent.childNodes).indexOf(firstNodes[0] as ChildNode);
    return idx < 0 ? 0 : idx;
  })();
  const domCounts: number[] = [];
  let running = 0;
  for (let i = 0; i < newLen; i++) {
    domCounts.push(running);
    const nodes = findAllDomNodes(patches[i].vnode);
    running += nodes.length || 1;
  }
  for (let i = 0; i < newLen; i++) {
    const { vnode, dom } = patches[i];
    const nodes = findAllDomNodes(vnode);
    const offset = baseOffset + domCounts[i];
    if (!dom || !dom.parentNode) {
      if (dom && nodes.length > 0) {
        const refNode = parent.childNodes[offset] || null;
        parent.insertBefore(dom, refNode);
      }
    } else {
      const firstNodeOffset = Array.from(parent.childNodes).indexOf(nodes[0] as ChildNode);
      if (firstNodeOffset !== offset) {
        const refNode = parent.childNodes[offset] || null;
        for (const node of nodes) {
          parent.insertBefore(node, refNode);
        }
      }
    }
  }
}
