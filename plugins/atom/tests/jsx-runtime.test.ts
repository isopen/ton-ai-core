import { jsx, h, Fragment } from '../src/jsx-runtime.js';
import { TEXT, FRAGMENT } from '../src/vdom.js';
import type { VNode } from '../src/vdom.js';

describe('jsx', () => {
  test('creates element vnode for string type', () => {
    const vnode = jsx('div', { id: 'foo', class: 'bar' });
    expect(vnode.type).toBe('div');
    expect(vnode.props).toEqual({ id: 'foo', class: 'bar' });
    expect(vnode.children).toEqual([]);
    expect(vnode.key).toBeNull();
  });

  test('creates component vnode for function type', () => {
    const Comp = (props: any) => ({ type: 'div', props, children: [], key: null });
    const vnode = jsx(Comp, { name: 'test' });
    expect(vnode.type).toBe(Comp);
    expect(vnode.props).toEqual({ name: 'test' });
    expect(vnode.children).toEqual([]);
    expect(vnode.key).toBeNull();
  });

  test('creates fragment vnode', () => {
    const vnode = jsx(Fragment, {});
    expect(vnode.type).toBe(FRAGMENT);
    expect(vnode.props).toEqual({});
    expect(vnode.children).toEqual([]);
  });

  test('passes key from config', () => {
    const vnode = jsx('div', { key: 'mykey' });
    expect(vnode.key).toBe('mykey');
  });

  test('passes key from second argument', () => {
    const vnode = jsx('div', {}, 'explicitKey');
    expect(vnode.key).toBe('explicitKey');
  });

  test('explicit key overrides config key', () => {
    const vnode = jsx('div', { key: 'configKey' }, 'explicitKey');
    expect(vnode.key).toBe('explicitKey');
  });

  test('handles children prop', () => {
    const child = { type: TEXT, props: {}, children: [], key: null };
    const vnode = jsx('div', { children: [child] });
    expect(vnode.children).toHaveLength(1);
    expect(vnode.children[0]).toBe(child);
  });

  test('normalizes string children', () => {
    const vnode = jsx('div', { children: 'hello' });
    expect(vnode.children).toHaveLength(1);
    expect(vnode.children[0].type).toBe(TEXT);
  });

  test('handles null config', () => {
    const vnode = jsx('div', null);
    expect(vnode.type).toBe('div');
    expect(vnode.props).toEqual({});
    expect(vnode.children).toEqual([]);
  });

  test('strips children and key from props', () => {
    const vnode = jsx('div', { children: 'x', key: 'k', id: 'main' });
    expect(vnode.props).toEqual({ id: 'main' });
  });
});

describe('h (hyperscript)', () => {
  test('creates element with no props', () => {
    const vnode = h('div');
    expect(vnode.type).toBe('div');
    expect(vnode.props).toEqual({});
    expect(vnode.children).toEqual([]);
  });

  test('creates element with props', () => {
    const vnode = h('div', { id: 'x' });
    expect(vnode.props).toEqual({ id: 'x' });
  });

  test('passes single child', () => {
    const vnode = h('div', null, 'hello');
    expect(vnode.children).toHaveLength(1);
    expect((vnode.children[0] as any).props.nodeValue).toBe('hello');
  });

  test('passes multiple children as array', () => {
    const vnode = h('div', null, 'a', 'b');
    expect(vnode.children).toHaveLength(2);
  });

  test('merges props with children', () => {
    const vnode = h('div', { id: 'x' }, 'child');
    expect(vnode.props).toEqual({ id: 'x' });
    expect(vnode.children).toHaveLength(1);
  });
});

describe('Fragment', () => {
  test('is exported as FRAGMENT_NODE', () => {
    expect(Fragment).toBe('FRAGMENT_NODE');
  });
});
