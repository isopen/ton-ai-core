/**
 * @jest-environment jsdom
 */

import { render } from '../src/render.js';
import { createDOM, patch, flushPendingRefs } from '../src/reconciler.js';
import { useState } from '../src/hooks.js';
import { createContext, useContext, readRenderValue } from '../src/context.js';
import { Suspense, suspend, clearSuspended } from '../src/suspense.js';
import { requestOnce } from '../src/dom-events.js';
import { VirtualList } from '../src/virtual-list.js';
import type { ComponentType, VNode } from '../src/vdom.js';
import { TEXT, normalizeChildren } from '../src/vdom.js';

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
  const p = { ...props };
  if (children.length > 0) p.children = children.length === 1 ? children[0] : children;
  return { type, props: p, children: flatChildren, key: (props as any)?.key ?? null };
}

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

let origClientHeight: PropertyDescriptor | undefined;
let origScrollHeight: PropertyDescriptor | undefined;

beforeEach(() => {
  document.body.innerHTML = '';
  origClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
  origScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
  clearSuspended();
});

afterEach(() => {
  if (origClientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', origClientHeight);
  if (origScrollHeight) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', origScrollHeight);
  clearSuspended();
});

function mockViewport(client: number, scroll: number) {
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => client });
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => scroll });
}

function listElOf(container: HTMLElement): HTMLElement {
  return container.querySelector('[style*="overflow-y"]') as HTMLElement;
}

