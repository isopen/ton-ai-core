import {
  TEXT, FRAGMENT, SLOT, SLOTTABLE,
  ComponentInstance,
  normalizeChild, normalizeChildren,
  currentInstance, setCurrentInstance,
} from '../src/vdom.js';
import type { ComponentType, VNode } from '../src/vdom.js';

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

  test('render() sets currentInstance and resets hookIndex', () => {
    const inst = new ComponentInstance(Dummy, {});
    setCurrentInstance(null);
    expect(currentInstance).toBeNull();

    const vnode = inst.render();

    expect(currentInstance).toBe(inst);
    expect(inst.hookIndex).toBe(0);
    expect(vnode.type).toBe('div');
  });

  test('render() restores previous instance', () => {
    const prev = currentInstance;
    const inst = new ComponentInstance(Dummy, {});
    inst.render();
    expect(currentInstance).toBe(inst);
    setCurrentInstance(prev);
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
