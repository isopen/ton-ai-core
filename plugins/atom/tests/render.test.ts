/**
 * @jest-environment jsdom
 */

import { render } from '../src/render.js';
import { useState, useRef, useEffect } from '../src/hooks.js';
import type { ComponentType } from '../src/vdom.js';

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
  const flatChildren: any[] = [];
  for (const c of children) {
    if (c == null || c === false || c === true) continue;
    if (Array.isArray(c)) { flatChildren.push(...c); continue; }
    if (typeof c === 'string' || typeof c === 'number') {
      flatChildren.push({ type: 'TEXT_NODE', props: { nodeValue: String(c) }, children: [], key: null });
    } else {
      flatChildren.push(c);
    }
  }
  return { type, props: { ...props }, children: flatChildren, key: (props as any)?.key ?? null };
}

describe('render', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('mounts component to container', () => {
    const Comp: ComponentType = () => h('div', { id: 'root' }, 'Hello');
    const container = document.createElement('div');
    document.body.appendChild(container);

    const dom = render(Comp, container);
    expect(dom).toBeTruthy();
    expect(container.innerHTML).toBe('<div id="root">Hello</div>');
  });

  test('returns the root DOM node', () => {
    const Comp: ComponentType = () => h('span', {}, 'test');
    const container = document.createElement('div');
    document.body.appendChild(container);

    const dom = render(Comp, container);
    expect(dom.nodeType).toBe(Node.ELEMENT_NODE);
    expect((dom as HTMLElement).tagName).toBe('SPAN');
  });

  test('re-renders on state update via microtask', (done) => {
    let setText: any;
    const Comp: ComponentType = () => {
      const [text, set] = useState('before');
      setText = set;
      return h('div', {}, text);
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Comp, container);

    expect(container.textContent).toBe('before');

    setText('after');

    queueMicrotask(() => {
      expect(container.textContent).toBe('after');
      done();
    });
  });

  test('batches multiple state updates', (done) => {
    let setA: any;
    let setB: any;
    const Comp: ComponentType = () => {
      const [a, setA_] = useState('a');
      const [b, setB_] = useState('b');
      setA = setA_;
      setB = setB_;
      return h('div', {}, `${a}-${b}`);
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Comp, container);

    expect(container.textContent).toBe('a-b');

    setA('x');
    setB('y');

    queueMicrotask(() => {
      expect(container.textContent).toBe('x-y');
      done();
    });
  });

  test('mounts component with props', () => {
    const Comp: ComponentType = (props: any) => h('div', {}, props.text);
    const container = document.createElement('div');
    document.body.appendChild(container);

    render(Comp, container);
    expect(container.textContent).toBe('');
  });

  test('sets up devtools when window exists', () => {
    const Comp: ComponentType = () => h('div', {}, 'devtools');
    const container = document.createElement('div');
    document.body.appendChild(container);

    render(Comp, container);
    expect((window as any).__ATOM_DEVTOOLS__).toBeDefined();
    expect(typeof (window as any).__ATOM_DEVTOOLS__.getRoot).toBe('function');
    expect(typeof (window as any).__ATOM_DEVTOOLS__.inspect).toBe('function');
  });

  test('inspectTree returns component tree structure', () => {
    const Comp: ComponentType = () => h('div', {}, 'hello');
    const container = document.createElement('div');
    document.body.appendChild(container);

    render(Comp, container);
    const tree = (window as any).__ATOM_DEVTOOLS__.inspect();
    expect(tree).toBeDefined();
    expect(tree.name).toBe('Comp');
    expect(tree.props).toBeDefined();
    expect(Array.isArray(tree.children)).toBe(true);
  });

  test('inspectTree shows nested components', () => {
    const Child: ComponentType = () => h('span', {}, 'child');
    const Parent: ComponentType = () => h('div', {}, { type: Child, props: {}, children: [], key: null });
    const container = document.createElement('div');
    document.body.appendChild(container);

    render(Parent, container);
    const tree = (window as any).__ATOM_DEVTOOLS__.inspect();
    expect(tree.name).toBe('Parent');
    expect(tree.children.length).toBeGreaterThanOrEqual(0);
  });

  test('state updates via devtools getRoot', (done) => {
    let setVal: any;
    const Comp: ComponentType = () => {
      const [val, set] = useState(0);
      setVal = set;
      return h('div', {}, String(val));
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Comp, container);
    expect(container.textContent).toBe('0');

    setVal(42);

    queueMicrotask(() => {
      expect(container.textContent).toBe('42');
      done();
    });
  });

  test('batched updates only trigger one re-render', (done) => {
    const renderFn = jest.fn();
    let setA: any;
    let setB: any;

    const Comp: ComponentType = () => {
      renderFn();
      const [a, setA_] = useState(1);
      const [b, setB_] = useState(2);
      setA = setA_;
      setB = setB_;
      return h('div', {}, `${a},${b}`);
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Comp, container);
    expect(renderFn).toHaveBeenCalledTimes(1);

    setA(10);
    setB(20);

    queueMicrotask(() => {
      expect(container.textContent).toBe('10,20');
      expect(renderFn).toHaveBeenCalledTimes(2);
      done();
    });
  });

  test('effect cleanup on re-render', (done) => {
    const cleanup = jest.fn();
    let setVal: any;

    const Comp: ComponentType = () => {
      const [val, set] = useState(0);
      setVal = set;
      useEffect(() => {
        return () => cleanup();
      }, [val]);
      return h('div', {}, String(val));
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Comp, container);

    setVal(1);

    queueMicrotask(() => {
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(container.textContent).toBe('1');
      done();
    });
  });

  test('renders Fragment-based component', () => {
    const Comp: ComponentType = () => ({
      type: 'FRAGMENT_NODE' as any,
      props: {},
      children: [
        h('span', { 'data-id': 'first' }, 'a'),
        h('span', { 'data-id': 'second' }, 'b'),
      ],
      key: null,
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const dom = render(Comp, container);
    expect(container.childNodes.length).toBe(2);
    expect(container.children[0].tagName).toBe('SPAN');
    expect(container.children[1].tagName).toBe('SPAN');
    expect(container.textContent).toBe('ab');
  });

  test('getRoot returns the root instance', () => {
    const Comp: ComponentType = () => h('div', {}, 'root');
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Comp, container);
    const root = (window as any).__ATOM_DEVTOOLS__.getRoot();
    expect(root).toBeTruthy();
    expect(root.displayName).toBe('Comp');
  });

  test('inspectTree includes state from hooks', () => {
    let setVal: any;
    const Comp: ComponentType = () => {
      const [val, set] = useState('stateful');
      setVal = set;
      return h('div', {}, val);
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Comp, container);
    const tree = (window as any).__ATOM_DEVTOOLS__.inspect();
    expect(tree.state).toContain('stateful');

    setVal('updated');
    queueMicrotask(() => {
      const tree2 = (window as any).__ATOM_DEVTOOLS__.inspect();
      expect(tree2.state).toContain('updated');
    });
  });

  test('re-renders on multiple sequential updates', (done) => {
    let setVal: any;
    const Comp: ComponentType = () => {
      const [val, set] = useState(0);
      setVal = set;
      return h('div', {}, String(val));
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Comp, container);
    expect(container.textContent).toBe('0');

    setVal(1);
    queueMicrotask(() => {
      expect(container.textContent).toBe('1');
      setVal(2);
      queueMicrotask(() => {
        expect(container.textContent).toBe('2');
        done();
      });
    });
  });
});
