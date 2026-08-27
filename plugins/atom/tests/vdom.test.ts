import {
  TEXT, FRAGMENT, SLOT, SLOTTABLE,
  ComponentInstance, memo,
  normalizeChild, normalizeChildren,
  currentInstance, setCurrentInstance,
} from '../src/vdom.js';
import type { ComponentType, VNode } from '../src/vdom.js';

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
  const flatChildren: any[] = [];
  for (const c of children) {
    if (c == null || c === false || c === true) continue;
    if (Array.isArray(c)) { flatChildren.push(...c); continue; }
    if (typeof c === 'string' || typeof c === 'number') {
      flatChildren.push({ type: TEXT, props: { nodeValue: String(c) }, children: [], key: null });
    } else {
      flatChildren.push(c);
    }
  }
  return { type, props: { ...props }, children: flatChildren, key: (props as any)?.key ?? null };
}

describe('vdom constants', () => {
  test('TEXT is defined', () => {
    expect(TEXT).toBe('TEXT_NODE');
  });

  test('FRAGMENT is defined', () => {
    expect(FRAGMENT).toBe('FRAGMENT_NODE');
  });

  test('SLOT is defined', () => {
    expect(SLOT).toBe('SLOT_NODE');
  });

  test('SLOTTABLE is defined', () => {
    expect(SLOTTABLE).toBe('SLOTTABLE_NODE');
  });
});

describe('normalizeChild', () => {
  test('returns null for null', () => {
    expect(normalizeChild(null)).toBeNull();
  });

  test('returns null for undefined', () => {
    expect(normalizeChild(undefined)).toBeNull();
  });

  test('returns null for false', () => {
    expect(normalizeChild(false)).toBeNull();
  });

  test('returns null for true', () => {
    expect(normalizeChild(true)).toBeNull();
  });

  test('wraps string in TEXT vnode', () => {
    const result = normalizeChild('hello');
    expect(result).toEqual({
      type: TEXT,
      props: { nodeValue: 'hello' },
      children: [],
      key: null,
    });
  });

  test('wraps number in TEXT vnode', () => {
    const result = normalizeChild(42);
    expect(result).toEqual({
      type: TEXT,
      props: { nodeValue: '42' },
      children: [],
      key: null,
    });
  });

  test('wraps zero in TEXT vnode', () => {
    const result = normalizeChild(0);
    expect(result).toEqual({
      type: TEXT,
      props: { nodeValue: '0' },
      children: [],
      key: null,
    });
  });

  test('passes through VNode', () => {
    const vnode: VNode = { type: 'div', props: {}, children: [], key: null };
    expect(normalizeChild(vnode)).toBe(vnode);
  });

  test('handles empty string', () => {
    const result = normalizeChild('');
    expect(result).toEqual({
      type: TEXT,
      props: { nodeValue: '' },
      children: [],
      key: null,
    });
  });
});

describe('normalizeChildren', () => {
  test('returns [] for null', () => {
    expect(normalizeChildren(null)).toEqual([]);
  });

  test('returns [] for undefined', () => {
    expect(normalizeChildren(undefined)).toEqual([]);
  });

  test('returns [] for false', () => {
    expect(normalizeChildren(false)).toEqual([]);
  });

  test('returns [] for true', () => {
    expect(normalizeChildren(true)).toEqual([]);
  });

  test('wraps single child in array', () => {
    const result = normalizeChildren('hello');
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe(TEXT);
  });

  test('handles array of children', () => {
    const result = normalizeChildren(['a', 'b']);
    expect(result).toHaveLength(2);
  });

  test('flattens nested arrays', () => {
    const result = normalizeChildren(['a', ['b', 'c'], 'd']);
    expect(result).toHaveLength(4);
  });

  test('filters out null/undefined/boolean children', () => {
    const result = normalizeChildren(['a', null, 'b', undefined, false, 'c', true]);
    expect(result).toHaveLength(3);
    expect(result.map(c => (c.props as any).nodeValue)).toEqual(['a', 'b', 'c']);
  });

  test('preserves VNodes in array', () => {
    const vnode: VNode = { type: 'div', props: {}, children: [], key: null };
    const result = normalizeChildren([vnode]);
    expect(result[0]).toBe(vnode);
  });

  test('deeply nested arrays are fully flattened', () => {
    const result = normalizeChildren(['a', ['b', ['c', ['d']]]]);
    expect(result).toHaveLength(4);
    expect(result.map(c => (c.props as any).nodeValue)).toEqual(['a', 'b', 'c', 'd']);
  });

  test('filters falsy values inside nested arrays', () => {
    const result = normalizeChildren(['a', [null, 'b', [false, 'c', undefined]]]);
    expect(result).toHaveLength(3);
  });

  test('handles single non-array child', () => {
    const vnode: VNode = { type: 'div', props: {}, children: [], key: null };
    const result = normalizeChildren(vnode);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(vnode);
  });

  test('handles empty array', () => {
    const result = normalizeChildren([]);
    expect(result).toEqual([]);
  });
});

