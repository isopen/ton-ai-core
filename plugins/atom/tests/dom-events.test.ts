/**
 * @jest-environment jsdom
 */

import { requestOnce, bindLifetimeListeners } from '../src/dom-events.js';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function trackListeners(target: Window | Document | Element = window): { adds: number; removes: number; restore: () => void } {
  const state = { adds: 0, removes: 0 };
  const t = target as any;
  const origAdd = t.addEventListener;
  const origRemove = t.removeEventListener;
  t.addEventListener = function (type: string, ...rest: any[]) {
    if (String(type).startsWith('track-')) state.adds++;
    return origAdd.call(this, type, ...rest);
  };
  t.removeEventListener = function (type: string, ...rest: any[]) {
    if (String(type).startsWith('track-')) state.removes++;
    return origRemove.call(this, type, ...rest);
  };
  return {
    adds: () => state.adds,
    removes: () => state.removes,
    restore: () => {
      t.addEventListener = origAdd;
      t.removeEventListener = origRemove;
    },
  };
}

describe('requestOnce', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('dispatches the request with payload and resolves on matching response', async () => {
    const dispatched: any[] = [];
    const origDispatch = window.dispatchEvent;
    window.dispatchEvent = ((e: Event) => {
      if (e.type === 'req-x') dispatched.push(e);
      return origDispatch.call(window, e);
    }) as typeof window.dispatchEvent;

    const p = requestOnce<{ answer: number }>('req-x', 'resp-x', { payload: { q: 1 } });
    expect(dispatched.length).toBe(1);
    expect((dispatched[0] as CustomEvent).detail).toEqual({ q: 1 });

    await tick();
    window.dispatchEvent(new CustomEvent('resp-x', { detail: { answer: 42 } }));
    const detail = await p;

    expect(detail).toEqual({ answer: 42 });
    window.dispatchEvent = origDispatch;
  });

  test('match filter skips non-matching responses', async () => {
    const p = requestOnce('rq', 'rs', { match: (d: any) => d?.id === 'target' });
    window.dispatchEvent(new CustomEvent('rs', { detail: { id: 'other' } }));
    await tick();
    window.dispatchEvent(new CustomEvent('rs', { detail: { id: 'target' } }));
    const detail = await p;
    expect((detail as any).id).toBe('target');
  });

  test('response listener is removed after resolution', async () => {
    const t = trackListeners(window);
    const p = requestOnce('track-req', 'track-resp');
    await tick();
    window.dispatchEvent(new CustomEvent('track-resp', { detail: 'done' }));
    const detail = await p;
    restore_and_assert: {
      t.restore();
      expect(detail).toBe('done');
      expect(t.adds()).toBe(1);
      expect(t.removes()).toBeGreaterThanOrEqual(1);
    }
  });

  test('rejects with timeout error and cleans up', async () => {
    const t = trackListeners(window);
    const p = requestOnce('track-to-req', 'track-to-resp', { timeoutMs: 30 });
    try {
      await p;
      throw new Error('expected timeout rejection');
    } catch (err: any) {
      t.restore();
      expect(err.message).toContain('timeout');
      expect(t.adds()).toBe(1);
      expect(t.removes()).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('bindLifetimeListeners', () => {
  test('attaches all pairs and detach removes them symmetrically', () => {
    const a = jest.fn();
    const b = jest.fn();
    const el = document.createElement('div');

    const detach = bindLifetimeListeners(el, { 'evt-a': a, 'evt-b': b });

    el.dispatchEvent(new Event('evt-a'));
    el.dispatchEvent(new Event('evt-b'));
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    detach();
    el.dispatchEvent(new Event('evt-a'));
    el.dispatchEvent(new Event('evt-b'));
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    expect(() => detach()).not.toThrow();
  });
});
