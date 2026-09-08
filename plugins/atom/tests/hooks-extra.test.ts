/**
 * @jest-environment jsdom
 */

import { render } from '../src/render.js';
import { useState, useEffect, useReducer, useLayoutEffect, useSyncExternalStore, useSelector } from '../src/hooks.js';
import { memo } from '../src/vdom.js';
import type { ComponentType } from '../src/vdom.js';

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
  const flat: any[] = [];
  const push = (c: any) => {
    if (c == null || c === false || c === true) return;
    if (Array.isArray(c)) { c.forEach(push); return; }
    if (typeof c === 'string' || typeof c === 'number') {
      flat.push({ type: 'TEXT_NODE', props: { nodeValue: String(c) }, children: [], key: null });
    } else {
      flat.push(c);
    }
  };
  children.forEach(push);
  const p = { ...props };
  if (children.length > 0) p.children = children.length === 1 ? children[0] : children;
  return { type, props: p, children: flat, key: props?.key ?? null };
}

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

describe('useReducer', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('dispatches actions through reducer', async () => {
    let dispatch: any;
    const Comp: ComponentType = () => {
      const [count, d] = useReducer((s: number, a: { n: number }) => s + a.n, 0);
      dispatch = d;
      return h('div', {}, count);
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Comp, container);
    expect(container.textContent).toBe('0');
    dispatch({ n: 5 });
    await tick();
    expect(container.textContent).toBe('5');
  });

  test('dispatch identity is stable', async () => {
    const seen: any[] = [];
    let bump: any;
    const Comp: ComponentType = () => {
      const [v, d] = useReducer((s: number, a: number) => s + a, 0);
      const [, setBump] = useState(0);
      bump = () => setBump((x: number) => x + 1);
      seen.push(d);
      return h('div', {}, v);
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Comp, container);
    bump();
    await tick();
    expect(seen.length).toBe(2);
    expect(seen[0]).toBe(seen[1]);
  });

  test('supports lazy init', async () => {
    const Comp: ComponentType = () => {
      const [v] = useReducer((s: number, a: number) => s + a, 10, (x) => x * 2);
      return h('div', {}, v);
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Comp, container);
    expect(container.textContent).toBe('20');
  });
});

describe('useLayoutEffect', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('runs before passive effects with measured DOM', async () => {
    const order: string[] = [];
    let observed = '';
    const Comp: ComponentType = () => {
      const [v, setV] = useState('a');
      (Comp as any).setV = setV;
      useLayoutEffect(() => {
        order.push('layout');
        observed = document.getElementById('probe')?.textContent || '';
      }, [v]);
      useEffect(() => {
        order.push('passive');
      }, [v]);
      return h('div', { id: 'probe' }, v);
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Comp, container);
    expect(order).toEqual(['layout', 'passive']);
    expect(observed).toBe('a');
    order.length = 0;
    (Comp as any).setV('b');
    await tick();
    expect(order).toEqual(['layout', 'passive']);
    expect(observed).toBe('b');
  });

  test('cleanup runs on unmount', async () => {
    let cleaned = false;
    const Inner: ComponentType = () => {
      useLayoutEffect(() => () => { cleaned = true; }, []);
      return h('span', {}, 'x');
    };
    const Outer: ComponentType = () => {
      const [show, setShow] = useState(true);
      (Outer as any).setShow = setShow;
      return show ? h(Inner, {}) : h('span', {}, 'gone');
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Outer, container);
    (Outer as any).setShow(false);
    await tick();
    expect(cleaned).toBe(true);
    expect(container.textContent).toBe('gone');
  });
});

describe('useSyncExternalStore', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  function makeStore(initial: number) {
    let value = initial;
    const subs = new Set<() => void>();
    return {
      subscribe: (cb: () => void) => {
        subs.add(cb);
        return () => { subs.delete(cb); };
      },
      getSnapshot: () => value,
      set: (v: number) => {
        value = v;
        [...subs].forEach((cb) => cb());
      },
    };
  }

  test('tracks external snapshots', async () => {
    const store = makeStore(1);
    const Comp: ComponentType = () => {
      const v = useSyncExternalStore(store.subscribe, store.getSnapshot);
      return h('div', {}, v);
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Comp, container);
    expect(container.textContent).toBe('1');
    store.set(2);
    await tick();
    expect(container.textContent).toBe('2');
  });
});

describe('useSelector', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  function makeStateStore() {
    let state = { a: 1, b: 1 };
    const subs = new Set<() => void>();
    return {
      subscribe: (cb: () => void) => {
        subs.add(cb);
        return () => { subs.delete(cb); };
      },
      getState: () => state,
      set: (next: { a: number; b: number }) => {
        state = next;
        [...subs].forEach((cb) => cb());
      },
    };
  }

  test('skips render when selected slice is unchanged', async () => {
    const store = makeStateStore();
    let rendersA = 0;
    let rendersB = 0;
    const CompA: ComponentType = memo(() => {
      rendersA++;
      const v = useSelector(store, (s) => s.a);
      return h('span', { id: 'a' }, v);
    });
    const CompB: ComponentType = memo(() => {
      rendersB++;
      const v = useSelector(store, (s) => s.b);
      return h('span', { id: 'b' }, v);
    });
    const Root: ComponentType = () => h('div', {}, h(CompA, {}), h(CompB, {}));
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Root, container);
    expect(rendersA).toBe(1);
    expect(rendersB).toBe(1);
    store.set({ a: 2, b: 1 });
    await tick();
    expect(container.querySelector('#a')?.textContent).toBe('2');
    expect(rendersA).toBe(2);
    expect(rendersB).toBe(1);
  });
});
