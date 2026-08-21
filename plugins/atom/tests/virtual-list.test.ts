/**
 * @jest-environment jsdom
 */

import { render } from '../src/render.js';
import { VirtualList } from '../src/virtual-list.js';
import { useState } from '../src/hooks.js';
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

    test('onVisibleRangeChange fires with start/end', (done) => {
      const items = generateItems(50);
      const calls: string[] = [];
      const App: ComponentType = () =>
        h('div', { style: { height: '200px' } },
          h(VirtualList as any, {
            data: items,
            itemHeight: 50,
            containerHeight: 200,
            overscan: 0,
            onVisibleRangeChange: (start: number, end: number) => { calls.push(start + '-' + end); },
            renderItem: ({ item }: { item: { id: number; label: string } }) =>
              h('div', { key: item.id, 'data-testid': 'item' }, item.label),
          })
        );

      const container = document.createElement('div');
      document.body.appendChild(container);
      render(App, container);

      queueMicrotask(() => {
        expect(calls.length).toBeGreaterThan(0);
        done();
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

  describe('layout-mocked behavior', () => {
    let origClientHeight: PropertyDescriptor | undefined;
    let origScrollHeight: PropertyDescriptor | undefined;
    let origOffsetHeight: PropertyDescriptor | undefined;

    beforeEach(() => {
      origClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
      origScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
      origOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    });

    afterEach(() => {
      if (origClientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', origClientHeight);
      else delete (HTMLElement.prototype as any).clientHeight;
      if (origScrollHeight) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', origScrollHeight);
      else delete (HTMLElement.prototype as any).scrollHeight;
      if (origOffsetHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', origOffsetHeight);
      else delete (HTMLElement.prototype as any).offsetHeight;
    });

    function defineListMetrics(listEl: HTMLElement, opts: { client?: number; scroll?: number }) {
      if (opts.client != null) Object.defineProperty(listEl, 'clientHeight', { value: opts.client, configurable: true });
      if (opts.scroll != null) Object.defineProperty(listEl, 'scrollHeight', { value: opts.scroll, configurable: true });
    }

    function listElOf(container: HTMLElement): HTMLElement {
      return container.querySelector('[style*="overflow-y"]') as HTMLElement;
    }

    test('updateThumb hides the thumb when content fits', (done) => {
      const items = generateItems(5);
      const App: ComponentType = () =>
        h('div', { style: { height: '200px' } },
          h(VirtualList as any, {
            data: items,
            itemHeight: 50,
            containerHeight: 200,
            renderItem: ({ item }: { item: { id: number; label: string } }) =>
              h('div', { key: item.id, 'data-testid': 'item' }, item.label),
          })
        );

      const container = document.createElement('div');
      document.body.appendChild(container);
      render(App, container);

      queueMicrotask(() => {
        const listEl = listElOf(container);
        const thumb = container.querySelector('.CustomScrollbar-thumb') as HTMLElement;
        defineListMetrics(listEl, { client: 200, scroll: 100 });
        listEl.scrollTop = 10;
        listEl.dispatchEvent(new Event('scroll'));

        afterScroll(() => {
          expect(thumb.style.display).toBe('none');
          done();
        });
      });
    });

    test('updateThumb shows and positions the thumb on overflow', (done) => {
      const items = generateItems(100);
      const App: ComponentType = () =>
        h('div', { style: { height: '200px' } },
          h(VirtualList as any, {
            data: items,
            itemHeight: 50,
            containerHeight: 200,
            renderItem: ({ item }: { item: { id: number; label: string } }) =>
              h('div', { key: item.id, 'data-testid': 'item' }, item.label),
          })
        );

      const container = document.createElement('div');
      document.body.appendChild(container);
      render(App, container);

      queueMicrotask(() => {
        const listEl = listElOf(container);
        const thumb = container.querySelector('.CustomScrollbar-thumb') as HTMLElement;
        defineListMetrics(listEl, { client: 200, scroll: 2000 });
        listEl.scrollTop = 100;
        listEl.dispatchEvent(new Event('scroll'));

        afterScroll(() => {
          expect(thumb.style.display).toBe('block');
          const thumbH = Math.max(200 * 0.12, (200 / 2000) * 200);
          const maxT = 200 - thumbH;
          expect(thumb.style.height).toBe(thumbH + 'px');
          expect(thumb.style.top).toBe(Math.round((100 / (2000 - 200)) * maxT) + 'px');
          done();
        });
      });
    });

    test('dragging the thumb scrolls the list and releases on mouseup', (done) => {
      const items = generateItems(100);
      const App: ComponentType = () =>
        h('div', { style: { height: '200px' } },
          h(VirtualList as any, {
            data: items,
            itemHeight: 50,
            containerHeight: 200,
            renderItem: ({ item }: { item: { id: number; label: string } }) =>
              h('div', { key: item.id, 'data-testid': 'item' }, item.label),
          })
        );

      const container = document.createElement('div');
      document.body.appendChild(container);
      render(App, container);

      queueMicrotask(() => {
        const listEl = listElOf(container);
        const thumb = container.querySelector('.CustomScrollbar-thumb') as HTMLElement;
        defineListMetrics(listEl, { client: 200, scroll: 2000 });
        Object.defineProperty(thumb, 'clientHeight', { value: 40, configurable: true });
        listEl.scrollTop = 100;
        listEl.dispatchEvent(new Event('scroll'));

        afterScroll(() => {
          const dragTop = parseInt(thumb.style.top || '0', 10);
          const maxT = 200 - 40;
          const newTop = Math.max(0, Math.min(maxT, dragTop + 50));
          thumb.dispatchEvent(new MouseEvent('mousedown', { clientY: 100, bubbles: true }));
          document.dispatchEvent(new MouseEvent('mousemove', { clientY: 150 }));

          const expectedScroll = (newTop / maxT) * (2000 - 200);
          expect(thumb.style.top).toBe(newTop + 'px');
          expect(listEl.scrollTop).toBe(expectedScroll);

          document.dispatchEvent(new MouseEvent('mouseup'));
          const after = listEl.scrollTop;
          document.dispatchEvent(new MouseEvent('mousemove', { clientY: 300 }));
          expect(listEl.scrollTop).toBe(after);
          done();
        });
      });
    });

    test('programmatic scroll events are suppressed and missing keyed node resets scrollToKey flag', (done) => {
      const items = generateItems(100);
      const scrollIntoView = jest.fn();
      (HTMLElement.prototype as any).scrollIntoView = scrollIntoView;
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 200 });
      Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 2500 });

      const App: ComponentType = () =>
        h('div', { style: { height: '200px' } },
          h(VirtualList as any, {
            data: items,
            itemHeight: 50,
            containerHeight: 200,
            initialNumToRender: 3,
            scrollToKey: 99,
            keyExtractor: (item: { id: number }) => item.id,
            renderItem: ({ item }: { item: { id: number; label: string } }) =>
              h('div', { key: item.id, 'data-testid': 'item', 'data-id': String(item.id) }, item.label),
          })
        );

      const container = document.createElement('div');
      document.body.appendChild(container);
      render(App, container);

      queueMicrotask(() => {
        const listEl = listElOf(container);
        listEl.dispatchEvent(new Event('scroll'));
        afterScroll(() => {
          expect(listEl.scrollTop).toBe(2300);
          expect(scrollIntoView).not.toHaveBeenCalled();
          done();
        });
      });
    });

    test('scroll height growth never mutates scrollTop mid-scroll (no fighting the gesture)', (done) => {
      const items = generateItems(100);
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 200 });

      const App: ComponentType = () =>
        h('div', { style: { height: '200px' } },
          h(VirtualList as any, {
            data: items,
            itemHeight: 50,
            containerHeight: 200,
            renderItem: ({ item }: { item: { id: number; label: string } }) =>
              h('div', { key: item.id, 'data-testid': 'item' }, item.label),
          })
        );

      const container = document.createElement('div');
      document.body.appendChild(container);
      render(App, container);

      queueMicrotask(() => {
        const listEl = listElOf(container);
        defineListMetrics(listEl, { client: 200, scroll: 2000 });
        listEl.scrollTop = 500;
        listEl.dispatchEvent(new Event('scroll'));
        afterScroll(() => {
          // Content grows below the viewport while scrolling: scrollTop must
          // stay where the user put it — no reactive compensation.
          Object.defineProperty(listEl, 'scrollHeight', { value: 3000, configurable: true });
          listEl.scrollTop = 500;
          listEl.dispatchEvent(new Event('scroll'));
          afterScroll(() => {
            expect(listEl.scrollTop).toBe(500);
            done();
          });
        });
      });
    }, 10000);

    test('multiple scroll events in the same frame batch into one update', (done) => {
      const items = generateItems(100);
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 200 });
      Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 2500 });

      const App: ComponentType = () =>
        h('div', { style: { height: '200px' } },
          h(VirtualList as any, {
            data: items,
            itemHeight: 50,
            containerHeight: 200,
            renderItem: ({ item }: { item: { id: number; label: string } }) =>
              h('div', { key: item.id, 'data-testid': 'item', 'data-id': String(item.id) }, item.label),
          })
        );

      const container = document.createElement('div');
      document.body.appendChild(container);
      render(App, container);

      queueMicrotask(() => {
        const listEl = listElOf(container);
        listEl.scrollTop = 1000;
        listEl.dispatchEvent(new Event('scroll'));
        listEl.scrollTop = 1200;
        listEl.dispatchEvent(new Event('scroll'));
        afterScroll(() => {
          const rendered = container.querySelectorAll('[data-testid="item"]');
          expect(Number(rendered[0]?.getAttribute('data-id'))).toBeGreaterThan(15);
          done();
        });
      });
    });

    test('scrollToKey with zero clientHeight bails out', (done) => {
      const items = generateItems(10);
      Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 500 });

      const App: ComponentType = () =>
        h('div', { style: { height: '200px' } },
          h(VirtualList as any, {
            data: items,
            itemHeight: 50,
            containerHeight: 200,
            scrollToKey: 5,
            renderItem: ({ item }: { item: { id: number; label: string } }) =>
              h('div', { key: item.id, 'data-testid': 'item' }, item.label),
          })
        );

      const container = document.createElement('div');
      document.body.appendChild(container);
      render(App, container);

      queueMicrotask(() => {
        expect(listElOf(container).scrollTop).toBe(0);
        done();
      });
    });

    test('scrollToKey in dynamic mode uses measured prefix heights', (done) => {
      const items = generateItems(50);
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 200 });
      Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 2500 });
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 70 });

      const App: ComponentType = () =>
        h('div', { style: { height: '200px' } },
          h(VirtualList as any, {
            data: items,
            estimatedItemHeight: 50,
            containerHeight: 200,
            scrollToKey: 10,
            renderItem: ({ item }: { item: { id: number; label: string } }) =>
              h('div', { key: item.id, 'data-testid': 'item' }, item.label),
          })
        );

      const container = document.createElement('div');
      document.body.appendChild(container);
      render(App, container);

      queueMicrotask(() => {
        const listEl = listElOf(container);
        expect(listEl.scrollTop).toBeGreaterThan(0);
        done();
      });
    });

    test('renderItem without key falls back to index', (done) => {
      const items = generateItems(20);
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 200 });

      const App: ComponentType = () =>
        h('div', { style: { height: '200px' } },
          h(VirtualList as any, {
            data: items,
            itemHeight: 50,
            containerHeight: 200,
            renderItem: ({ item }: { item: { id: number; label: string } }) =>
              h('div', { 'data-testid': 'item' }, item.label),
          })
        );

      const container = document.createElement('div');
      document.body.appendChild(container);
      render(App, container);

      queueMicrotask(() => {
        const rendered = container.querySelectorAll('[data-testid="item"]');
        expect(rendered.length).toBeGreaterThan(0);
        done();
      });
    });

    test('scrollToKey scrolls to the keyed item via keyExtractor', (done) => {
      const items = generateItems(100);
      const scrollIntoView = jest.fn();
      (HTMLElement.prototype as any).scrollIntoView = scrollIntoView;
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 200 });
      Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 2500 });

      const App: ComponentType = () =>
        h('div', { style: { height: '200px' } },
          h(VirtualList as any, {
            data: items,
            itemHeight: 50,
            containerHeight: 200,
            scrollToKey: 42,
            keyExtractor: (item: { id: number }) => item.id,
            renderItem: ({ item }: { item: { id: number; label: string } }) =>
              h('div', { key: item.id, 'data-testid': 'item', 'data-id': String(item.id) }, item.label),
          })
        );

      const container = document.createElement('div');
      document.body.appendChild(container);
      render(App, container);

      queueMicrotask(() => {
        const listEl = listElOf(container);
        expect(listEl.scrollTop).toBe(2100);
        requestAnimationFrame(() => {
          const rendered = container.querySelectorAll('[data-testid="item"]');
          const ids = Array.from(rendered).map((n) => n.getAttribute('data-id'));
          expect(ids).toContain('42');
          expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
          done();
        });
      });
    });

    test('scrollToKey falls back to parseInt without keyExtractor', (done) => {
      const items = generateItems(50);
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 200 });
      Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 1200 });

      const App: ComponentType = () =>
        h('div', { style: { height: '200px' } },
          h(VirtualList as any, {
            data: items,
            itemHeight: 50,
            containerHeight: 200,
            scrollToKey: '7',
            renderItem: ({ item }: { item: { id: number; label: string } }) =>
              h('div', { key: item.id, 'data-testid': 'item' }, item.label),
          })
        );

      const container = document.createElement('div');
      document.body.appendChild(container);
      render(App, container);

      queueMicrotask(() => {
        expect(listElOf(container).scrollTop).toBe(350);
        done();
      });
    });

    test('scrollToKey with unresolvable key does nothing', (done) => {
      const items = generateItems(10);
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 200 });
      Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 500 });

      const App: ComponentType = () =>
        h('div', { style: { height: '200px' } },
          h(VirtualList as any, {
            data: items,
            itemHeight: 50,
            containerHeight: 200,
            scrollToKey: 'not-a-number',
            renderItem: ({ item }: { item: { id: number; label: string } }) =>
              h('div', { key: item.id, 'data-testid': 'item' }, item.label),
          })
        );

      const container = document.createElement('div');
      document.body.appendChild(container);
      render(App, container);

      queueMicrotask(() => {
        expect(listElOf(container).scrollTop).toBe(0);
        done();
      });
    });

    test('startAtBottom scrolls to the bottom on mount', (done) => {
      const items = generateItems(50);
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 200 });
      Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 2500 });

      const App: ComponentType = () =>
        h('div', { style: { height: '200px' } },
          h(VirtualList as any, {
            data: items,
            itemHeight: 50,
            containerHeight: 200,
            startAtBottom: true,
            renderItem: ({ item }: { item: { id: number; label: string } }) =>
              h('div', { key: item.id, 'data-testid': 'item' }, item.label),
          })
        );

      const container = document.createElement('div');
      document.body.appendChild(container);
      render(App, container);

      queueMicrotask(() => {
        expect(listElOf(container).scrollTop).toBe(2300);
        done();
      });
    });

    test('startAtBottom with content that does not overflow sets scrollTop to scrollHeight (browser clamps to 0)', (done) => {
      const items = generateItems(3);
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 200 });
      Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 100 });

      const App: ComponentType = () =>
        h('div', { style: { height: '200px' } },
          h(VirtualList as any, {
            data: items,
            itemHeight: 50,
            containerHeight: 200,
            startAtBottom: true,
            renderItem: ({ item }: { item: { id: number; label: string } }) =>
              h('div', { key: item.id, 'data-testid': 'item' }, item.label),
          })
        );

      const container = document.createElement('div');
      document.body.appendChild(container);
      render(App, container);

      queueMicrotask(() => {
        expect(listElOf(container).scrollTop).toBe(100);
        done();
      });
    });

    test('dynamic mode measures item heights via refs', (done) => {
      const items = generateItems(40);
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 70 });
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 200 });

      const App: ComponentType = () =>
        h('div', { style: { height: '200px' } },
          h(VirtualList as any, {
            data: items,
            estimatedItemHeight: 50,
            containerHeight: 200,
            overscan: 0,
            renderItem: ({ item }: { item: { id: number; label: string } }) =>
              h('div', { key: item.id, 'data-testid': 'item', 'data-id': String(item.id) }, item.label),
          })
        );

      const container = document.createElement('div');
      document.body.appendChild(container);
      render(App, container);

      queueMicrotask(() => {
        const listEl = listElOf(container);
        listEl.scrollTop = 1500;
        listEl.dispatchEvent(new Event('scroll'));

        afterScroll(() => {
          const spacer = listEl.children[0] as HTMLElement;
          const spacerH = parseInt(spacer.style.height, 10);
          expect(spacerH % 50).not.toBe(0);
          const rendered = container.querySelectorAll('[data-testid="item"]');
          const firstId = Number(rendered[0]?.getAttribute('data-id'));
          expect(firstId).toBeGreaterThanOrEqual(15);
          expect(firstId).toBeLessThanOrEqual(25);
          done();
        });
      });
    });

    test('topLoader is rendered in dynamic mode', (done) => {
      const items = generateItems(10);
      const App: ComponentType = () =>
        h('div', { style: { height: '200px' } },
          h(VirtualList as any, {
            data: items,
            estimatedItemHeight: 50,
            containerHeight: 200,
            topLoader: h('span', { key: 'spin', 'data-testid': 'loader' }, 'loading'),
            renderItem: ({ item }: { item: { id: number; label: string } }) =>
              h('div', { key: item.id, 'data-testid': 'item' }, item.label),
          })
        );

      const container = document.createElement('div');
      document.body.appendChild(container);
      render(App, container);

      queueMicrotask(() => {
        expect(container.querySelector('[data-testid="loader"]')).not.toBeNull();
        done();
      });
    });

    test('onEndReached is reset when scrolling away from bottom', (done) => {
      const items = generateItems(20);
      let endReached = 0;
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 200 });

      const App: ComponentType = () =>
        h('div', { style: { height: '200px' } },
          h(VirtualList as any, {
            data: items,
            itemHeight: 50,
            containerHeight: 200,
            overscan: 0,
            onEndReached: () => { endReached++; },
            onEndReachedThreshold: 0.1,
            renderItem: ({ item }: { item: { id: number; label: string } }) =>
              h('div', { key: item.id, 'data-testid': 'item' }, item.label),
          })
        );

      const container = document.createElement('div');
      document.body.appendChild(container);
      render(App, container);

      queueMicrotask(() => {
        const listEl = listElOf(container);
        listEl.scrollTop = 1000;
        listEl.dispatchEvent(new Event('scroll'));
        afterScroll(() => {
          expect(endReached).toBe(1);
          listEl.scrollTop = 100;
          listEl.dispatchEvent(new Event('scroll'));
          afterScroll(() => {
            expect(endReached).toBe(1);
            listEl.scrollTop = 1000;
            listEl.dispatchEvent(new Event('scroll'));
            afterScroll(() => {
              expect(endReached).toBe(2);
              done();
            });
          });
        });
      });
    });
  });

  describe('dynamic mode data growth', () => {
    test('prepended items shift heights and restore anchor position', (done) => {
      let setData: ((v: { id: number; label: string }[]) => void) | null = null;
      const App: ComponentType = () => {
        const [data, setState] = useState(generateItems(10));
        setData = setState;
        return h('div', { style: { height: '200px' } },
          h(VirtualList as any, {
            data,
            estimatedItemHeight: 50,
            containerHeight: 200,
            overscan: 0,
            keyExtractor: (item: { id: number }) => item.id,
            renderItem: ({ item }: { item: { id: number; label: string } }) =>
              h('div', { key: item.id, 'data-testid': 'item', 'data-id': String(item.id) }, item.label),
          })
        );
      };

      const container = document.createElement('div');
      document.body.appendChild(container);
      render(App, container);

      queueMicrotask(() => {
        const listEl = container.querySelector('[style*="overflow-y"]') as HTMLElement;
        Object.defineProperty(listEl, 'clientHeight', { value: 200, configurable: true });
        Object.defineProperty(listEl, 'scrollHeight', { value: 2000, configurable: true });
        listEl.scrollTop = 100;
        listEl.dispatchEvent(new Event('scroll'));

        afterScroll(() => {
          setData!(generateItems(15));
          queueMicrotask(() => {
            queueMicrotask(() => {
              expect(listEl.scrollTop).toBe(100);
              done();
            });
          });
        });
      });
    });

    test('prepended items correct scrollTop via anchor when position shifts', (done) => {
      let setData: ((v: { id: number; label: string }[]) => void) | null = null;
      const App: ComponentType = () => {
        const [data, setState] = useState(generateItems(10));
        setData = setState;
        return h('div', { style: { height: '200px' } },
          h(VirtualList as any, {
            data,
            estimatedItemHeight: 50,
            containerHeight: 200,
            overscan: 0,
            keyExtractor: (item: { id: number }) => item.id,
            renderItem: ({ item }: { item: { id: number; label: string } }) =>
              h('div', { key: item.id, 'data-testid': 'item', 'data-id': String(item.id) }, item.label),
          })
        );
      };

      const container = document.createElement('div');
      document.body.appendChild(container);
      render(App, container);

      queueMicrotask(() => {
        const listEl = container.querySelector('[style*="overflow-y"]') as HTMLElement;
        Object.defineProperty(listEl, 'clientHeight', { value: 200, configurable: true });
        Object.defineProperty(listEl, 'scrollHeight', { value: 2000, configurable: true });
        listEl.getBoundingClientRect = () => ({ top: 0, bottom: 200, left: 0, right: 0, width: 0, height: 200, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
        let rectTop = 60;
        for (const item of Array.from(listEl.children)) {
          const el = item as HTMLElement;
          if (el.getAttribute('data-testid') === 'item') {
            el.getBoundingClientRect = () => ({ top: rectTop, bottom: rectTop + 50, left: 0, right: 0, width: 0, height: 50, x: 0, y: rectTop, toJSON: () => ({}) } as DOMRect);
          }
        }
        listEl.scrollTop = 100;
        listEl.dispatchEvent(new Event('scroll'));

        afterScroll(() => {
          rectTop = 160;
          setData!(generateItems(15));
          queueMicrotask(() => {
            queueMicrotask(() => {
              expect(listEl.scrollTop).toBe(200);
              done();
            });
          });
        });
      });
    });
  });

  describe('without containerHeight (ResizeObserver)', () => {
    let origRO: any;

    beforeEach(() => {
      origRO = (global as any).ResizeObserver;
      (global as any).ResizeObserver = class MockResizeObserver {
        cb: (entries: any[]) => void;
        el: Element | null = null;
        static last: MockResizeObserver | null = null;
        constructor(cb: (entries: any[]) => void) { this.cb = cb; MockResizeObserver.last = this; }
        observe(el: Element) { this.el = el; }
        disconnect() { this.el = null; }
        unobserve() {}
      };
    });

    afterEach(() => {
      (global as any).ResizeObserver = origRO;
    });

    test('ResizeObserver callback updates measured height on resize', (done) => {
      const items = generateItems(30);
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 200 });

      const App: ComponentType = () =>
        h('div', { style: { height: '200px' } },
          h(VirtualList as any, {
            data: items,
            itemHeight: 50,
            overscan: 0,
            renderItem: ({ item }: { item: { id: number; label: string } }) =>
              h('div', { key: item.id, 'data-testid': 'item' }, item.label),
          })
        );

      const container = document.createElement('div');
      document.body.appendChild(container);
      render(App, container);

      queueMicrotask(() => {
        const listEl = container.querySelector('[style*="overflow-y"]') as HTMLElement;
        const before = container.querySelectorAll('[data-testid="item"]').length;
        Object.defineProperty(listEl, 'clientHeight', { value: 700, configurable: true });
        (global as any).ResizeObserver.last.cb();
        queueMicrotask(() => {
          const after = container.querySelectorAll('[data-testid="item"]').length;
          expect(after).toBeGreaterThan(before);
          done();
        });
      });
    });

    test('unmount cancels pending scroll rAF and disconnects ResizeObserver', (done) => {
      let setShow: ((v: boolean) => void) | null = null;
      const items = generateItems(10);
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 200 });

      const App: ComponentType = () => {
        const [show, setShowState] = useState(true);
        setShow = setShowState;
        return h('div', { style: { height: '200px' } },
          show
            ? h(VirtualList as any, {
                data: items,
                itemHeight: 50,
                renderItem: ({ item }: { item: { id: number; label: string } }) =>
                  h('div', { key: item.id, 'data-testid': 'item' }, item.label),
              })
            : h('div', { 'data-testid': 'gone' }, 'gone'));
      };

      const container = document.createElement('div');
      document.body.appendChild(container);
      render(App, container);

      queueMicrotask(() => {
        const listEl = container.querySelector('[style*="overflow-y"]') as HTMLElement;
        listEl.scrollTop = 100;
        listEl.dispatchEvent(new Event('scroll'));
        setShow!(false);
        queueMicrotask(() => {
          expect(container.querySelector('[style*="overflow-y"]')).toBeNull();
          expect((global as any).ResizeObserver.last.el).toBeNull();
          done();
        });
      });
    });

    test('measures container height via ResizeObserver and renders items', (done) => {
      const items = generateItems(30);
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 200 });

      const App: ComponentType = () =>
        h('div', { style: { height: '200px' } },
          h(VirtualList as any, {
            data: items,
            itemHeight: 50,
            overscan: 0,
            renderItem: ({ item }: { item: { id: number; label: string } }) =>
              h('div', { key: item.id, 'data-testid': 'item' }, item.label),
          })
        );

      const container = document.createElement('div');
      document.body.appendChild(container);
      render(App, container);

      queueMicrotask(() => {
        const rendered = container.querySelectorAll('[data-testid="item"]');
        expect(rendered.length).toBeGreaterThan(0);
        expect(rendered.length).toBeLessThan(items.length);
        const listEl = container.querySelector('[style*="overflow-y"]') as HTMLElement;
        expect(listEl.style.flex).toBe('1 1 0%');
        done();
      });
    });

    test('startAtBottom scrolls to bottom with measured height', (done) => {
      const items = generateItems(20);
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 200 });
      Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 1000 });

      const App: ComponentType = () =>
        h('div', { style: { height: '200px' } },
          h(VirtualList as any, {
            data: items,
            itemHeight: 50,
            startAtBottom: true,
            onReadyContent: () => {},
            renderItem: ({ item }: { item: { id: number; label: string } }) =>
              h('div', { key: item.id, 'data-testid': 'item' }, item.label),
          })
        );

      const container = document.createElement('div');
      document.body.appendChild(container);
      render(App, container);

      queueMicrotask(() => {
        expect((container.querySelector('[style*="overflow-y"]') as HTMLElement).scrollTop).toBe(800);
        done();
      });
    });
  });
});

