/**
 * @jest-environment jsdom
 */

import { render } from '../src/render.js';
import { useState, useEffect, useRef, useMemo, useCallback } from '../src/hooks.js';
import { createDOM, patch } from '../src/reconciler.js';
import { TEXT, FRAGMENT, ComponentInstance, setCurrentInstance, currentInstance } from '../src/vdom.js';
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

describe('integration: counter', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('increments and decrements', (done) => {
    let inc: any, dec: any;

    const Counter: ComponentType = () => {
      const [count, setCount] = useState(0);
      inc = () => setCount((c: number) => c + 1);
      dec = () => setCount((c: number) => c - 1);
      return h('div', {},
        h('span', { 'data-testid': 'value' }, String(count)),
        h('button', { 'data-testid': 'inc' }, '+'),
        h('button', { 'data-testid': 'dec' }, '-'),
      );
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Counter, container);

    expect(container.querySelector('[data-testid="value"]')!.textContent).toBe('0');

    inc();

    queueMicrotask(() => {
      expect(container.querySelector('[data-testid="value"]')!.textContent).toBe('1');

      dec();
      queueMicrotask(() => {
        expect(container.querySelector('[data-testid="value"]')!.textContent).toBe('0');
        done();
      });
    });
  });
});

describe('integration: conditional rendering', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('shows/hides content based on state', (done) => {
    let toggle: any;

    const Toggle: ComponentType = () => {
      const [show, setShow] = useState(false);
      toggle = () => setShow((s: boolean) => !s);
      return h('div', {},
        show ? h('span', { 'data-testid': 'content' }, 'visible') : null,
      );
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Toggle, container);

    expect(container.querySelector('[data-testid="content"]')).toBeNull();

    toggle();

    queueMicrotask(() => {
      expect(container.querySelector('[data-testid="content"]')!.textContent).toBe('visible');

      toggle();
      queueMicrotask(() => {
        expect(container.querySelector('[data-testid="content"]')).toBeNull();
        done();
      });
    });
  });
});

describe('integration: list rendering with keys', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('renders list and reorders', (done) => {
    let reverse: any;

    const List: ComponentType = () => {
      const [items, setItems] = useState(['a', 'b', 'c']);
      reverse = () => setItems([...items].reverse());

      return h('ul', {},
        ...items.map((item) =>
          h('li', { key: item, 'data-id': item }, item)
        ),
      );
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(List, container);

    expect(container.textContent).toBe('abc');

    reverse();

    queueMicrotask(() => {
      expect(container.textContent).toBe('cba');
      const lis = container.querySelectorAll('li');
      expect(lis[0].getAttribute('data-id')).toBe('c');
      expect(lis[1].getAttribute('data-id')).toBe('b');
      expect(lis[2].getAttribute('data-id')).toBe('a');
      done();
    });
  });
});

describe('integration: useEffect cleanup on unmount', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('runs cleanup when component is removed via key change', (done) => {
    const cleanup = jest.fn();
    let toggle: any;

    const EffectComp: ComponentType = () => {
      useEffect(() => {
        return () => cleanup();
      }, []);
      return h('span', {}, 'effect');
    };

    const Parent: ComponentType = () => {
      const [show, setShow] = useState(true);
      toggle = () => setShow(false);
      return h('div', {},
        show ? h('div', { key: 'eff' }, { type: EffectComp, props: {}, children: [], key: 'eff' }) : null,
      );
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Parent, container);

    expect(container.textContent).toBe('effect');

    toggle();

    queueMicrotask(() => {
      expect(container.textContent).toBe('');
      expect(cleanup).toHaveBeenCalledTimes(1);
      done();
    });
  });
});

describe('integration: useRef', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('ref can access DOM element', () => {
    const Comp: ComponentType = () => {
      const ref = useRef<HTMLElement | null>(null);
      return h('div', { ref });
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Comp, container);

    const renderedDiv = container.firstChild as HTMLElement;
    expect(renderedDiv.tagName).toBe('DIV');
  });
});

