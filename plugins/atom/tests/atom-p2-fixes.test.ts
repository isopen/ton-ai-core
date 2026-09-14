/**
 * @jest-environment jsdom
 */

import { render } from '../src/render.js';
import { createDOM, patch, flushPendingRefs } from '../src/reconciler.js';
import { createPortal } from '../src/portal.js';
import { useState, useEffect, useMemo, useDomEvent, useSyncExternalStore, flushAllEffects } from '../src/hooks.js';
import { useTransition } from '../src/scheduler.js';
import { Suspense, suspend, clearSuspended } from '../src/suspense.js';
import { VirtualList } from '../src/virtual-list.js';
import { memo } from '../src/vdom.js';
import type { ComponentType, VNode } from '../src/vdom.js';
import { TEXT } from '../src/vdom.js';

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

describe('atom p2 fixes reconciler', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('failed patch rolls back sibling effect queues', async () => {
    const runs: number[] = [];
    let setV: ((v: number) => void) | null = null;
    let armed = false;
    const Watcher: ComponentType = ({ v }: any) => {
      useEffect(() => {
        runs.push(v);
      }, [v]);
      return h('span', { id: 'w' }, String(v));
    };
    const Boom: ComponentType = () => {
      if (armed) throw new Error('boom');
      return h('span', { id: 'b' }, 'ok');
    };
    const App: ComponentType = () => {
      const [v, setS] = useState(1);
      setV = setS;
      return h('div', {}, h(Watcher as any, { v }), h(Boom as any, {}));
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);
    await tick();
    expect(runs).toEqual([1]);
    armed = true;
    setV!(2);
    await tick();
    await tick();
    await tick();
    expect(container.querySelector('#w')?.textContent).toBe('2');
    expect(runs).toEqual([1]);
    armed = false;
    setV!(3);
    await tick();
    await tick();
    expect(container.querySelector('#w')?.textContent).toBe('3');
    expect(runs).toEqual([1, 3]);
  });

  test('failed component patch restores instance props', () => {
    let armed = false;
    const Child: ComponentType = ({ label }: any) => {
      if (armed) throw new Error('bad child');
      return h('span', { id: 'c' }, label);
    };
    const oldVNode = h('div', {}, h(Child as any, { label: 'old' }));
    const dom = createDOM(oldVNode) as HTMLElement;
    document.body.appendChild(dom);
    const inst = (oldVNode.children[0] as VNode).componentInstance;
    expect(inst).toBeDefined();
    const newVNode = h('div', {}, h(Child as any, { label: 'new' }));
    armed = true;
    expect(() => patch(dom, oldVNode, newVNode)).toThrow('bad child');
    expect((inst as any).props).toEqual({ label: 'old' });
  });

  test('throwing mount fallback leaves clean queues for next mount', async () => {
    const Boom: ComponentType = () => { throw new Error('orig'); };
    const BadFb: ComponentType = () => { throw new Error('fb'); };
    const App: ComponentType = () => h('div', {}, h(Boom as any, {}));
    const { ErrorBoundary } = await import('../src/boundary.js');
    const Root: ComponentType = () => h(ErrorBoundary as any, {
      fallback: h('div', {}, h(BadFb as any, {})),
    }, h(App as any, {}));
    const container = document.createElement('div');
    document.body.appendChild(container);
    expect(() => render(Root, container)).toThrow('fb');
    flushAllEffects();
    const clean = document.createElement('div');
    document.body.appendChild(clean);
    render(() => h('span', { id: 'ok' }, 'fine'), clean);
    await tick();
    expect(clean.querySelector('#ok')?.textContent).toBe('fine');
  });

  test('slot mount failure keeps tree usable', () => {
    const Bad: ComponentType = () => { throw new Error('bad'); };
    const vnode = h('div', {}, { type: 'SLOT_NODE', props: {}, children: [h(Bad as any, {})], key: null } as VNode);
    expect(() => createDOM(vnode)).toThrow('bad');
    flushAllEffects();
    const good = h('div', { id: 'g' }, 'good');
    const dom = createDOM(good) as HTMLElement;
    document.body.appendChild(dom);
    expect(document.body.querySelector('#g')?.textContent).toBe('good');
  });

  test('throwing ref callback aborts patch with rollback', () => {
    const calm = () => {};
    const oldVNode = h('div', { id: 'w', ref: calm }, 'x');
    const dom = createDOM(oldVNode) as HTMLElement;
    document.body.appendChild(dom);
    flushPendingRefs();
    const bad = () => { throw new Error('ref boom'); };
    const newVNode = h('div', { id: 'w', ref: bad }, 'x');
    expect(() => patch(dom, oldVNode, newVNode)).toThrow('ref boom');
    flushAllEffects();
    const good = h('div', { id: 'after' }, 'after');
    const dom2 = createDOM(good) as HTMLElement;
    document.body.appendChild(dom2);
    expect(document.body.querySelector('#after')?.textContent).toBe('after');
  });

  test('portal container change keeps old content when new tree throws', () => {
    const targetA = document.createElement('div');
    const targetB = document.createElement('div');
    document.body.appendChild(targetA);
    document.body.appendChild(targetB);
    let armed = false;
    const Bad: ComponentType = () => {
      if (armed) throw new Error('bad');
      return h('span', { id: 'inb' }, 'B');
    };
    const oldVNode = createPortal(h('div', {}, h('span', { id: 'ina' }, 'A'), h(Bad as any, {})), targetA, 'p');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dom = createDOM(oldVNode);
    host.appendChild(dom);
    flushPendingRefs();
    expect(targetA.querySelector('#ina')?.textContent).toBe('A');
    armed = true;
    const newVNode = createPortal(h('div', {}, h('span', { id: 'ina' }, 'A2'), h(Bad as any, {})), targetB, 'p');
    expect(() => patch(dom, oldVNode, newVNode)).toThrow('bad');
    expect(targetA.querySelector('#ina')?.textContent).toBe('A');
    expect(targetB.querySelector('#inb')).toBeNull();
    expect(host.contains(dom)).toBe(true);
  });

  test('removed keyed portal leaves no placeholder in host', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    let setShow: ((v: boolean) => void) | null = null;
    const App: ComponentType = () => {
      const [show, setS] = useState(true);
      setShow = setS;
      return h('div', { id: 'row' },
        ...(show ? [createPortal(h('span', { id: 'pin' }, 'P'), target, 'p')] : []),
        h('span', { key: 's', id: 's' }, 'S'));
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);
    await tick();
    expect(target.querySelector('#pin')).not.toBeNull();
    setShow!(false);
    await tick();
    await tick();
    expect(target.querySelector('#pin')).toBeNull();
    const row = container.querySelector('#row') as HTMLElement;
    expect(row.childNodes.length).toBe(1);
    expect((row.firstChild as HTMLElement).id).toBe('s');
  });

  test('keyed portal reorder moves placeholder with content', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    let setFlip: ((v: boolean) => void) | null = null;
    const App: ComponentType = () => {
      const [flip, setF] = useState(false);
      setFlip = setF;
      const kids = flip
        ? [h('span', { key: 'b', id: 'b' }, 'B'), createPortal(h('span', { id: 'pin' }, 'P'), target, 'p'), h('span', { key: 'a', id: 'a' }, 'A')]
        : [createPortal(h('span', { id: 'pin' }, 'P'), target, 'p'), h('span', { key: 'a', id: 'a' }, 'A'), h('span', { key: 'b', id: 'b' }, 'B')];
      return h('div', { id: 'row' }, ...kids);
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);
    await tick();
    setFlip!(true);
    await tick();
    await tick();
    const row = container.querySelector('#row') as HTMLElement;
    const order = [...row.childNodes].map((n) => (n as HTMLElement).id || '#text');
    expect(order).toEqual(['b', '#text', 'a']);
    expect(target.querySelector('#pin')?.textContent).toBe('P');
  });

  test('slot merges child and slot refs', () => {
    const seenChild: unknown[] = [];
    const seenSlot: unknown[] = [];
    const child = h('div', { id: 'sl', ref: (el: unknown) => { seenChild.push(el); } }, 'x');
    const slot = { type: 'SLOT_NODE', props: { ref: (el: unknown) => { seenSlot.push(el); } }, children: [child], key: null } as VNode;
    const dom = createDOM(h('div', {}, slot)) as HTMLElement;
    document.body.appendChild(dom);
    flushPendingRefs();
    expect(seenChild.length).toBe(1);
    expect(seenSlot.length).toBe(1);
    expect(seenChild[0]).toBe(seenSlot[0]);
  });
});

