/**
 * @jest-environment jsdom
 */

import { render } from '../src/render.js';
import { useState } from '../src/hooks.js';
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

describe('memo compare', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('custom comparator skips render on unrelated prop change', async () => {
    let renders = 0;
    const Inner: ComponentType = (props: any) => {
      renders++;
      return h('span', { id: 'm' }, props.used);
    };
    const MemoInner = memo(Inner as any, (a, b) => a.used === b.used);
    const Root: ComponentType = () => {
      const [s, setS] = useState({ used: 'a', extra: 1 });
      (Root as any).setS = setS;
      return h(MemoInner as any, { used: s.used, extra: s.extra });
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Root, container);
    expect(renders).toBe(1);
    (Root as any).setS({ used: 'a', extra: 2 });
    await tick();
    expect(renders).toBe(1);
    expect(container.querySelector('#m')?.textContent).toBe('a');
    (Root as any).setS({ used: 'b', extra: 2 });
    await tick();
    expect(renders).toBe(2);
    expect(container.querySelector('#m')?.textContent).toBe('b');
  });

  test('default shallow compare still works', async () => {
    let renders = 0;
    const Inner: ComponentType = (props: any) => {
      renders++;
      return h('span', {}, props.v);
    };
    const MemoInner = memo(Inner as any);
    const Root: ComponentType = () => {
      const [s, setS] = useState({ v: 1 });
      (Root as any).setS = setS;
      return h(MemoInner as any, { v: s.v });
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Root, container);
    (Root as any).setS({ v: 1 });
    await tick();
    expect(renders).toBe(1);
    (Root as any).setS({ v: 2 });
    await tick();
    expect(renders).toBe(2);
  });
});