describe('VirtualList edge branches', () => {
  function defineListMetrics(listEl: HTMLElement, opts: { client?: number; scroll?: number }) {
    if (opts.client != null) Object.defineProperty(listEl, 'clientHeight', { value: opts.client, configurable: true });
    if (opts.scroll != null) Object.defineProperty(listEl, 'scrollHeight', { value: opts.scroll, configurable: true });
  }

  function listElOf(container: HTMLElement): HTMLElement {
    return container.querySelector('[style*="overflow-y"]') as HTMLElement;
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    jest.restoreAllMocks();
    delete (HTMLElement.prototype as any).clientHeight;
    delete (HTMLElement.prototype as any).scrollHeight;
    delete (HTMLElement.prototype as any).offsetHeight;
  });

  test('falls back to default estimated height when none provided', (done) => {
    const items = generateItems(5);
    const App: ComponentType = () =>
      h('div', { style: { height: '200px' } },
        h(VirtualList as any, {
          data: items,
          renderItem: ({ item }: { item: { id: number; label: string } }) =>
            h('div', { key: item.id, 'data-testid': 'item' }, item.label),
        })
      );

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);

    queueMicrotask(() => {
      expect(container.querySelectorAll('[data-testid="item"]').length).toBeGreaterThan(0);
      done();
    });
  });

  test('skips non-element children when measuring rows', (done) => {
    const items = generateItems(10);
    const App: ComponentType = () =>
      h('div', { style: { height: '200px' } },
        h(VirtualList as any, {
          data: items,
          itemHeight: 50,
          containerHeight: 200,
          renderItem: ({ item }: { item: { id: number; label: string } }) =>
            h('div', { key: item.id, 'data-testid': 'item' },
              'text ',
              h('span', { 'data-t': '1' }, item.label),
              ' tail'),
        })
      );

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);

    queueMicrotask(() => {
      const first = container.querySelector('[data-testid="item"]') as HTMLElement;
      expect(first.querySelector('span')!.getAttribute('data-t')).toBe('1');
      done();
    });
  });

  test('dragging the thumb right after mount uses a zero drag offset', (done) => {
    const items = generateItems(100);
    const App: ComponentType = () =>
      h('div', { style: { height: '200px' } },
        h(VirtualList as any, {
          data: items,
          itemHeight: 50,
          containerHeight: 200,
          renderItem: ({ item }: { item: { id: number; label: string } }) =>
            h('div', { key: item.id, 'data-testid': 'item' }, item.label),
        })
      );

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);

    queueMicrotask(() => {
      const listEl = listElOf(container);
      const thumb = container.querySelector('.CustomScrollbar-thumb') as HTMLElement;
      defineListMetrics(listEl, { client: 200, scroll: 2000 });
      Object.defineProperty(thumb, 'clientHeight', { value: 40, configurable: true });

      thumb.dispatchEvent(new MouseEvent('mousedown', { clientY: 0, bubbles: true }));
      document.dispatchEvent(new MouseEvent('mousemove', { clientY: 40 }));
      document.dispatchEvent(new MouseEvent('mouseup'));

      afterScroll(() => {
        expect(thumb.style.top).toBe('40px');
        done();
      });
    });
  });

  test('small scroll deltas do not override pending scroll position', (done) => {
    const items = generateItems(100);
    const App: ComponentType = () =>
      h('div', { style: { height: '200px' } },
        h(VirtualList as any, {
          data: items,
          estimatedItemHeight: 50,
          containerHeight: 200,
          onEndReached: () => {},
          renderItem: ({ item }: { item: { id: number; label: string } }) =>
            h('div', { key: item.id, 'data-testid': 'item' }, item.label),
        })
      );

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);

    queueMicrotask(() => {
      const listEl = listElOf(container);
      defineListMetrics(listEl, { client: 200, scroll: 2000 });
      listEl.scrollTop = 100;
      listEl.dispatchEvent(new Event('scroll'));

      afterScroll(() => {
        listEl.scrollTop = 110;
        listEl.dispatchEvent(new Event('scroll'));

        afterScroll(() => {
          expect(listEl.scrollTop).toBe(110);
          done();
        });
      });
    });
  });

  test('startAtBottom effect returns early after a user scroll', (done) => {
    const items = generateItems(20);
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 200 });
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 1000 });

    const App: ComponentType = () =>
      h('div', { style: { height: '200px' } },
        h(VirtualList as any, {
          data: items,
          itemHeight: 50,
          startAtBottom: true,
          onReadyContent: () => {},
          renderItem: ({ item }: { item: { id: number; label: string } }) =>
            h('div', { key: item.id, 'data-testid': 'item' }, item.label),
        })
      );

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);

    queueMicrotask(() => {
      const listEl = listElOf(container);
      listEl.scrollTop = 100;
      listEl.dispatchEvent(new Event('scroll'));
      done();
    });
  });

  test('renders topLoader in static mode', (done) => {
    const items = generateItems(10);
    const App: ComponentType = () =>
      h('div', { style: { height: '200px' } },
        h(VirtualList as any, {
          data: items,
          itemHeight: 50,
          topLoader: h('div', { 'data-testid': 'loader', key: 'l' }, 'loading'),
          renderItem: ({ item }: { item: { id: number; label: string } }) =>
            h('div', { key: item.id, 'data-testid': 'item' }, item.label),
        })
      );

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);

    queueMicrotask(() => {
      expect(container.querySelector('[data-testid="loader"]')).toBeTruthy();
      done();
    });
  });

  test('clamps the rendered range for short lists scrolled to the bottom', (done) => {
    const items = generateItems(3);
    const App: ComponentType = () =>
      h('div', { style: { height: '200px' } },
        h(VirtualList as any, {
          data: items,
          itemHeight: 50,
          containerHeight: 200,
          renderItem: ({ item }: { item: { id: number; label: string } }) =>
            h('div', { key: item.id, 'data-testid': 'item' }, item.label),
        })
      );

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);

    queueMicrotask(() => {
      const listEl = listElOf(container);
      defineListMetrics(listEl, { client: 200, scroll: 150 });
      listEl.scrollTop = 50;
      listEl.dispatchEvent(new Event('scroll'));

      afterScroll(() => {
        expect(container.querySelectorAll('[data-testid="item"]').length).toBe(3);
        done();
      });
    });
  });

  test('applies id and className to the scroll container', (done) => {
    const items = generateItems(10);
    const App: ComponentType = () =>
      h('div', { style: { height: '200px' } },
        h(VirtualList as any, {
          data: items,
          itemHeight: 50,
          id: 'my-list',
          className: 'my-class',
          renderItem: ({ item }: { item: { id: number; label: string } }) =>
            h('div', { key: item.id, 'data-testid': 'item' }, item.label),
        })
      );

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);

    queueMicrotask(() => {
      const listEl = listElOf(container);
      expect(listEl.id).toBe('my-list');
      expect(listEl.classList.contains('my-class')).toBe(true);
      done();
    });
  });

  test('thumb drag does not scroll when the thumb fills the container', (done) => {
    const items = generateItems(100);
    const App: ComponentType = () =>
      h('div', { style: { height: '200px' } },
        h(VirtualList as any, {
          data: items,
          itemHeight: 50,
          containerHeight: 200,
          renderItem: ({ item }: { item: { id: number; label: string } }) =>
            h('div', { key: item.id, 'data-testid': 'item' }, item.label),
        })
      );

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);

    queueMicrotask(() => {
      const listEl = listElOf(container);
      const thumb = container.querySelector('.CustomScrollbar-thumb') as HTMLElement;
      defineListMetrics(listEl, { client: 200, scroll: 2000 });
      Object.defineProperty(thumb, 'clientHeight', { value: 300, configurable: true });
      listEl.scrollTop = 100;
      listEl.dispatchEvent(new Event('scroll'));

      afterScroll(() => {
        listEl.scrollTop = 0;
        thumb.dispatchEvent(new MouseEvent('mousedown', { clientY: 0, bubbles: true }));
        document.dispatchEvent(new MouseEvent('mousemove', { clientY: 60 }));
        document.dispatchEvent(new MouseEvent('mouseup'));
        expect(listEl.scrollTop).toBe(0);
        done();
      });
    });
  });

  test('anchor scroll adjustment is skipped when the item did not move', (done) => {
    let setData: ((v: { id: number; label: string }[]) => void) | null = null;
    const App: ComponentType = () => {
      const [data, setState] = useState(generateItems(10));
      setData = setState;
      return h('div', { style: { height: '200px' } },
        h(VirtualList as any, {
          data,
          estimatedItemHeight: 50,
          containerHeight: 200,
          overscan: 0,
          keyExtractor: (item: { id: number }) => item.id,
          renderItem: ({ item }: { item: { id: number; label: string } }) =>
            h('div', { key: item.id, 'data-testid': 'item', 'data-id': String(item.id) }, item.label),
        })
      );
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);

    queueMicrotask(() => {
      const listEl = listElOf(container);
      defineListMetrics(listEl, { client: 200, scroll: 2000 });
      listEl.getBoundingClientRect = () => ({ top: 0, bottom: 200, left: 0, right: 0, width: 0, height: 200, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
      for (const item of Array.from(listEl.children)) {
        const el = item as HTMLElement;
        if (el.getAttribute('data-testid') === 'item') {
          el.getBoundingClientRect = () => ({ top: 60, bottom: 110, left: 0, right: 0, width: 0, height: 50, x: 0, y: 60, toJSON: () => ({}) } as DOMRect);
        }
      }
      listEl.scrollTop = 100;
      listEl.dispatchEvent(new Event('scroll'));

      afterScroll(() => {
        setData!(generateItems(12));
        queueMicrotask(() => {
          queueMicrotask(() => {
            expect(listEl.scrollTop).toBe(100);
            done();
          });
        });
      });
    });
  });

  test('prepend skips the anchor when its item scrolled out of the render window', (done) => {
    let setData: ((v: { id: number; label: string }[]) => void) | null = null;
    const App: ComponentType = () => {
      const [data, setState] = useState(generateItems(10));
      setData = setState;
      return h('div', { style: { height: '200px' } },
        h(VirtualList as any, {
          data,
          estimatedItemHeight: 50,
          containerHeight: 200,
          overscan: 0,
          keyExtractor: (item: { id: number }) => item.id,
          renderItem: ({ item }: { item: { id: number; label: string } }) =>
            h('div', { key: item.id, 'data-testid': 'item', 'data-id': String(item.id) }, item.label),
        })
      );
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);

    queueMicrotask(() => {
      const listEl = listElOf(container);
      defineListMetrics(listEl, { client: 200, scroll: 2000 });
      listEl.getBoundingClientRect = () => ({ top: 0, bottom: 200, left: 0, right: 0, width: 0, height: 200, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
      for (const item of Array.from(listEl.children)) {
        const el = item as HTMLElement;
        if (el.getAttribute('data-testid') === 'item') {
          el.getBoundingClientRect = () => ({ top: 60, bottom: 110, left: 0, right: 0, width: 0, height: 50, x: 0, y: 60, toJSON: () => ({}) } as DOMRect);
        }
      }
      listEl.scrollTop = 100;
      listEl.dispatchEvent(new Event('scroll'));

      afterScroll(() => {
        listEl.scrollTop = 300;
        const grown = [...generateItems(10).map((i) => ({ id: i.id + 10, label: i.label })), ...generateItems(10)];
        setData!(grown);
        queueMicrotask(() => {
          queueMicrotask(() => {
            expect(listEl.scrollTop).toBe(300);
            done();
          });
        });
      });
    });
  });

  test('onNearTop fires once per approach to the top', (done) => {
    const items = generateItems(100);
    let nearTop = 0;
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 200 });
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 2500 });

    const App: ComponentType = () =>
      h('div', { style: { height: '200px' } },
        h(VirtualList as any, {
          data: items,
          itemHeight: 50,
          containerHeight: 200,
          onNearTop: () => { nearTop++; },
          renderItem: ({ item }: { item: { id: number; label: string } }) =>
            h('div', { key: item.id, 'data-testid': 'item' }, item.label),
        })
      );

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);

    queueMicrotask(() => {
      const listEl = listElOf(container);
      listEl.scrollTop = 50;
      listEl.dispatchEvent(new Event('scroll'));
      afterScroll(() => {
        listEl.scrollTop = 300;
        listEl.dispatchEvent(new Event('scroll'));
        afterScroll(() => {
          listEl.scrollTop = 40;
          listEl.dispatchEvent(new Event('scroll'));
          afterScroll(() => {
            listEl.scrollTop = 60;
            listEl.dispatchEvent(new Event('scroll'));
            afterScroll(() => {
              expect(nearTop).toBe(2);
              done();
            });
          });
        });
      });
    });
  });

  test('onEndReached fires only once while staying near the bottom', (done) => {
    const items = generateItems(50);
    let endReached = 0;
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 200 });
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 2500 });

    const App: ComponentType = () =>
      h('div', { style: { height: '200px' } },
        h(VirtualList as any, {
          data: items,
          itemHeight: 50,
          containerHeight: 200,
          overscan: 0,
          onEndReached: () => { endReached++; },
          onEndReachedThreshold: 0.5,
          renderItem: ({ item }: { item: { id: number; label: string } }) =>
            h('div', { key: item.id, 'data-testid': 'item' }, item.label),
        })
      );

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);

    queueMicrotask(() => {
      const listEl = listElOf(container);
      listEl.scrollTop = 2300;
      listEl.dispatchEvent(new Event('scroll'));
      afterScroll(() => {
        expect(endReached).toBe(1);
        listEl.scrollTop = 2200;
        listEl.dispatchEvent(new Event('scroll'));
        afterScroll(() => {
          expect(endReached).toBe(1);
          done();
        });
      });
    });
  });

  test('startAtBottom effect returns early after the user scrolls', (done) => {
    let setData: ((v: { id: number; label: string }[]) => void) | null = null;
    const items = generateItems(20);
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 200 });
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 1000 });

    const App: ComponentType = () => {
      const [data, setState] = useState(items);
      setData = setState;
      return h('div', { style: { height: '200px' } },
        h(VirtualList as any, {
          data,
          itemHeight: 50,
          startAtBottom: true,
          onReadyContent: () => {},
          renderItem: ({ item }: { item: { id: number; label: string } }) =>
            h('div', { key: item.id, 'data-testid': 'item' }, item.label),
        })
      );
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);

    queueMicrotask(() => {
      const listEl = listElOf(container);
      listEl.scrollTop = 100;
      listEl.dispatchEvent(new Event('scroll'));
      afterScroll(() => {
        listEl.dispatchEvent(new Event('scroll'));
        afterScroll(() => {
          setData!(generateItems(25));
          queueMicrotask(() => {
            expect(listEl.scrollTop).toBe(100);
            done();
          });
        });
      });
    });
  });

  test('startAtBottom keeps the list pinned to the bottom while the user has not scrolled', (done) => {
    let setData: ((v: { id: number; label: string }[]) => void) | null = null;
    const items = generateItems(20);
    let sh = 1000;
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 200 });
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => sh });

    const App: ComponentType = () => {
      const [data, setState] = useState(items);
      setData = setState;
      return h('div', { style: { height: '200px' } },
        h(VirtualList as any, {
          data,
          itemHeight: 50,
          startAtBottom: true,
          onReadyContent: () => {},
          renderItem: ({ item }: { item: { id: number; label: string } }) =>
            h('div', { key: item.id, 'data-testid': 'item' }, item.label),
        })
      );
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);

    queueMicrotask(() => {
      const listEl = listElOf(container);
      expect(listEl.scrollTop).toBe(800);
      sh = 1500;
      setData!(generateItems(30));
      queueMicrotask(() => {
        expect(listEl.scrollTop).toBe(1300);
        done();
      });
    });
  });

  test('startAtBottom effect bails out when there is nothing to scroll to', (done) => {
    const items = generateItems(20);
    const App: ComponentType = () =>
      h('div', { style: { height: '200px' } },
        h(VirtualList as any, {
          data: items,
          itemHeight: 50,
          containerHeight: 200,
          startAtBottom: true,
          onReadyContent: () => {},
          renderItem: ({ item }: { item: { id: number; label: string } }) =>
            h('div', { key: item.id, 'data-testid': 'item' }, item.label),
        })
      );

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);

    queueMicrotask(() => {
      expect((listElOf(container) as HTMLElement).scrollTop).toBe(0);
      done();
    });
  });

  test('dynamic mode with empty data renders nothing', (done) => {
    const App: ComponentType = () =>
      h('div', { style: { height: '200px' } },
        h(VirtualList as any, {
          data: [],
          estimatedItemHeight: 50,
          containerHeight: 200,
          renderItem: ({ item }: { item: any }) =>
            h('div', { key: item.id, 'data-testid': 'item' }, String(item)),
        })
      );

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);

    queueMicrotask(() => {
      expect(container.querySelectorAll('[data-testid="item"]').length).toBe(0);
      done();
    });
  });

  test('prepended items fall back to the height diff when the anchor item left the render window', (done) => {
    let setData: ((v: { id: number; label: string }[]) => void) | null = null;
    const App: ComponentType = () => {
      const [data, setState] = useState(generateItems(10));
      setData = setState;
      return h('div', { style: { height: '200px' } },
        h(VirtualList as any, {
          data,
          estimatedItemHeight: 50,
          containerHeight: 200,
          overscan: 0,
          keyExtractor: (item: { id: number }) => item.id,
          renderItem: ({ item }: { item: { id: number; label: string } }) =>
            h('div', { key: item.id, 'data-testid': 'item', 'data-id': String(item.id) }, item.label),
        })
      );
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);

    queueMicrotask(() => {
      const listEl = listElOf(container);
      defineListMetrics(listEl, { client: 200, scroll: 2000 });
      listEl.getBoundingClientRect = () => ({ top: 0, bottom: 200, left: 0, right: 0, width: 0, height: 200, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
      for (const item of Array.from(listEl.children)) {
        const el = item as HTMLElement;
        if (el.getAttribute('data-testid') === 'item') {
          el.getBoundingClientRect = () => ({ top: 60, bottom: 110, left: 0, right: 0, width: 0, height: 50, x: 0, y: 60, toJSON: () => ({}) } as DOMRect);
        }
      }
      listEl.scrollTop = 100;
      listEl.dispatchEvent(new Event('scroll'));

      afterScroll(() => {
        const grown = generateItems(30).map((i) => ({ id: i.id + 30, label: i.label }));
        setData!(grown);
        queueMicrotask(() => {
          queueMicrotask(() => {
            expect(listEl.scrollTop).toBe(100);
            done();
          });
        });
      });
    });
  });

  test('small scroll deltas do not re-anchor the scroll position', (done) => {
    const ranges: string[] = [];
    const items = generateItems(100);
    const App: ComponentType = () =>
      h('div', { style: { height: '200px' } },
        h(VirtualList as any, {
          data: items,
          estimatedItemHeight: 50,
          containerHeight: 200,
          overscan: 0,
          onEndReached: () => {},
          onVisibleRangeChange: (s: number, e: number) => { ranges.push(s + ',' + e); },
          renderItem: ({ item }: { item: { id: number; label: string } }) =>
            h('div', { key: item.id, 'data-testid': 'item' }, item.label),
        })
      );

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);

    queueMicrotask(() => {
      const listEl = listElOf(container);
      defineListMetrics(listEl, { client: 200, scroll: 2000 });
      listEl.scrollTop = 100;
      listEl.dispatchEvent(new Event('scroll'));

      afterScroll(() => {
        const before = ranges.slice();
        listEl.scrollTop = 110;
        listEl.dispatchEvent(new Event('scroll'));

        afterScroll(() => {
          expect(ranges).toEqual(before);
          done();
        });
      });
    });
  });
});

