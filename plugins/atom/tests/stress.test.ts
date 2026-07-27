/**
 * @jest-environment jsdom
 */

import { render } from '../src/render.js';
import { useState } from '../src/hooks.js';
import { createDOM, patch } from '../src/reconciler.js';
import { TEXT, FRAGMENT, memo } from '../src/vdom.js';
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

jest.setTimeout(30_000);

describe('stress: createDOM throughput', () => {
  test('10k flat spans', () => {
    const vnode = h('div', {},
      ...Array.from({ length: 10_000 }, (_, i) => h('span', { key: i, 'data-id': i }, String(i)))
    );
    const t0 = performance.now();
    const dom = createDOM(vnode);
    const dt = performance.now() - t0;
    const count = (dom as HTMLElement).querySelectorAll('span').length;
    expect(count).toBe(10_000);
    console.log(`  createDOM 10k spans: ${dt.toFixed(1)}ms (${(10_000 / dt).toFixed(0)}/ms)`);
  });

  test('20k flat spans', () => {
    const vnode = h('div', {},
      ...Array.from({ length: 20_000 }, (_, i) => h('span', { key: i }, String(i)))
    );
    const t0 = performance.now();
    const dom = createDOM(vnode);
    const dt = performance.now() - t0;
    const count = (dom as HTMLElement).querySelectorAll('span').length;
    expect(count).toBe(20_000);
    console.log(`  createDOM 20k spans: ${dt.toFixed(1)}ms (${(20_000 / dt).toFixed(0)}/ms)`);
  });
});

describe('stress: patch throughput', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  test('patch 1k items 10 times', () => {
    const N = 1_000;
    const ITERS = 10;

    let oldV = h('div', {},
      ...Array.from({ length: N }, (_, i) => h('span', { key: i }, String(i)))
    );
    let dom = createDOM(oldV);
    container.appendChild(dom);

    const t0 = performance.now();
    for (let iter = 0; iter < ITERS; iter++) {
      const newV = h('div', {},
        ...Array.from({ length: N }, (_, j) => h('span', { key: j }, String(j + iter)))
      );
      dom = patch(dom, oldV, newV);
      oldV = newV;
    }
    const dt = performance.now() - t0;
    console.log(`  patch 1k items x ${ITERS} iters: ${dt.toFixed(1)}ms (${(N * ITERS / dt).toFixed(0)} nodes/ms)`);
  });
});

describe('stress: large list render and update', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('render 1000 items', (done) => {
    let add: any;

    const List: ComponentType = () => {
      const [items, setItems] = useState<number[]>([]);
      add = () => setItems(Array.from({ length: 1_000 }, (_, i) => i));
      return h('ul', {},
        ...items.map(i => h('li', { key: i, 'data-id': i }, String(i)))
      );
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(List, container);
    add();

    queueMicrotask(() => {
      expect(container.querySelectorAll('li').length).toBe(1_000);
      done();
    });
  });

  test('render 10k items', (done) => {
    let add: any;

    const List: ComponentType = () => {
      const [items, setItems] = useState<number[]>([]);
      add = () => setItems(Array.from({ length: 10_000 }, (_, i) => i));
      return h('div', {},
        ...items.map(i => h('span', { key: i }, String(i)))
      );
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(List, container);
    add();

    queueMicrotask(() => {
      expect(container.querySelectorAll('span').length).toBe(10_000);
      done();
    });
  });

  test('reorder 1000 items', (done) => {
    let shuffle: any;

    const List: ComponentType = () => {
      const [items, setItems] = useState(Array.from({ length: 1_000 }, (_, i) => i));
      shuffle = () => setItems([...items].reverse());
      return h('ul', {},
        ...items.map(i => h('li', { key: i, 'data-id': i }, String(i)))
      );
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(List, container);
    shuffle();

    queueMicrotask(() => {
      const lis = container.querySelectorAll('li');
      expect(lis.length).toBe(1_000);
      expect(lis[0].getAttribute('data-id')).toBe('999');
      expect(lis[999].getAttribute('data-id')).toBe('0');
      done();
    });
  });
});

describe('stress: rapid state updates', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('batched updates coalesce into single render', (done) => {
    let setVal: any;
    let renderCount = 0;

    const Counter: ComponentType = () => {
      const [val, setVal_] = useState(0);
      setVal = setVal_;
      renderCount++;
      return h('div', {}, String(val));
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Counter, container);

    renderCount = 0;
    setVal(1);
    setVal(2);
    setVal(3);
    setVal(4);
    setVal(5);

    queueMicrotask(() => {
      expect(container.textContent).toBe('5');
      expect(renderCount).toBe(1);
      done();
    });
  });
});

describe('stress: deep component tree', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('20 levels deep', () => {
    let depthCounter = 0;

    const Leaf: ComponentType = () => h('span', {}, 'bottom');
    const Mid: ComponentType = (props: any) => {
      depthCounter++;
      if (props.remaining <= 1) return { type: Leaf, props: {}, children: [], key: null };
      return h('div', { 'data-depth': props.remaining },
        { type: Mid, props: { remaining: props.remaining - 1 }, children: [], key: null }
      );
    };

    const vnode = h('div', {},
      { type: Mid, props: { remaining: 20 }, children: [], key: null },
    );

    const t0 = performance.now();
    const dom = createDOM(vnode);
    const dt = performance.now() - t0;

    let el = dom as HTMLElement;
    el = el.firstElementChild as HTMLElement;
    let d = 20;
    while (el.firstElementChild && d > 1) {
      el = el.firstElementChild as HTMLElement;
      d--;
    }
    expect(el.textContent).toBe('bottom');
    expect(depthCounter).toBe(20);
    console.log(`  20-level deep tree: ${dt.toFixed(1)}ms`);
  });
});

