/**
 * @jest-environment jsdom
 */
import { render } from '../src/render.js';
import { useState } from '../src/hooks.js';
import type { ComponentType } from '../src/vdom.js';
import { h } from '../src/jsx-runtime.js';
import { ErrorBoundary } from '../src/boundary.js';
import { Suspense } from '../src/suspense.js';
import { createContext, useContext } from '../src/context.js';

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

describe('fragment-rooted children insertion on transition', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('suspense child appears when transitioning from text child', async () => {
    const Root: ComponentType = () => {
      const [on, setOn] = useState(false);
      (Root as any).setOn = setOn;
      return on
        ? h('div' as any, { class: 'panel' }, h('div' as any, { class: 'hdr' }, 'H'),
          h(Suspense as any, { fallback: h('div' as any, { class: 'sp' }, 'SP') },
            h('div' as any, { class: 'body' }, 'BODY')))
        : h('div' as any, { class: 'empty' }, 'EMPTY');
    };
    const c = document.createElement('div');
    document.body.appendChild(c);
    render(Root as any, c);
    await tick();
    expect(c.querySelector('.empty')).not.toBeNull();
    (Root as any).setOn(true);
    await tick(80);
    expect(c.querySelector('.hdr')?.textContent).toBe('H');
    expect(c.querySelector('.body')?.textContent).toBe('BODY');
  });

  test('error boundary child appears when transitioning from text child', async () => {
    const Root: ComponentType = () => {
      const [on, setOn] = useState(false);
      (Root as any).setOn = setOn;
      return on
        ? h('div' as any, { class: 'panel' }, h('div' as any, { class: 'hdr' }, 'H'),
          h(ErrorBoundary as any, { resetKeys: [on], fallback: h('div' as any, { class: 'fb' }, 'FB') },
            h('div' as any, { class: 'body' }, 'BODY')))
        : h('div' as any, { class: 'empty' }, 'EMPTY');
    };
    const c = document.createElement('div');
    document.body.appendChild(c);
    render(Root as any, c);
    await tick();
    (Root as any).setOn(true);
    await tick(80);
    expect(c.querySelector('.body')?.textContent).toBe('BODY');
  });

  test('nested boundary child appears on transition', async () => {
    const Root: ComponentType = () => {
      const [on, setOn] = useState(false);
      (Root as any).setOn = setOn;
      return on
        ? h('div' as any, { class: 'panel' }, h('div' as any, { class: 'hdr' }, 'H'),
          h(ErrorBoundary as any, { resetKeys: [on], fallback: h('div' as any, { class: 'fb' }, 'FB') },
            h(Suspense as any, { fallback: h('div' as any, { class: 'sp' }, 'SP') },
              h('div' as any, { class: 'body' }, 'BODY'))))
        : h('div' as any, { class: 'empty' }, 'EMPTY');
    };
    const c = document.createElement('div');
    document.body.appendChild(c);
    render(Root as any, c);
    await tick();
    (Root as any).setOn(true);
    await tick(80);
    expect(c.querySelector('.body')?.textContent).toBe('BODY');
  });

  test('provider child appears on transition', async () => {
    const Ctx = createContext<string>('dflt');
    const Inner: ComponentType = () => {
      const v = useContext(Ctx);
      return h('div' as any, { class: 'body' }, v);
    };
    const Root: ComponentType = () => {
      const [on, setOn] = useState(false);
      (Root as any).setOn = setOn;
      return on
        ? h('div' as any, { class: 'panel' }, h('div' as any, { class: 'hdr' }, 'H'),
          h(Ctx.Provider as any, { value: 'LIVE' }, h(Inner as any, {})))
        : h('div' as any, { class: 'empty' }, 'EMPTY');
    };
    const c = document.createElement('div');
    document.body.appendChild(c);
    render(Root as any, c);
    await tick();
    (Root as any).setOn(true);
    await tick(80);
    expect(c.querySelector('.body')?.textContent).toBe('LIVE');
  });

  test('sibling order stays correct after fragment insertion', async () => {
    const Root: ComponentType = () => {
      const [on, setOn] = useState(false);
      (Root as any).setOn = setOn;
      return on
        ? h('div' as any, { class: 'panel' }, h('div' as any, { class: 'a' }, 'A'),
          h(Suspense as any, { fallback: null }, h('div' as any, { class: 'body' }, 'BODY')),
          h('div' as any, { class: 'z' }, 'Z'))
        : h('div' as any, { class: 'empty' }, 'EMPTY');
    };
    const c = document.createElement('div');
    document.body.appendChild(c);
    render(Root as any, c);
    await tick();
    (Root as any).setOn(true);
    await tick(80);
    const panel = c.querySelector('.panel') as HTMLElement;
    expect(panel).not.toBeNull();
    expect([...panel.children].map((e) => e.className).join(',')).toBe('a,body,z');
  });
});