describe('atom p3 fixes reconciler', () => {
  test('replace path survives detached anchor with attached dom', () => {
    const oldVNode = h('div', { id: 'w' }, h('span', { id: 'a' }, 'A'));
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dom = createDOM(oldVNode) as HTMLElement;
    host.appendChild(dom);
    const anchor = dom.querySelector('#a') as HTMLElement;
    anchor.parentNode!.removeChild(anchor);
    const other = document.createElement('b');
    other.textContent = 'other';
    host.appendChild(other);
    const newVNode = h('i', { id: 'n' }, 'N');
    let out: Node | null = null;
    expect(() => { out = patch(other, oldVNode, newVNode); }).not.toThrow();
    expect(host.contains(out as Node)).toBe(true);
    expect((out as HTMLElement).tagName).toBe('I');
  });

  test('detached keyed child still runs unmount cleanups', async () => {
    const cleaned: string[] = [];
    const { useEffect } = await import('../src/hooks.js');
    const Comp: ComponentType = ({ id }: any) => {
      useEffect(() => () => { cleaned.push(id); }, []);
      return h('span', { id }, id);
    };
    const oldVNode = h('div', {}, h(Comp as any, { key: 'c', id: 'c' }));
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dom = createDOM(oldVNode) as HTMLElement;
    host.appendChild(dom);
    flushPendingRefs();
    const { flushAllEffects, flushLayoutEffects } = await import('../src/hooks.js');
    flushLayoutEffects();
    flushAllEffects();
    await tick();
    const compDom = dom.querySelector('#c') as HTMLElement;
    compDom.parentNode!.removeChild(compDom);
    const newVNode = h('div', {}, h(Comp as any, { key: 'c', id: 'c2' }));
    patch(dom, oldVNode, newVNode);
    flushLayoutEffects();
    flushAllEffects();
    expect(cleaned).toEqual(['c']);
  });

  test('innerHTML null shape clears stale html', () => {
    const oldVNode = h('div', { dangerouslySetInnerHTML: { __html: '<b>x</b>' } });
    const el = createDOM(oldVNode) as HTMLElement;
    document.body.appendChild(el);
    expect(el.innerHTML).toBe('<b>x</b>');
    const newVNode = h('div', { dangerouslySetInnerHTML: { __html: null } });
    patch(el, oldVNode, newVNode);
    expect(el.innerHTML).toBe('');
  });

  test('removed value prop resets input', () => {
    const oldVNode = h('input', { value: 'a' });
    const el = createDOM(oldVNode) as HTMLInputElement;
    document.body.appendChild(el);
    expect(el.value).toBe('a');
    const newVNode = h('input', {});
    patch(el, oldVNode, newVNode);
    expect(el.value).toBe('');
  });

  test('normalize handles bigint symbol function and sets', () => {
    const sym = Symbol('s');
    const kids = normalizeChildren([10n as any, sym as any, (() => {}) as any, new Set(['a', 'b']) as any]);
    const vnode: VNode = { type: 'div', props: {}, children: kids, key: null };
    const dom = createDOM(vnode) as HTMLElement;
    document.body.appendChild(dom);
    expect(dom.textContent).toContain('10');
    expect(dom.textContent).toContain('s');
    expect(dom.textContent).toContain('a');
    expect(dom.textContent).toContain('b');
  });

  test('component ref attaches releases and follows change', () => {
    const seenA: unknown[] = [];
    const seenB: unknown[] = [];
    const Comp: ComponentType = () => h('span', {}, 'x');
    const v1 = h(Comp as any, { ref: (v: unknown) => { seenA.push(v); } });
    const dom = createDOM(v1) as HTMLElement;
    document.body.appendChild(dom);
    const inst = (v1 as VNode).componentInstance;
    expect(inst).toBeDefined();
    expect(seenA[seenA.length - 1]).toBe(inst);
    const v2 = h(Comp as any, { ref: (v: unknown) => { seenB.push(v); } });
    patch(dom, v1, v2);
    expect(seenA[seenA.length - 1]).toBeNull();
    expect(seenB[seenB.length - 1]).toBe(inst);
    const v3 = h('div', {}, 'gone');
    patch(dom, v2, v3);
    expect(seenB[seenB.length - 1]).toBeNull();
  });

  test('aborted render reruns state initializers on retry', () => {
    let initB = 0;
    let armed = false;
    const Comp: ComponentType = ({ mode }: any) => {
      const [a] = useState(1);
      let b = 0;
      if (mode === 2) {
        const [bb] = useState(() => {
          initB++;
          return 100 + initB;
        });
        b = bb;
      }
      if (armed) throw new Error('boom');
      return h('span', { id: 'v' }, mode === 2 ? String(b) : String(a));
    };
    const oldVNode = h('div', {}, h(Comp as any, { mode: 1 }));
    const dom = createDOM(oldVNode) as HTMLElement;
    document.body.appendChild(dom);
    expect(dom.querySelector('#v')?.textContent).toBe('1');
    armed = true;
    const badVNode = h('div', {}, h(Comp as any, { mode: 2 }));
    expect(() => patch(dom, oldVNode, badVNode)).toThrow('boom');
    expect(initB).toBe(1);
    armed = false;
    const fixedVNode = h('div', {}, h(Comp as any, { mode: 2 }));
    patch(dom, oldVNode, fixedVNode);
    expect(initB).toBe(2);
    expect(dom.querySelector('#v')?.textContent).toBe('102');
  });

  test('manual Provider call leaks no cursor', () => {
    const Ctx = createContext('d');
    const vnode = (Ctx.Provider as any)({ value: 'x', children: [] });
    expect(vnode).toBeDefined();
    expect(readRenderValue(Ctx)).toBe('d');
  });

  test('boundary fallback inside rerendered provider sees outer value', async () => {
    const Ctx = createContext('o');
    const Read: ComponentType = () => {
      const v = useContext(Ctx);
      return h('span', { id: 'r' }, v);
    };
    let armed = false;
    const Thrower: ComponentType = () => {
      if (armed) throw new Error('bad');
      return h('span', { id: 't' }, 'ok');
    };
    const { ErrorBoundary } = await import('../src/boundary.js');
    let setV: ((v: string) => void) | null = null;
    const Root: ComponentType = () => {
      const [v, setS] = useState('i');
      setV = setS;
      return h(Ctx.Provider, { value: 'o' },
        h(ErrorBoundary as any, { fallback: h(Read as any, {}) },
          h(Ctx.Provider, { value: v }, h(Thrower as any, {}))));
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Root, container);
    await tick();
    expect(container.querySelector('#t')?.textContent).toBe('ok');
    armed = true;
    setV!('i2');
    await tick();
    await tick();
    await tick();
    expect(container.querySelector('#r')?.textContent).toBe('o');
  });
});