describe('atom p2 fixes hooks scheduler suspense', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  afterEach(() => { clearSuspended(); });

  test('useSyncExternalStore stabilizes equal snapshots by identity', async () => {
    const seen: unknown[] = [];
    let notify: (() => void) | null = null;
    let bump: (() => void) | null = null;
    const store = {
      subscribe: (cb: () => void) => { notify = cb; return () => { notify = null; }; },
      getState: () => ({ v: 1 }),
    };
    const Comp: ComponentType = () => {
      const [, setN] = useState(0);
      bump = () => setN((p: number) => p + 1);
      const s = useSyncExternalStore(store.subscribe, () => ({ v: store.getState().v }), (a, b) => a.v === b.v);
      seen.push(s);
      return h('span', { id: 'n' }, String((s as any).v));
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Comp, container);
    await tick();
    bump!();
    await tick();
    await tick();
    bump!();
    await tick();
    await tick();
    expect(container.querySelector('#n')?.textContent).toBe('1');
    expect(seen.length).toBeGreaterThan(1);
    for (const s of seen) expect(s).toBe(seen[0]);
    notify!();
    await tick();
    await tick();
    expect(container.querySelector('#n')?.textContent).toBe('1');
  });

  test('useDomEvent follows target swap', async () => {
    const hits: string[] = [];
    const t1 = document.createElement('button');
    const t2 = document.createElement('button');
    document.body.appendChild(t1);
    document.body.appendChild(t2);
    let setT: ((t: HTMLElement) => void) | null = null;
    const App: ComponentType = () => {
      const [t, setX] = useState<HTMLElement>(t1);
      setT = setX;
      useDomEvent(t, 'click', () => { hits.push(t === t1 ? 't1' : 't2'); }, []);
      return h('div', {}, 'x');
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);
    await tick();
    t1.click();
    expect(hits).toEqual(['t1']);
    setT!(t2);
    await tick();
    await tick();
    t1.click();
    t2.click();
    expect(hits).toEqual(['t1', 't2']);
  });

  test('useMemo write rolls back on failed commit', () => {
    let calls = 0;
    let armed = false;
    const Memo: ComponentType = ({ v }: any) => {
      const m = useMemo(() => {
        calls++;
        return v * 10 + calls;
      }, [v]);
      return h('span', { id: 'm' }, String(m));
    };
    const Bad: ComponentType = () => {
      if (armed) throw new Error('bad');
      return h('span', { id: 'b' }, 'ok');
    };
    const oldVNode = h('div', {}, h(Memo as any, { v: 1 }), h(Bad as any, {}));
    const dom = createDOM(oldVNode) as HTMLElement;
    document.body.appendChild(dom);
    expect(calls).toBe(1);
    const nextVNode = h('div', {}, h(Memo as any, { v: 2 }), h(Bad as any, {}));
    armed = true;
    expect(() => patch(dom, oldVNode, nextVNode)).toThrow('bad');
    expect(calls).toBe(2);
    armed = false;
    const fixedVNode = h('div', {}, h(Memo as any, { v: 2 }), h(Bad as any, {}));
    patch(dom, oldVNode, fixedVNode);
    expect(calls).toBe(3);
    expect(dom.querySelector('#m')?.textContent).toBe(String(2 * 10 + 3));
  });

  test('useTransition keeps pending while first transition inflight after second throws', async () => {
    let startOuter: ((fn: () => void) => void) | null = null;
    const App: ComponentType = () => {
      const [pending, start] = useTransition();
      startOuter = start;
      return h('span', { id: 'p' }, pending ? 'yes' : 'no');
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);
    await tick();
    startOuter!(() => {});
    expect(() => startOuter!(() => { throw new Error('t'); })).toThrow('t');
    await tick(0);
    expect(container.querySelector('#p')?.textContent).toBe('yes');
    await tick(60);
    await tick(60);
    expect(container.querySelector('#p')?.textContent).toBe('no');
  });

  test('suspend wakes every owner root on resolve', async () => {
    let resolveIt: ((v: string) => void) | null = null;
    const gate = new Promise<string>((res) => { resolveIt = res; });
    const Inner: ComponentType = () => {
      const v = suspend('shared-multi-owner', () => gate);
      return h('span', { class: 'val' }, v);
    };
    const mk = () => h(Suspense as any, { fallback: h('span', { class: 'fb' }, 'wait') }, h(Inner as any, {}));
    const c1 = document.createElement('div');
    const c2 = document.createElement('div');
    document.body.appendChild(c1);
    document.body.appendChild(c2);
    render(mk as any, c1);
    render(mk as any, c2);
    await tick();
    expect(c1.querySelector('.fb')).not.toBeNull();
    expect(c2.querySelector('.fb')).not.toBeNull();
    resolveIt!('done');
    await tick(30);
    await tick(30);
    expect(c1.querySelector('.val')?.textContent).toBe('done');
    expect(c2.querySelector('.val')?.textContent).toBe('done');
  });

  test('suspend cache refreshes hits before evicting', async () => {
    const calls = new Map<string, number>();
    const mkLoader = (k: string) => () => {
      calls.set(k, (calls.get(k) ?? 0) + 1);
      return new Promise<string>(() => {});
    };
    for (let i = 0; i < 500; i++) {
      try {
        suspend('lru-' + i, mkLoader('lru-' + i));
      } catch {}
    }
    try {
      suspend('lru-0', mkLoader('lru-0'));
    } catch {}
    try {
      suspend('lru-500', mkLoader('lru-500'));
    } catch {}
    expect(calls.get('lru-0')).toBe(1);
    try {
      suspend('lru-0', mkLoader('lru-0'));
    } catch {}
    expect(calls.get('lru-0')).toBe(1);
    try {
      suspend('lru-1', mkLoader('lru-1'));
    } catch {}
    expect(calls.get('lru-1')).toBe(2);
  });
});