describe('integration: useMemo', () => {
  test('memoizes computed value across renders', (done) => {
    let update: any;
    const computeFn = jest.fn((x: number) => x * 2);

    const Comp: ComponentType = () => {
      const [val, setVal] = useState(5);
      update = setVal;
      const doubled = useMemo(() => computeFn(val), [val]);
      return h('div', {}, String(doubled));
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Comp, container);

    expect(container.textContent).toBe('10');
    expect(computeFn).toHaveBeenCalledTimes(1);

    update(5);
    queueMicrotask(() => {
      expect(computeFn).toHaveBeenCalledTimes(1);
      expect(container.textContent).toBe('10');

      update(3);
      queueMicrotask(() => {
        expect(computeFn).toHaveBeenCalledTimes(2);
        expect(container.textContent).toBe('6');
        done();
      });
    });
  });
});

describe('integration: multiple components', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('nested components render correctly', () => {
    const Label: ComponentType = (props: any) => h('span', { class: 'label' }, props.text);

    const Card: ComponentType = () => h('div', { class: 'card' },
      { type: Label, props: { text: 'Title' }, children: [], key: null },
    );

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Card, container);

    expect(container.innerHTML).toBe('<div class="card"><span class="label">Title</span></div>');
  });
});

describe('integration: createDOM and patch standalone', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('patches text node directly', () => {
    const oldV: VNode = { type: TEXT, props: { nodeValue: 'old' }, children: [], key: null };
    const dom = createDOM(oldV);
    expect(dom.textContent).toBe('old');

    const newV: VNode = { type: TEXT, props: { nodeValue: 'new' }, children: [], key: null };
    patch(dom, oldV, newV);
    expect(dom.textContent).toBe('new');
  });

  test('replaces element type via patch', () => {
    const oldV = h('span', { id: 's' }, 'text');
    const dom = createDOM(oldV);
    const parent = document.createElement('div');
    parent.appendChild(dom);

    const newV = h('div', { id: 'd' }, 'text');
    const newDom = patch(dom, oldV, newV);
    expect((newDom as HTMLElement).tagName).toBe('DIV');
    expect(parent.firstChild).toBe(newDom);
  });
});

describe('integration: useCallback', () => {
  test('callback identity is stable when deps unchanged', (done) => {
    const callbacks: any[] = [];
    let setVal: any;

    const Comp: ComponentType = () => {
      const [val, set] = useState(0);
      setVal = set;
      const cb = useCallback(() => val, []);
      callbacks.push(cb);
      return h('div', {}, String(val));
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Comp, container);
    expect(callbacks[0]()).toBe(0);

    setVal(1);
    queueMicrotask(() => {
      expect(callbacks.length).toBe(2);
      expect(callbacks[1]).toBe(callbacks[0]);
      done();
    });
  });
});

