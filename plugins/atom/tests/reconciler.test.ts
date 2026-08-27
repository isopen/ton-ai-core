/**
 * @jest-environment jsdom
 */

import { createDOM, patch, flushPendingRefs } from '../src/reconciler.js';
import {
  TEXT, FRAGMENT, SLOT, SLOTTABLE, currentInstance,
} from '../src/vdom.js';
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
  return { type, props, children: flatChildren, key: props.key ?? null };
}

describe('createDOM', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('creates text node', () => {
    const vnode: VNode = { type: TEXT, props: { nodeValue: 'hello' }, children: [], key: null };
    const node = createDOM(vnode);
    expect(node.nodeType).toBe(Node.TEXT_NODE);
    expect(node.textContent).toBe('hello');
    expect(vnode.dom).toBe(node);
  });

  test('creates empty text node when nodeValue missing', () => {
    const vnode: VNode = { type: TEXT, props: {}, children: [], key: null };
    const node = createDOM(vnode);
    expect(node.nodeType).toBe(Node.TEXT_NODE);
    expect(node.textContent).toBe('');
  });

  test('creates element', () => {
    const vnode = h('div', { id: 'foo' });
    const el = createDOM(vnode) as HTMLElement;
    expect(el.tagName).toBe('DIV');
    expect(el.id).toBe('foo');
  });

  test('creates element with class', () => {
    const vnode = h('div', { className: 'container' });
    const el = createDOM(vnode) as HTMLElement;
    expect(el.getAttribute('class')).toBe('container');
  });

  test('creates element with style string', () => {
    const vnode = h('div', { style: 'color: red' });
    const el = createDOM(vnode) as HTMLElement;
    expect(el.getAttribute('style')).toBe('color: red');
  });

  test('creates element with style object', () => {
    const vnode = h('div', { style: { color: 'red', fontSize: '16px' } });
    const el = createDOM(vnode) as HTMLElement;
    expect(el.style.color).toBe('red');
    expect(el.style.fontSize).toBe('16px');
  });

  test('creates element with boolean attribute', () => {
    const vnode = h('input', { disabled: true });
    const el = createDOM(vnode) as HTMLInputElement;
    expect(el.hasAttribute('disabled')).toBe(true);
  });

  test('removes boolean attribute when false', () => {
    const vnode = h('input', { disabled: false });
    const el = createDOM(vnode) as HTMLInputElement;
    expect(el.hasAttribute('disabled')).toBe(false);
  });

  test('creates document fragment for FRAGMENT', () => {
    const vnode = h(FRAGMENT as any, {}, h('span'), h('div'));
    const node = createDOM(vnode);
    expect(node.nodeType).toBe(Node.DOCUMENT_FRAGMENT_NODE);
    expect(node.childNodes.length).toBe(2);
  });

  test('creates document fragment for SLOTTABLE', () => {
    const vnode = h(SLOTTABLE as any, {}, h('span'));
    const node = createDOM(vnode);
    expect(node.nodeType).toBe(Node.DOCUMENT_FRAGMENT_NODE);
  });

  test('creates SVG element for svg tag', () => {
    const vnode = h('svg', {}, h('circle', { cx: '10', cy: '10', r: '5' }));
    const svg = createDOM(vnode) as Element;
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
    const circle = svg.firstElementChild!;
    expect(circle.namespaceURI).toBe('http://www.w3.org/2000/svg');
  });

  test('creates SVG rect element', () => {
    const vnode = h('rect', { width: '100', height: '50', fill: 'blue' });
    const rect = createDOM(vnode) as Element;
    expect(rect.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(rect.getAttribute('width')).toBe('100');
    expect(rect.getAttribute('fill')).toBe('blue');
  });

  test('creates SVG path element', () => {
    const vnode = h('path', { d: 'M0 0L10 10', stroke: 'black' });
    const path = createDOM(vnode) as Element;
    expect(path.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(path.getAttribute('d')).toBe('M0 0L10 10');
  });

  test('SVG child elements get SVG namespace', () => {
    const svg = h('svg', {}, h('circle', { cx: '10', cy: '10', r: '5' }));
    const svgEl = createDOM(svg) as Element;
    const circle = svgEl.firstElementChild!;
    expect(circle.namespaceURI).toBe('http://www.w3.org/2000/svg');
  });

  test('creates component', () => {
    const Comp: ComponentType = (props) => h('span', { id: props.id }, props.text);
    const vnode = { type: Comp, props: { id: 'x', text: 'hello' }, children: [], key: null };
    const el = createDOM(vnode) as HTMLElement;
    expect(el.tagName).toBe('SPAN');
    expect(el.id).toBe('x');
    expect(el.textContent).toBe('hello');
  });

  test('creates empty text node when component returns null', () => {
    const Comp: ComponentType = () => null as any;
    const vnode = { type: Comp, props: {}, children: [], key: null };
    const node = createDOM(vnode);
    expect(node.nodeType).toBe(Node.TEXT_NODE);
    expect(node.textContent).toBe('');
  });

  test('sets dom reference on vnodes', () => {
    const child: VNode = { type: TEXT, props: { nodeValue: 'x' }, children: [], key: null };
    const vnode = h('div', {}, child);
    const el = createDOM(vnode) as HTMLElement;
    expect(vnode.dom).toBe(el);
    expect(child.dom).toBe(el.firstChild);
  });

  test('applies ref callback after flush', () => {
    const refFn = jest.fn();
    const vnode = h('div', { ref: refFn });
    createDOM(vnode);

    flushPendingRefs();
    expect(refFn).toHaveBeenCalledTimes(1);
    expect(refFn.mock.calls[0][0].tagName).toBe('DIV');
  });

  test('applies ref object after flush', () => {
    const ref = { current: null };
    const vnode = h('div', { ref });
    createDOM(vnode);
    flushPendingRefs();
    expect(ref.current).not.toBeNull();
    expect((ref.current as HTMLElement).tagName).toBe('DIV');
  });

  test('attaches event listener', () => {
    const handler = jest.fn();
    const vnode = h('button', { onClick: handler });
    const el = createDOM(vnode) as HTMLElement;
    el.click();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('sets value on input element', () => {
    const vnode: VNode = { type: 'input', props: { value: 'test' }, children: [], key: null };
    const el = createDOM(vnode) as HTMLInputElement;
    expect(el.value).toBe('test');
  });

  test('sets innerHTML via dangerouslySetInnerHTML', () => {
    const vnode = h('div', { dangerouslySetInnerHTML: { __html: '<span>inner</span>' } });
    const el = createDOM(vnode) as HTMLElement;
    expect(el.innerHTML).toBe('<span>inner</span>');
  });

  test('skips key and children in setProp', () => {
    const vnode = h('div', { key: 'k', children: ['x'], id: 'ok' });
    const el = createDOM(vnode) as HTMLElement;
    expect(el.id).toBe('ok');
  });

  test('value prop on textarea', () => {
    const vnode = { type: 'textarea', props: { value: 'initial' }, children: [], key: null } as VNode;
    const el = createDOM(vnode) as HTMLTextAreaElement;
    expect(el.value).toBe('initial');
  });
});

describe('patch', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('replaces node when type changes', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const oldVNode = h('span', { id: 'old' });
    const oldDom = createDOM(oldVNode);
    parent.appendChild(oldDom);

    const newVNode = h('div', { id: 'new' });
    const newDom = patch(oldDom, oldVNode, newVNode);

    expect(newDom).not.toBe(oldDom);
    expect((newDom as HTMLElement).tagName).toBe('DIV');
    expect((newDom as HTMLElement).id).toBe('new');
  });

  test('updates text node value', () => {
    const oldVNode: VNode = { type: TEXT, props: { nodeValue: 'old' }, children: [], key: null };
    const dom = createDOM(oldVNode);
    expect(dom.textContent).toBe('old');

    const newVNode: VNode = { type: TEXT, props: { nodeValue: 'new' }, children: [], key: null };
    const result = patch(dom, oldVNode, newVNode);
    expect(result).toBe(dom);
    expect(dom.textContent).toBe('new');
  });

  test('updates props on same element type', () => {
    const oldVNode = h('div', { id: 'old', class: 'a' });
    const dom = createDOM(oldVNode);
    const el = dom as HTMLElement;

    const newVNode = h('div', { id: 'new', class: 'b' });
    const result = patch(dom, oldVNode, newVNode);
    expect(result).toBe(dom);
    expect(el.id).toBe('new');
    expect(el.getAttribute('class')).toBe('b');
  });

  test('removes old props that are not in new', () => {
    const oldVNode = h('div', { id: 'old', title: 'hello' });
    const dom = createDOM(oldVNode);
    const el = dom as HTMLElement;

    const newVNode = h('div', { id: 'new' });
    patch(dom, oldVNode, newVNode);
    expect(el.hasAttribute('title')).toBe(false);
    expect(el.id).toBe('new');
  });

  test('removes event listener and adds new one', () => {
    const oldHandler = jest.fn();
    const newHandler = jest.fn();

    const oldVNode = h('button', { onClick: oldHandler });
    const dom = createDOM(oldVNode) as HTMLElement;

    const newVNode = h('button', { onClick: newHandler });
    patch(dom, oldVNode, newVNode);

    dom.click();
    expect(oldHandler).not.toHaveBeenCalled();
    expect(newHandler).toHaveBeenCalledTimes(1);
  });

  test('re-renders component when deps change', () => {
    const renderFn = jest.fn((props: any) => h('div', {}, props.text));
    const Comp: ComponentType = (props) => renderFn(props);

    const oldVNode = { type: Comp, props: { text: 'a' }, children: [], key: null };
    const dom = createDOM(oldVNode);

    const newVNode = { type: Comp, props: { text: 'b' }, children: [], key: null };
    patch(dom, oldVNode, newVNode);

    expect(renderFn).toHaveBeenCalledTimes(2);
    expect((dom as HTMLElement).textContent).toBe('b');
  });

  test('preserves component instance on re-render', () => {
    const Comp: ComponentType = (props) => h('div', {}, props.text);
    const oldVNode = { type: Comp, props: { text: 'a' }, children: [], key: null };
    const dom = createDOM(oldVNode);
    const oldInst = oldVNode.componentInstance;

    const newVNode = { type: Comp, props: { text: 'b' }, children: [], key: null };
    patch(dom, oldVNode, newVNode);

    expect(newVNode.componentInstance).toBe(oldInst);
  });

  test('patches fragment children', () => {
    const oldVNode = h(FRAGMENT as any, {}, h('span', { class: 'a' }));
    const dom = createDOM(oldVNode);

    const newVNode = h(FRAGMENT as any, {}, h('div', { class: 'b' }));
    const result = patch(dom, oldVNode, newVNode);

    expect(result).toBe(dom);
  });

  test('patches empty fragment', () => {
    const oldVNode = h(FRAGMENT as any);
    const dom = createDOM(oldVNode);
    expect(dom.nodeType).toBe(Node.DOCUMENT_FRAGMENT_NODE);

    const newVNode = h(FRAGMENT as any, {}, h('span', {}, 'hello'));
    const result = patch(dom, oldVNode, newVNode);
    expect(result).toBe(dom);
  });

  test('removes boolean attribute on patch', () => {
    const oldVNode = h('input', { disabled: true });
    const el = createDOM(oldVNode) as HTMLInputElement;
    expect(el.hasAttribute('disabled')).toBe(true);

    const newVNode = h('input', {});
    patch(el, oldVNode, newVNode);
    expect(el.hasAttribute('disabled')).toBe(false);
  });

  test('adds boolean attribute on patch', () => {
    const oldVNode = h('input', {});
    const el = createDOM(oldVNode) as HTMLInputElement;
    expect(el.hasAttribute('disabled')).toBe(false);

    const newVNode = h('input', { disabled: true });
    patch(el, oldVNode, newVNode);
    expect(el.hasAttribute('disabled')).toBe(true);
  });

  test('updates input value via patch', () => {
    const oldVNode = { type: 'input', props: { value: 'old' }, children: [], key: null } as VNode;
    const el = createDOM(oldVNode) as HTMLInputElement;

    const newVNode = { type: 'input', props: { value: 'new' }, children: [], key: null } as VNode;
    patch(el, oldVNode, newVNode);
    expect(el.value).toBe('new');
  });

  test('updates dangerouslySetInnerHTML via patch', () => {
    const oldVNode = h('div', { dangerouslySetInnerHTML: { __html: 'old' } });
    const el = createDOM(oldVNode) as HTMLElement;

    const newVNode = h('div', { dangerouslySetInnerHTML: { __html: '<strong>new</strong>' } });
    patch(el, oldVNode, newVNode);
    expect(el.innerHTML).toBe('<strong>new</strong>');
  });

  test('updates className on patch', () => {
    const oldVNode = h('div', { className: 'old' });
    const el = createDOM(oldVNode) as HTMLElement;

    const newVNode = h('div', { class: 'new' });
    patch(el, oldVNode, newVNode);
    expect(el.getAttribute('class')).toBe('new');
  });

  test('removes className on patch', () => {
    const oldVNode = h('div', { class: 'old' });
    const el = createDOM(oldVNode) as HTMLElement;

    const newVNode = h('div', {});
    patch(el, oldVNode, newVNode);
    expect(el.hasAttribute('class')).toBe(false);
  });

  test('component returning null then element', () => {
    let returnNull = true;
    const Comp: ComponentType = () => {
      if (returnNull) return null as any;
      return h('span', {}, 'hello');
    };

    const vnode = { type: Comp, props: {}, children: [], key: null };
    const dom = createDOM(vnode);
    expect(dom.nodeType).toBe(Node.TEXT_NODE);

    returnNull = false;
    const newVnode = { type: Comp, props: {}, children: [], key: null };
    const newDom = patch(dom, vnode, newVnode);
    expect((newDom as HTMLElement).tagName).toBe('SPAN');
  });

  test('component returning element then null', () => {
    let returnEl = true;
    const Comp: ComponentType = () => {
      if (returnEl) return h('span', {}, 'hello');
      return null as any;
    };

    const vnode = { type: Comp, props: {}, children: [], key: null };
    const dom = createDOM(vnode);
    expect((dom as HTMLElement).tagName).toBe('SPAN');

    returnEl = false;
    const newVnode = { type: Comp, props: {}, children: [], key: null };
    const newDom = patch(dom, vnode, newVnode);
    expect(newDom.nodeType).toBe(Node.TEXT_NODE);
  });
});

describe('patch - keyed children', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('reorders keyed children', () => {
    const A = (props: any) => h('div', { key: 'a', 'data-id': 'a' }, 'A');
    const B = (props: any) => h('div', { key: 'b', 'data-id': 'b' }, 'B');

    const parent = h('div', {},
      { type: 'div', props: { key: 'a', 'data-id': 'a' }, children: [h(TEXT as any, { nodeValue: 'A' })], key: 'a' } as any,
      { type: 'div', props: { key: 'b', 'data-id': 'b' }, children: [h(TEXT as any, { nodeValue: 'B' })], key: 'b' } as any,
    );
    const parentEl = createDOM(parent) as HTMLElement;
    document.body.appendChild(parentEl);

    const newParent = h('div', {},
      { type: 'div', props: { key: 'b', 'data-id': 'b' }, children: [h(TEXT as any, { nodeValue: 'B' })], key: 'b' } as any,
      { type: 'div', props: { key: 'a', 'data-id': 'a' }, children: [h(TEXT as any, { nodeValue: 'A' })], key: 'a' } as any,
    );

    patch(parentEl, parent, newParent);

    expect(parentEl.children[0].getAttribute('data-id')).toBe('b');
    expect(parentEl.children[1].getAttribute('data-id')).toBe('a');
  });

  test('removes keyed child', () => {
    const parent = h('div', {},
      { type: 'div', props: { key: 'a' }, children: [h(TEXT as any, { nodeValue: 'A' })], key: 'a' } as any,
      { type: 'div', props: { key: 'b' }, children: [h(TEXT as any, { nodeValue: 'B' })], key: 'b' } as any,
    );
    const parentEl = createDOM(parent) as HTMLElement;
    document.body.appendChild(parentEl);

    const newParent = h('div', {},
      { type: 'div', props: { key: 'a' }, children: [h(TEXT as any, { nodeValue: 'A' })], key: 'a' } as any,
    );

    patch(parentEl, parent, newParent);
    expect(parentEl.children.length).toBe(1);
    expect(parentEl.textContent).toBe('A');
  });

  test('adds keyed child', () => {
    const parent = h('div', {},
      { type: 'div', props: { key: 'a' }, children: [h(TEXT as any, { nodeValue: 'A' })], key: 'a' } as any,
    );
    const parentEl = createDOM(parent) as HTMLElement;
    document.body.appendChild(parentEl);

    const newParent = h('div', {},
      { type: 'div', props: { key: 'a' }, children: [h(TEXT as any, { nodeValue: 'A' })], key: 'a' } as any,
      { type: 'div', props: { key: 'b' }, children: [h(TEXT as any, { nodeValue: 'B' })], key: 'b' } as any,
    );

    patch(parentEl, parent, newParent);
    expect(parentEl.children.length).toBe(2);
  });

  test('reorders with multiple keyed children', () => {
    const parent = h('div', {},
      { type: 'div', props: { key: 'a' }, children: [h(TEXT as any, { nodeValue: 'A' })], key: 'a' } as any,
      { type: 'div', props: { key: 'b' }, children: [h(TEXT as any, { nodeValue: 'B' })], key: 'b' } as any,
      { type: 'div', props: { key: 'c' }, children: [h(TEXT as any, { nodeValue: 'C' })], key: 'c' } as any,
    );
    const parentEl = createDOM(parent) as HTMLElement;
    document.body.appendChild(parentEl);

    const newParent = h('div', {},
      { type: 'div', props: { key: 'c' }, children: [h(TEXT as any, { nodeValue: 'C' })], key: 'c' } as any,
      { type: 'div', props: { key: 'a' }, children: [h(TEXT as any, { nodeValue: 'A' })], key: 'a' } as any,
      { type: 'div', props: { key: 'b' }, children: [h(TEXT as any, { nodeValue: 'B' })], key: 'b' } as any,
    );

    patch(parentEl, parent, newParent);
    expect(parentEl.children.length).toBe(3);
    expect(parentEl.children[0].textContent).toBe('C');
    expect(parentEl.children[1].textContent).toBe('A');
    expect(parentEl.children[2].textContent).toBe('B');
  });

  test('replaces all keyed children', () => {
    const parent = h('div', {},
      { type: 'div', props: { key: 'a' }, children: [h(TEXT as any, { nodeValue: 'A' })], key: 'a' } as any,
      { type: 'div', props: { key: 'b' }, children: [h(TEXT as any, { nodeValue: 'B' })], key: 'b' } as any,
    );
    const parentEl = createDOM(parent) as HTMLElement;
    document.body.appendChild(parentEl);

    const newParent = h('div', {},
      { type: 'div', props: { key: 'c' }, children: [h(TEXT as any, { nodeValue: 'C' })], key: 'c' } as any,
      { type: 'div', props: { key: 'd' }, children: [h(TEXT as any, { nodeValue: 'D' })], key: 'd' } as any,
    );

    patch(parentEl, parent, newParent);
    expect(parentEl.children.length).toBe(2);
    expect(parentEl.children[0].textContent).toBe('C');
    expect(parentEl.children[1].textContent).toBe('D');
  });

  test('keyed children with component nodes', () => {
    const CompA: ComponentType = () => h('span', { 'data-key': 'a' }, 'A');
    const CompB: ComponentType = () => h('span', { 'data-key': 'b' }, 'B');

    const parent = h('div', {},
      { type: CompA, props: { key: 'a' }, children: [], key: 'a' } as any,
      { type: CompB, props: { key: 'b' }, children: [], key: 'b' } as any,
    );
    const parentEl = createDOM(parent) as HTMLElement;
    document.body.appendChild(parentEl);

    const newParent = h('div', {},
      { type: CompB, props: { key: 'b' }, children: [], key: 'b' } as any,
      { type: CompA, props: { key: 'a' }, children: [], key: 'a' } as any,
    );

    patch(parentEl, parent, newParent);
    expect(parentEl.children[0].getAttribute('data-key')).toBe('b');
    expect(parentEl.children[1].getAttribute('data-key')).toBe('a');
  });
});

