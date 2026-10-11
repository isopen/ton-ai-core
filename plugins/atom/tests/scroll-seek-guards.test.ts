/**
 * @jest-environment jsdom
 */

import { render } from '../src/render.js';
import { VirtualList } from '../src/virtual-list.js';
import { useState } from '../src/hooks.js';
import type { ComponentType, VNode } from '../src/vdom.js';
import { TEXT } from '../src/vdom.js';

function h(type: any, props: Record<string, any> = {}, ...children: any[]): VNode {
  const flatChildren: VNode[] = [];
  for (const c of children) {
    if (c == null || c === false || c === true) continue;
    if (Array.isArray(c)) { flatChildren.push(...c); continue; }
    if (typeof c === 'string' || typeof c === 'number') {
      flatChildren.push({ type: TEXT, props: { nodeValue: String(c) }, children: [], key: null });
    } else {
      flatChildren.push(c);
    }
  }
  return { type, props: { ...props }, children: flatChildren, key: (props as any)?.key ?? null };
}

function generateItems(n: number): { id: number; label: string }[] {
  return Array.from({ length: n }, (_, i) => ({ id: i, label: `Item ${i}` }));
}

function afterScroll(assert: () => void, done?: jest.DoneCallback): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      try {
        assert();
        done?.();
      } catch (e) {
        if (done) done(e as any);
        else throw e;
      }
    });
  });
}

function listElOf(container: HTMLElement): HTMLElement {
  return container.querySelector('[style*="overflow-y"]') as HTMLElement;
}

function renderRow(item: { id: number; label: string }) {
  return h('div', { key: item.id }, item.label);
}

describe('scroll seek guards', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 200 });
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 5000 });
  });

  afterEach(() => {
    delete (HTMLElement.prototype as any).clientHeight;
    delete (HTMLElement.prototype as any).scrollHeight;
  });

  test('scrollToKey does not yank the user back after they scrolled away', (done) => {
    const items = generateItems(100);
    let pushMore: ((next: { id: number; label: string }[]) => void) | null = null;
    const App: ComponentType = () => {
      const [data, setData] = useState(items);
      pushMore = setData;
      return h('div', { style: { height: '200px' } },
        h(VirtualList as any, {
          data,
          itemHeight: 50,
          containerHeight: 200,
          scrollToKey: '30',
          renderItem: ({ item }: { item: { id: number; label: string } }) => renderRow(item),
        }));
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);
    queueMicrotask(() => {
      const listEl = listElOf(container);
      afterScroll(() => {
        expect(listEl.scrollTop).toBe(30 * 50);
        listEl.scrollTop = 100;
        listEl.dispatchEvent(new Event('scroll'));
        pushMore!([...generateItems(100), ...generateItems(10).map((g) => ({ ...g, id: 100 + g.id }))]);
        afterScroll(() => {
          expect(listEl.scrollTop).toBe(100);
          done();
        });
      });
    });
  });

  test('initialScrollKey seeks once and does not re-seek on data growth', (done) => {
    const items = generateItems(100);
    let pushMore: ((next: { id: number; label: string }[]) => void) | null = null;
    const App: ComponentType = () => {
      const [data, setData] = useState(items);
      pushMore = setData;
      return h('div', { style: { height: '200px' } },
        h(VirtualList as any, {
          data,
          itemHeight: 50,
          containerHeight: 200,
          initialScrollKey: '80',
          scrollToKey: '10',
          renderItem: ({ item }: { item: { id: number; label: string } }) => renderRow(item),
        }));
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);
    queueMicrotask(() => {
      const listEl = listElOf(container);
      afterScroll(() => {
        expect(listEl.scrollTop).toBe(80 * 50);
        pushMore!([...generateItems(100), ...generateItems(10).map((g) => ({ ...g, id: 100 + g.id }))]);
        afterScroll(() => {
          expect(listEl.scrollTop).toBe(80 * 50);
          done();
        });
      });
    });
  });

  test('missing initialScrollKey falls back to scrollToKey', (done) => {
    const items = generateItems(100);
    const App: ComponentType = () =>
      h('div', { style: { height: '200px' } },
        h(VirtualList as any, {
          data: items,
          itemHeight: 50,
          containerHeight: 200,
          initialScrollKey: '9999',
          scrollToKey: '10',
          renderItem: ({ item }: { item: { id: number; label: string } }) => renderRow(item),
        }));
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);
    queueMicrotask(() => {
      const listEl = listElOf(container);
      afterScroll(() => {
        expect(listEl.scrollTop).toBe(10 * 50);
        done();
      });
    });
  });

  test('restored position is not dragged to the bottom by the startAtBottom pin', (done) => {
    const items = generateItems(100);
    let pushMore: ((next: { id: number; label: string }[]) => void) | null = null;
    const App: ComponentType = () => {
      const [data, setData] = useState(items);
      pushMore = setData;
      return h('div', { style: { height: '200px' } },
        h(VirtualList as any, {
          data,
          itemHeight: 50,
          containerHeight: 200,
          startAtBottom: true,
          initialScrollKey: '30',
          renderItem: ({ item }: { item: { id: number; label: string } }) => renderRow(item),
        }));
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);
    queueMicrotask(() => {
      const listEl = listElOf(container);
      afterScroll(() => {
        expect(listEl.scrollTop).toBe(30 * 50);
        pushMore!([...generateItems(100), ...generateItems(10).map((g) => ({ ...g, id: 100 + g.id }))]);
        afterScroll(() => {
          expect(listEl.scrollTop).toBe(30 * 50);
          done();
        });
      });
    });
  });

  test('a user scroll after the restore releases the hold and lets the bottom pin work again', (done) => {
    const items = generateItems(100);
    let pushMore: ((next: { id: number; label: string }[]) => void) | null = null;
    const App: ComponentType = () => {
      const [data, setData] = useState(items);
      pushMore = setData;
      return h('div', { style: { height: '200px' } },
        h(VirtualList as any, {
          data,
          itemHeight: 50,
          containerHeight: 200,
          startAtBottom: true,
          initialScrollKey: '30',
          renderItem: ({ item }: { item: { id: number; label: string } }) => renderRow(item),
        }));
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);
    queueMicrotask(() => {
      const listEl = listElOf(container);
      afterScroll(() => {
        listEl.scrollTop = 2000;
        listEl.dispatchEvent(new Event('scroll'));
        pushMore!([...generateItems(100), ...generateItems(10).map((g) => ({ ...g, id: 100 + g.id }))]);
        afterScroll(() => {
          expect(listEl.scrollTop).toBe(2000);
          done();
        });
      });
    });
  });
});
