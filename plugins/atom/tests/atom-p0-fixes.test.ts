/**
 * @jest-environment jsdom
 */

import { render } from '../src/render.js';
import { createDOM, patch, flushPendingRefs } from '../src/reconciler.js';
import { useState, useRef } from '../src/hooks.js';
import { createContext, useContext } from '../src/context.js';
import { ErrorBoundary } from '../src/boundary.js';
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

describe('atom p0 fixes', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('parent rendering child directly preserves child state across updates', async () => {
    let setOuter: ((v: number) => void) | null = null;
    const Child: ComponentType = () => {
      const [n, setN] = useState(0);
      (Child as any).setN = setN;
      return h('span', { id: 'child' }, String(n));
    };
    const Parent: ComponentType = () => {
      const [o, setO] = useState(0);
      setOuter = setO;
      void o;
      return h(Child, {});
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Parent, container);
    expect(container.querySelector('#child')?.textContent).toBe('0');
    (Child as any).setN(5);
    await tick();
    expect(container.querySelector('#child')?.textContent).toBe('5');
    setOuter!(1);
    await tick();
    expect(container.querySelector('#child')?.textContent).toBe('5');
  });

  test('unmount releases object and callback refs', async () => {
    const objRef = { current: null as unknown as HTMLElement | null };
    const calls: Array<HTMLElement | null> = [];
    let setShow: ((v: boolean) => void) | null = null;
    const App: ComponentType = () => {
      const [show, setS] = useState(true);
      setShow = setS;
      return show
        ? h('div', {}, h('span', { id: 'a', ref: objRef }), h('span', { id: 'b', ref: (el: HTMLElement | null) => { calls.push(el); } }))
        : h('div', {}, 'empty');
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);
    await tick();
    expect(objRef.current).not.toBeNull();
    setShow!(false);
    await tick();
    expect(objRef.current).toBeNull();
    expect(calls[calls.length - 1]).toBeNull();
  });

  test('setState after unmount is a no-op', async () => {
    let leaked: ((v: number) => void) | null = null;
    const Inner: ComponentType = () => {
      const [n, setN] = useState(0);
      leaked = setN;
      return h('span', { id: 'n' }, String(n));
    };
    let setShow: ((v: boolean) => void) | null = null;
    const App: ComponentType = () => {
      const [show, setS] = useState(true);
      setShow = setS;
      return show ? h(Inner, {}) : h('div', { id: 'gone' }, 'gone');
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);
    setShow!(false);
    await tick();
    expect(container.querySelector('#gone')?.textContent).toBe('gone');
    expect(() => leaked!(42)).not.toThrow();
    await tick();
    expect(container.querySelector('#gone')?.textContent).toBe('gone');
  });

  test('nested providers isolate branches and propagate updates', async () => {
    const Ctx = createContext('default');
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
    expect(container.querySelector('#out')?.textContent).toBe('default');
    setV!('b');
    await tick();
    await tick();
    expect(container.querySelector('#in')?.textContent).toBe('b');
    expect(container.querySelector('#out')?.textContent).toBe('default');
  });

  test('error boundary resetKeys recovers after key change', async () => {
    const Boom: ComponentType = ({ fail }: any) => {
      if (fail) throw new Error('boom');
      return h('span', { id: 'ok' }, 'ok');
    };
    let setFail: ((v: boolean) => void) | null = null;
    const App: ComponentType = () => {
      const [fail, setF] = useState(true);
      setFail = setF;
      return h(ErrorBoundary as any, { fallback: h('span', { id: 'fb' }, 'fallback'), resetKeys: [fail] }, h(Boom as any, { fail }));
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);
    await tick();
    expect(container.querySelector('#fb')?.textContent).toBe('fallback');
    setFail!(false);
    await tick();
    await tick();
    expect(container.querySelector('#ok')?.textContent).toBe('ok');
  });

  test('failed patch keeps previous DOM', () => {
    const Good: ComponentType = () => h('span', { id: 'good' }, 'good');
    const oldVNode = h('div', { id: 'root' }, h(Good, {}));
    const dom = createDOM(oldVNode) as HTMLElement;
    document.body.appendChild(dom);
    flushPendingRefs();
    const Bad: ComponentType = () => { throw new Error('render fail'); };
    const newVNode = h('div', { id: 'root' }, h(Bad as any, {}));
    expect(() => patch(dom, oldVNode, newVNode)).toThrow();
    expect(document.body.querySelector('#good')?.textContent).toBe('good');
  });

  test('stable setState identity across renders', async () => {
    const seen = new Set<unknown>();
    const App: ComponentType = () => {
      const [, setN] = useState(0);
      seen.add(setN);
      return h('button', { id: 'b', onClick: () => setN((p) => p + 1) }, 'inc');
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);
    (container.querySelector('#b') as HTMLElement).click();
    await tick();
    (container.querySelector('#b') as HTMLElement).click();
    await tick();
    expect(seen.size).toBe(1);
  });

  test('effect cleanup runs once per dep change, not twice', async () => {
    let cleanups = 0;
    let runs = 0;
    let setV: ((v: number) => void) | null = null;
    const { useEffect } = require('../src/hooks.js') as typeof import('../src/hooks.js');
    const App: ComponentType = () => {
      const [v, setS] = useState(0);
      setV = setS;
      const ref = useRef(v);
      ref.current = v;
      useEffect(() => {
        runs++;
        return () => { cleanups++; };
      }, [v]);
      return h('span', { id: 'v' }, String(v));
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);
    await tick();
    const runsAfterMount = runs;
    setV!(1);
    await tick();
    expect(runs).toBe(runsAfterMount + 1);
    expect(cleanups).toBe(1);
  });
});
