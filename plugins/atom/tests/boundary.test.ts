/**
 * @jest-environment jsdom
 */

import { render } from '../src/render.js';
import { useState } from '../src/hooks.js';
import { ErrorBoundary } from '../src/boundary.js';
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

describe('ErrorBoundary', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('renders fallback when child throws', async () => {
    const Boom: ComponentType = () => {
      throw new Error('boom');
    };
    const Root: ComponentType = () => h(ErrorBoundary, { fallback: h('div', { id: 'fb' }, 'recovered') }, h(Boom, {}));
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Root, container);
    expect(container.querySelector('#fb')?.textContent).toBe('recovered');
  });

  test('supports render-prop fallback with error', async () => {
    const Boom: ComponentType = () => {
      throw new Error('bad-data');
    };
    const Root: ComponentType = () => h(ErrorBoundary, {
      fallback: (e: any) => h('div', { id: 'fb2' }, 'caught:' + e.message),
    }, h(Boom, {}));
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Root, container);
    expect(container.querySelector('#fb2')?.textContent).toBe('caught:bad-data');
  });

  test('healthy siblings keep rendering', async () => {
    const Boom: ComponentType = () => {
      throw new Error('boom');
    };
    const Root: ComponentType = () => h('div', {},
      h(ErrorBoundary, { fallback: h('span', { id: 'fb3' }, 'fb') }, h(Boom, {})),
      h('span', { id: 'ok' }, 'alive'),
    );
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Root, container);
    expect(container.querySelector('#fb3')?.textContent).toBe('fb');
    expect(container.querySelector('#ok')?.textContent).toBe('alive');
  });

  test('recovers when resetKeys change', async () => {
    let fail = true;
    const Flaky: ComponentType = () => {
      if (fail) throw new Error('flaky');
      return h('span', { id: 'fine' }, 'fine');
    };
    const Root: ComponentType = () => {
      const [k, setK] = useState(0);
      (Root as any).setK = setK;
      return h(ErrorBoundary, { fallback: h('span', { id: 'fb4' }, 'fb'), resetKeys: [k] }, h(Flaky, {}));
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Root, container);
    expect(container.querySelector('#fb4')?.textContent).toBe('fb');
    fail = false;
    (Root as any).setK(1);
    await tick();
    expect(container.querySelector('#fine')?.textContent).toBe('fine');
  });

  test('unhandled update error keeps previous DOM', async () => {
    let fail = false;
    const Maybe: ComponentType = () => {
      if (fail) throw new Error('late');
      return h('span', { id: 'v' }, 'v1');
    };
    const Root: ComponentType = () => {
      const [n, setN] = useState(0);
      (Root as any).bump = () => setN(n + 1);
      void n;
      return h(Maybe, {});
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Root, container);
    expect(container.querySelector('#v')?.textContent).toBe('v1');
    fail = true;
    (Root as any).bump();
    await tick();
    expect(container.querySelector('#v')?.textContent).toBe('v1');
  });
});
