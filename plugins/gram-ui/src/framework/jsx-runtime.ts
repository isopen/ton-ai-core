import { normalizeChildren } from './vdom.js';
import type { VNode } from './vdom.js';

export const Fragment = 'FRAGMENT_NODE';

export function jsx(type: any, config: Record<string, any> | null, maybeKey?: any): VNode {
  const { children, key: configKey, ...props } = config || {};
  const flatKey = maybeKey ?? configKey ?? null;
  const flatChildren = normalizeChildren(children);

  if (typeof type === 'function') {
    const vnode: VNode = { type, props: { ...props, children }, children: flatChildren, key: flatKey };
    return vnode;
  }

  if (type === 'FRAGMENT_NODE') {
    return { type: 'FRAGMENT_NODE' as any, props: {}, children: flatChildren, key: flatKey };
  }

  return { type, props, children: flatChildren, key: flatKey };
}

export function h(type: any, props: Record<string, any> | null, ...children: any[]): VNode {
  const merged = { ...(props || {}) };
  if (children.length > 0) {
    merged.children = children.length === 1 ? children[0] : children;
  }
  return jsx(type, merged);
}
