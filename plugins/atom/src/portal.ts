import { PORTAL, normalizeChildren, type VNode } from './vdom.js';

export function createPortal(children: any, container: Element | null, key?: string | number): VNode {
  return {
    type: PORTAL,
    props: { container },
    children: normalizeChildren(children),
    key: key ?? null,
  };
}

export function isPortal(vnode: VNode | null | undefined): boolean {
  return !!vnode && vnode.type === PORTAL;
}
