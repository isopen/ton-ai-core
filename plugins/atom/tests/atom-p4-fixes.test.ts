/**
 * @jest-environment jsdom
 */
import { createDOM, patch } from '../src/reconciler.js';
import { render } from '../src/render.js';
import { useEffect, useLayoutEffect, flushAllEffects, flushLayoutEffects } from '../src/hooks.js';
import { ComponentInstance, setCurrentInstance } from '../src/vdom.js';
import { VirtualList } from '../src/virtual-list.js';
import { TEXT } from '../src/vdom.js';
import type { VNode, ComponentType } from '../src/vdom.js';

function h(type: any, props: Record<string, any> = {}, ...children: any[]): VNode {
  const flatChildren: VNode[] = [];
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

function click(el: Element): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

const tick = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('atom p4 fixes events', () => {
  test('once false to true becomes single-shot', () => {
    const fn = jest.fn();
    const v0 = h('button', { onClick: { handle: fn, once: false } }, 'x');
    const el = createDOM(v0) as HTMLElement;
    document.body.appendChild(el);
    patch(el, v0, h('button', { onClick: { handle: fn, once: true } }, 'x'));
    click(el);
    click(el);
    click(el);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('once true to false becomes persistent', () => {
    const fn = jest.fn();
    const v0 = h('button', { onClick: { handle: fn, once: true } }, 'x');
    const el = createDOM(v0) as HTMLElement;
    document.body.appendChild(el);
    patch(el, v0, h('button', { onClick: { handle: fn, once: false } }, 'x'));
    click(el);
    click(el);
    click(el);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('failed rebind keeps old binding usable', () => {
    const f1 = jest.fn();
    const f2 = jest.fn();
    const v0 = h('button', { onClick: { handle: f1, capture: false } }, 'x');
    const el = createDOM(v0) as HTMLElement;
    document.body.appendChild(el);
    const orig = EventTarget.prototype.addEventListener;
    let calls = 0;
    EventTarget.prototype.addEventListener = function (this: any, ...args: any[]) {
      calls++;
      if (calls === 1) throw new Error('bind-boom');
      return orig.apply(this, args as any);
    };
    try {
      expect(() => patch(el, v0, h('button', { onClick: { handle: f2, capture: true } }, 'x'))).toThrow('bind-boom');
    } finally {
      EventTarget.prototype.addEventListener = orig;
    }
    click(el);
    expect(f1).toHaveBeenCalledTimes(1);
    expect(f2).not.toHaveBeenCalled();
  });
});

describe('atom p4 fixes innerHTML', () => {
  test('mount with innerHTML ignores children', () => {
    const vnode = h('div', { dangerouslySetInnerHTML: { __html: '<b>html</b>' } }, 'child-text');
    const el = createDOM(vnode) as HTMLElement;
    expect(el.innerHTML).toBe('<b>html</b>');
    expect(el.textContent).toBe('html');
  });

  test('patch to innerHTML drops old children and ignores new children', () => {
    const oldVNode = h('div', {}, h('span', { id: 's' }, 'old'));
    const el = createDOM(oldVNode) as HTMLElement;
    document.body.appendChild(el);
    expect(el.querySelector('#s')).not.toBeNull();
    const next = h('div', { dangerouslySetInnerHTML: { __html: '<i>new</i>' } }, h('span', { id: 'n' }, 'nope'));
    patch(el, oldVNode, next);
    expect(el.innerHTML).toBe('<i>new</i>');
    expect(el.querySelector('#n')).toBeNull();
    expect(el.querySelector('#s')).toBeNull();
  });

  test('host props revert when child patch throws', () => {
    const Boom: ComponentType = () => {
      throw new Error('child-boom');
    };
    const oldVNode = h('div', { id: 'w', class: 'old' }, h('span', {}, 'ok'));
    const el = createDOM(oldVNode) as HTMLElement;
    document.body.appendChild(el);
    expect(el.getAttribute('class')).toBe('old');
    const next = h('div', { id: 'w', class: 'new' }, h(Boom as any, {}));
    expect(() => patch(el, oldVNode, next)).toThrow('child-boom');
    expect(el.getAttribute('class')).toBe('old');
  });
});

describe('atom p4 fixes effects', () => {
  test('effect self-unmount drops new cleanup', async () => {
    const Comp: ComponentType = () => h('div', {}, 'x');
    const inst = new ComponentInstance(Comp, {});
    inst._mounted = true;
    setCurrentInstance(inst);
    inst.hookIndex = 0;
    useEffect(() => {
      inst._mounted = false;
      inst.unmountCleanups.length = 0;
      return () => {};
    }, []);
    setCurrentInstance(null);
    flushAllEffects();
    expect(inst.unmountCleanups).toHaveLength(0);
    expect(inst.hookStates[1]).toBeUndefined();
  });

  test('layout effect self-unmount drops new cleanup', async () => {
    const Comp: ComponentType = () => h('div', {}, 'x');
    const inst = new ComponentInstance(Comp, {});
    inst._mounted = true;
    setCurrentInstance(inst);
    inst.hookIndex = 0;
    useLayoutEffect(() => {
      inst._mounted = false;
      inst.unmountCleanups.length = 0;
      return () => {};
    }, []);
    setCurrentInstance(null);
    flushLayoutEffects();
    expect(inst.unmountCleanups).toHaveLength(0);
    expect(inst.hookStates[1]).toBeUndefined();
  });
});

describe('atom p4 fixes vlist', () => {
  test('renderItem vnode is not mutated', async () => {
    const cached: VNode = h('div', {}, 'cached');
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const App: ComponentType = () =>
      h('div', {},
        h(VirtualList as any, {
          data: items,
          itemHeight: 30,
          containerHeight: 200,
          renderItem: () => cached,
        }));
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);
    await tick(10);
    expect(cached.key).toBeNull();
    expect((cached.props as any)['data-vl-key']).toBeUndefined();
    expect((cached.props as any).ref).toBeUndefined();
  });

  test('middle mutation with same ends renders new row', async () => {
    const mk = (ids: string[]) => ids.map((id) => ({ id }));
    let items = mk(['a', 'b', 'c', 'd', 'e']);
    let setItems: ((v: Array<{ id: string }>) => void) | null = null;
    const App: ComponentType = () => {
      const { useState } = require('../src/hooks.js');
      const [data, setData] = useState(items);
      setItems = setData;
      return h('div', {},
        h(VirtualList as any, {
          data,
          keyExtractor: (it: any) => it.id,
          itemHeight: 30,
          containerHeight: 200,
          renderItem: ({ item }: any) => h('div', { key: item.id }, item.id),
        }));
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);
    await tick(10);
    expect(container.textContent).toContain('b');
    setItems!(mk(['a', 'x', 'c', 'd', 'e']));
    await tick(10);
    await tick(10);
    expect(container.textContent).toContain('x');
    expect(container.textContent).not.toContain('b');
  });

  test('special key chars do not throw query', async () => {
    const items = [{ id: 'a"b' }, { id: 'c[d]' }, { id: 'e\\f' }];
    const App: ComponentType = () =>
      h('div', {},
        h(VirtualList as any, {
          data: items,
          keyExtractor: (it: any) => it.id,
          itemHeight: 30,
          containerHeight: 200,
          renderItem: ({ item }: any) => h('div', { key: item.id }, item.id),
        }));
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);
    await tick(10);
    expect(container.querySelectorAll('[data-vl-key]').length).toBe(3);
  });

  test('loader toggle keeps rows without throwing', async () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ id: 'k' + i }));
    let setLoader: ((v: boolean) => void) | null = null;
    const App: ComponentType = () => {
      const { useState } = require('../src/hooks.js');
      const [loading, setLoading] = useState(false);
      setLoader = setLoading;
      return h('div', {},
        h(VirtualList as any, {
          data: items,
          keyExtractor: (it: any) => it.id,
          itemHeight: 30,
          containerHeight: 200,
          topLoader: loading ? h('div', { id: 'tl' }, 'loading') : undefined,
          renderItem: ({ item }: any) => h('div', { key: item.id }, item.id),
        }));
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);
    await tick(10);
    const before = container.querySelectorAll('[data-vl-key]').length;
    expect(before).toBeGreaterThan(0);
    setLoader!(true);
    await tick(10);
    expect(container.querySelector('#tl')).not.toBeNull();
    setLoader!(false);
    await tick(10);
    expect(container.querySelector('#tl')).toBeNull();
    expect(container.querySelectorAll('[data-vl-key]').length).toBeGreaterThan(0);
  });
});
