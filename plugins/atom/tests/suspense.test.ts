/**
 * @jest-environment jsdom
 */

import { render } from '../src/render.js';
import { useState } from '../src/hooks.js';
import { Suspense, suspend, clearSuspended } from '../src/suspense.js';
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

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: any) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('Suspense', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    clearSuspended();
  });

  test('shows fallback while promise pending then content', async () => {
    const d = deferred<string>();
    const Async: ComponentType = () => {
      const v = suspend('k1', () => d.promise);
      return h('span', { id: 'done' }, v);
    };
    const Root: ComponentType = () => h(Suspense, { fallback: h('span', { id: 'fb' }, 'loading') }, h(Async, {}));
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Root, container);
    expect(container.querySelector('#fb')?.textContent).toBe('loading');
    d.resolve('ready');
    await tick(30);
    expect(container.querySelector('#done')?.textContent).toBe('ready');
    expect(container.querySelector('#fb')).toBeNull();
  });

  test('rejection surfaces to error boundary', async () => {
    const d = deferred<string>();
    const Async: ComponentType = () => {
      const v = suspend('k2', () => d.promise);
      return h('span', {}, v);
    };
    const Root: ComponentType = () => h(ErrorBoundary, { fallback: h('span', { id: 'err' }, 'failed') },
      h(Suspense, { fallback: h('span', {}, 'loading') }, h(Async, {})),
    );
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Root, container);
    d.reject(new Error('nope'));
    await tick(30);
    expect(container.querySelector('#err')?.textContent).toBe('failed');
  });

  test('suspend caches resolved value without loader rerun', async () => {
    let loads = 0;
    const d = deferred<string>();
    const first = () => {
      try {
        return suspend('k3', () => { loads++; return d.promise; });
      } catch (p) {
        if (p && typeof (p as any).then === 'function') throw p;
        throw p;
      }
    };
    try { first(); } catch {}
    expect(loads).toBe(1);
    d.resolve('v');
    await tick(20);
    expect(first()).toBe('v');
    expect(first()).toBe('v');
    expect(loads).toBe(1);
  });
});