describe('ComponentInstance', () => {
  const Dummy: ComponentType = () => ({ type: 'div', props: {}, children: [], key: null });

  test('stores component and props', () => {
    const inst = new ComponentInstance(Dummy, { foo: 'bar' });
    expect(inst.component).toBe(Dummy);
    expect(inst.props).toEqual({ foo: 'bar' });
  });

  test('initializes hookStates as empty', () => {
    const inst = new ComponentInstance(Dummy, {});
    expect(inst.hookStates).toEqual([]);
  });

  test('initializes hookIndex as 0', () => {
    const inst = new ComponentInstance(Dummy, {});
    expect(inst.hookIndex).toBe(0);
  });

  test('initializes cleanupFns as empty', () => {
    const inst = new ComponentInstance(Dummy, {});
    expect(inst.cleanupFns).toEqual([]);
  });

  test('initializes unmountCleanups as empty', () => {
    const inst = new ComponentInstance(Dummy, {});
    expect(inst.unmountCleanups).toEqual([]);
  });

  test('initializes vnode as null', () => {
    const inst = new ComponentInstance(Dummy, {});
    expect(inst.vnode).toBeNull();
  });

  test('displayName from displayName property', () => {
    const fn: any = Object.assign(
      () => ({ type: 'div', props: {}, children: [], key: null }),
      { displayName: 'MyComponent' }
    );
    const inst = new ComponentInstance(fn, {});
    expect(inst.displayName).toBe('MyComponent');
  });

  test('displayName falls back to component.name', () => {
    function NamedComp() { return { type: 'div', props: {}, children: [], key: null }; }
    const inst = new ComponentInstance(NamedComp, {});
    expect(inst.displayName).toBe('NamedComp');
  });

  test('displayName falls back to (anonymous)', () => {
    const inst = new ComponentInstance(Dummy, {});
    expect(inst.displayName).toBe('Dummy');
  });

  test('render() resets hookIndex and clears currentInstance', () => {
    const inst = new ComponentInstance(Dummy, {});
    setCurrentInstance(null);
    expect(currentInstance).toBeNull();

    const vnode = inst.render();

    expect(currentInstance).toBeNull();
    expect(inst.hookIndex).toBe(0);
    expect(vnode.type).toBe('div');
  });

  test('render() does not leak the instance into global currentInstance', () => {
    const inst = new ComponentInstance(Dummy, {});
    inst.render();
    expect(currentInstance).toBeNull();
  });

  test('displayName for anonymous arrow function', () => {
    const fn = (() => (props: any) => ({ type: 'div', props, children: [], key: null }))();
    const inst = new ComponentInstance(fn, {});
    expect(inst.displayName).toBe('(anonymous)');
  });
});

describe('setCurrentInstance', () => {
  test('sets currentInstance to given value', () => {
    const Dummy: ComponentType = () => ({ type: 'span', props: {}, children: [], key: null });
    const inst = new ComponentInstance(Dummy, {});
    setCurrentInstance(inst);
    expect(currentInstance).toBe(inst);
  });

  test('sets currentInstance to null', () => {
    setCurrentInstance(null);
    expect(currentInstance).toBeNull();
  });
});

