/**
 * @jest-environment jsdom
 */

import { createDOM, patch } from '../src/reconciler.js';
import { render } from '../src/render.js';
import { useState, useDomEvent } from '../src/hooks.js';
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

function click(el: Element): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function trackListenerAdds(): { adds: Array<{ target: any; type: string; options: any }>; restore: () => void } {
  const adds: Array<{ target: any; type: string; options: any }> = [];
  const orig = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (this: any, type: string, fn: any, opts: any) {
    adds.push({ target: this, type, options: opts });
    return orig.call(this, type, fn, opts);
  };
  return { adds, restore: () => { EventTarget.prototype.addEventListener = orig; } };
}

describe('atom event bindings', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('on* prop attaches a native listener receiving the DOM event', () => {
    const fn = jest.fn();
    const el = createDOM(h('button', { onClick: fn }, 'go')) as HTMLElement;
    click(el);
    expect(fn).toHaveBeenCalledTimes(1);
    const ev = fn.mock.calls[0][0] as MouseEvent;
    expect(ev).toBeInstanceOf(MouseEvent);
    expect(ev.type).toBe('click');
  });

  test('non-function on* value becomes a plain attribute, not a listener', () => {
    const el = createDOM(h('div', { online: true })) as HTMLElement;
    expect(el.getAttribute('online')).toBe('');
    // No throw when such an event name fires.
    expect(() => el.dispatchEvent(new Event('line'))).not.toThrow();
  });

  test('binds once across re-renders while swapping handler references', () => {
    const calls: number[] = [];
    const f1 = () => calls.push(1);
    const f2 = () => calls.push(2);
    const f3 = () => calls.push(3);

    const v0 = h('button', { onClick: f1 }, 'x');
    const el = createDOM(v0) as HTMLElement;

    const { adds, restore } = trackListenerAdds();
    patch(el, v0, h('button', { onClick: f2 }, 'x'));
    patch(el as any, h('button', { onClick: f2 }, 'x'), h('button', { onClick: f3 }, 'x'));
    restore();

    const clickAdds = adds.filter((a) => a.target === el && a.type === 'click');
    expect(clickAdds.length).toBe(0);

    click(el);
    expect(calls).toEqual([3]);
  });

  test('removes the binding when the prop disappears', () => {
    const fn = jest.fn();
    const v0 = h('button', { onClick: fn }, 'x');
    const el = createDOM(v0) as HTMLElement;
    const v1 = h('button', {}, 'x');
    patch(el, v0, v1);
    click(el);
    expect(fn).not.toHaveBeenCalled();
  });

  test('object form: once fires a single time per handler identity', () => {
    const fn = jest.fn();
    const el = createDOM(h('button', { onClick: { handle: fn, once: true } }, 'x')) as HTMLElement;
    click(el);
    click(el);
    click(el);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('object form: passing a new handler rearms a consumed once-binding', () => {
    const f1 = jest.fn();
    const f2 = jest.fn();
    const v0 = h('button', { onClick: { handle: f1, once: true } }, 'x');
    const el = createDOM(v0) as HTMLElement;
    click(el);
    expect(f1).toHaveBeenCalledTimes(1);
    patch(el, v0, h('button', { onClick: { handle: f2, once: true } }, 'x'));
    click(el);
    expect(f1).toHaveBeenCalledTimes(1);
    expect(f2).toHaveBeenCalledTimes(1);
  });

  test('object form: capture and passive are forwarded to addEventListener', () => {
    const fn = jest.fn();
    const { adds, restore } = trackListenerAdds();
    const el = createDOM(h('div', { onTouchmove: { handle: fn, capture: true, passive: false } })) as HTMLElement;
    restore();

    const rec = adds.find((a) => a.target === el && a.type === 'touchmove');
    expect(rec).toBeDefined();
    expect(rec!.options.capture).toBe(true);
    expect(rec!.options.passive).toBe(false);
  });

  test('plain handlers keep automatic passive for scroll-family events', () => {
    const fn = jest.fn();
    const { adds, restore } = trackListenerAdds();
    const el = createDOM(h('div', { onTouchstart: fn })) as HTMLElement;
    restore();

    const rec = adds.find((a) => a.target === el && a.type === 'touchstart');
    expect(rec!.options.passive).toBe(true);
  });

  describe('AbortSignal support', () => {
    const ctrl = new AbortController();
    let signalSupported = false;
    beforeAll(() => {
      // Feature detection: jsdom honours signal since v21.
      const probe = document.createElement('div');
      let fired = false;
      probe.addEventListener('sig-probe', () => { fired = true; }, { signal: ctrl.signal });
      ctrl.abort();
      probe.dispatchEvent(new Event('sig-probe'));
      signalSupported = !fired;
    });

    test('aborted signal stops delivery', () => {
      if (!signalSupported) {
        // eslint-disable-next-line no-console
        console.warn('jsdom without AbortSignal listener support - skipping');
        return;
      }
      const fn = jest.fn();
      const localCtrl = new AbortController();
      const v0 = h('button', { onClick: { handle: fn, signal: localCtrl.signal } }, 'x');
      const el = createDOM(v0) as HTMLElement;
      click(el);
      expect(fn).toHaveBeenCalledTimes(1);
      localCtrl.abort();
      click(el);
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  test('on:<name> attaches verbatim custom event names', () => {
    const fn = jest.fn();
    const el = createDOM(h('div', { 'on:tg-interaction-request': fn })) as HTMLElement;
    const ev = new CustomEvent('tg-interaction-request', { detail: { a: 1 } });
    el.dispatchEvent(ev);
    expect(fn).toHaveBeenCalledTimes(1);
    expect((fn.mock.calls[0][0] as CustomEvent).detail.a).toBe(1);
  });

  describe('delegated container handlers', () => {
    test('routes bubbled clicks through selectors with matched target', () => {
      const hits: Array<[Event, Element]> = [];
      const misses = jest.fn();
      const v0 = h('ul', {
        onClickDelegate: { '.hit': (e: Event, t: Element) => hits.push([e, t]), '.miss': misses },
      },
        h('li', { class: 'hit' }, 'a'),
        h('li', { class: 'miss' }, 'b'),
      );
      const ul = createDOM(v0) as HTMLElement;
      const [liHit, liMiss] = Array.from(ul.querySelectorAll('li'));

      click(liHit);
      expect(hits.length).toBe(1);
      expect(hits[0][1]).toBe(liHit);
      expect(misses).not.toHaveBeenCalled();

      click(liMiss);
      expect(hits.length).toBe(1);
      expect(misses).toHaveBeenCalledTimes(1);
    });

    test('delegate map updates in place and removal detaches the listener', () => {
      const a = jest.fn();
      const b = jest.fn();
      const v0 = h('div', { onClickDelegate: { '.a': a } }, h('span', { class: 'a' }), h('span', { class: 'b' }));
      const el = createDOM(v0) as HTMLElement;
      const spanA = el.querySelector('.a')!;
      const spanB = el.querySelector('.b')!;

      click(spanA);
      expect(a).toHaveBeenCalledTimes(1);

      patch(el, v0, h('div', { onClickDelegate: { '.b': b } }, h('span', { class: 'a' }), h('span', { class: 'b' })));
      click(spanA);
      expect(a).toHaveBeenCalledTimes(1);

      click(spanB);
      expect(b).toHaveBeenCalledTimes(1);

      const v2 = h('div', {}, h('span', { class: 'a' }), h('span', { class: 'b' }));
      patch(el, h('div', { onClickDelegate: { '.b': b } }), v2);
      click(spanB);
      expect(b).toHaveBeenCalledTimes(1);
    });
  });

  describe('useDomEvent hook', () => {
    test('subscribes, re-binds on deps change and drops stale handlers', async () => {
      const first = jest.fn();
      const second = jest.fn();
      let setVer!: (v: number) => void;

      const Comp: ComponentType = () => {
        const [ver, setVerState] = useState(0);
        setVer = setVerState;
        useDomEvent(window, 'ev-atom-dom-test', ver === 0 ? first : second, [ver]);
        return h('div', {}, String(ver));
      };

      const container = document.createElement('div');
      document.body.appendChild(container);
      render(Comp, container);

      window.dispatchEvent(new Event('ev-atom-dom-test'));
      expect(first).toHaveBeenCalledTimes(1);
      expect(second).not.toHaveBeenCalled();

      setVer(1);
      await tick();

      window.dispatchEvent(new Event('ev-atom-dom-test'));
      expect(first).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledTimes(1);
    });

    test('null target and null handler are safe', () => {
      const Comp: ComponentType = () => {
        useDomEvent(null, 'click', () => {});
        useDomEvent(window, 'click', null);
        return h('div', {}, 'ok');
      };
      const container = document.createElement('div');
      document.body.appendChild(container);
      expect(() => render(Comp, container)).not.toThrow();
      expect(container.textContent).toContain('ok');
    });
  });
});