describe('atom p3 fixes scheduler suspense dom-events', () => {
  test('requestOnce rejects when addEventListener throws', async () => {
    const target = {
      addEventListener: () => { throw new Error('nope'); },
      removeEventListener: () => {},
      dispatchEvent: () => true,
    };
    await expect(requestOnce('a', 'b', { target: target as any, timeoutMs: 50 })).rejects.toThrow('nope');
  });

  test('clearSuspended unsticks showing fallback', async () => {
    let calls1 = 0;
    let calls2 = 0;
    let gate2: ((v: string) => void) | null = null;
    let setV: ((v: number) => void) | null = null;
    const gate1 = new Promise<string>(() => {});
    const Inner: ComponentType = ({ v }: any) => {
      const out = v === 1
        ? suspend('ephem-key', () => { calls1++; return gate1; })
        : suspend('ephem-key', () => { calls2++; return new Promise<string>((res) => { gate2 = res; }); });
      return h('span', { class: 'val' }, out);
    };
    const App: ComponentType = () => {
      const [v, setS] = useState(1);
      setV = setS;
      return h(Suspense as any, { fallback: h('span', { class: 'fb' }, 'wait') }, h(Inner as any, { v }));
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);
    await tick();
    expect(container.querySelector('.fb')).not.toBeNull();
    expect(calls1).toBe(1);
    clearSuspended('ephem-key');
    setV!(2);
    await tick();
    await tick();
    expect(calls2).toBe(1);
    gate2!('done');
    await tick(30);
    await tick(30);
    expect(container.querySelector('.val')?.textContent).toBe('done');
  });
});