describe('memo', () => {
  test('returns cached vnode when props and subtree are unchanged', () => {
    let renders = 0;
    const Inner: ComponentType = memo((props: any) => {
      renders++;
      return h('span', {}, String(props.n));
    });

    const inst = new ComponentInstance(Inner, {});
    setCurrentInstance(inst);
    const v1 = Inner({ n: 1 });
    const v2 = Inner({ n: 1 });
    setCurrentInstance(null);

    expect(renders).toBe(1);
    expect(v2).toBe(v1);
  });

  test('re-renders when a child component is dirty', () => {
    let parentRenders = 0;
    const Child: ComponentType = () => h('div', {}, 'c');
    const Parent: ComponentType = memo(() => {
      parentRenders++;
      return h(Child);
    });

    const inst = new ComponentInstance(Parent, {});
    setCurrentInstance(inst);
    const p1 = Parent({});
    const childInst = new ComponentInstance(Child, {});
    (p1 as VNode).componentInstance = childInst;
    childInst._dirty = true;

    const p2 = Parent({});
    setCurrentInstance(null);

    expect(parentRenders).toBe(2);
    expect(p2).not.toBe(p1);
  });

  test('re-renders when a child subtree is dirty (recursion)', () => {
    let parentRenders = 0;
    const Leaf: ComponentType = () => h('i', {}, 'l');
    const Mid: ComponentType = () => h('div', {}, h(Leaf));
    const Parent: ComponentType = memo(() => {
      parentRenders++;
      return h(Mid);
    });

    const inst = new ComponentInstance(Parent, {});
    setCurrentInstance(inst);
    const p1 = Parent({});
    const midInst = new ComponentInstance(Mid, {});
    const midVNode = p1 as VNode;
    midVNode.componentInstance = midInst;
    const leafInst = new ComponentInstance(Leaf, {});
    midInst.vnode = h('div', {}, h(Leaf));
    midInst.vnode.children[0].componentInstance = leafInst;
    leafInst._dirty = true;

    const p2 = Parent({});
    setCurrentInstance(null);

    expect(parentRenders).toBe(2);
    expect(p2).not.toBe(p1);
  });

  test('handles null and instance-less cached subtrees', () => {
    let mode: 'null' | 'noinst' | 'ok' = 'null';
    const Child: ComponentType = () => h('div', {}, 'c');
    const Inner: ComponentType = memo((props: any) => {
      if (mode === 'null') return null as any;
      if (mode === 'noinst') return { type: Child, props: {}, children: [], key: null } as any;
      return h('span', {}, String(props.n));
    });

    const inst = new ComponentInstance(Inner, {});
    setCurrentInstance(inst);
    const n1 = Inner({ n: 1 });
    const n2 = Inner({ n: 1 });
    expect(n2).toBe(n1);
    expect(n1).toBeNull();

    mode = 'noinst';
    const c1 = Inner({ n: 2 });
    const c2 = Inner({ n: 2 });
    expect(c2).toBe(c1);

    mode = 'ok';
    const s1 = Inner({ n: 3 });
    expect((s1 as VNode).type).toBe('span');
    setCurrentInstance(null);
  });

  test('re-renders when the props shape changes (shallowEqual length mismatch)', () => {
    let renders = 0;
    const Inner: ComponentType = memo((props: any) => {
      renders++;
      return h('span', {}, String(props.n));
    });

    const inst = new ComponentInstance(Inner, {});
    setCurrentInstance(inst);
    Inner({ n: 1 });
    Inner({ n: 1, extra: true });
    setCurrentInstance(null);

    expect(renders).toBe(2);
  });

  test('runs the original component when no current instance', () => {
    const Inner: ComponentType = memo((props: any) => h('b', {}, String(props.n)));
    setCurrentInstance(null);
    const v = Inner({ n: 3 });
    expect((v as VNode).type).toBe('b');
  });

  test('falls back to the component name for displayName', () => {
    const Comp = function MyComp() { return null as any; };
    const Wrapped = memo(Comp);
    expect((Wrapped as any).displayName).toBe('MyComp');
  });
});
