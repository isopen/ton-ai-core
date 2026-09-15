import { getLogger } from '@ton-ai/gram-debug';
import { TEXT, FRAGMENT, PORTAL, SLOT, SLOTTABLE, ComponentInstance, setCurrentInstance, getMountRoot, boundaryStack, takeBoundaryFrame, clearBoundaryFrame, currentInstance, type BoundaryFrame, type VNode, type ComponentType } from './vdom.js';
import { snapshotEffectQueues, rollbackEffectQueues, purgeDeadEffects } from './hooks.js';
import { snapshotContextQueue, rollbackContextQueue, popRenderValue } from './context.js';
import { isTraced, diffProps } from './dev.js';

const log = getLogger('atom');

function isComponentBoundary(vnode: VNode): boolean {
  return typeof vnode.type === 'function' && vnode.componentInstance != null;
}

function runUnmountCleanups(vnode: VNode) {
  if (vnode.type === PORTAL) {
    for (const child of vnode.children) {
      runUnmountCleanups(child);
    }
    for (const node of findAllDomNodes(vnode)) {
      if (node.parentNode) node.parentNode.removeChild(node);
    }
    return;
  }
  if (isComponentBoundary(vnode)) {
    const inst = vnode.componentInstance!;
    inst._mounted = false;
    inst.rootRef = undefined;
    releaseRef(null as unknown as Element, vnode.props.ref);
    const cleanups = inst.unmountCleanups ?? [];
    for (const fn of cleanups) {
      try { fn(); } catch (e) { log.error('useEffect unmount cleanup error:', e); }
    }
    cleanups.length = 0;
    if (inst.vnode && inst.vnode !== vnode) {
      runUnmountCleanups(inst.vnode);
    }
    purgeDeadEffects();
    return;
  }
  if (vnode.type === SLOT) {
    const resolved = (vnode as any).__resolved as VNode | undefined;
    if (resolved) {
      runUnmountCleanups(resolved);
      return;
    }
  }
  if (typeof vnode.type === 'string' && vnode.props && vnode.props.ref != null) {
    const dom = vnode.dom as Element | undefined;
    if (dom) {
      dropPendingRefsFor(dom);
      releaseRef(dom, vnode.props.ref);
    }
  }
  for (const child of vnode.children) {
    runUnmountCleanups(child);
  }
}

function restoreProvided(instance: ComponentInstance) {
  const stack = (instance as any).__atomProvidesStack as Array<{ ctx: { _current: unknown }; prev: unknown }> | undefined;
  if (!stack || stack.length === 0) return;
  (instance as any).__atomProvidesStack = [];
  for (let i = stack.length - 1; i >= 0; i--) {
    try {
      popRenderValue(stack[i].ctx as any);
    } catch {}
  }
}

function popFrame(frame: BoundaryFrame) {
  const top = boundaryStack[boundaryStack.length - 1];
  if (top === frame) {
    boundaryStack.pop();
    return;
  }
  const idx = boundaryStack.indexOf(frame);
  if (idx !== -1) boundaryStack.splice(idx, 1);
}

function safeFallback(frame: BoundaryFrame): VNode | null {
  const prev = currentInstance;
  setCurrentInstance(frame.instance);
  try {
    return frame.renderFallback();
  } catch (e) {
    log.error('[atom] boundary fallback render failed:', e);
    return null;
  } finally {
    setCurrentInstance(prev);
  }
}

export function removePortalNodes(vnode: VNode): void {
  for (const node of findAllDomNodes(vnode)) {
    if (node.parentNode) node.parentNode.removeChild(node);
  }
}

function destroyCreated(children: VNode[]): void {
  for (const child of children) {
    try {
      for (const node of findAllDomNodes(child)) dropPendingRefsFor(node);
    } catch {}
    try {
      runUnmountCleanups(child);
    } catch {}
  }
}