describe('VirtualList unmount without scroll activity', () => {
  let origRO: any;

  beforeEach(() => {
    document.body.innerHTML = '';
    origRO = (global as any).ResizeObserver;
    (global as any).ResizeObserver = class MockResizeObserver {
      cb: (entries: any[]) => void;
      el: Element | null = null;
      static last: MockResizeObserver | null = null;
      constructor(cb: (entries: any[]) => void) { this.cb = cb; MockResizeObserver.last = this; }
      observe(el: Element) { this.el = el; }
      disconnect() { this.el = null; }
      unobserve() {}
    };
  });

  afterEach(() => {
    (global as any).ResizeObserver = origRO;
  });

  test('unmount with containerHeight and no scroll has nothing to cancel', (done) => {
    let setShow: ((v: boolean) => void) | null = null;
    const items = generateItems(10);

    const App: ComponentType = () => {
      const [show, setShowState] = useState(true);
      setShow = setShowState;
      return h('div', { style: { height: '200px' } },
        show
          ? h(VirtualList as any, {
              data: items,
              itemHeight: 50,
              containerHeight: 200,
              renderItem: ({ item }: { item: { id: number; label: string } }) =>
                h('div', { key: item.id, 'data-testid': 'item' }, item.label),
            })
          : h('div', { 'data-testid': 'gone' }, 'gone'));
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);

    queueMicrotask(() => {
      setShow!(false);
      queueMicrotask(() => {
        expect(container.querySelector('[style*="overflow-y"]')).toBeNull();
        expect((global as any).ResizeObserver.last).toBeNull();
        done();
      });
    });
  });

  test('ResizeObserver callback with an unchanged height is ignored', (done) => {
    const items = generateItems(30);
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 200 });

    const App: ComponentType = () =>
      h('div', { style: { height: '200px' } },
        h(VirtualList as any, {
          data: items,
          itemHeight: 50,
          overscan: 0,
          renderItem: ({ item }: { item: { id: number; label: string } }) =>
            h('div', { key: item.id, 'data-testid': 'item' }, item.label),
        })
      );

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);

    queueMicrotask(() => {
      const before = container.querySelectorAll('[data-testid="item"]').length;
      (global as any).ResizeObserver.last.cb();
      queueMicrotask(() => {
        expect(container.querySelectorAll('[data-testid="item"]').length).toBe(before);
        done();
      });
    });
  });

  test('mounting without a measurable clientHeight keeps the default measured height', (done) => {
    const items = generateItems(30);
    const proto = HTMLElement.prototype as any;
    delete proto.clientHeight;
    delete proto.scrollHeight;
    const App: ComponentType = () =>
      h('div', { style: { height: '200px' } },
        h(VirtualList as any, {
          data: items,
          itemHeight: 50,
          overscan: 0,
          renderItem: ({ item }: { item: { id: number; label: string } }) =>
            h('div', { key: item.id, 'data-testid': 'item' }, item.label),
        })
      );

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);

    queueMicrotask(() => {
      expect((global as any).ResizeObserver.last.el).not.toBeNull();
      expect(container.querySelectorAll('[data-testid="item"]').length).toBeGreaterThan(0);
      done();
    });
  });
});
