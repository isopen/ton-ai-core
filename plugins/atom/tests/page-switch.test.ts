/**
 * @jest-environment jsdom
 */

import { render } from '../src/render.js';
import { setUseRafBatching } from '../src/render.js';
import { useState, useMemo } from '../src/hooks.js';
import { memo } from '../src/vdom.js';
import { ErrorBoundary } from '../src/boundary.js';
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
  const p: any = { ...props };
  if (children.length > 0) p.children = children.length === 1 ? children[0] : children;
  const { key } = p;
  void key;
  return { type, props: p, children: flat, key: p.key ?? null };
}

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

const Ctx = createContext({ lang: 'en' });

function Panel(props: any): any {
  return h('div', { class: 'Panel' }, props.children);
}
function Flex(props: any): any {
  return h('div', { class: props.className }, props.children);
}
function FpsMeter(): any {
  return null;
}
function SectionView(props: any): any {
  const ctx = useContext(Ctx);
  void ctx;
  return h('div', { class: 'section-' + props.name }, props.name + ':' + props.items.join(','));
}
const Section = memo(SectionView as any, (a: any, b: any) => a.items === b.items && a.name === b.name);

function dialogState(items: string[]) {
  return {
    page: 'dialogs', authStep: 'code', theme: 'light', langCode: 'en',
    dialogs: items, selectedPeer: null, messages: [], typingByPeer: {},
    connectionStatus: 'connected', sidebarCollapsed: false, selfUserId: 'u1',
  };
}

function authState() {
  return {
    page: 'auth', authStep: 'phone', theme: 'light', langCode: 'en',
    dialogs: [], selectedPeer: null, messages: [], typingByPeer: {},
    connectionStatus: 'disconnected', sidebarCollapsed: false, selfUserId: '',
  };
}

describe('page switch', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('logout multi-dispatch leaves single body', async () => {
    const items = ['d1', 'd2', 'd3'];
    const Root: ComponentType = () => {
      const [state, setState] = useState<any>(dialogState(items));
      (Root as any).logout = async () => {
        setState((p: any) => ({ ...p, page: 'auth', authStep: 'phone', connectionStatus: 'disconnected' }));
        setState((p: any) => ({ ...p, phone: '' }));
        await tick(5);
        await tick(5);
        setState((p: any) => ({ ...p, connectionStatus: 'connected' }));
      };
      (Root as any).churnDialogs = (next: string[]) => setState((p: any) => ({ ...p, dialogs: next }));
      const s = state;
      const ctxVal = useMemo(() => ({ lang: s.langCode }), [s.langCode]);
      return h(Panel as any, {},
        s.page !== 'auth' ? h('div', { class: 'hdr' }, 'hdr') : null,
        s.page === 'auth'
          ? h(Flex as any, { key: 'auth-body', className: 'tgui-body' },
              h(ErrorBoundary as any, { fallback: h('div', {}, 'fb') },
                h(Ctx.Provider as any, { value: ctxVal },
                  h(Section as any, { name: 'auth-form', items: ['f'] }))))
          : h(Flex as any, { key: 'app-body', className: 'tgui-body' },
              h(ErrorBoundary as any, { fallback: h('div', {}, 'fb') },
                h(Ctx.Provider as any, { value: ctxVal },
                  h(Section as any, { name: 'dialogs', items: s.dialogs })))),
        h(FpsMeter as any, {}),
      );
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Root, container);
    expect(container.querySelectorAll('.tgui-body').length).toBe(1);
    (Root as any).churnDialogs(['d1', 'd2', 'd3', 'd4']);
    await tick(10);
    (Root as any).churnDialogs(['d1', 'd4']);
    await tick(10);
    expect(container.querySelectorAll('.tgui-body').length).toBe(1);
    await (Root as any).logout();
    await tick(30);
    const bodies = container.querySelectorAll('.tgui-body');
    expect(bodies.length).toBe(1);
    expect(container.textContent).toContain('auth-form');
  });

  test('storm of churn renders plus rapid page flips keeps single body', async () => {
    setUseRafBatching(true);
    try {
    const Root: ComponentType = () => {
      const [state, setState] = useState<any>({ page: 'dialogs', n: 0, items: ['x'] });
      (Root as any).flip = () => setState((p: any) => ({ ...p, page: p.page === 'dialogs' ? 'auth' : 'dialogs' }));
      (Root as any).storm = (k: number) => {
        for (let i = 0; i < k; i++) {
          setState((p: any) => ({ ...p, n: p.n + 1, items: [...p.items, 'i' + i] }));
        }
      };
      const s = state;
      const ctxVal = useMemo(() => ({ lang: 'en' }), []);
      return h(Panel as any, {},
        s.page === 'auth'
          ? h(Flex as any, { key: 'auth-body', className: 'tgui-body' },
              h(ErrorBoundary as any, { fallback: h('div', {}, 'fb') },
                h(Ctx.Provider as any, { value: ctxVal },
                  h(Section as any, { name: 'auth-form', items: ['f'] }))))
          : h(Flex as any, { key: 'app-body', className: 'tgui-body' },
              h(ErrorBoundary as any, { fallback: h('div', {}, 'fb') },
                h(Ctx.Provider as any, { value: ctxVal },
                  h(Section as any, { name: 'dialogs', items: s.items })))),
        h(FpsMeter as any, {}),
      );
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Root, container);
    for (let round = 0; round < 4; round++) {
      (Root as any).storm(25);
      await tick(5);
      (Root as any).flip();
      await tick(15);
      expect(container.querySelectorAll('.tgui-body').length).toBe(1);
    }
    (Root as any).flip();
    await tick(30);
    expect(container.textContent).toContain('auth-form');
    expect(container.textContent).not.toContain('dialogs:');
    expect(container.querySelectorAll('.tgui-body').length).toBe(1);
    setUseRafBatching(false);
  });

  test('provider between panel and keyed branches does not resurrect removed branch', async () => {
    const Root: ComponentType = () => {
      const [page, setPage] = useState('auth');
      (Root as any).go = (p: string) => setPage(p);
      const ctxVal = useMemo(() => ({ lang: 'en' }), []);
      return h(Panel as any, {},
        h(Ctx.Provider as any, { value: ctxVal },
          page !== 'auth' ? h('div', { class: 'hdr' }, 'hdr') : null,
          page === 'auth'
            ? h(Flex as any, { key: 'auth-body', className: 'tgui-body' },
                h(Section as any, { name: 'auth-form', items: ['f'] }))
            : h(Flex as any, { key: 'app-body', className: 'tgui-body' },
                h(Section as any, { name: 'dialogs', items: ['d1'] })),
          h(FpsMeter as any, {}),
        ),
      );
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Root, container);
    expect(container.querySelectorAll('.tgui-body').length).toBe(1);
    (Root as any).go('dialogs');
    await tick(20);
    expect(container.querySelectorAll('.tgui-body').length).toBe(1);
    expect(container.textContent).toContain('dialogs:');
    (Root as any).go('auth');
    await tick(20);
    expect(container.querySelectorAll('.tgui-body').length).toBe(1);
    expect(container.textContent).toContain('auth-form:');
    expect(container.textContent).not.toContain('dialogs:');
  });
});
