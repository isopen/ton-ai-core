/**
 * @jest-environment jsdom
 */

import { createDOM, patch, flushPendingRefs } from '../src/reconciler.js';
import { TEXT } from '../src/vdom.js';
import type { VNode } from '../src/vdom.js';

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
  return { type, props: { ...props }, children: flatChildren, key: props.key ?? null };
}

function mount(vnode: VNode): HTMLElement {
  const el = createDOM(vnode) as HTMLElement;
  document.body.appendChild(el);
  return el;
}

function spyMoves(el: HTMLElement): () => string[] {
  const moves: string[] = [];
  const orig = Element.prototype.insertBefore;
  (el as any).insertBefore = function (node: Node, ref: Node | null) {
    moves.push(node.textContent || '?');
    return orig.call(this, node, ref);
  };
  return () => moves;
}

describe('reconciler: DOM move economy', () => {
  test('stable rerender performs zero insertBefore calls', () => {
    const oldOuter = h('div', {}, [
      h('span', { key: 'a' }, 'A'),
      h('div', { key: 'b' }, 'B'),
      h('span', { key: 'c' }, 'C'),
    ]);
    const el = mount(oldOuter);
    const getMoves = spyMoves(el);

    const newOuter = h('div', {}, [
      h('span', { key: 'a' }, 'A2'),
      h('div', { key: 'b' }, 'B2'),
      h('span', { key: 'c' }, 'C2'),
    ]);
    patch(el, oldOuter, newOuter);

    expect(getMoves()).toEqual([]);
    expect(el.textContent).toBe('A2B2C2');
  });

  test('reorder moves only displaced nodes', () => {
    const oldOuter = h('div', {}, [
      h('span', { key: 'a' }, 'A'),
      h('div', { key: 'b' }, 'B'),
      h('span', { key: 'c' }, 'C'),
    ]);
    const el = mount(oldOuter);
    const getMoves = spyMoves(el);

    const reordered = h('div', {}, [
      h('span', { key: 'a' }, 'A'),
      h('span', { key: 'c' }, 'C'),
      h('div', { key: 'b' }, 'B'),
    ]);
    patch(el, oldOuter, reordered);

    const moves = getMoves();
    expect(moves).not.toContain('A');
    expect(moves.length).toBeLessThanOrEqual(1);
    expect(el.textContent).toBe('ACB');
  });

  test('append and remove produce no moves for existing siblings', () => {
    const oldOuter = h('div', {}, [h('span', { key: 'a' }, 'A')]);
    const el = mount(oldOuter);
    const getMoves = spyMoves(el);

    const grown = h('div', {}, [h('span', { key: 'a' }, 'A'), h('span', { key: 'n' }, 'N')]);
    patch(el, oldOuter, grown);
    expect(el.textContent).toBe('AN');

    expect(getMoves()).not.toContain('A');

    const shrunk = h('div', {}, [h('span', { key: 'a' }, 'A')]);
    patch(el, grown, shrunk);
    expect(el.textContent).toBe('A');
    expect(getMoves()).not.toContain('A');
  });

  test('matched keyed child with partially detached dom is fully replaced', () => {
    const frag = {
      type: FRAGMENT_TEST,
      props: {},
      children: [h('span', {}, '1'), h('span', {}, '2')],
      key: 'f',
    };
    const oldOuter = h('div', {}, frag);
    const el = mount(oldOuter);

    el.removeChild(el.firstChild as Node);
    expect(el.textContent).toBe('2');

    const newOuter = h('div', {}, h('span', { key: 'f' }, '3'));
    patch(el, oldOuter, newOuter);

    expect(el.textContent).toBe('3');
  });
});

const FRAGMENT_TEST = 'FRAGMENT_NODE';

describe('reconciler: prop diffing', () => {
  test('event handler is swapped without double firing', () => {
    const calls: string[] = [];
    const oldOuter = h('button', { onClick: () => calls.push('old') }, 'go');
    const el = mount(oldOuter);

    el.click();
    expect(calls).toEqual(['old']);

    const newOuter = h('button', { onClick: () => calls.push('new') }, 'go');
    patch(el, oldOuter, newOuter);
    el.click();
    expect(calls).toEqual(['old', 'new']);
  });

  test('removed event handler stops firing', () => {
    const calls: number[] = [];
    const oldOuter = h('button', { onClick: () => calls.push(1) }, 'x');
    const el = mount(oldOuter);

    const newOuter = h('button', {}, 'x');
    patch(el, oldOuter, newOuter);
    el.click();
    expect(calls).toEqual([]);
  });

  test('style object diff applies changes and drops removed keys', () => {
    const oldOuter = h('div', { style: { color: 'red', margin: '1px' } }, 's');
    const el = mount(oldOuter) as HTMLElement;

    const newOuter = h('div', { style: { color: 'blue' } }, 's');
    patch(el, oldOuter, newOuter);

    expect((el as HTMLElement).style.color).toBe('blue');
    expect((el as HTMLElement).style.margin).toBe('');
  });

  test('boolean props toggle attribute presence', () => {
    const on = h('input', { disabled: true });
    const el = mount(on) as HTMLInputElement;
    expect(el.hasAttribute('disabled')).toBe(true);

    const off = h('input', { disabled: false });
    patch(el, on, off);
    expect(el.hasAttribute('disabled')).toBe(false);
  });

  test('dangerouslySetInnerHTML updates content', () => {
    const v1 = h('div', { dangerouslySetInnerHTML: { __html: '<b>x</b>' } });
    const el = mount(v1);
    expect(el.innerHTML).toContain('<b>x</b>');

    const v2 = h('div', { dangerouslySetInnerHTML: { __html: '<i>y</i>' } });
    patch(el, v1, v2);
    expect(el.innerHTML).toContain('<i>y</i>');
    expect(el.innerHTML).not.toContain('<b>');
  });

  test('value prop writes the live property for inputs', () => {
    const v1 = h('input', { value: 'first' });
    const el = mount(v1) as HTMLInputElement;
    expect(el.value).toBe('first');

    const v2 = h('input', { value: 'second' });
    patch(el, v1, v2);
    expect(el.value).toBe('second');
  });

  test('function ref receives the element, object ref gets current', () => {
    const seen: Element[] = [];
    const holder: { current: Element | null } = { current: null };
    const vnode = h('div', {
      ref: (e: Element) => seen.push(e),
      children: [],
    });

    const outer = h('div', {}, [
      vnode,
      h('span', { ref: holder }),
    ]);
    const el = mount(outer);

    flushPendingRefs();
    expect(seen.length).toBe(1);
    expect(seen[0]).toBe(el.firstChild);
    expect(holder.current).toBe(el.lastChild);
  });

  test('deferred refs see connected elements', () => {
    const heights: number[] = [];
    const outer = h('div', {}, [h('div', { ref: (e: Element) => heights.push((e as HTMLElement).offsetHeight), style: 'height:40px' })]);
    const el = mount(outer);

    Object.defineProperty(el.firstElementChild, 'offsetHeight', { value: 40, configurable: true });
    flushPendingRefs();
    expect(heights).toEqual([40]);
  });
});
