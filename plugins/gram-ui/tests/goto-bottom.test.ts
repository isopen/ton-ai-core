/**
 * @jest-environment jsdom
 */

import { render } from '@ton-ai/atom';
import { useState } from '@ton-ai/atom/hooks';
import { GotoBottomButton, useShowGotoBottom, scrollListToBottom, countNewBelow, countNewBelowViewport } from '../dist/components/goto-bottom.js';

function mountList(scrollTop: number, clientHeight: number, scrollHeight: number): HTMLElement {
  document.body.innerHTML = '';
  const list = document.createElement('div');
  list.id = 'tg-msg-list-content';
  Object.defineProperty(list, 'scrollTop', { value: scrollTop, writable: true, configurable: true });
  Object.defineProperty(list, 'clientHeight', { value: clientHeight, configurable: true });
  Object.defineProperty(list, 'scrollHeight', { value: scrollHeight, configurable: true });
  document.body.appendChild(list);
  return list;
}

const tick = (ms = 20) => new Promise<void>((r) => setTimeout(r, ms));

function Probe({ listId, seen, active = true }: { listId: string; seen: boolean[]; active?: boolean }) {
  const show = useShowGotoBottom(listId, active);
  const [, setTick] = useState(0);
  seen.push(show);
  void setTick;
  return null as any;
}

describe('useShowGotoBottom', () => {
  test('hidden at bottom, shown after scrolling up with delay', async () => {
    const list = mountList(900, 100, 1000);
    const seen: boolean[] = [];
    const c = document.createElement('div');
    document.body.appendChild(c);
    render(() => Probe({ listId: 'a', seen }) as any, c as HTMLElement);
    await tick();
    expect(seen[seen.length - 1]).toBe(false);
    Object.defineProperty(list, 'scrollTop', { value: 100, writable: true, configurable: true });
    list.dispatchEvent(new Event('scroll'));
    await tick(50);
    expect(seen[seen.length - 1]).toBe(false);
    await tick(220);
    expect(seen[seen.length - 1]).toBe(true);
  });

  test('hides immediately when scrolled back to bottom', async () => {
    const list = mountList(100, 100, 1000);
    const seen: boolean[] = [];
    const c = document.createElement('div');
    document.body.appendChild(c);
    render(() => Probe({ listId: 'b', seen }) as any, c as HTMLElement);
    await tick(250);
    expect(seen[seen.length - 1]).toBe(true);
    Object.defineProperty(list, 'scrollTop', { value: 995, writable: true, configurable: true });
    list.dispatchEvent(new Event('scroll'));
    await tick();
    expect(seen[seen.length - 1]).toBe(false);
  });

  test('resets on list change', async () => {
    mountList(100, 100, 1000);
    const seen: boolean[] = [];
    const c = document.createElement('div');
    document.body.appendChild(c);
    let listId = 'x';
    const Host = () => Probe({ listId, seen }) as any;
    render(Host as any, c as HTMLElement);
    await tick(250);
    expect(seen[seen.length - 1]).toBe(true);
    listId = 'y';
    const c2 = document.createElement('div');
    document.body.appendChild(c2);
    render(Host as any, c2 as HTMLElement);
    await tick();
    expect(seen[seen.length - 1]).toBe(false);
  });
});

describe('useShowGotoBottom inactive', () => {
  test('never shows while inactive even when scrolled up', async () => {
    const list = document.createElement('div');
    list.id = 'tg-msg-list-content';
    Object.defineProperty(list, 'scrollTop', { value: 100, writable: true, configurable: true });
    Object.defineProperty(list, 'clientHeight', { value: 100, configurable: true });
    Object.defineProperty(list, 'scrollHeight', { value: 1000, configurable: true });
    document.body.innerHTML = '';
    document.body.appendChild(list);
    const seen: boolean[] = [];
    const c = document.createElement('div');
    document.body.appendChild(c);
    render(() => Probe({ listId: 'z', seen, active: false }) as any, c as HTMLElement);
    list.dispatchEvent(new Event('scroll'));
    await tick(250);
    expect(seen.every((v) => v === false)).toBe(true);
  });
});

