/**
 * @jest-environment jsdom
 */

import {
  useState, useEffect, useMemo, useCallback, useRef,
} from '../src/hooks.js';
import { ComponentInstance, currentInstance, setCurrentInstance } from '../src/vdom.js';
import { render } from '../src/render.js';
import type { ComponentType, VNode } from '../src/vdom.js';

function h(type: any, props: Record<string, any> = {}, ...children: any[]): VNode {
  const flatChildren: VNode[] = [];
  for (const c of children) {
    if (c == null || c === false || c === true) continue;
    if (Array.isArray(c)) { flatChildren.push(...c); continue; }
    if (typeof c === 'string' || typeof c === 'number') {
      flatChildren.push({ type: 'TEXT_NODE', props: { nodeValue: String(c) }, children: [], key: null });
    } else {
      flatChildren.push(c);
    }
  }
  return { type, props: { ...props }, children: flatChildren, key: props.key ?? null };
}

const flush = () => new Promise<void>((r) => queueMicrotask(r));

describe('hooks safety', () => {
  test('useState outside a component throws instead of corrupting state', () => {
    setCurrentInstance(null);
    expect(() => useState(1)).toThrow(/within a component/);
  });

  test('useEffect outside a component throws', () => {
    setCurrentInstance(null);
    expect(() => useEffect(() => {})).toThrow(/within a component/);
  });

  test('useRef outside a component throws', () => {
    setCurrentInstance(null);
    expect(() => useRef(0)).toThrow(/within a component/);
  });

  test('currentInstance is cleared after ComponentInstance.render()', () => {
    setCurrentInstance(null);
    const Dummy: ComponentType = () => h('div');
    const inst = new ComponentInstance(Dummy, {});
    inst.render();
    expect(currentInstance).toBeNull();
  });

  test('functional setState applies updates sequentially in one tick', async () => {
    let inc!: () => void;
    const Counter: ComponentType = () => {
      const [n, setN] = useState(0);
      inc = () => setN((v: number) => v + 1);
      return h('div', {}, String(n));
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Counter, container);
    expect(container.textContent).toBe('0');

    inc();
    inc();
    inc();
    await flush();

    expect(container.textContent).toBe('3');
  });

  test('setState with the same value does not re-render', async () => {
    let setSame!: (v: number) => void;
    let renders = 0;
    const Comp: ComponentType = () => {
      const [v, setV] = useState(7);
      setSame = setV;
      renders++;
      return h('div', {}, String(v));
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Comp, container);
    const rendersAfterMount = renders;

    setSame(7);
    await flush();
    expect(renders).toBe(rendersAfterMount);

    setSame(8);
    await flush();
    expect(renders).toBe(rendersAfterMount + 1);
    expect(container.textContent).toBe('8');
  });

  test('useMemo recomputes only when deps change', async () => {
    let bump!: () => void;
    let computations = 0;
    const Comp: ComponentType = () => {
      const [x, setX] = useState(1);
      const [label, setLabel] = useState('a');
      bump = () => setLabel(label + 'a');
      const heavy = useMemo(() => {
        computations++;
        return x * 10;
      }, [x]);
      return h('div', {}, String(heavy), ':', label);
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Comp, container);
    expect(computations).toBe(1);

    bump();
    await flush();
    expect(computations).toBe(1);
    expect(container.textContent).toBe('10:aa');

    bump();
    await flush();
    expect(computations).toBe(1);
  });

  test('useCallback keeps identity while deps are equal', async () => {
    let bump!: () => void;
    const identities: number[] = [];
    let saved!: () => void;
    const Comp: ComponentType = () => {
      const [, setN] = useState(0);
      const [seed] = useState(42);
      bump = () => setN((v: number) => v + 1);
      const cb = useCallback(() => seed, [seed]);
      if (!identities.includes(cb.length)) identities.push(cb.length);
      saved = cb;
      identities.push(-1);
      return h('div');
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Comp, container);
    const first = saved;
    bump();
    await flush();
    expect(saved).toBe(first);
  });
});