describe('atom p3 fixes render vlist', () => {
  test('root render error retries once and recovers', async () => {
    let armed = false;
    let setV: ((v: number) => void) | null = null;
    const Root: ComponentType = () => {
      const [v, setS] = useState(1);
      setV = setS;
      if (armed) {
        armed = false;
        throw new Error('transient');
      }
      return h('span', { id: 'r' }, String(v));
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Root, container);
    await tick();
    expect(container.querySelector('#r')?.textContent).toBe('1');
    armed = true;
    setV!(2);
    await tick();
    await tick();
    await tick();
    expect(container.querySelector('#r')?.textContent).toBe('2');
  });

  test('same-length swap repins startAtBottom list', async () => {
    mockViewport(200, 1000);
    const mk = (ids: number[]) => ids.map((id) => ({ id }));
    let setData: ((d: Array<{ id: number }>) => void) | null = null;
    const App: ComponentType = () => {
      const [data, setD] = useState(mk([1, 2, 3]));
      setData = setD;
      return h(VirtualList as any, {
        data,
        estimatedItemHeight: 50,
        containerHeight: 200,
        startAtBottom: true,
        keyExtractor: (it: { id: number }) => it.id,
        renderItem: ({ item }: any) => h('div', { key: item.id }, 'r' + item.id),
      });
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);
    await tick();
    await tick();
    const listEl = listElOf(container);
    expect(listEl.scrollTop).toBe(800);
    Object.defineProperty(listEl, 'scrollHeight', { configurable: true, value: 2000 });
    setData!(mk([4, 5, 6]));
    await tick();
    await tick();
    await tick();
    expect(listEl.scrollTop).toBe(1800);
  });

  test('append pin on short list clamps to zero', async () => {
    mockViewport(200, 100);
    const mk = (ids: number[]) => ids.map((id) => ({ id }));
    let setData: ((d: Array<{ id: number }>) => void) | null = null;
    const App: ComponentType = () => {
      const [data, setD] = useState(mk([1, 2]));
      setData = setD;
      return h(VirtualList as any, {
        data,
        estimatedItemHeight: 50,
        containerHeight: 200,
        startAtBottom: true,
        keyExtractor: (it: { id: number }) => it.id,
        renderItem: ({ item }: any) => h('div', { key: item.id }, 'r' + item.id),
      });
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);
    await tick();
    await tick();
    setData!((prev: Array<{ id: number }>) => [...prev, { id: 3 }, { id: 4 }]);
    await tick();
    await tick();
    await tick();
    expect(listElOf(container).scrollTop).toBe(0);
  });

  test('scrollToKey accounts loader height', async () => {
    mockViewport(200, 5000);
    const items = Array.from({ length: 50 }, (_, i) => ({ id: i }));
    const App: ComponentType = () =>
      h('div', {},
        h(VirtualList as any, {
          data: items,
          itemHeight: 50,
          containerHeight: 200,
          topLoader: h('div', { id: 'tl' }, 'loading'),
          scrollToKey: '2',
          renderItem: ({ item }: any) => h('div', { key: item.id }, 'r' + item.id),
        }));
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);
    await tick();
    await tick();
    await tick();
    expect(listElOf(container).scrollTop).toBe(148);
  });

  test('scrollToKey resolves custom vnode keys without extractor', async () => {
    mockViewport(200, 5000);
    const items = Array.from({ length: 50 }, (_, i) => ({ id: 'msg-' + i }));
    const App: ComponentType = () =>
      h('div', {},
        h(VirtualList as any, {
          data: items,
          itemHeight: 50,
          containerHeight: 200,
          scrollToKey: 'msg-4',
          renderItem: ({ item }: any) => h('div', { key: item.id }, item.id),
        }));
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);
    await tick();
    await tick();
    await tick();
    expect(listElOf(container).scrollTop).toBe(200);
  });

  test('scrollToKey ignores non-integer key text', async () => {
    mockViewport(200, 5000);
    const items = Array.from({ length: 50 }, (_, i) => ({ id: i }));
    const App: ComponentType = () =>
      h('div', {},
        h(VirtualList as any, {
          data: items,
          itemHeight: 50,
          containerHeight: 200,
          scrollToKey: '1.5',
          renderItem: ({ item }: any) => h('div', { key: item.id }, 'r' + item.id),
        }));
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);
    await tick();
    await tick();
    expect(listElOf(container).scrollTop).toBe(0);
  });

  test('scrollToKey refires when reorder moves the key', async () => {
    mockViewport(200, 5000);
    const mk = (ids: string[]) => ids.map((id) => ({ id }));
    let setData: ((d: Array<{ id: string }>) => void) | null = null;
    const App: ComponentType = () => {
      const [data, setD] = useState(mk(['a', 'b', 'c']));
      setData = setD;
      return h(VirtualList as any, {
        data,
        itemHeight: 50,
        containerHeight: 200,
        scrollToKey: 'c',
        keyExtractor: (it: { id: string }) => it.id,
        renderItem: ({ item }: any) => h('div', { key: item.id }, item.id),
      });
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);
    await tick();
    await tick();
    expect(listElOf(container).scrollTop).toBe(100);
    setData!(mk(['c', 'a', 'b']));
    await tick();
    await tick();
    await tick();
    expect(listElOf(container).scrollTop).toBe(0);
  });

  test('dynamic first paint honors initialNumToRender', async () => {
    mockViewport(200, 10000);
    const items = Array.from({ length: 40 }, (_, i) => ({ id: i }));
    const App: ComponentType = () =>
      h('div', {},
        h(VirtualList as any, {
          data: items,
          estimatedItemHeight: 500,
          containerHeight: 200,
          initialNumToRender: 10,
          keyExtractor: (it: { id: number }) => it.id,
          renderItem: ({ item }: any) => h('div', { key: item.id }, 'r' + item.id),
        }));
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);
    await tick();
    await tick();
    expect(container.querySelectorAll('[data-vl-key]').length).toBe(10);
  });
});