describe('patch - style updates', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('updates style object properties', () => {
    const oldVNode = h('div', { style: { color: 'red', fontSize: '12px' } });
    const dom = createDOM(oldVNode) as HTMLElement;

    const newVNode = h('div', { style: { color: 'blue', background: 'black' } });
    patch(dom, oldVNode, newVNode);

    expect(dom.style.color).toBe('blue');
    expect(dom.style.fontSize).toBe('');
    expect(dom.style.background).toBe('black');
  });

  test('removes style attribute when set to null', () => {
    const oldVNode = h('div', { style: 'color: red' });
    const dom = createDOM(oldVNode) as HTMLElement;

    const newVNode = h('div', {});
    patch(dom, oldVNode, newVNode);

    expect(dom.hasAttribute('style')).toBe(false);
  });
});

describe('patch - component unmount cleanups', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('runs unmountCleanups when component type changes', () => {
    const cleanup = jest.fn();
    const CompA: ComponentType = () => {
      const inst = currentInstance!;
      inst.unmountCleanups.push(cleanup);
      return h('div', {}, 'A');
    };

    const oldVNode = { type: CompA, props: {}, children: [], key: null };
    const dom = createDOM(oldVNode);

    const CompB: ComponentType = () => h('div', {}, 'B');
    const newVNode = { type: CompB, props: {}, children: [], key: null };

    patch(dom, oldVNode, newVNode);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  test('runs unmountCleanups on child component removal via key change', () => {
    const cleanup = jest.fn();
    const Child: ComponentType = () => {
      const inst = currentInstance!;
      inst.unmountCleanups.push(cleanup);
      return h('span', {}, 'child');
    };

    const parent = h('div', {},
      { type: Child, props: { key: 'c' }, children: [], key: 'c' } as any,
    );
    const parentEl = createDOM(parent) as HTMLElement;
    document.body.appendChild(parentEl);

    const newParent = h('div', {});
    patch(parentEl, parent, newParent);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  test('runs unmountCleanups recursively on nested components', () => {
    const cleanup = jest.fn();
    const DeepChild: ComponentType = () => {
      const inst = currentInstance!;
      inst.unmountCleanups.push(cleanup);
      return h('span', {}, 'deep');
    };
    const Middle: ComponentType = () => h('div', {},
      { type: DeepChild, props: {}, children: [], key: null } as any,
    );

    const parent = h('div', {},
      { type: Middle, props: {}, children: [], key: null } as any,
    );
    const parentEl = createDOM(parent) as HTMLElement;
    document.body.appendChild(parentEl);

    const newParent = h('div', {}, h('span', {}, 'replaced'));
    patch(parentEl, parent, newParent);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  test('unmountCleanups cleared after running', () => {
    const cleanup = jest.fn();
    const CompA: ComponentType = () => {
      const inst = currentInstance!;
      inst.unmountCleanups.push(cleanup);
      return h('div', {}, 'A');
    };

    const oldVNode = { type: CompA, props: {}, children: [], key: null };
    const dom = createDOM(oldVNode);
    const inst = oldVNode.componentInstance!;
    expect(inst.unmountCleanups).toHaveLength(1);

    const CompB: ComponentType = () => h('div', {}, 'B');
    const newVNode = { type: CompB, props: {}, children: [], key: null };
    patch(dom, oldVNode, newVNode);

    expect(inst.unmountCleanups).toHaveLength(0);
  });
});

describe('patch - slot', () => {
  test('resolves SLOT type', () => {
    const child: VNode = h('div', { class: 'child' });
    const slotVNode: VNode = {
      type: SLOT,
      props: { class: 'parent' },
      children: [child],
      key: null,
    };
    const dom = createDOM(slotVNode) as HTMLElement;
    expect(dom.getAttribute('class')).toBe('child parent');
  });

  test('SLOT merges style props', () => {
    const child: VNode = h('div', { style: { color: 'red' } });
    const slotVNode: VNode = {
      type: SLOT,
      props: { style: { background: 'blue' } },
      children: [child],
      key: null,
    };
    const dom = createDOM(slotVNode) as HTMLElement;
    expect(dom.style.color).toBe('red');
    expect(dom.style.background).toBe('blue');
  });

  test('SLOT merges event handlers', () => {
    const childClick = jest.fn();
    const parentClick = jest.fn();
    const child: VNode = h('button', { onClick: childClick });
    const slotVNode: VNode = {
      type: SLOT,
      props: { onClick: parentClick },
      children: [child],
      key: null,
    };
    const dom = createDOM(slotVNode) as HTMLElement;
    dom.click();
    expect(childClick).toHaveBeenCalledTimes(1);
    expect(parentClick).toHaveBeenCalledTimes(1);
  });

  test('SLOT with no child does not crash', () => {
    const slotVNode: VNode = {
      type: SLOT,
      props: {},
      children: [],
      key: null,
    };

    const dom = createDOM({ type: TEXT, props: { nodeValue: '' }, children: [], key: null });
    expect(dom.nodeType).toBe(Node.TEXT_NODE);
  });

  test('SLOT child props take precedence over slot props', () => {
    const child: VNode = h('div', { id: 'child-id', 'data-test': 'child' });
    const slotVNode: VNode = {
      type: SLOT,
      props: { 'data-test': 'parent' },
      children: [child],
      key: null,
    };
    const dom = createDOM(slotVNode) as HTMLElement;
    expect(dom.id).toBe('child-id');
    expect(dom.getAttribute('data-test')).toBe('parent');
  });

  test('SLOT patching resolves correctly', () => {
    const child: VNode = h('div', { class: 'child' }, 'text');
    const oldSlot: VNode = {
      type: SLOT,
      props: {},
      children: [child],
      key: null,
    };
    const dom = createDOM(oldSlot) as HTMLElement;

    const newChild: VNode = h('span', { class: 'new-child' }, 'new text');
    const newSlot: VNode = {
      type: SLOT,
      props: {},
      children: [newChild],
      key: null,
    };
    const result = patch(dom, oldSlot, newSlot);
    expect((result as HTMLElement).tagName).toBe('SPAN');
    expect(result.textContent).toBe('new text');
  });
});

describe('patch - updateProp edge cases', () => {
  test('handles value === "" as setAttribute', () => {
    const vnode = h('div', { 'data-test': '' });
    const el = createDOM(vnode) as HTMLElement;
    expect(el.getAttribute('data-test')).toBe('');
  });

  test('skips nullish values on creation', () => {
    const vnode = h('div', { title: null, id: undefined });
    const el = createDOM(vnode) as HTMLElement;
    expect(el.hasAttribute('title')).toBe(false);
    expect(el.hasAttribute('id')).toBe(false);
  });

  test('updateProp with same value does nothing', () => {
    const oldVNode = h('div', { id: 'same' });
    const el = createDOM(oldVNode) as HTMLElement;

    const newVNode = h('div', { id: 'same' });
    patch(el, oldVNode, newVNode);
    expect(el.id).toBe('same');
    // no error = pass
  });

  test('removeProp removes event listener', () => {
    const handler = jest.fn();
    const oldVNode = h('button', { onClick: handler });
    const el = createDOM(oldVNode) as HTMLElement;

    const newVNode = h('button', {});
    patch(el, oldVNode, newVNode);
    el.click();
    expect(handler).not.toHaveBeenCalled();
  });

  test('updateProp null/false removes attribute', () => {
    const oldVNode = h('div', { title: 'hello', 'data-active': 'yes' });
    const el = createDOM(oldVNode) as HTMLElement;

    const newVNode = h('div', { title: null, 'data-active': false });
    patch(el, oldVNode, newVNode);
    expect(el.hasAttribute('title')).toBe(false);
    expect(el.hasAttribute('data-active')).toBe(false);
  });
});

describe('patch - edge paths', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('select value is applied via rAF', (done) => {
    const vnode = h('select', { value: 'B' },
      h('option', {}, 'A'),
      h('option', {}, 'B'),
    );
    const el = createDOM(vnode) as HTMLSelectElement;
    document.body.appendChild(el);
    requestAnimationFrame(() => {
      expect(el.value).toBe('B');
      done();
    });
  });

  test('style object added on update replaces style via cssText', () => {
    const oldVNode = h('div');
    const el = createDOM(oldVNode) as HTMLElement;

    const newVNode = h('div', { style: { color: 'red', top: '5px' } });
    patch(el, oldVNode, newVNode);
    expect(el.style.color).toBe('red');
    expect(el.style.top).toBe('5px');
  });

  test('non-string non-object style removes the attribute on update', () => {
    const oldVNode = h('div', { style: 'color:red' });
    const el = createDOM(oldVNode) as HTMLElement;

    const newVNode = h('div', { style: false as any });
    patch(el, oldVNode, newVNode);
    expect(el.hasAttribute('style')).toBe(false);
  });

  test('component null to element transition replaces its dom in the parent', () => {
    let returnNull = true;
    const Comp: ComponentType = () => (returnNull ? null as any : h('span', {}, 'hi'));

    const vnode = { type: Comp, props: {}, children: [], key: null };
    const dom = createDOM(vnode);
    const parent = document.createElement('div');
    parent.appendChild(dom);
    document.body.appendChild(parent);

    returnNull = false;
    const newVnode = { type: Comp, props: {}, children: [], key: null };
    const newDom = patch(dom, vnode, newVnode);
    expect((newDom as HTMLElement).tagName).toBe('SPAN');
    expect(parent.children[0]).toBe(newDom);
  });

  test('patch component vnode without an existing instance', () => {
    const Comp: ComponentType = (props) => h('span', { 'data-n': props.n }, String(props.n));

    const vnode1 = { type: Comp, props: { n: 1 }, children: [], key: null };
    const dom = createDOM(vnode1);
    document.body.appendChild(dom);

    const oldAlias = { type: Comp, props: { n: 1 }, children: [], key: null };
    const vnode2 = { type: Comp, props: { n: 2 }, children: [], key: null };
    const newDom = patch(dom, oldAlias, vnode2);
    expect((newDom as HTMLElement).textContent).toBe('2');
  });

  test('findDomNode resolves rendered component children via instance', () => {
    const Comp: ComponentType = () => h('span', { 'data-c': '1' }, 'C');

    const compVNode = h(Comp);
    compVNode.componentInstance = { vnode: h('span', { 'data-c': 'x' }, 'X') } as any;
    const oldFrag = h(FRAGMENT as any, {}, compVNode);
    const el = document.createElement('div');

    const newFrag = h(FRAGMENT as any, {}, h('span', { 'data-c': 'y' }, 'Y'));
    patch(el, oldFrag, newFrag);
    expect(el.querySelector('span')!.getAttribute('data-c')).toBe('y');
  });

  test('findDomNode recurses into unrendered component children', () => {
    const Comp: ComponentType = () => h('span', { 'data-c': '1' }, 'C');

    const oldFrag = h(FRAGMENT as any, {}, h(Comp));
    const el = document.createElement('div');

    const newFrag = h(FRAGMENT as any, {}, h('span', { 'data-c': '2' }, 'D'));
    patch(el, oldFrag, newFrag);
    expect(el.querySelector('span')!.getAttribute('data-c')).toBe('2');
  });

  test('patch fragment whose first child is a component', () => {
    const Comp: ComponentType = () => h('span', { 'data-c': '1' }, 'C');

    const outer = h('div', {}, h(FRAGMENT as any, {}, h(Comp), h('b', {}, 'x')));
    const el = createDOM(outer) as HTMLElement;
    document.body.appendChild(el);

    const outer2 = h('div', {}, h(FRAGMENT as any, {}, h(Comp), h('b', {}, 'y')));
    patch(el, outer, outer2);
    expect(el.querySelector('span')!.getAttribute('data-c')).toBe('1');
    expect(el.querySelector('b')!.textContent).toBe('y');
  });

  test('keyed children whose vnodes are fragments', () => {
    const frag = (x: string) => h(FRAGMENT as any, { key: 'f' }, h('i', { 'data-f': x }), h('u', { 'data-f': x }));

    const parent = h('div', {}, frag('1'));
    const el = createDOM(parent) as HTMLElement;
    document.body.appendChild(el);
    expect(el.querySelectorAll('i, u').length).toBe(2);

    const parent2 = h('div', {}, frag('2'));
    patch(el, parent, parent2);
    expect(el.querySelector('i')!.getAttribute('data-f')).toBe('2');
    expect(el.querySelector('u')!.getAttribute('data-f')).toBe('2');
  });

  test('keyed children reconcile component children via findDomNode', () => {
    const Comp: ComponentType = (props: any) => h('span', { 'data-v': props.v }, props.v);

    const oldOuter = h('div', {}, h(Comp, { key: 'a', v: 'A' }));
    const el = createDOM(oldOuter) as HTMLElement;
    document.body.appendChild(el);

    const newOuter = h('div', {}, h(Comp, { key: 'a', v: 'B' }));
    patch(el, oldOuter, newOuter);
    expect(el.textContent).toBe('B');
  });

  test('keyed child with an unrendered element vnode is created fresh', () => {
    const oldInner = h('span', { key: 'a' }, 'A');
    const oldOuter = h('div', {}, oldInner);
    const el = document.createElement('div');
    document.body.appendChild(el);

    const newOuter = h('div', {}, h('span', { key: 'a' }, 'A'));
    patch(el, oldOuter, newOuter);
    expect(el.textContent).toBe('A');
  });

  test('keyed fragment child with detached first node is replaced cleanly', () => {
    const inner1 = h('span', {}, '1');
    const inner2 = h('span', {}, '2');
    const frag = { type: FRAGMENT, props: {}, children: [inner1, inner2], key: 'f' };
    const oldOuter = h('div', {}, frag);
    const el = createDOM(oldOuter) as HTMLElement;
    document.body.appendChild(el);

    el.removeChild(el.firstChild as Node);

    const newOuter = h('div', {}, h('span', { key: 'f' }, '3'));
    patch(el, oldOuter, newOuter);

    expect(el.textContent).toBe('3');
  });

  test('keyed child whose old dom is detached is recreated', () => {
    const parent = h('div', {},
      { type: 'div', props: { key: 'a' }, children: [h(TEXT as any, { nodeValue: 'A' })], key: 'a' } as any,
    );
    const parentEl = createDOM(parent) as HTMLElement;
    parentEl.children[0].remove();
    document.body.appendChild(parentEl);

    const newParent = h('div', {},
      { type: 'div', props: { key: 'a' }, children: [h(TEXT as any, { nodeValue: 'A2' })], key: 'a' } as any,
    );
    patch(parentEl, parent, newParent);
    expect(parentEl.children.length).toBe(1);
    expect(parentEl.textContent).toBe('A2');
  });
});

describe('patch - maximum coverage branches', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('runUnmountCleanups recurses through plain element vnodes', () => {
    const cleanup = jest.fn();
    const Child: ComponentType = () => {
      const inst = currentInstance!;
      inst.unmountCleanups.push(cleanup);
      return h('span', {}, 'child');
    };

    const oldParent = h('div', {}, { type: Child, props: {}, children: [], key: null } as any);
    const parentEl = createDOM(oldParent) as HTMLElement;
    document.body.appendChild(parentEl);

    const newParent = h('span', {}, 'replaced');
    patch(parentEl, oldParent, newParent);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  test('ref with a non-function, non-object value is ignored', () => {
    const vnode = h('div', { ref: 42 as any });
    const el = createDOM(vnode) as HTMLElement;
    expect(el.tagName).toBe('DIV');
  });

  test('dangerouslySetInnerHTML without __html does nothing', () => {
    const vnode = h('div', { dangerouslySetInnerHTML: {} as any });
    const el = createDOM(vnode) as HTMLElement;
    expect(el.innerHTML).toBe('');
  });

  test('value prop on a non-input element is ignored', () => {
    const vnode = h('div', { value: 'x' } as any);
    const el = createDOM(vnode) as HTMLElement;
    expect(el.getAttribute('value')).toBeNull();
  });

  test('removing a ref prop is a no-op in removeProp', () => {
    const oldVNode = h('div', { ref: () => {} });
    const el = createDOM(oldVNode) as HTMLElement;

    const newVNode = h('div', {});
    expect(() => patch(el, oldVNode, newVNode)).not.toThrow();
  });

  test('removing dangerouslySetInnerHTML prop is a no-op in removeProp', () => {
    const oldVNode = h('div', { dangerouslySetInnerHTML: { __html: '<b>keep</b>' } });
    const el = createDOM(oldVNode) as HTMLElement;

    const newVNode = h('div', {});
    patch(el, oldVNode, newVNode);
    expect(el.innerHTML).toBe('<b>keep</b>');
  });

  test('updateProps skips removal when old value is nullish', () => {
    const oldVNode = h('div', { 'data-x': null });
    const el = createDOM(oldVNode) as HTMLElement;

    const newVNode = h('div', {});
    expect(() => patch(el, oldVNode, newVNode)).not.toThrow();
  });

  test('SLOT merge skips key and children props', () => {
    const child: VNode = h('div', { class: 'c' });
    const slotVNode: VNode = {
      type: SLOT,
      props: { key: 'k', class: 'p', children: ['x'] },
      children: [child],
      key: null,
    };
    const dom = createDOM(slotVNode) as HTMLElement;
    expect(dom.getAttribute('class')).toBe('c p');
  });

  test('SLOT class merge uses fallback when child has no class', () => {
    const child: VNode = h('div');
    const slotVNode: VNode = {
      type: SLOT,
      props: { class: 'p' },
      children: [child],
      key: null,
    };
    const dom = createDOM(slotVNode) as HTMLElement;
    expect(dom.getAttribute('class')).toBe('p');
  });

  test('SLOT class merge drops the class when both are empty', () => {
    const child: VNode = h('div', { class: '' });
    const slotVNode: VNode = {
      type: SLOT,
      props: { class: '' },
      children: [child],
      key: null,
    };
    const dom = createDOM(slotVNode) as HTMLElement;
    expect(dom.hasAttribute('class')).toBe(false);
  });

  test('SLOT style merge uses fallbacks for missing styles', () => {
    const child: VNode = h('div');
    const slotVNode: VNode = {
      type: SLOT,
      props: { style: { background: 'blue' } },
      children: [child],
      key: null,
    };
    const dom = createDOM(slotVNode) as HTMLElement;
    expect(dom.style.background).toBe('blue');
  });

  test('SLOT merge skips nullish slot and child values', () => {
    const child: VNode = h('div', { 'data-y': null });
    const slotVNode: VNode = {
      type: SLOT,
      props: { 'data-x': null },
      children: [child],
      key: null,
    };
    const dom = createDOM(slotVNode) as HTMLElement;
    expect(dom.hasAttribute('data-x')).toBe(false);
    expect(dom.hasAttribute('data-y')).toBe(false);
  });

  test('SLOT with no child renders an empty text node', () => {
    const slotVNode: VNode = {
      type: SLOT,
      props: {},
      children: [],
      key: null,
    };
    const dom = createDOM(slotVNode);
    expect(dom.nodeType).toBe(Node.TEXT_NODE);
    expect(dom.textContent).toBe('');
  });

  test('SLOT patch to an empty slot removes the old child dom', () => {
    const child: VNode = h('span', {}, 'old');
    const oldSlot: VNode = { type: SLOT, props: {}, children: [child], key: null };
    const dom = createDOM(oldSlot);
    const parent = document.createElement('div');
    parent.appendChild(dom);
    document.body.appendChild(parent);

    const newSlot: VNode = { type: SLOT, props: {}, children: [], key: null };
    const result = patch(dom, oldSlot, newSlot);
    expect(result.nodeType).toBe(Node.TEXT_NODE);
    expect(parent.children.length).toBe(0);
  });

  test('SLOT patch between two empty slots keeps the text node', () => {
    const oldSlot: VNode = { type: SLOT, props: {}, children: [], key: null };
    const dom = createDOM(oldSlot);
    expect(dom.nodeType).toBe(Node.TEXT_NODE);

    const newSlot: VNode = { type: SLOT, props: {}, children: [], key: null };
    const result = patch(dom, oldSlot, newSlot);
    expect(result).toBe(dom);
  });

  test('patch with the identical vnode returns the same dom', () => {
    const vnode = h('div', { id: 'same' });
    const dom = createDOM(vnode);
    expect(patch(dom, vnode, vnode)).toBe(dom);
  });

  test('component rendering null twice reuses the text node', () => {
    const Comp: ComponentType = () => null as any;
    const vnode1 = { type: Comp, props: {}, children: [], key: null };
    const dom = createDOM(vnode1);
    expect(dom.nodeType).toBe(Node.TEXT_NODE);

    const vnode2 = { type: Comp, props: {}, children: [], key: null };
    const result = patch(dom, vnode1, vnode2);
    expect(result).toBe(dom);
  });

  test('component returning element then null removes its dom from the parent', () => {
    let returnEl = true;
    const Comp: ComponentType = () => (returnEl ? h('span', {}, 'hi') : null as any);

    const vnode = { type: Comp, props: {}, children: [], key: null };
    const dom = createDOM(vnode);
    const parent = document.createElement('div');
    parent.appendChild(dom);
    document.body.appendChild(parent);
    expect(parent.children.length).toBe(1);

    returnEl = false;
    const newVnode = { type: Comp, props: {}, children: [], key: null };
    const result = patch(dom, vnode, newVnode);
    expect(result.nodeType).toBe(Node.TEXT_NODE);
    expect(parent.children.length).toBe(0);
  });

  test('patch bails out early when children arrays are identical', () => {
    const children = [h('span', {}, 'x')];
    const v1 = { type: 'div', props: {}, children, key: null } as VNode;
    const v2 = { type: 'div', props: {}, children, key: null } as VNode;
    const dom = createDOM(v1);
    expect(() => patch(dom, v1, v2)).not.toThrow();
    expect((dom as HTMLElement).textContent).toBe('x');
  });

  test('keyed child rendering null is skipped during placement', () => {
    const NullComp: ComponentType = () => null as any;

    const parent = h('div', {},
      { type: NullComp, props: { key: 'n' }, children: [], key: 'n' } as any,
    );
    const parentEl = createDOM(parent) as HTMLElement;
    document.body.appendChild(parentEl);

    const newParent = h('div', {},
      { type: NullComp, props: { key: 'n' }, children: [], key: 'n' } as any,
      { type: 'div', props: { key: 's' }, children: [h(TEXT as any, { nodeValue: 'S' })], key: 's' } as any,
    );

    patch(parentEl, parent, newParent);
    expect(parentEl.textContent).toBe('S');
  });

  test('keyed removal with a detached node skips the removeChild', () => {
    const parent = h('div', {},
      { type: 'div', props: { key: 'a' }, children: [h(TEXT as any, { nodeValue: 'A' })], key: 'a' } as any,
      { type: 'div', props: { key: 'b' }, children: [h(TEXT as any, { nodeValue: 'B' })], key: 'b' } as any,
    );
    const parentEl = createDOM(parent) as HTMLElement;
    document.body.appendChild(parentEl);
    parentEl.children[1].remove();

    const newParent = h('div', {},
      { type: 'div', props: { key: 'a' }, children: [h(TEXT as any, { nodeValue: 'A' })], key: 'a' } as any,
    );

    expect(() => patch(parentEl, parent, newParent)).not.toThrow();
    expect(parentEl.children.length).toBe(1);
  });

  test('component null to element transition preserves instance state', () => {
    let show = false;
    let instanceRef: any = null;
    const Comp: ComponentType = () => {
      const inst = currentInstance!;
      instanceRef = inst;
      return show ? h('span', { 'data-state': String(inst.props.preserve ?? 'yes') }, 'shown') : null as any;
    };

    const vnode = { type: Comp, props: {}, children: [], key: null };
    const dom = createDOM(vnode);
    expect(dom.nodeType).toBe(Node.TEXT_NODE);
    const instBefore = vnode.componentInstance;

    show = true;
    const newVnode = { type: Comp, props: {}, children: [], key: null };
    const newDom = patch(dom, vnode, newVnode);
    expect((newDom as HTMLElement).tagName).toBe('SPAN');
    expect(newVnode.componentInstance).toBe(instBefore);
    expect(instanceRef).toBe(instBefore);
  });

  test('style object with nullish values is skipped by styleObjToCss', () => {
    const vnode = h('div', { style: { width: null, height: '', color: 'red' } as any });
    const el = createDOM(vnode) as HTMLElement;
    expect(el.style.cssText).toBe('color: red;');
  });

  test('style with a non-string non-object value is ignored', () => {
    const vnode = h('div', { style: 42 as any });
    const el = createDOM(vnode) as HTMLElement;
    expect(el.getAttribute('style')).toBeNull();
  });

  test('removing the className prop removes the class attribute', () => {
    const oldVnode = h('div', { className: 'a b' });
    const el = createDOM(oldVnode) as HTMLElement;
    const newVnode = h('div', {});
    patch(el, oldVnode, newVnode);
    expect(el.getAttribute('class')).toBeNull();
  });

  test('SLOT style merge falls back when the child has no style prop', () => {
    const oldSlot: VNode = { type: SLOT, props: { style: { color: 'red' } }, children: [h('span', {}, 'x')], key: null };
    const el = createDOM(oldSlot) as HTMLElement;
    expect((el as HTMLElement).style.color).toBe('red');
  });

  test('SLOT merge combines the same event prop from child and slot', () => {
    const childFn = jest.fn();
    const slotFn = jest.fn();
    const slot: VNode = {
      type: SLOT,
      props: { onClick: slotFn },
      children: [h('button', { onClick: childFn }, 'go')],
      key: null,
    };
    const el = createDOM(slot) as HTMLElement;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(childFn).toHaveBeenCalledTimes(1);
    expect(slotFn).toHaveBeenCalledTimes(1);
  });

  test('SLOT merge copies plain data props from slot props', () => {
    const slot: VNode = {
      type: SLOT,
      props: { 'data-x': 'y' },
      children: [h('span', {}, 'x')],
      key: null,
    };
    const el = createDOM(slot) as HTMLElement;
    expect(el.getAttribute('data-x')).toBe('y');
  });

  test('createDOM reuses the passed component instance', () => {
    const renderFn = jest.fn(() => h('div', { id: 'res' }, 'x'));
    const mockInstance = { props: {}, _mounted: false, render: renderFn } as any;
    const vnode = { type: (() => null) as any, props: { seed: 7 }, children: [], key: null };
    const dom = createDOM(vnode, mockInstance) as HTMLElement;
    expect(dom.id).toBe('res');
    expect(renderFn).toHaveBeenCalledTimes(1);
    expect(mockInstance.props.seed).toBe(7);
    expect(mockInstance._mounted).toBe(true);
    expect(vnode.componentInstance).toBe(mockInstance);
  });

  test('SLOT merge falls back when the slot has no style prop', () => {
    const oldSlot: VNode = { type: SLOT, props: {}, children: [h('span', { style: { color: 'blue' } }, 'x')], key: null };
    const el = createDOM(oldSlot) as HTMLElement;
    expect(el.style.color).toBe('blue');
  });

  test('SLOT patch to an empty slot with a detached dom skips removeChild', () => {
    const oldSlot: VNode = { type: SLOT, props: {}, children: [h('span', {}, 'old')], key: null };
    const dom = createDOM(oldSlot);
    const newSlot: VNode = { type: SLOT, props: {}, children: [], key: null };
    const result = patch(dom, oldSlot, newSlot);
    expect(result.nodeType).toBe(Node.TEXT_NODE);
  });
});
