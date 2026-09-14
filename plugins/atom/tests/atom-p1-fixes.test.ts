/**
 * @jest-environment jsdom
 */

import { render } from '../src/render.js';
import { createDOM } from '../src/reconciler.js';
import { createPortal } from '../src/portal.js';
import { useState, useEffect, useSyncExternalStore } from '../src/hooks.js';
import { createContext, useContext } from '../src/context.js';
import { ErrorBoundary } from '../src/boundary.js';
import { useTransition } from '../src/scheduler.js';
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

describe('atom p1 fixes', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('unmount releases ref on component root host node', async () => {
    const seen: Array<HTMLElement | null> = [];
    let setShow: ((v: boolean) => void) | null = null;
    const Inner: ComponentType = () => h('div', { id: 'root-host', ref: (el: HTMLElement | null) => { seen.push(el); } }, 'x');
    const App: ComponentType = () => {
      const [show, setS] = useState(true);
      setShow = setS;
      return show ? h(Inner, {}) : h('div', { id: 'gone' }, 'gone');
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);
    await tick();
    expect(seen.length).toBeGreaterThan(0);
    setShow!(false);
    await tick();
    expect(seen[seen.length - 1]).toBeNull();
  });

  test('unmount removes direct portal child from its container', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const Portaled: ComponentType = () => createPortal(h('span', { id: 'pin' }, 'p'), target);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = container as any;
    render(Portaled, container);
    await tick();
    expect(target.querySelector('#pin')).not.toBeNull();
    const rd = (document.querySelectorAll('div').length);
    void rd;
    void handle;
    const { flushRender } = await import('../src/render.js');
    void flushRender;
    render(() => h('div', { id: 'after' }, 'after'), container);
    await tick();
    expect(target.querySelector('#pin')).toBeNull();
  });

  test('failed commit restores effect deps so retry runs the effect', async () => {
    let runs = 0;
    let boomArmed = false;
    const Watcher: ComponentType = ({ v }: any) => {
      useEffect(() => {
        runs++;
      }, [v]);
      return h('span', { id: 'w' }, String(v));
    };
    const Boom: ComponentType = () => {
      if (boomArmed) {
        boomArmed = false;
        throw new Error('transient');
      }
      return h('span', { id: 'b' }, 'fine');
    };
    let setBoth: ((v: number) => void) | null = null;
    const App: ComponentType = () => {
      const [v, setV] = useState(1);
      setBoth = setV;
      return h('div', {}, h(Watcher as any, { v }), h(Boom as any, {}));
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);
    await tick();
    expect(runs).toBe(1);
    boomArmed = true;
    setBoth!(2);
    await tick();
    await tick();
    await tick();
    expect(container.querySelector('#w')?.textContent).toBe('2');
    expect(container.querySelector('#b')).not.toBeNull();
    expect(runs).toBe(2);
  });

  test('partial createDOM failure propagates and keeps host clean', () => {
    const Good: ComponentType = () => h('span', { id: 'g' }, 'g');
    const Bad: ComponentType = () => { throw new Error('bad'); };
    const vnode = h('div', { id: 'w' }, h(Good, {}), h(Bad as any, {}));
    expect(() => createDOM(vnode)).toThrow('bad');
  });

  test('useSyncExternalStore respects custom equality without loops', async () => {
    let renders = 0;
    let notify: (() => void) | null = null;
    const state = { user: { name: 'a' } };
    const store = {
      subscribe: (cb: () => void) => { notify = cb; return () => { notify = null; }; },
      getState: () => state,
    };
    const Comp: ComponentType = () => {
      renders++;
      const name = useSyncExternalStore(store.subscribe, () => store.getState().user.name, (a, b) => a === b);
      return h('span', { id: 'n' }, name);
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Comp, container);
    await tick();
    const before = renders;
    notify!();
    await tick();
    await tick();
    expect(container.querySelector('#n')?.textContent).toBe('a');
    expect(renders - before).toBeLessThanOrEqual(2);
  });

  test('useTransition resets pending when transition throws', async () => {
    let startOuter: ((fn: () => void) => void) | null = null;
    const App: ComponentType = () => {
      const [pending, start] = useTransition();
      startOuter = start;
      return h('span', { id: 'p' }, pending ? 'yes' : 'no');
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);
    expect(() => startOuter!(() => { throw new Error('t'); })).toThrow('t');
    await tick();
    await tick();
    expect(container.querySelector('#p')?.textContent).toBe('no');
  });

  test('delegate binding removed on truthy non-object value', async () => {
    const calls: string[] = [];
    let setVal: ((v: any) => void) | null = null;
    const App: ComponentType = () => {
      const [val, setV] = useState<any>({ '.hit': () => { calls.push('hit'); } });
      setVal = setV;
      return h('div', { id: 'd', onClickDelegate: val }, h('span', { class: 'hit' }, 'x'));
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);
    await tick();
    (container.querySelector('.hit') as HTMLElement).click();
    expect(calls).toEqual(['hit']);
    setVal!('nope');
    await tick();
    (container.querySelector('.hit') as HTMLElement).click();
    expect(calls).toEqual(['hit']);
  });

  test('throwing error-boundary fallback renders null without crashing', async () => {
    const Boom: ComponentType = () => { throw new Error('orig'); };
    const App: ComponentType = () => h(ErrorBoundary as any, {
      fallback: () => { throw new Error('fb'); },
    }, h(Boom, {}));
    const container = document.createElement('div');
    document.body.appendChild(container);
    expect(() => render(App, container)).not.toThrow();
    expect(container.textContent).toBe('');
  });

  test('keyed reorder keeps portal nodes in their container', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    let setFlip: ((v: boolean) => void) | null = null;
    const App: ComponentType = () => {
      const [flip, setF] = useState(false);
      setFlip = setF;
      const ab = flip
        ? [h('span', { key: 'b', id: 'b' }, 'B'), h('span', { key: 'a', id: 'a' }, 'A')]
        : [h('span', { key: 'a', id: 'a' }, 'A'), h('span', { key: 'b', id: 'b' }, 'B')];
      return h('div', { id: 'row' }, createPortal(h('span', { key: 'pin', id: 'pin' }, 'P'), target, 'p'), ...ab);
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);
    await tick();
    expect(target.querySelector('#pin')).not.toBeNull();
    setFlip!(true);
    await tick();
    await tick();
    expect(target.querySelector('#pin')?.textContent).toBe('P');
    const row = container.querySelector('#row') as HTMLElement;
    expect([...row.children].map((e) => e.id).join(',')).toBe('b,a');
  });

  test('context update reaches consumer in same branch only', async () => {
    const Ctx = createContext('d');
    const Comp: ComponentType = ({ id }: any) => {
      const v = useContext(Ctx);
      return h('span', { id }, v);
    };
    let setV: ((v: string) => void) | null = null;
    const Root: ComponentType = () => {
      const [v, setS] = useState('a');
      setV = setS;
      return h('div', {},
        h(Ctx.Provider, { value: v }, h(Comp, { id: 'one' })),
        h(Ctx.Provider, { value: 'fixed' }, h(Comp, { id: 'two' })));
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Root, container);
    expect(container.querySelector('#one')?.textContent).toBe('a');
    expect(container.querySelector('#two')?.textContent).toBe('fixed');
    setV!('b');
    await tick();
    await tick();
    expect(container.querySelector('#one')?.textContent).toBe('b');
    expect(container.querySelector('#two')?.textContent).toBe('fixed');
  });

  test('committed snapshot does not pollute sibling render', async () => {
    const Ctx = createContext('d');
    const Comp: ComponentType = ({ id }: any) => {
      const v = useContext(Ctx);
      return h('span', { id }, v);
    };
    let setV: ((v: string) => void) | null = null;
    const Root: ComponentType = () => {
      const [v, setS] = useState('a');
      setV = setS;
      return h('div', {},
        h(Ctx.Provider, { value: v }, h(Comp, { id: 'in' })),
        h(Comp, { id: 'out' }));
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Root, container);
    expect(container.querySelector('#in')?.textContent).toBe('a');
    expect(container.querySelector('#out')?.textContent).toBe('d');
    expect((Ctx as any)._current).toBe('a');
    setV!('b');
    await tick();
    await tick();
    expect(container.querySelector('#in')?.textContent).toBe('b');
    expect(container.querySelector('#out')?.textContent).toBe('d');
    expect((Ctx as any)._current).toBe('b');
  });

  test('nested providers isolate levels and commit innermost', async () => {
    const Ctx = createContext('d');
    const Comp: ComponentType = ({ id }: any) => {
      const v = useContext(Ctx);
      return h('span', { id }, v);
    };
    const Root: ComponentType = () => h(Ctx.Provider, { value: 'outer' },
      h(Comp, { id: 'o' }),
      h(Ctx.Provider, { value: 'inner' }, h(Comp, { id: 'i' })));
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Root, container);
    expect(container.querySelector('#o')?.textContent).toBe('outer');
    expect(container.querySelector('#i')?.textContent).toBe('inner');
    expect((Ctx as any)._current).toBe('inner');
  });

  test('aborted provider mount leaves no cursor behind', async () => {
    const Ctx = createContext('d');
    const Comp: ComponentType = ({ id }: any) => {
      const v = useContext(Ctx);
      return h('span', { id }, v);
    };
    const Bad: ComponentType = () => { throw new Error('bad'); };
    expect(() => createDOM(h('div', {}, h(Ctx.Provider, { value: 'x' }, h(Bad as any, {}))))).toThrow('bad');
    const Root: ComponentType = () => h('div', {},
      h(Ctx.Provider, { value: 'y' }, h(Comp, { id: 'in' })),
      h(Comp, { id: 'out' }));
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Root, container);
    await tick();
    expect(container.querySelector('#in')?.textContent).toBe('y');
    expect(container.querySelector('#out')?.textContent).toBe('d');
  });
});
