/**
 * @jest-environment jsdom
 */

import { render } from '../src/render.js';
import { useState } from '../src/hooks.js';
import { createContext, useContext } from '../src/context.js';
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

describe('context', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('reads default value without provider', async () => {
    const Ctx = createContext('default');
    const Comp: ComponentType = () => {
      const v = useContext(Ctx);
      return h('div', {}, v);
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Comp, container);
    expect(container.textContent).toBe('default');
  });

  test('provider supplies value to consumers', async () => {
    const Ctx = createContext('default');
    const Comp: ComponentType = () => {
      const v = useContext(Ctx);
      return h('span', {}, v);
    };
    const Root: ComponentType = () => h(Ctx.Provider, { value: 'provided' }, h(Comp, {}));
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Root, container);
    expect(container.textContent).toBe('provided');
  });

  test('nested providers override outer value', async () => {
    const Ctx = createContext('default');
    const Comp: ComponentType = ({ id }: any) => {
      const v = useContext(Ctx);
      return h('span', { id }, v);
    };
    const Root: ComponentType = () => h(Ctx.Provider, { value: 'outer' },
      h(Comp, { id: 'o' }),
      h(Ctx.Provider, { value: 'inner' }, h(Comp, { id: 'i' })),
    );
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Root, container);
    expect(container.querySelector('#o')?.textContent).toBe('outer');
    expect(container.querySelector('#i')?.textContent).toBe('inner');
  });

  test('sibling outside provider keeps default', async () => {
    const Ctx = createContext('default');
    const Comp: ComponentType = ({ id }: any) => {
      const v = useContext(Ctx);
      return h('span', { id }, v);
    };
    const Root: ComponentType = () => h('div', {},
      h(Ctx.Provider, { value: 'x' }, h(Comp, { id: 'in' })),
      h(Comp, { id: 'out' }),
    );
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Root, container);
    expect(container.querySelector('#in')?.textContent).toBe('x');
    expect(container.querySelector('#out')?.textContent).toBe('default');
  });

  test('consumer updates when provider value changes', async () => {
    const Ctx = createContext('a');
    const Comp: ComponentType = () => {
      const v = useContext(Ctx);
      return h('span', { id: 'c' }, v);
    };
    const Root: ComponentType = () => {
      const [v, setV] = useState('a');
      (Root as any).setV = setV;
      return h(Ctx.Provider, { value: v }, h(Comp, {}));
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Root, container);
    expect(container.querySelector('#c')?.textContent).toBe('a');
    (Root as any).setV('b');
    await tick();
    expect(container.querySelector('#c')?.textContent).toBe('b');
  });
});
