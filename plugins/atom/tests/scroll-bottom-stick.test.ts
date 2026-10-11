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

describe('startAtBottom keeps the bottom on late content growth', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 200 });
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 5000 });
  });

  afterEach(() => {
    delete (HTMLElement.prototype as any).clientHeight;
    delete (HTMLElement.prototype as any).scrollHeight;
    delete (HTMLElement.prototype as any).getBoundingClientRect;
  });

  test('content above the anchor grows while the user sits at the bottom', (done) => {
    let shift = 0;
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      get() {
        return function () {
          const key = this.getAttribute && this.getAttribute('data-vl-key');
          if (key != null) {
            const top = Number(key) * 50 - shift;
            return { top, bottom: top + 50, height: 50, left: 0, right: 100, width: 100, x: 0, y: top, toJSON: () => ({}) } as any;
          }
          return { top: 0, bottom: 200, height: 200, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON: () => ({}) } as any;
        };
      },
    });
    const items = generateItems(100);
    let setData: ((v: { id: number; label: string }[]) => void) | null = null;
    const App: ComponentType = () => {
      const [data, setState] = useState(items);
      setData = setState;
      return h('div', { style: { height: '200px' } },
        h(VirtualList as any, {
          data,
          estimatedItemHeight: 50,
          estimateItem: () => 50,
          containerHeight: 200,
          startAtBottom: true,
          renderItem: ({ item }: { item: { id: number; label: string } }) => renderRow(item),
        }));
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(App, container);
    queueMicrotask(() => {
      const listEl = listElOf(container);
      afterScroll(() => {
        expect(listEl.scrollTop).toBe(4800);
        listEl.dispatchEvent(new Event('scroll'));
        afterScroll(() => {
          shift = 100;
          setData!(generateItems(100));
          afterScroll(() => {
            expect(listEl.scrollTop).toBe(4800);
            done();
          });
        });
      });
    });
  });
});