describe('integration: list add and remove', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('adds item to list', (done) => {
    let add: any;
    const List: ComponentType = () => {
      const [items, setItems] = useState(['a', 'b']);
      add = () => setItems([...items, 'c']);
      return h('ul', {},
        ...items.map((item) => h('li', { key: item }, item)),
      );
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(List, container);
    expect(container.textContent).toBe('ab');

    add();
    queueMicrotask(() => {
      expect(container.textContent).toBe('abc');
      expect(container.querySelectorAll('li').length).toBe(3);
      done();
    });
  });

  test('removes item from list', (done) => {
    let remove: any;
    const List: ComponentType = () => {
      const [items, setItems] = useState(['a', 'b', 'c']);
      remove = () => setItems(items.filter((i: string) => i !== 'b'));
      return h('ul', {},
        ...items.map((item) => h('li', { key: item }, item)),
      );
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(List, container);
    expect(container.textContent).toBe('abc');

    remove();
    queueMicrotask(() => {
      expect(container.textContent).toBe('ac');
      expect(container.querySelectorAll('li').length).toBe(2);
      done();
    });
  });
});

describe('integration: nested component unmount cleanup', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('nested cleanup runs when parent is toggled off', (done) => {
    const innerCleanup = jest.fn();
    let toggle: any;

    const Inner: ComponentType = () => {
      useEffect(() => {
        return () => innerCleanup();
      }, []);
      return h('span', {}, 'inner');
    };

    const Outer: ComponentType = () => {
      useEffect(() => {
        return () => { /* outer cleanup */ };
      }, []);
      return h('div', {},
        { type: Inner, props: {}, children: [], key: null },
      );
    };

    const Parent: ComponentType = () => {
      const [show, setShow] = useState(true);
      toggle = () => setShow(false);
      return h('div', {},
        show ? { type: Outer, props: {}, children: [], key: null } : null,
      );
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Parent, container);
    expect(container.textContent).toBe('inner');

    toggle();
    queueMicrotask(() => {
      expect(container.textContent).toBe('');
      expect(innerCleanup).toHaveBeenCalledTimes(1);
      done();
    });
  });
});

describe('integration: useEffect with deps change', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('useEffect re-runs when deps change and runs old cleanup', (done) => {
    const cleanup = jest.fn();
    const effectFn = jest.fn();
    let setVal: any;

    const Comp: ComponentType = () => {
      const [val, set] = useState(0);
      setVal = set;
      useEffect(() => {
        effectFn(val);
        return () => cleanup(val);
      }, [val]);
      return h('div', {}, String(val));
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Comp, container);
    expect(effectFn).toHaveBeenCalledWith(0);

    setVal(1);
    queueMicrotask(() => {
      expect(cleanup).toHaveBeenCalledWith(0);
      expect(effectFn).toHaveBeenCalledWith(1);
      done();
    });
  });
});

describe('integration: component type swap triggers cleanup', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('changing component type runs unmount cleanups', (done) => {
    const cleanupA = jest.fn();
    let swap: any;

    const CompA: ComponentType = () => {
      useEffect(() => {
        return () => cleanupA();
      }, []);
      return h('div', {}, 'A');
    };

    const CompB: ComponentType = () => h('div', {}, 'B');

    const Parent: ComponentType = () => {
      const [useA, setUseA] = useState(true);
      swap = () => setUseA((s: boolean) => !s);
      return h('div', {},
        useA
          ? { type: CompA, props: {}, children: [], key: 'comp' }
          : { type: CompB, props: {}, children: [], key: 'comp' },
      );
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Parent, container);
    expect(container.textContent).toBe('A');

    swap();
    queueMicrotask(() => {
      expect(cleanupA).toHaveBeenCalledTimes(1);
      expect(container.textContent).toBe('B');
      done();
    });
  });
});

describe('integration: useRef with DOM after re-render', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('ref still points to DOM element after re-render', (done) => {
    const ref = { current: null as any };
    let setVal: any;

    const Comp: ComponentType = () => {
      const [val, set] = useState(0);
      setVal = set;
      return h('div', { ref }, String(val));
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Comp, container);

    const firstDiv = ref.current;
    expect(firstDiv).toBeTruthy();
    expect(firstDiv.tagName).toBe('DIV');

    setVal(1);
    queueMicrotask(() => {
      expect(ref.current).toBe(firstDiv);
      done();
    });
  });
});

describe('integration: useState lazy init in component', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('lazy initializer called only once', () => {
    const initFn = jest.fn(() => 'computed');
    let setVal: any;

    const Comp: ComponentType = () => {
      const [val, set] = useState(initFn);
      setVal = set;
      return h('div', {}, val);
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Comp, container);
    expect(container.textContent).toBe('computed');
    expect(initFn).toHaveBeenCalledTimes(1);

    setVal('updated');
    // Should re-render but not call initFn again
    expect(initFn).toHaveBeenCalledTimes(1);
  });
});