describe('GotoBottomButton', () => {
  test('renders nothing when hidden', () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    let called = 0;
    render(() => GotoBottomButton({ visible: false, newCount: 5, onGo: () => { called++; } }) as any, c as HTMLElement);
    expect(c.querySelector('.tgui-goto-bottom')).toBeNull();
    expect(called).toBe(0);
    document.body.removeChild(c);
  });

  test('renders chevron and fires onGo', () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    let called = 0;
    render(() => GotoBottomButton({ visible: true, newCount: 0, onGo: () => { called++; } }) as any, c as HTMLElement);
    const btn = c.querySelector('.tgui-goto-bottom') as HTMLElement;
    expect(btn).not.toBeNull();
    const arrow = btn.querySelector('svg.tgui-goto-bottom-arrow') as SVGElement | null;
    expect(arrow).not.toBeNull();
    expect(arrow!.getAttribute('viewBox')).toBe('0 0 18 11');
    expect(arrow!.querySelector('path')!.getAttribute('d')).toBe('M1.4 1.2 9 8.9 16.6 1.2');
    expect(c.querySelector('.tgui-goto-bottom-count')).toBeNull();
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(called).toBe(1);
    document.body.removeChild(c);
  });

  test('shows the new messages count above the button', () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    render(() => GotoBottomButton({ visible: true, newCount: 7, onGo: () => { } }) as any, c as HTMLElement);
    const wrap = c.querySelector('.tgui-goto-bottom-wrap') as HTMLElement;
    expect(wrap).not.toBeNull();
    expect(Array.from(wrap.children).map((k) => k.className)).toEqual(['tgui-goto-bottom-count', 'tgui-goto-bottom']);
    expect(wrap.querySelector('.tgui-goto-bottom-count')!.textContent).toContain('7');
    document.body.removeChild(c);
  });

  test('caps the count label at 99+', () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    render(() => GotoBottomButton({ visible: true, newCount: 150, onGo: () => { } }) as any, c as HTMLElement);
    expect(c.querySelector('.tgui-goto-bottom-count')!.textContent).toContain('99+');
    document.body.removeChild(c);
  });

  test('scrollListToBottom jumps to the end', () => {
    const list = mountList(100, 100, 1000);
    scrollListToBottom();
    expect(list.scrollTop).toBe(1000);
  });
});

describe('countNewBelow', () => {
  const row = (...ids: number[]) => ({ msgs: ids.map((id) => ({ id })) });
  const rows = [row(90), row(91, 92), row(93), row(94, 95)];

  test('counts messages after the last visible id', () => {
    expect(countNewBelow(rows, 90)).toBe(5);
    expect(countNewBelow(rows, 92)).toBe(3);
    expect(countNewBelow(rows, 93)).toBe(2);
  });

  test('returns zero at the end of the list and for unknown ids', () => {
    expect(countNewBelow(rows, 95)).toBe(0);
    expect(countNewBelow(rows, 500)).toBe(0);
    expect(countNewBelow([], 90)).toBe(0);
  });

  test('tolerates empty and missing rows', () => {
    expect(countNewBelow([row(1), { msgs: [] }, row(2, 3)], 1)).toBe(2);
    expect(countNewBelow([undefined as any, row(1, 2)], 0)).toBe(2);
  });
});

describe('countNewBelowViewport', () => {
  const ROW_H = 50;
  const IDS = [10, 11, 12, 13, 14, 15];
  const rows = IDS.map((id) => ({ msgs: [{ id }] }));

  function mount(rowsTop: number, scrollTop: number): HTMLElement {
    document.body.innerHTML = '';
    const list = document.createElement('div');
    list.id = 'tg-msg-list-content';
    Object.defineProperty(list, 'clientHeight', { configurable: true, get: () => 100 });
    Object.defineProperty(list, 'scrollHeight', { configurable: true, get: () => 400 });
    Object.defineProperty(list, 'scrollTop', { configurable: true, get: () => scrollTop });
    Object.defineProperty(list, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 0, bottom: 100, height: 100, left: 0, right: 300, width: 300, x: 0, y: 0, toJSON: () => ({}) } as any),
    });
    IDS.forEach((id, i) => {
      const row = document.createElement('div');
      row.className = 'tgui-msg-row';
      row.id = 'msg-' + id;
      const top = rowsTop + i * ROW_H - scrollTop;
      row.getBoundingClientRect = () => ({ top, bottom: top + ROW_H, height: ROW_H, left: 0, right: 300, width: 300, x: 0, y: top, toJSON: () => ({}) } as any);
      list.appendChild(row);
    });
    document.body.appendChild(list);
    return list;
  }

  test('counts the messages below the last visible row', () => {
    const list = mount(0, 0);
    expect(countNewBelowViewport(list, rows)).toBe(4);
  });

  test('follows the viewport while scrolling down', () => {
    const list = mount(0, 50);
    expect(countNewBelowViewport(list, rows)).toBe(3);
  });

  test('returns zero at the bottom and without a list', () => {
    const list = mount(0, 300);
    expect(countNewBelowViewport(list, rows)).toBe(0);
    expect(countNewBelowViewport(null, rows)).toBe(0);
    expect(countNewBelowViewport(mount(0, 0), [])).toBe(0);
  });
});
