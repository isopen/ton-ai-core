/**
 * @jest-environment jsdom
 */

import { render } from '../src/render.js';
import { VirtualList } from '../src/virtual-list.js';
import { TEXT } from '../src/vdom.js';
import type { VNode, ComponentType } from '../src/vdom.js';

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

// Scroll-driven state is throttled to one setScrollTop per animation frame
// (virtual-list rAF batching), so assertions after a scroll event must wait
// for the rAF callback + the queued render microtask: two rAFs cover both.
function afterScroll(assert: () => void, done: jest.DoneCallback): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      try {
        assert();
        done();
      } catch (e) {
        done(e as any);
      }
    });
  });
}

describe('VirtualList', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('fixed itemHeight mode', () => {
    test('renders subset of items, not all 100', (done) => {
      const items = generateItems(100);
      const ITEM_HEIGHT = 50;
      const CONTAINER_HEIGHT = 200;

      const App: ComponentType = () =>
        h('div', { style: { height: CONTAINER_HEIGHT + 'px' } },
          h(VirtualList as any, {
            data: items,
            itemHeight: ITEM_HEIGHT,
            containerHeight: CONTAINER_HEIGHT,
            overscan: 1,
            initialNumToRender: 4,
            renderItem: ({ item }: { item: { id: number; label: string } }) =>
              h('div', { key: item.id, 'data-testid': 'item', 'data-id': String(item.id) }, item.label),
          })
        );

      const container = document.createElement('div');
      document.body.appendChild(container);
      render(App, container);

      queueMicrotask(() => {
        const rendered = container.querySelectorAll('[data-testid="item"]');
        expect(rendered.length).toBeLessThan(items.length);
        expect(rendered.length).toBeGreaterThan(0);
        done();
      });
    });

    test('scroll position determines which items are rendered', (done) => {
      const items = generateItems(100);
      const ITEM_HEIGHT = 50;
      const CONTAINER_HEIGHT = 200;

      const App: ComponentType = () =>
        h('div', { style: { height: CONTAINER_HEIGHT + 'px' } },
          h(VirtualList as any, {
            data: items,
            itemHeight: ITEM_HEIGHT,
            containerHeight: CONTAINER_HEIGHT,
            overscan: 0,
            initialNumToRender: 4,
            renderItem: ({ item }: { item: { id: number; label: string } }) =>
              h('div', { key: item.id, 'data-testid': 'item', 'data-id': String(item.id) }, item.label),
          })
        );

      const container = document.createElement('div');
      document.body.appendChild(container);
      render(App, container);

      queueMicrotask(() => {
        const listEl = container.querySelector('[style*="overflow-y"]') as HTMLElement;
        expect(listEl).not.toBeNull();
        listEl.scrollTop = 20 * ITEM_HEIGHT;
        listEl.dispatchEvent(new Event('scroll'));

        afterScroll(() => {
          const rendered = container.querySelectorAll('[data-testid="item"]');
          const firstId = rendered[0]?.getAttribute('data-id');
          expect(firstId).toBe('20');
        }, done);
      });
    });

    test('keyExtractor assigns stable keys', (done) => {
      const items = generateItems(50);
      const ITEM_HEIGHT = 50;
      const CONTAINER_HEIGHT = 200;

      const App: ComponentType = () =>
        h('div', { style: { height: CONTAINER_HEIGHT + 'px' } },
          h(VirtualList as any, {
            data: items,
            itemHeight: ITEM_HEIGHT,
            containerHeight: CONTAINER_HEIGHT,
            overscan: 0,
            keyExtractor: (item: { id: number }) => item.id,
            renderItem: ({ item }: { item: { id: number; label: string } }) =>
              h('div', { 'data-testid': 'item' }, item.label),
          })
        );

      const container = document.createElement('div');
      document.body.appendChild(container);
      render(App, container);

      queueMicrotask(() => {
        const rendered = container.querySelectorAll('[data-testid="item"]');
        for (let i = 0; i < rendered.length; i++) {
          expect(rendered[i].textContent).toBe(`Item ${i}`);
        }
        done();
      });
    });

    test('empty data renders no items', (done) => {
      const App: ComponentType = () =>
        h('div', { style: { height: '200px' } },
          h(VirtualList as any, {
            data: [],
            itemHeight: 50,
            containerHeight: 200,
            renderItem: ({ item }: { item: any }) =>
              h('div', { 'data-testid': 'item' }, String(item)),
          })
        );

      const container = document.createElement('div');
      document.body.appendChild(container);
      render(App, container);

      queueMicrotask(() => {
        const rendered = container.querySelectorAll('[data-testid="item"]');
        expect(rendered.length).toBe(0);
        done();
      });
    });

    test('spacers sum to offscreen content', (done) => {
      const items = generateItems(50);
      const ITEM_HEIGHT = 50;
      const CONTAINER_HEIGHT = 200;

      const App: ComponentType = () =>
        h('div', { style: { height: CONTAINER_HEIGHT + 'px' } },
          h(VirtualList as any, {
            data: items,
            itemHeight: ITEM_HEIGHT,
            containerHeight: CONTAINER_HEIGHT,
            overscan: 0,
            initialNumToRender: 4,
            renderItem: ({ item }: { item: { id: number; label: string } }) =>
              h('div', { key: item.id, 'data-testid': 'item' }, item.label),
          })
        );

      const container = document.createElement('div');
      document.body.appendChild(container);
      render(App, container);

      queueMicrotask(() => {
        const listEl = container.querySelector('[style*="overflow-y"]') as HTMLElement;
        const children = listEl.children;
        let totalSpacerHeight = 0;
        let itemCount = 0;
        for (let i = 0; i < children.length; i++) {
          const child = children[i] as HTMLElement;
          if (child.getAttribute('data-testid') === 'item') {
            itemCount++;
          } else if (child.style.height) {
            totalSpacerHeight += parseInt(child.style.height);
          }
        }
        expect(totalSpacerHeight + itemCount * ITEM_HEIGHT).toBe(items.length * ITEM_HEIGHT);
        done();
      });
    });

    test('does not render all items when data is large', (done) => {
      const items = generateItems(10000);
      const ITEM_HEIGHT = 50;
      const CONTAINER_HEIGHT = 400;

      const App: ComponentType = () =>
        h('div', { style: { height: CONTAINER_HEIGHT + 'px' } },
          h(VirtualList as any, {
            data: items,
            itemHeight: ITEM_HEIGHT,
            containerHeight: CONTAINER_HEIGHT,
            overscan: 2,
            initialNumToRender: 8,
            renderItem: ({ item }: { item: { id: number; label: string } }) =>
              h('div', { key: item.id, 'data-testid': 'item' }, item.label),
          })
        );

      const container = document.createElement('div');
      document.body.appendChild(container);
      render(App, container);

      queueMicrotask(() => {
        const rendered = container.querySelectorAll('[data-testid="item"]');
        expect(rendered.length).toBeLessThan(100);
        done();
      });
    });
  });

  describe('dynamic height mode', () => {
    test('renders subset of items using estimatedItemHeight', (done) => {
      const items = generateItems(100);
      const CONTAINER_HEIGHT = 200;

      const App: ComponentType = () =>
        h('div', { style: { height: CONTAINER_HEIGHT + 'px' } },
          h(VirtualList as any, {
            data: items,
            estimatedItemHeight: 50,
            containerHeight: CONTAINER_HEIGHT,
            overscan: 1,
            initialNumToRender: 4,
            renderItem: ({ item }: { item: { id: number; label: string } }) =>
              h('div', { key: item.id, 'data-testid': 'item', 'data-id': String(item.id) }, item.label),
          })
        );

      const container = document.createElement('div');
      document.body.appendChild(container);
      render(App, container);

      queueMicrotask(() => {
        const rendered = container.querySelectorAll('[data-testid="item"]');
        expect(rendered.length).toBeLessThan(items.length);
        expect(rendered.length).toBeGreaterThan(0);
        done();
      });
    });

    test('scroll changes visible window in dynamic mode', (done) => {
      const items = generateItems(100);
      const CONTAINER_HEIGHT = 200;

      const App: ComponentType = () =>
        h('div', { style: { height: CONTAINER_HEIGHT + 'px' } },
          h(VirtualList as any, {
            data: items,
            estimatedItemHeight: 50,
            containerHeight: CONTAINER_HEIGHT,
            overscan: 0,
            initialNumToRender: 4,
            renderItem: ({ item }: { item: { id: number; label: string } }) =>
              h('div', { key: item.id, 'data-testid': 'item', 'data-id': String(item.id) }, item.label),
          })
        );

      const container = document.createElement('div');
      document.body.appendChild(container);
      render(App, container);

      queueMicrotask(() => {
        const listEl = container.querySelector('[style*="overflow-y"]') as HTMLElement;
        expect(listEl).not.toBeNull();
        listEl.scrollTop = 20 * 50;
        listEl.dispatchEvent(new Event('scroll'));

        afterScroll(() => {
          const rendered = container.querySelectorAll('[data-testid="item"]');
          const firstId = rendered[0]?.getAttribute('data-id');
          expect(Number(firstId)).toBeGreaterThan(0);
          expect(Number(firstId)).toBeLessThan(20);
        }, done);
      });
    });

    test('spacers use estimated heights before measurement', (done) => {
      const items = generateItems(20);
      const CONTAINER_HEIGHT = 200;
      const EST = 50;

      const App: ComponentType = () =>
        h('div', { style: { height: CONTAINER_HEIGHT + 'px' } },
          h(VirtualList as any, {
            data: items,
            estimatedItemHeight: EST,
            containerHeight: CONTAINER_HEIGHT,
            overscan: 0,
            initialNumToRender: 4,
            renderItem: ({ item }: { item: { id: number; label: string } }) =>
              h('div', { key: item.id, 'data-testid': 'item' }, item.label),
          })
        );

      const container = document.createElement('div');
      document.body.appendChild(container);
      render(App, container);

      queueMicrotask(() => {
        const listEl = container.querySelector('[style*="overflow-y"]') as HTMLElement;
        const children = listEl.children;
        let totalSpacerHeight = 0;
        let itemCount = 0;
        for (let i = 0; i < children.length; i++) {
          const child = children[i] as HTMLElement;
          if (child.getAttribute('data-testid') === 'item') itemCount++;
          else if (child.style.height) totalSpacerHeight += parseInt(child.style.height);
        }
        expect(totalSpacerHeight + itemCount * EST).toBe(items.length * EST);
        done();
      });
    });
  });

  describe('callbacks', () => {
    test('onNearTop fires when scrolled near top', (done) => {
      const items = generateItems(100);
      let nearTop = false;

      const App: ComponentType = () =>
        h('div', { style: { height: '200px' } },
          h(VirtualList as any, {
            data: items,
            itemHeight: 50,
            containerHeight: 200,
            overscan: 0,
            onNearTop: () => { nearTop = true; },
            renderItem: ({ item }: { item: { id: number; label: string } }) =>
              h('div', { key: item.id, 'data-testid': 'item' }, item.label),
          })
        );

      const container = document.createElement('div');
      document.body.appendChild(container);
      render(App, container);

      queueMicrotask(() => {
        const listEl = container.querySelector('[style*="overflow-y"]') as HTMLElement;
        listEl.scrollTop = 50;
        listEl.dispatchEvent(new Event('scroll'));

        queueMicrotask(() => {
          expect(nearTop).toBe(true);
          done();
        });
      });
    });

    test('onEndReached fires when scrolled to bottom', (done) => {
      const items = generateItems(20);
      let endReached = false;

      const App: ComponentType = () =>
        h('div', { style: { height: '200px' } },
          h(VirtualList as any, {
            data: items,
            itemHeight: 50,
            containerHeight: 200,
            overscan: 0,
            initialNumToRender: 4,
            onEndReached: () => { endReached = true; },
            onEndReachedThreshold: 0.1,
            renderItem: ({ item }: { item: { id: number; label: string } }) =>
              h('div', { key: item.id, 'data-testid': 'item' }, item.label),
          })
        );

      const container = document.createElement('div');
      document.body.appendChild(container);
      render(App, container);

      queueMicrotask(() => {
        const listEl = container.querySelector('[style*="overflow-y"]') as HTMLElement;
        listEl.scrollTop = items.length * 50;
        listEl.dispatchEvent(new Event('scroll'));

        afterScroll(() => {
          expect(endReached).toBe(true);
        }, done);
      });
    });

    test('onReadyContent fires with container element', (done) => {
      const items = generateItems(10);
      let readyEl: HTMLDivElement | null = null;

      const App: ComponentType = () =>
        h('div', { style: { height: '200px' } },
          h(VirtualList as any, {
            data: items,
            itemHeight: 50,
            containerHeight: 200,
            onReadyContent: (el: HTMLDivElement) => { readyEl = el; },
            renderItem: ({ item }: { item: { id: number; label: string } }) =>
              h('div', { key: item.id, 'data-testid': 'item' }, item.label),
          })
        );

      const container = document.createElement('div');
      document.body.appendChild(container);
      render(App, container);

      queueMicrotask(() => {
        expect(readyEl).not.toBeNull();
        done();
      });
    });
  });
});
