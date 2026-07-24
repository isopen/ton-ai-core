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

  constructor(component: ComponentType, props: Record<string, any>) {
    this.component = component;
    this.props = props;
  }

  render(): VNode {
    currentInstance = this;
    this.hookIndex = 0;
    const vnode = this.component(this.props);
    return vnode;
  }
}

export let currentInstance: ComponentInstance | null = null;

export function setCurrentInstance(inst: ComponentInstance | null) {
  currentInstance = inst;
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