describe('stress: large fragment children', () => {
  test('fragment with 10k children', () => {
    const children = Array.from({ length: 10_000 }, (_, i) =>
      h('span', { key: i, 'data-id': i }, String(i))
    );
    const fragment: VNode = {
      type: FRAGMENT,
      props: {},
      children,
      key: null,
    };

    const t0 = performance.now();
    const dom = createDOM(fragment);
    const dt = performance.now() - t0;
    expect(dom instanceof DocumentFragment).toBe(true);
    expect(dom.childNodes.length).toBe(10_000);
    console.log(`  Fragment 10k children: ${dt.toFixed(1)}ms (${(10_000 / dt).toFixed(0)}/ms)`);
  });
});

describe('stress: event listener setup', () => {
  test('create 10k elements with event listeners', () => {
    const handler = () => {};
    const vnode = h('div', {},
      ...Array.from({ length: 10_000 }, (_, i) =>
        h('button', { key: i, onClick: handler }, String(i))
      )
    );

    const t0 = performance.now();
    const dom = createDOM(vnode);
    const dt = performance.now() - t0;
    const count = (dom as HTMLElement).querySelectorAll('button').length;
    expect(count).toBe(10_000);
    console.log(`  10k buttons with listeners: ${dt.toFixed(1)}ms (${(10_000 / dt).toFixed(0)}/ms)`);
  });
});

describe('stress: style objects', () => {
  test('create 10k elements with inline styles', () => {
    const vnode = h('div', {},
      ...Array.from({ length: 10_000 }, (_, i) =>
        h('span', {
          key: i,
          style: { color: 'red', fontSize: '14px', marginLeft: `${i % 10}px` },
        }, String(i))
      )
    );

    const t0 = performance.now();
    const dom = createDOM(vnode);
    const dt = performance.now() - t0;
    const count = (dom as HTMLElement).querySelectorAll('span').length;
    expect(count).toBe(10_000);
    console.log(`  10k styled spans: ${dt.toFixed(1)}ms (${(10_000 / dt).toFixed(0)}/ms)`);
  });
});

describe('stress: memo', () => {
  let container: HTMLDivElement;
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); });
  afterEach(() => { document.body.removeChild(container); });

  test('memo skips render when props unchanged', (done) => {
    let innerRenders = 0;
    let setOuter: any;

    const Inner: ComponentType = memo((props: any) => {
      innerRenders++;
      return h('span', { 'data-label': props.label }, props.label);
    });

    const Outer: ComponentType = () => {
      const [label, setLabel] = useState('hello');
      setOuter = setLabel;
      return h('div', {},
        h(Inner as any, { label }),
        h('span', { 'data-id': 'static' }, 'static'),
      );
    };

    render(Outer, container);
    innerRenders = 0;

    setOuter('hello'); // same label

    queueMicrotask(() => {
      expect(innerRenders).toBe(0); // memo prevented re-render
      done();
    });
  });

  test('memo re-renders when props change', (done) => {
    let innerRenders = 0;
    let setOuter: any;

    const Inner: ComponentType = memo((props: any) => {
      innerRenders++;
      return h('span', { 'data-label': props.label }, props.label);
    });

    const Outer: ComponentType = () => {
      const [label, setLabel] = useState('hello');
      setOuter = setLabel;
      return h('div', {},
        h(Inner as any, { label }),
      );
    };

    render(Outer, container);
    innerRenders = 0;

    setOuter('world');

    queueMicrotask(() => {
      expect(innerRenders).toBe(1);
      expect(container.querySelector('span')!.textContent).toBe('world');
      done();
    });
  });

  test('memo re-renders when internal state changes', (done) => {
    let innerRenders = 0;
    let setInner: any;

    const Inner: ComponentType = memo(() => {
      const [count, setCount] = useState(0);
      innerRenders++;
      setInner = setCount;
      return h('span', {}, String(count));
    });

    const Outer: ComponentType = () => {
      return h('div', {},
        h(Inner as any, { label: 'fixed' }),
      );
    };

    render(Outer, container);
    innerRenders = 0;

    setInner(42);

    queueMicrotask(() => {
      expect(innerRenders).toBe(1);
      expect(container.querySelector('span')!.textContent).toBe('42');
      done();
    });
  });
});

describe('stress: RAF batching', () => {
  let container: HTMLDivElement;
  beforeAll(() => {
    const { setUseRafBatching } = require('../src/render.js');
    setUseRafBatching(true);
  });
  afterAll(() => {
    const { setUseRafBatching } = require('../src/render.js');
    setUseRafBatching(false);
  });
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); });
  afterEach(() => { document.body.removeChild(container); jest.useRealTimers(); });

  test('RAF batching coalesces multiple setState in one frame', () => {
    const origRAF = globalThis.requestAnimationFrame;
    const frames: (() => void)[] = [];
    globalThis.requestAnimationFrame = (cb: any) => { frames.push(cb); return 1; };

    let renderCount = 0;
    let setVal: any;

    const Counter: ComponentType = () => {
      const [val, setVal_] = useState(0);
      setVal = setVal_;
      renderCount++;
      return h('div', {}, String(val));
    };

    render(Counter, container);

    renderCount = 0;
    setVal(1);
    setVal(2);
    setVal(3);

    expect(frames.length).toBe(1);
    frames[0]();

    expect(container.textContent).toBe('3');
    expect(renderCount).toBe(1);

    globalThis.requestAnimationFrame = origRAF;
  });
});
