/**
 * @jest-environment jsdom
 */

import { render } from '../src/render.js';
import { useState } from '../src/hooks.js';
import { startTransition, useTransition, inTransition } from '../src/scheduler.js';
import { setDevWarnings, isDevWarnings, traceComponent, untraceComponent, isTraced, diffProps } from '../src/dev.js';
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

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

describe('scheduler', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('urgent updates flush on microtask', async () => {
    const Root: ComponentType = () => {
      const [v, setV] = useState('a');
      (Root as any).setV = setV;
      return h('div', { id: 'u' }, v);
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Root, container);
    (Root as any).setV('b');
    await Promise.resolve();
    await Promise.resolve();
    expect(container.querySelector('#u')?.textContent).toBe('b');
  });

  test('transition updates defer past microtask and then apply', async () => {
    const Root: ComponentType = () => {
      const [v, setV] = useState('a');
      (Root as any).setV = setV;
      return h('div', { id: 't' }, v);
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Root, container);
    startTransition(() => (Root as any).setV('b'));
    await Promise.resolve();
    await Promise.resolve();
    expect(container.querySelector('#t')?.textContent).toBe('a');
    await tick();
    await tick();
    expect(container.querySelector('#t')?.textContent).toBe('b');
  });

  test('useTransition tracks pending flag', async () => {
    const seen: boolean[] = [];
    const Root: ComponentType = () => {
      const [v, setV] = useState('a');
      const [pending, start] = useTransition();
      (Root as any).start = () => start(() => setV('b'));
      seen.push(pending);
      return h('div', { id: 'p' }, v + ':' + pending);
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Root, container);
    (Root as any).start();
    await tick();
    await tick();
    expect(container.querySelector('#p')?.textContent).toBe('b:false');
    expect(seen[0]).toBe(false);
    expect(seen).toContain(true);
  });

  test('inTransition is true only inside transition', async () => {
    expect(inTransition()).toBe(false);
    let inside = false;
    startTransition(() => { inside = inTransition(); });
    expect(inside).toBe(true);
    expect(inTransition()).toBe(false);
  });
});

describe('dev warnings', () => {
  test('flag toggles', async () => {
    setDevWarnings(true);
    expect(isDevWarnings()).toBe(true);
    setDevWarnings(false);
    expect(isDevWarnings()).toBe(false);
  });

  test('diffProps lists changed keys skipping children', async () => {
    expect(diffProps({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe('b');
    expect(diffProps({ x: 1 }, { x: 1 })).toBe('');
    expect(diffProps({ children: 1 }, { children: 2 })).toBe('');
  });

  test('traceComponent registers names', async () => {
    setDevWarnings(true);
    traceComponent('Probe');
    expect(isTraced('Probe')).toBe(true);
    untraceComponent('Probe');
    expect(isTraced('Probe')).toBe(false);
    setDevWarnings(false);
  });
});