describe('atom p2 fixes vlist vdom', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('memo detects mutation of the same props object', async () => {
    const Inner: ComponentType = ({ label }: any) => h('span', { id: 't' }, label);
    const MemoInner = memo(Inner);
    const propsObj: Record<string, any> = { label: 'a' };
    let setTick2: ((v: number) => void) | null = null;
    const App: ComponentType = () => {
      const [n, setN] = useState(0);
      setTick2 = setN;
      void n;
      return h('div', {}, h(MemoInner as any, propsObj));
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);
    await tick();
    expect(container.querySelector('#t')?.textContent).toBe('a');
    propsObj.label = 'b';
    setTick2!(1);
    await tick();
    await tick();
    expect(container.querySelector('#t')?.textContent).toBe('b');
  });

  test('topLoader offsets visible window by loader height', (done) => {
    const items = Array.from({ length: 50 }, (_, i) => ({ id: i }));
    const App: ComponentType = () =>
      h('div', {},
        h(VirtualList as any, {
          data: items,
          itemHeight: 50,
          containerHeight: 200,
          topLoader: h('div', { id: 'tl' }, 'loading'),
          renderItem: ({ item }: any) => h('div', { key: item.id }, 'r' + item.id),
        }));
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);
    queueMicrotask(() => {
      const listEl = container.querySelector('[style*="overflow-y"]') as HTMLElement;
      listEl.scrollTop = 460;
      listEl.dispatchEvent(new Event('scroll'));
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const keys = [...container.querySelectorAll('[data-vl-key]')].map((n) => n.getAttribute('data-vl-key'));
          expect(keys[0]).toBe('5');
          expect(container.querySelector('#tl')).not.toBeNull();
          done();
        });
      });
    });
  });

  test('measured heights apply to items with custom vnode keys', (done) => {
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 70 });
    const items = Array.from({ length: 40 }, (_, i) => ({ id: 'k' + i }));
    const App: ComponentType = () =>
      h('div', {},
        h(VirtualList as any, {
          data: items,
          estimatedItemHeight: 50,
          containerHeight: 200,
          renderItem: ({ item }: any) => h('div', { key: item.id }, item.id),
        }));
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);
    queueMicrotask(() => {
      const before = container.querySelectorAll('[data-vl-key]').length;
      expect(before).toBe(12);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const after = container.querySelectorAll('[data-vl-key]').length;
            delete (HTMLElement.prototype as any).offsetHeight;
            expect(after).toBe(10);
            done();
          });
        });
      });
    });
  });
});
