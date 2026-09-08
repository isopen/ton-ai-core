/**
 * @jest-environment jsdom
 */

import { render } from '../src/render.js';
import { useState } from '../src/hooks.js';
import { createPortal } from '../src/portal.js';
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

describe('createPortal', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('renders children into container instead of parent', async () => {
    const target = document.createElement('div');
    target.id = 'portal-target';
    document.body.appendChild(target);
    const Root: ComponentType = () => h('div', { id: 'parent' },
      h('span', {}, 'inline'),
      createPortal(h('span', { id: 'in-portal' }, 'ported'), target),
    );
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Root, container);
    expect(container.querySelector('#in-portal')).toBeNull();
    expect(target.querySelector('#in-portal')?.textContent).toBe('ported');
    expect(container.querySelector('#parent')?.textContent).toContain('inline');
  });

  test('portal content updates on state change', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const Root: ComponentType = () => {
      const [n, setN] = useState(1);
      (Root as any).setN = setN;
      return h('div', {}, createPortal(h('span', { id: 'pc' }, 'n' + n), target));
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Root, container);
    expect(target.querySelector('#pc')?.textContent).toBe('n1');
    (Root as any).setN(2);
    await tick();
    expect(target.querySelector('#pc')?.textContent).toBe('n2');
  });

  test('unmount removes portal nodes from container', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const Root: ComponentType = () => {
      const [show, setShow] = useState(true);
      (Root as any).setShow = setShow;
      return h('div', {}, show ? createPortal(h('span', { id: 'gone' }, 'x'), target) : h('span', {}, 'off'));
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dom: any = render(Root, container);
    expect(target.querySelector('#gone')).not.toBeNull();
    (Root as any).setShow(false);
    await tick();
    expect(target.querySelector('#gone')).toBeNull();
    (dom.__atomRoot as any).unmount();
    expect(target.innerHTML).toBe('');
  });

  test('moving portal to another container relocates nodes', async () => {
    const a = document.createElement('div');
    const b = document.createElement('div');
    document.body.appendChild(a);
    document.body.appendChild(b);
    const Root: ComponentType = () => {
      const [useB, setUseB] = useState(false);
      (Root as any).setUseB = setUseB;
      return h('div', {}, createPortal(h('span', { id: 'mv' }, 'm'), useB ? b : a));
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Root, container);
    expect(a.querySelector('#mv')).not.toBeNull();
    (Root as any).setUseB(true);
    await tick();
    expect(a.querySelector('#mv')).toBeNull();
    expect(b.querySelector('#mv')?.textContent).toBe('m');
  });
});