const SVG_TAGS = new Set(['svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'g', 'text', 'use', 'defs', 'stop', 'linearGradient', 'radialGradient', 'clipPath', 'mask', 'filter', 'image']);

function isSvgTag(tag: string): boolean {
  return SVG_TAGS.has(tag);
}

function createElementNS(tag: string): Element {
  return document.createElementNS('http://www.w3.org/2000/svg', tag);
}

function createElement(tag: string): Element {
  if (isSvgTag(tag)) return createElementNS(tag);
  return document.createElement(tag);
}

const PASSIVE_EVENT_TYPES = new Set(['scroll', 'wheel', 'touchstart', 'touchmove']);

interface EventBinding {
  type: string;
  handle: (e: any) => void;
  capture: boolean;
  passive: boolean;
  once: boolean;
  signal?: AbortSignal;
  abortHandler?: () => void;
  consumed: boolean;
  swaps: number;
  warnedChurn: boolean;
  bound: (e: Event) => void;
}

const elementBindings = new WeakMap<Element, Map<string, EventBinding>>();

interface DelegateBinding {
  type: string;
  selectors: string[];
  handlers: Map<string, (e: any, target: Element) => void>;
  bound: (e: Event) => void;
}

const delegateBindings = new WeakMap<Element, Map<string, DelegateBinding>>();

function eventPropType(key: string): string | null {
  if (key.startsWith('on:')) return key.length > 3 ? key.slice(3) : null;
  if (key.startsWith('on') && key.length > 2) return key.slice(2).toLowerCase();
  return null;
}

function delegateEventType(key: string): string | null {
  const m = /^on([A-Za-z]+)Delegate$/.exec(key);
  return m ? m[1].toLowerCase() : null;
}

function eventHandlerOf(value: any): ((e: any) => void) | null {
  if (typeof value === 'function') return value;
  if (value && typeof value === 'object' && typeof value.handle === 'function') return value.handle;
  return null;
}

function setEventBinding(el: Element, key: string, type: string, value: any): void {
  const handle = eventHandlerOf(value);
  if (!handle) return;

  const obj = value && typeof value === 'object' ? value : null;
  const once = !!(obj && obj.once);
  const wantCapture = !!(obj && obj.capture);
  const signalRaw = obj ? obj.signal : undefined;
  const signal = signalRaw instanceof AbortSignal ? signalRaw : undefined;
  const passive = obj && typeof obj.passive === 'boolean' ? obj.passive : PASSIVE_EVENT_TYPES.has(type);

  let byKey = elementBindings.get(el);
  if (!byKey) { byKey = new Map(); elementBindings.set(el, byKey); }

  const prev = byKey.get(key);
  if (signal && signal.aborted) {
    if (prev) removeEventBinding(el, key);
    return;
  }
  if (!prev) {
    const binding: EventBinding = {
      type, handle, capture: wantCapture, passive, once, signal,
      consumed: false, swaps: 0, warnedChurn: false,
      bound: (ev: Event) => {
        if (binding.once && binding.consumed) return;
        try {
          binding.handle(ev);
        } finally {
          if (binding.once) {
            binding.consumed = true;
            el.removeEventListener(binding.type, binding.bound, { capture: binding.capture });
            const live = elementBindings.get(el);
            if (live && live.get(key) === binding) {
              live.delete(key);
              if (live.size === 0) elementBindings.delete(el);
            }
          }
        }
      },
    };
    if (signal) {
      const onAbort = () => {
        const live = elementBindings.get(el);
        if (live && live.get(key) === binding) {
          live.delete(key);
          if (live.size === 0) elementBindings.delete(el);
        }
      };
      binding.abortHandler = onAbort;
      try {
        signal.addEventListener('abort', onAbort, { once: true });
      } catch {}
    }
    try {
      el.addEventListener(type, binding.bound, { capture: wantCapture, passive, signal });
    } catch (e) {
      if (signal && binding.abortHandler) {
        try {
          signal.removeEventListener('abort', binding.abortHandler);
        } catch {}
      }
      throw e;
    }
    byKey.set(key, binding);
    return;
  }

  const handlerChanged = prev.handle !== handle;
  const onceChanged = prev.once !== once;
  const needsRebind = prev.type !== type
    || prev.capture !== wantCapture
    || prev.passive !== passive
    || prev.signal !== signal;

  if (!handlerChanged && !needsRebind && !onceChanged) return;

  prev.swaps++;

  if (prev.swaps >= 20 && !prev.warnedChurn) {
    prev.warnedChurn = true;
    log.debug('[atom] event handler identity churn on "' + key + '"; wrap it in useCallback (swaps=' + prev.swaps + ')');
  }

  if (needsRebind) {
    el.removeEventListener(prev.type, prev.bound, { capture: prev.capture });
    if (prev.signal && prev.abortHandler) {
      try {
        prev.signal.removeEventListener('abort', prev.abortHandler);
      } catch {}
    }
    const rollbackType = prev.type;
    const rollbackCapture = prev.capture;
    const rollbackPassive = prev.passive;
    const rollbackSignal = prev.signal;
    const rollbackAbortHandler = prev.abortHandler;
    const rollbackOnce = prev.once;
    const rollbackConsumed = prev.consumed;
    prev.type = type;
    prev.capture = wantCapture;
    prev.passive = passive;
    prev.signal = signal;
    prev.once = once;
    if (!once) prev.consumed = false;
    prev.abortHandler = undefined;
    try {
      if (signal) {
        const onAbort = () => {
          const live = elementBindings.get(el);
          if (live && live.get(key) === prev) {
            live.delete(key);
            if (live.size === 0) elementBindings.delete(el);
          }
        };
        prev.abortHandler = onAbort;
        signal.addEventListener('abort', onAbort, { once: true });
      }
      el.addEventListener(type, prev.bound, { capture: wantCapture, passive, signal });
    } catch (e) {
      prev.type = rollbackType;
      prev.capture = rollbackCapture;
      prev.passive = rollbackPassive;
      prev.signal = rollbackSignal;
      prev.abortHandler = rollbackAbortHandler;
      prev.once = rollbackOnce;
      prev.consumed = rollbackConsumed;
      try {
        el.addEventListener(rollbackType, prev.bound, { capture: rollbackCapture, passive: rollbackPassive, signal: rollbackSignal ?? undefined });
      } catch {
        removeEventBinding(el, key);
      }
      throw e;
    }
  } else if (onceChanged) {
    prev.once = once;
    if (!once) prev.consumed = false;
    if (once && !handlerChanged) prev.consumed = false;
  }
  prev.handle = handle;
  if (handlerChanged) prev.consumed = false;
}

function removeEventBinding(el: Element, key: string): boolean {
  const byKey = elementBindings.get(el);
  if (!byKey) return false;
  const b = byKey.get(key);
  if (!b) return false;
  el.removeEventListener(b.type, b.bound, { capture: b.capture });
  if (b.signal && b.abortHandler) {
    try {
      b.signal.removeEventListener('abort', b.abortHandler);
    } catch {}
  }
  byKey.delete(key);
  if (byKey.size === 0) elementBindings.delete(el);
  return true;
}

function setDelegateBinding(el: Element, key: string, type: string, value: any): void {
  if (!value || typeof value !== 'object') {
    removeDelegateBinding(el, key);
    return;
  }
  let byKey = delegateBindings.get(el);
  if (!byKey) { byKey = new Map(); delegateBindings.set(el, byKey); }
  const selectors = Object.keys(value).filter((s) => typeof (value as any)[s] === 'function');
  const handlers = new Map<string, (e: any, target: Element) => void>();
  for (const s of selectors) handlers.set(s, (value as any)[s]);

  let entry = byKey.get(key);
  if (!entry) {
    entry = {
      type,
      selectors,
      handlers,
      bound: (ev: Event) => {
        const target = ev.target as Element | null;
        if (!target || typeof target.closest !== 'function') return;
        for (const sel of entry!.selectors) {
          const handler = entry!.handlers.get(sel);
          if (!handler) continue;
          const hit = target.closest(sel);
          if (hit && el.contains(hit)) {
            handler(ev, hit);
            break;
          }
        }
      },
    };
    byKey.set(key, entry);
    try {
      el.addEventListener(type, entry.bound);
    } catch (e) {
      if (byKey.get(key) === entry) {
        byKey.delete(key);
        if (byKey.size === 0) delegateBindings.delete(el);
      }
      throw e;
    }
    return;
  }
  entry.selectors = selectors;
  entry.handlers = handlers;
}

function removeDelegateBinding(el: Element, key: string): boolean {
  const byKey = delegateBindings.get(el);
  if (!byKey) return false;
  const e = byKey.get(key);
  if (!e) return false;
  el.removeEventListener(e.type, e.bound);
  byKey.delete(key);
  if (byKey.size === 0) delegateBindings.delete(el);
  return true;
}

function dropElementBindings(el: Element, props: Record<string, any>): void {
  if (!props) return;
  for (const key of Object.keys(props)) {
    try {
      if (delegateEventType(key)) removeDelegateBinding(el, key);
      else if (eventPropType(key)) removeEventBinding(el, key);
    } catch {}
  }
}

function setStyleProp(style: CSSStyleDeclaration, key: string, value: string): void {
  try {
    if (key.startsWith('--')) style.setProperty(key, value);
    else if (key.indexOf('-') !== -1) style.setProperty(key, value);
    else (style as any)[key] = value;
  } catch {}
}

function clearStyleProp(style: CSSStyleDeclaration, key: string): void {
  try {
    if (key.startsWith('--') || key.indexOf('-') !== -1) style.removeProperty(key);
    else (style as any)[key] = '';
  } catch {}
}

function styleObjToCss(style: Record<string, any>): string {
  const parts: string[] = [];
  for (const k in style) {
    const v = style[k];
    if (v != null && v !== '') {
      let prop = '';
      for (let i = 0; i < k.length; i++) {
        const c = k[i];
        if (c >= 'A' && c <= 'Z') prop += '-' + c.toLowerCase();
        else prop += c;
      }
      parts.push(prop + ':' + v);
    }
  }
  return parts.join(';');
}

const pendingRefCalls: Array<{ el: Element; ref: any }> = [];

function releaseRef(el: Element, ref: any): void {
  if (ref == null) return;
  try {
    if (typeof ref === 'function') ref(null);
    else if (typeof ref === 'object') ref.current = null;
  } catch (e) { log.error('[recon] ref release error:', e); }
}

function setComponentRef(ref: any, instance: unknown): void {
  if (ref == null) return;
  try {
    if (typeof ref === 'function') ref(instance);
    else if (typeof ref === 'object') ref.current = instance;
  } catch (e) { log.error('[recon] component ref error:', e); }
}

function syncComponentRef(oldRef: any, newRef: any, instance: unknown): void {
  if (oldRef === newRef) return;
  releaseRef(null as unknown as Element, oldRef);
  setComponentRef(newRef, instance);
}

export function flushPendingRefs(): void {
  if (pendingRefCalls.length === 0) return;
  const list = pendingRefCalls.splice(0, pendingRefCalls.length);
  for (const { el, ref } of list) {
    try {
      if (typeof ref === 'function') ref(el);
      else if (ref && typeof ref === 'object') ref.current = el;
    } catch (e) { log.error('[recon] ref callback error:', e); }
  }
}

export function dropPendingRefsFor(root: Node | null): void {
  if (!root || pendingRefCalls.length === 0) return;
  for (let i = pendingRefCalls.length - 1; i >= 0; i--) {
    const entry = pendingRefCalls[i];
    if (entry.el === root || (root.contains && root.contains(entry.el))) {
      const picked = pendingRefCalls.splice(i, 1)[0];
      releaseRef(picked.el, picked.ref);
    }
  }
}

function setProp(el: Element, key: string, value: any) {
  if (key === 'key' || key === 'children') return;
  if (key === 'ref') {
    if (!el.isConnected) {
      pendingRefCalls.push({ el, ref: value });
      return;
    }
    if (typeof value === 'function') value(el);
    else if (value && typeof value === 'object') value.current = el;
    return;
  }
  if (key === 'class' || key === 'className') {
    el.setAttribute('class', value ?? '');
    return;
  }
  if (key === 'style') {
    if (typeof value === 'string') {
      el.setAttribute('style', value);
    } else if (typeof value === 'object' && value !== null) {
      (el as HTMLElement).style.cssText = styleObjToCss(value);
    }
    return;
  }
  if (key === 'dangerouslySetInnerHTML') {
    if (value && value.__html != null) {
      el.innerHTML = value.__html;
    }
    return;
  }
  const delegateType = delegateEventType(key);
  if (delegateType) {
    setDelegateBinding(el, key, delegateType, value);
    return;
  }
  const eventType = eventPropType(key);
  if (eventType && eventHandlerOf(value)) {
    setEventBinding(el, key, eventType, value);
    return;
  }

  if (typeof value === 'boolean') {
    if (key === 'checked') {
      (el as HTMLInputElement).checked = value;
      return;
    }
    if (value) el.setAttribute(key, '');
    else el.removeAttribute(key);
    return;
  }
  if (key === 'value') {
    const tag = el.tagName;
    if (tag === 'SELECT') {
      const want = String(value);
      requestAnimationFrame(() => {
        if (!el.isConnected) return;
        (el as HTMLSelectElement).value = want;
      });
    } else if (tag === 'INPUT' || tag === 'TEXTAREA') {
      (el as HTMLInputElement).value = String(value);
    }
    return;
  }
  if (value === '') {
    el.setAttribute(key, '');
    return;
  }
  if (value != null && value !== false) {
    el.setAttribute(key, String(value));
  }
}

function removeProp(el: Element, key: string, oldValue: any) {
  if (key === 'key' || key === 'children') return;
  if (key === 'ref') {
    releaseRef(el, oldValue);
    return;
  }
  if (key === 'class' || key === 'className') {
    el.removeAttribute('class');
    return;
  }
  if (key === 'style') {
    el.removeAttribute('style');
    return;
  }
  if (key === 'value') {
    const tag = (el as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') (el as HTMLInputElement).value = '';
    else if (tag === 'SELECT') (el as HTMLSelectElement).selectedIndex = -1;
    return;
  }
  if (key === 'checked') {
    (el as HTMLInputElement).checked = false;
    return;
  }
  if (key === 'dangerouslySetInnerHTML') {
    el.innerHTML = '';
    return;
  }
  if (delegateEventType(key)) {
    removeDelegateBinding(el, key);
    return;
  }
  const removedType = eventPropType(key);
  if (removedType && removeEventBinding(el, key)) return;
  el.removeAttribute(key);
}

function updateProp(el: Element, key: string, oldValue: any, newValue: any) {
  if (oldValue === newValue) return;
  if (key === 'ref') {
    releaseRef(el, oldValue);
    setProp(el, key, newValue);
    return;
  }
  if (key === 'style') {
    if (typeof newValue === 'object' && newValue !== null) {
      const st = (el as HTMLElement).style;
      if (typeof oldValue === 'object' && oldValue !== null) {
        for (const k in oldValue) {
          if (!(k in newValue)) clearStyleProp(st, k);
        }
        for (const k in newValue) {
          if (oldValue[k] !== newValue[k]) setStyleProp(st, k, String(newValue[k]));
        }
      } else {
        (el as HTMLElement).style.cssText = styleObjToCss(newValue);
      }
    } else if (typeof newValue === 'string') {
      el.setAttribute('style', newValue);
    } else {
      el.removeAttribute('style');
    }
    return;
  }
  if (key === 'checked') {
    (el as HTMLInputElement).checked = newValue != null && newValue !== false;
    return;
  }
  if (key === 'dangerouslySetInnerHTML') {
    const html = newValue && (newValue as any).__html;
    el.innerHTML = html != null ? String(html) : '';
    return;
  }
  if (newValue == null || newValue === false) {
    removeProp(el, key, oldValue);
    return;
  }
  const delegateType = delegateEventType(key);
  if (delegateType) {
    setDelegateBinding(el, key, delegateType, newValue);
    return;
  }
  const eventType = eventPropType(key);
  if (eventType && eventHandlerOf(newValue)) {
    setEventBinding(el, key, eventType, newValue);
    return;
  }

  if (eventType && eventHandlerOf(oldValue)) {
    removeEventBinding(el, key);
  }
  setProp(el, key, newValue);
}

function updateProps(el: Element, oldProps: Record<string, any>, newProps: Record<string, any>) {
  const allKeys = new Set([...Object.keys(oldProps), ...Object.keys(newProps)]);
  for (const key of allKeys) {
    if (key === 'key' || key === 'children') continue;
    const oldVal = oldProps[key];
    const newVal = newProps[key];
    if (newVal === undefined || newVal === null) {
      if (oldVal !== undefined && oldVal !== null) {
        removeProp(el, key, oldVal);
      }
    } else if (oldVal !== newVal) {
      updateProp(el, key, oldVal, newVal);
    }
  }
}

function mergeSlotProps(childProps: Record<string, any>, slotProps: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  const allKeys = new Set([...Object.keys(childProps), ...Object.keys(slotProps)]);
  for (const key of allKeys) {
    if (key === 'key' || key === 'children') continue;
    const cv = childProps[key];
    const sv = slotProps[key];
    if (key === 'class' || key === 'className') {
      const merged = ((cv || '') + ' ' + (sv || '')).trim();
      if (merged) result.class = (result.class ? result.class + ' ' : '') + merged;
      continue;
    }
    if (key === 'style') {
      if (typeof cv === 'string' || typeof sv === 'string') {
        const left = typeof cv === 'string' ? cv : styleObjToCss(cv || {});
        const right = typeof sv === 'string' ? sv : styleObjToCss(sv || {});
        const merged = (left ? left + ';' : '') + right;
        if (merged) result.style = merged;
        continue;
      }
      result.style = { ...(cv || {}), ...(sv || {}) };
      continue;
    }
    if (key.startsWith('on') && cv && sv) {
      result[key] = (e: any) => { cv(e); sv(e); };
      continue;
    }
    if (key === 'ref' && cv != null && sv != null) {
      const cbr = cv;
      const sbr = sv;
      result[key] = (el2: unknown) => {
        try {
          if (typeof cbr === 'function') cbr(el2);
          else if (cbr && typeof cbr === 'object') (cbr as any).current = el2;
        } catch {}
        try {
          if (typeof sbr === 'function') sbr(el2);
          else if (sbr && typeof sbr === 'object') (sbr as any).current = el2;
        } catch {}
      };
      continue;
    }
    if (key in slotProps) {
      if (sv !== undefined && sv !== null) result[key] = sv;
    } else if (cv !== undefined && cv !== null) {
      result[key] = cv;
    }
  }
  return result;
}

function resolveSlotVNode(vnode: VNode): VNode {
  if (vnode.type !== SLOT) return vnode;
  const child = vnode.children[0];
  if (!child) return vnode;
  const merged: VNode = {
    ...child,
    props: mergeSlotProps(child.props, vnode.props),
  };
  return merged;
}

function stabilizeSlotHandlers(oldVNode: VNode, newVNode: VNode, oldResolved: VNode, resolved: VNode): void {
  if (resolved === newVNode || oldResolved === oldVNode) return;
  const prev = oldResolved.props ?? {};
  const next = resolved.props ?? {};
  const oldChild = (oldVNode.children[0] as VNode | undefined)?.props ?? {};
  const newChild = (newVNode.children[0] as VNode | undefined)?.props ?? {};
  const oldSlot = oldVNode.props ?? {};
  const newSlot = newVNode.props ?? {};
  for (const key of Object.keys(next)) {
    const nv = (next as any)[key];
    if (typeof nv !== 'function') continue;
    const pv = (prev as any)[key];
    if (typeof pv !== 'function') continue;
    if ((oldChild as any)[key] === (newChild as any)[key] && (oldSlot as any)[key] === (newSlot as any)[key]) {
      (next as any)[key] = pv;
    }
  }
}

export function createDOM(vnode: VNode, reuseInstance?: ComponentInstance): Node {
  if (!vnode) return document.createTextNode('');

  if (vnode.type === TEXT) {
    const node = document.createTextNode(vnode.props.nodeValue ?? '');
    vnode.dom = node;
    return node;
  }

  if (vnode.type === FRAGMENT || vnode.type === SLOTTABLE) {
    const fragment = document.createDocumentFragment();
    const fxSnapFrag = snapshotEffectQueues();
    const ctxSnapFrag = snapshotContextQueue();
    const doneFrag: VNode[] = [];
    try {
      for (const child of vnode.children) {
        fragment.appendChild(createDOM(child));
        doneFrag.push(child);
      }
    } catch (e) {
      destroyCreated(doneFrag);
      rollbackEffectQueues(fxSnapFrag);
      rollbackContextQueue(ctxSnapFrag);
      throw e;
    }
    return fragment;
  }

  if (vnode.type === SLOT) {
    const resolved = resolveSlotVNode(vnode);
    if (resolved === vnode) {
      const empty = document.createTextNode('');
      vnode.dom = empty;
      return empty;
    }
    const fxSnapSlot = snapshotEffectQueues();
    const ctxSnapSlot = snapshotContextQueue();
    try {
      const node = createDOM(resolved);
      vnode.dom = node;
      (vnode as any).__resolved = resolved;
      return node;
    } catch (e) {
      destroyCreated([resolved]);
      rollbackEffectQueues(fxSnapSlot);
      rollbackContextQueue(ctxSnapSlot);
      throw e;
    }
  }

  if (vnode.type === PORTAL) {
    const placeholder = document.createTextNode('');
    vnode.dom = placeholder;
    const container = vnode.props.container as Element | null;
    if (container) {
      const fxSnapPortal = snapshotEffectQueues();
      const ctxSnapPortal = snapshotContextQueue();
      const donePortal: VNode[] = [];
      try {
        for (const child of vnode.children) {
          const childDom = createDOM(child);
          container.appendChild(childDom);
          donePortal.push(child);
        }
      } catch (e) {
        destroyCreated(donePortal);
        for (const node of findAllDomNodes(vnode)) {
          if (node.parentNode === container) container.removeChild(node);
        }
        rollbackEffectQueues(fxSnapPortal);
        rollbackContextQueue(ctxSnapPortal);
        throw e;
      }
    }
    return placeholder;
  }

    if (typeof vnode.type === 'function') {
      const component = vnode.type as ComponentType;
      const instance = reuseInstance ?? new ComponentInstance(component, vnode.props);
      if (instance.rootRef === undefined) instance.rootRef = getMountRoot();
      if (reuseInstance) {
        reuseInstance.props = vnode.props;
        reuseInstance._mounted = true;
      }
      const prevInst = currentInstance;
      setCurrentInstance(instance);
      const fxSnapMount = snapshotEffectQueues();
      const ctxSnapMount = snapshotContextQueue();
      let result: VNode | null;
      try {
        result = instance.render();
      } catch (e) {
        rollbackEffectQueues(fxSnapMount);
        rollbackContextQueue(ctxSnapMount);
        setCurrentInstance(prevInst);
        restoreProvided(instance);
        throw e;
      }
      setCurrentInstance(prevInst);
      const frame = takeBoundaryFrame(instance);
      if (frame) {
        clearBoundaryFrame(instance);
        boundaryStack.push(frame);
      }
      try {
        instance.vnode = result;
        if (result) {
          const dom = createDOM(result);
          vnode.dom = dom;
          vnode.componentInstance = instance;
          setComponentRef(vnode.props.ref, instance);
          return dom;
        }
        const empty = document.createTextNode('');
        vnode.dom = empty;
        vnode.componentInstance = instance;
        setComponentRef(vnode.props.ref, instance);
        return empty;
      } catch (e) {
        if (frame && boundaryStack[boundaryStack.length - 1] === frame && frame.handle(e)) {
          rollbackEffectQueues(fxSnapMount);
          rollbackContextQueue(ctxSnapMount);
          restoreProvided(instance);
          const fb = safeFallback(frame);
          instance.vnode = fb;
          if (fb) {
            try {
              const dom = createDOM(fb);
              vnode.dom = dom;
              vnode.componentInstance = instance;
              setComponentRef(vnode.props.ref, instance);
              restoreProvided(frame.instance);
              return dom;
            } catch (e2) {
              instance.vnode = null;
              rollbackEffectQueues(fxSnapMount);
              rollbackContextQueue(ctxSnapMount);
              throw e2;
            }
          }
          const empty = document.createTextNode('');
          vnode.dom = empty;
          vnode.componentInstance = instance;
          setComponentRef(vnode.props.ref, instance);
          restoreProvided(frame.instance);
          return empty;
        }
        instance.vnode = null;
        rollbackEffectQueues(fxSnapMount);
        rollbackContextQueue(ctxSnapMount);
        throw e;
      } finally {
        if (frame) popFrame(frame);
        restoreProvided(instance);
      }
    }

  const el = createElement(vnode.type as string);
  vnode.dom = el;

  const fxSnapEl = snapshotEffectQueues();
  const ctxSnapEl = snapshotContextQueue();
  const doneEl: VNode[] = [];
  try {
    for (const [key, value] of Object.entries(vnode.props)) {
      if (key === 'key' || key === 'children') continue;
      if (value !== undefined && value !== null) {
        setProp(el, key, value);
      }
    }

    if (vnode.children.length > 0) {
      const htmlProp = (vnode.props as Record<string, any>).dangerouslySetInnerHTML;
      const hasHtml = htmlProp != null && (htmlProp as any).__html != null;
      if (!hasHtml) {
        const frag = document.createDocumentFragment();
        for (const child of vnode.children) {
          const childDom = createDOM(child);
          if (childDom) frag.appendChild(childDom);
          doneEl.push(child);
        }
        el.appendChild(frag);
      }
    }
  } catch (e) {
    destroyCreated(doneEl);
    dropPendingRefsFor(el);
    dropElementBindings(el, vnode.props);
    rollbackEffectQueues(fxSnapEl);
    rollbackContextQueue(ctxSnapEl);
    throw e;
  }

  return el;
}

function findDomNode(vnode: VNode): Node | null {
  if (typeof vnode.type === 'function') {
    const inner = vnode.componentInstance?.vnode;
    if (inner && inner !== vnode) {
      const found = findDomNode(inner);
      if (found) return found;
    }
  }
  if (vnode.type === SLOT) {
    const resolved = (vnode as any).__resolved as VNode | undefined;
    if (resolved) {
      const found = findDomNode(resolved);
      if (found) return found;
    }
  }
  if (vnode.type === FRAGMENT || vnode.type === SLOTTABLE) {
    for (const child of vnode.children) {
      const dom = findDomNode(child);
      if (dom) return dom;
    }
    if (vnode.dom) return vnode.dom;
    return null;
  }
  if (vnode.dom) return vnode.dom;
  if (vnode.type === SLOT || vnode.type === PORTAL) {
    for (const child of vnode.children) {
      const dom = findDomNode(child);
      if (dom) return dom;
    }
    return null;
  }
  return null;
}

function findAllDomNodes(vnode: VNode): Node[] {
  if (vnode.type === SLOT) {
    const resolved = (vnode as any).__resolved as VNode | undefined;
    if (resolved) return findAllDomNodes(resolved);
    if (vnode.dom) return [vnode.dom];
  }
  if (vnode.type === FRAGMENT || vnode.type === SLOTTABLE || vnode.type === SLOT || vnode.type === PORTAL) {
    const nodes: Node[] = [];
    for (const child of vnode.children) {
      nodes.push(...findAllDomNodes(child));
    }
    return nodes;
  }
  if (typeof vnode.type === 'function') {
    const inner = vnode.componentInstance?.vnode;
    if (inner && inner !== vnode) return findAllDomNodes(inner);
    if (vnode.dom && vnode.dom.nodeType === 3) return [vnode.dom];
    return [];
  }
  if (vnode.dom) return [vnode.dom];
  return [];
}

function isSameNodeType(a: VNode, b: VNode): boolean {
  if (a.type === SLOT || b.type === SLOT) return a.type === b.type;
  if (a.type === PORTAL || b.type === PORTAL) return a.type === b.type;
  if (typeof a.type === 'function' && typeof b.type === 'function') {
    return a.type === b.type;
  }
  return a.type === b.type;
}

function childMapKey(vnode: VNode, index: number): string {
  return vnode.key != null ? 'k:' + String(vnode.key) : 'i:' + index;
}

function removePortalPlaceholder(vnode: VNode): void {
  if (vnode.type !== PORTAL) return;
  const ph = vnode.dom;
  if (ph && ph.parentNode) ph.parentNode.removeChild(ph);
}

function removeDeepPlaceholders(vnode: VNode | null): void {
  if (!vnode) return;
  if (vnode.type === PORTAL) {
    removePortalPlaceholder(vnode);
    return;
  }
  if (typeof vnode.type === 'function') {
    const inner = vnode.componentInstance?.vnode;
    if (inner && inner !== vnode) removeDeepPlaceholders(inner);
    return;
  }
  if (vnode.type === SLOT) {
    const resolved = (vnode as any).__resolved as VNode | undefined;
    if (resolved) {
      removeDeepPlaceholders(resolved);
      return;
    }
  }
  for (const child of vnode.children) removeDeepPlaceholders(child);
}

function reorderNodes(vnode: VNode): Node[] {
  const nodes = findAllDomNodes(vnode);
  if (vnode.type === PORTAL && vnode.dom && !nodes.includes(vnode.dom)) nodes.push(vnode.dom);
  return nodes;
}

export function patch(dom: Node, oldVNode: VNode, newVNode: VNode): Node {
  if (oldVNode === newVNode) return dom;
  if (!isSameNodeType(oldVNode, newVNode)) {
    const oldRef = oldVNode.props?.ref;
    const newDom = createDOM(newVNode);
    runUnmountCleanups(oldVNode);
    if (oldRef != null && oldRef === newVNode.props?.ref && typeof newVNode.type === 'function' && newVNode.componentInstance) {
      setComponentRef(oldRef, newVNode.componentInstance);
    }
    const anchor = (oldVNode.type === PORTAL ? oldVNode.dom : null) || findDomNode(oldVNode) || dom;
    const host = (anchor && anchor.parentNode) || (dom && dom.parentNode);
    if (host && anchor && anchor.parentNode === host) {
      host.replaceChild(newDom, anchor);
      const oldNodes = findAllDomNodes(oldVNode);
      for (const node of oldNodes) {
        if (node !== anchor && node !== newDom && node.parentNode) node.parentNode.removeChild(node);
      }
    } else if (host) {
      const oldNodes = findAllDomNodes(oldVNode);
      for (const node of oldNodes) {
        if (node !== newDom && node.parentNode) node.parentNode.removeChild(node);
      }
      host.appendChild(newDom);
    }
    return newDom;
  }

  if (newVNode.type === TEXT) {
    if ((dom as Text).nodeValue !== newVNode.props.nodeValue) {
      (dom as Text).nodeValue = newVNode.props.nodeValue;
    }
    newVNode.dom = dom;
    return dom;
  }

  if (newVNode.type === FRAGMENT || newVNode.type === SLOTTABLE) {
    const fxSnapFragP = snapshotEffectQueues();
    const ctxSnapFragP = snapshotContextQueue();
    try {
      const firstOld = findDomNode(oldVNode);
      const host = (firstOld && firstOld.parentNode) || (dom && dom.parentNode) || dom;
      reconcileChildren(host, oldVNode.children, newVNode.children, firstOld || dom);
    } catch (e) {
      rollbackEffectQueues(fxSnapFragP);
      rollbackContextQueue(ctxSnapFragP);
      throw e;
    }
    newVNode.dom = dom;
    return dom;
  }

  if (newVNode.type === SLOT) {
    const oldResolved = (oldVNode as any).__resolved ?? resolveSlotVNode(oldVNode);
    const resolved = resolveSlotVNode(newVNode);
    stabilizeSlotHandlers(oldVNode, newVNode, oldResolved, resolved);
    if (resolved === newVNode) {
      if (oldResolved !== oldVNode) {
        runUnmountCleanups(oldResolved);
        const empty = document.createTextNode('');
        newVNode.dom = empty;
        if (dom && dom.parentNode) dom.parentNode.replaceChild(empty, dom);
        return empty;
      }
      newVNode.dom = dom;
      return dom;
    }
    const fxSnapSlotP = snapshotEffectQueues();
    const ctxSnapSlotP = snapshotContextQueue();
    try {
      const out = patch(dom, oldResolved, resolved);
      newVNode.dom = (resolved as VNode).dom ?? out;
      (newVNode as any).__resolved = resolved;
      return out;
    } catch (e) {
      rollbackEffectQueues(fxSnapSlotP);
      rollbackContextQueue(ctxSnapSlotP);
      throw e;
    }
  }

  if (newVNode.type === PORTAL) {
    const container = newVNode.props.container as Element | null;
    const oldContainer = oldVNode.props.container as Element | null;
    if (container !== oldContainer) {
      const fxSnapPortalP = snapshotEffectQueues();
      const ctxSnapPortalP = snapshotContextQueue();
      let fresh: Node;
      try {
        fresh = createDOM(newVNode);
      } catch (e) {
        rollbackEffectQueues(fxSnapPortalP);
        rollbackContextQueue(ctxSnapPortalP);
        throw e;
      }
      runUnmountCleanups(oldVNode);
      if (dom.parentNode) dom.parentNode.replaceChild(fresh, dom);
      return fresh;
    }
    if (container) {
      const fxSnapPortalC = snapshotEffectQueues();
      const ctxSnapPortalC = snapshotContextQueue();
      try {
        reconcileChildren(container, oldVNode.children, newVNode.children, null);
      } catch (e) {
        rollbackEffectQueues(fxSnapPortalC);
        rollbackContextQueue(ctxSnapPortalC);
        throw e;
      }
    }
    newVNode.dom = oldVNode.dom ?? dom;
    return newVNode.dom;
  }

  if (typeof newVNode.type === 'function') {
    const component = newVNode.type as ComponentType;
    let instance = oldVNode.componentInstance;
    const prevProps = instance ? instance.props : newVNode.props;
    const prevMounted = instance ? instance._mounted : true;
    const prevCompRef = oldVNode.props.ref;
    if (!instance) {
      instance = new ComponentInstance(component, newVNode.props);
      if (instance.rootRef === undefined) instance.rootRef = getMountRoot();
    } else {
      instance.props = newVNode.props;
      instance._mounted = true;
    }
    newVNode.componentInstance = instance;

    if (isTraced(instance.displayName)) {
      const changed = diffProps(oldVNode.props, newVNode.props);
      log.debug('[atom] rerender ' + instance.displayName + ' props changed: ' + (changed || '(same)'));
    }

    const prevPatchInst = currentInstance;
    setCurrentInstance(instance);
    const fxSnapPatch = snapshotEffectQueues();
    const ctxSnapPatch = snapshotContextQueue();
    let result: VNode | null;
    try {
      result = instance.render();
    } catch (e) {
      instance.props = prevProps;
      instance._mounted = prevMounted;
      rollbackEffectQueues(fxSnapPatch);
      rollbackContextQueue(ctxSnapPatch);
      setCurrentInstance(prevPatchInst);
      restoreProvided(instance);
      throw e;
    }
    setCurrentInstance(prevPatchInst);
    const frame = takeBoundaryFrame(instance);
    if (frame) {
      clearBoundaryFrame(instance);
      boundaryStack.push(frame);
    }
    const prevCommitted = instance.vnode;
    try {
      instance._dirty = false;

      const oldResult = isComponentBoundary(oldVNode) && oldVNode.componentInstance?.vnode ? oldVNode.componentInstance.vnode : oldVNode;
      const hadNullResult = isComponentBoundary(oldVNode) && oldVNode.componentInstance?.vnode == null;
      instance.vnode = result;

      if (!result) {
        if (dom && dom.nodeType !== 3) {
          runUnmountCleanups(oldResult);
          for (const node of findAllDomNodes(oldResult)) {
            if (node.parentNode) node.parentNode.removeChild(node);
          }
          removeDeepPlaceholders(oldResult);
        }
        const empty = dom && dom.nodeType === 3 ? dom : document.createTextNode('');
        newVNode.dom = empty;
        syncComponentRef(prevCompRef, newVNode.props.ref, instance);
        return empty;
      }

      if (hadNullResult) {
        const freshDom = createDOM(result);
        if (dom && dom.parentNode) dom.parentNode.replaceChild(freshDom, dom);
        newVNode.dom = freshDom;
        syncComponentRef(prevCompRef, newVNode.props.ref, instance);
        return freshDom;
      }

      const newDom = patch(dom, oldResult, result);
      newVNode.dom = newDom;
      syncComponentRef(prevCompRef, newVNode.props.ref, instance);
      return newDom;
    } catch (e) {
      if (frame && boundaryStack[boundaryStack.length - 1] === frame && frame.handle(e)) {
        rollbackEffectQueues(fxSnapPatch);
        rollbackContextQueue(ctxSnapPatch);
        restoreProvided(instance);
        const fb = safeFallback(frame);
        const oldResult = isComponentBoundary(oldVNode) && oldVNode.componentInstance?.vnode ? oldVNode.componentInstance.vnode : oldVNode;
        instance._dirty = false;
        instance.vnode = fb;
        if (!fb) {
          runUnmountCleanups(oldResult);
          for (const node of findAllDomNodes(oldResult)) {
            if (node.parentNode) node.parentNode.removeChild(node);
          }
          removeDeepPlaceholders(oldResult);
          const empty = document.createTextNode('');
          newVNode.dom = empty;
          syncComponentRef(prevCompRef, newVNode.props.ref, instance);
          restoreProvided(frame.instance);
          return empty;
        }
        try {
          const fbDom = patch(dom, oldResult, fb);
          newVNode.dom = fbDom;
          syncComponentRef(prevCompRef, newVNode.props.ref, instance);
          restoreProvided(frame.instance);
          return fbDom;
        } catch (e2) {
          instance.props = prevProps;
          instance._mounted = prevMounted;
          instance.vnode = prevCommitted;
          instance._dirty = true;
          rollbackEffectQueues(fxSnapPatch);
          rollbackContextQueue(ctxSnapPatch);
          throw e2;
        }
      }
      instance.props = prevProps;
      instance._mounted = prevMounted;
      instance.vnode = prevCommitted;
      instance._dirty = true;
      rollbackEffectQueues(fxSnapPatch);
      rollbackContextQueue(ctxSnapPatch);
      throw e;
    } finally {
      if (frame) popFrame(frame);
      restoreProvided(instance);
    }
  }

  const el = dom as HTMLElement;
  newVNode.dom = el;

  const fxSnapElP = snapshotEffectQueues();
  const ctxSnapElP = snapshotContextQueue();
  try {
    updateProps(el, oldVNode.props, newVNode.props);
    const nextHtml = (newVNode.props as Record<string, any>).dangerouslySetInnerHTML;
    const nextHasHtml = nextHtml != null && (nextHtml as any).__html != null;
    if (nextHasHtml) {
      reconcileChildren(el, oldVNode.children, [], null);
    } else {
      reconcileChildren(el, oldVNode.children, newVNode.children, null);
    }
  } catch (e) {
    try {
      updateProps(el, newVNode.props, oldVNode.props);
    } catch {}
    rollbackEffectQueues(fxSnapElP);
    rollbackContextQueue(ctxSnapElP);
    throw e;
  }

  return el;
}

function reconcileChildren(
  parentEl: Node,
  oldChildren: VNode[],
  newChildren: VNode[],
  anchor: Node | null
) {
  const oldLen = oldChildren.length;
  const newLen = newChildren.length;

  if (oldChildren === newChildren) return;

  const dupOldFirst: VNode[] = [];
  const oldKeyed = new Map<string, { vnode: VNode; nodes: Node[]; origKey: string }>();
  for (let i = 0; i < oldLen; i++) {
    const key = childMapKey(oldChildren[i], i);
    if (oldKeyed.has(key)) {
      log.warn('[recon] DUP-KEY key=' + String(key));
      dupOldFirst.push(oldChildren[i]);
      continue;
    }
    oldKeyed.set(key, { vnode: oldChildren[i], nodes: findAllDomNodes(oldChildren[i]), origKey: key });
  }

  const usedKeys = new Set<string>();
  interface PatchEntry { nodes: Node[] }
  const patches: PatchEntry[] = [];
  const freshCreated: VNode[] = [];

  for (let i = 0; i < newLen; i++) {
    const newChild = newChildren[i];
    const key = childMapKey(newChild, i);
    const oldEntry = oldKeyed.get(key);

    try {
      if (oldEntry && !usedKeys.has(key)) {
        usedKeys.add(key);
        const oldDom = oldEntry.nodes[0];
        const attached = oldEntry.nodes.filter((n) => n.parentNode);
        const inPlace = attached.length > 0 && attached.every((n) => {
          const par = n.parentNode;
          return !!par && par.nodeType !== 11;
        });
        if (oldDom && oldDom.parentNode && inPlace) {
          const newDom = patch(oldDom, oldEntry.vnode, newChild);
          newChild.dom = newDom;
          patches.push({ nodes: reorderNodes(newChild) });
        } else {
          runUnmountCleanups(oldEntry.vnode);
          for (const node of oldEntry.nodes) {
            if (node.parentNode) node.parentNode.removeChild(node);
          }
          removePortalPlaceholder(oldEntry.vnode);
          const newDom = createDOM(newChild);
          newChild.dom = newDom;
          freshCreated.push(newChild);
          patches.push({ nodes: reorderNodes(newChild) });
        }
      } else if (oldEntry) {
        log.warn('[recon] DUP-KEY key=' + String(key) + ' parent=' + (parentEl as HTMLElement).className);
        const newDom = createDOM(newChild);
        newChild.dom = newDom;
        freshCreated.push(newChild);
        patches.push({ nodes: reorderNodes(newChild) });
      } else {
        const newDom = createDOM(newChild);
        newChild.dom = newDom;
        freshCreated.push(newChild);
        patches.push({ nodes: reorderNodes(newChild) });
      }
    } catch (e) {
      destroyCreated(freshCreated);
      throw e;
    }
  }

  for (const [, entry] of oldKeyed) {
    if (!usedKeys.has(entry.origKey)) {
      log.debug('[recon] remove key=' + String(entry.origKey) + ' parent=' + (parentEl as HTMLElement).className);
      runUnmountCleanups(entry.vnode);
      for (const node of entry.nodes) {
        if (node.parentNode) node.parentNode.removeChild(node);
      }
      removePortalPlaceholder(entry.vnode);
    }
  }

  for (const dup of dupOldFirst) {
    runUnmountCleanups(dup);
    for (const node of findAllDomNodes(dup)) {
      if (node.parentNode) node.parentNode.removeChild(node);
    }
    removePortalPlaceholder(dup);
  }

  if (patches.length === 0) return;

  const flat: Node[] = [];
  for (const p of patches) {
    for (const node of p.nodes) {
      const par = node.parentNode;
      if (!par || par === parentEl || par.nodeType === 11) flat.push(node);
    }
  }
  {
    const members = new Set<Node>(flat);
    let matched = 0;
    let ordered = true;
    for (let n = parentEl.firstChild; n !== null; n = n.nextSibling) {
      if (!members.has(n)) continue;
      if (flat[matched] !== n) { ordered = false; break; }
      matched++;
    }
    if (ordered && matched === flat.length) return;
  }

  let cur: Node | null = parentEl.firstChild;
  if (anchor && anchor.parentNode === parentEl) cur = anchor;
  for (let i = 0; i < patches.length; i++) {
    const nodes = patches[i].nodes;
    for (let j = 0; j < nodes.length; j++) {
      const node = nodes[j];
      const par = node.parentNode;
      if (par && par !== parentEl && par.nodeType !== 11) continue;
      if (node === cur) {
        cur = cur!.nextSibling;
      } else {
        parentEl.insertBefore(node, cur);
      }
    }
  }
}
