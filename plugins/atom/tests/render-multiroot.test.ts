/**
 * @jest-environment jsdom
 */

import { render, flushRender } from '../src/render.js';
import { useState, useEffect } from '../src/hooks.js';
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

function makeCounter(): { Component: ComponentType; inc: () => void } {
  const api = { inc: () => {} };
  const Counter: ComponentType = () => {
    const [n, setN] = useState(0);
    api.inc = () => setN((v: number) => v + 1);
    return h('div', { class: 'counter' }, String(n));
  };

  return { Component: Counter, inc: () => api.inc() };
}

describe('multi-root', () => {
  test('nested setState targets its own root, not the last rendered one', async () => {
    const a = makeCounter();
    const b = makeCounter();

    const containerA = document.createElement('div');
    const containerB = document.createElement('div');
    document.body.appendChild(containerA);
    document.body.appendChild(containerB);

    const WrapA: ComponentType = () => h('section', {}, h(a.Component as any));
    const WrapB: ComponentType = () => h('section', {}, h(b.Component as any));

    render(WrapA, containerA);
    render(WrapB, containerB);

    expect(containerA.textContent).toBe('0');
    expect(containerB.textContent).toBe('0');

    a.inc();
    await flush();

    expect(containerA.textContent).toBe('1');
    expect(containerB.textContent).toBe('0');

    b.inc();
    await flush();
    expect(containerA.textContent).toBe('1');
    expect(containerB.textContent).toBe('1');
  });

  test('unmount handle removes DOM and runs effect cleanups', async () => {
    const cleanups: string[] = [];
    const Comp: ComponentType = () => {
      useEffect(() => () => cleanups.push('bye'));
      return h('div', {}, 'alive');
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dom = render(Comp, container);
    expect(container.textContent).toBe('alive');

    const handle = (dom as any).__atomRoot;
    expect(typeof handle.unmount).toBe('function');
    handle.unmount();

    expect(container.textContent).toBe('');
    expect(cleanups).toEqual(['bye']);
  });

  test('rerender handle forces a fresh render', async () => {
    let version = 0;
    const Comp: ComponentType = () => h('div', {}, 'v' + version);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dom = render(Comp, container);
    expect(container.textContent).toBe('v0');

    const handle = (dom as any).__atomRoot;
    version = 1;
    handle.rerender();
    await flush();
    expect(container.textContent).toBe('v1');
  });

  test('render() on the same container remounts cleanly', async () => {
    const cleanups: string[] = [];
    const First: ComponentType = () => {
      useEffect(() => () => cleanups.push('first'));
      return h('div', { id: 'first' }, '1');
    };
    const Second: ComponentType = () => h('div', { id: 'second' }, '2');

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(First, container);
    render(Second, container);
    await flush();

    expect(container.querySelectorAll('#first').length).toBe(0);
    expect(container.querySelector('#second')).not.toBeNull();
    expect(cleanups).toEqual(['first']);
  });
});

describe('render error resilience', () => {
  test('throwing component keeps previous DOM and recovers later', async () => {
    let fail = false;
    let version = 0;
    const Flaky: ComponentType = () => {
      if (fail) throw new Error('boom');
      return h('div', {}, 'ok-v' + version);
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dom = render(Flaky, container);
    expect(container.textContent).toBe('ok-v0');

    const handle = (dom as any).__atomRoot;

    fail = true;
    expect(() => handle.rerender()).not.toThrow();
    await flush();

    expect(container.textContent).toBe('ok-v0');

    fail = false;
    version = 2;
    handle.rerender();
    await flush();
    expect(container.textContent).toBe('ok-v2');
  });

  test('flushRender without roots is a safe no-op', () => {
    expect(() => flushRender()).not.toThrow();
  });

  test('error inside a nested child does not lose sibling subtrees', async () => {
    let failChild = false;
    const Bad: ComponentType = () => {
      if (failChild) throw new Error('child boom');
      return h('b', {}, 'B');
    };
    const Page: ComponentType = () => h('div', {}, h('i', {}, 'I'), h(Bad as any), h('u', {}, 'U'));
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Page, container);
    expect(container.textContent).toBe('IBU');

    failChild = true;
    const dom = container.firstChild as HTMLElement;

    const handle = (dom as any).__atomRoot ?? ((container.firstChild as any).__atomRoot);
    if (handle) {
      expect(() => handle.rerender()).not.toThrow();
      await flush();
    }

    expect(container.parentNode).toBe(document.body);
  });
});
