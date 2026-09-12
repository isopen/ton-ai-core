/**
 * @jest-environment jsdom
 */
import { h } from '@ton-ai/atom';
import { render } from '@ton-ai/atom';
import { useEffect, useState } from '@ton-ai/atom/hooks';

function tick(): Promise<void> {
  return new Promise(r => setTimeout(r, 0));
}

describe('keyed reconciliation', () => {
  test('explicit key never collides with positional index', async () => {
    let setFlip: ((v: boolean) => void) | null = null;
    const App: any = () => {
      const [flip, setState] = useState(false);
      setFlip = setState;
      return h('div', null,
        ...(flip
          ? [h('span', { key: 0 }, 'B2'), h('span', null, 'C')]
          : [h('span', null, 'A'), h('span', { key: 0 }, 'B')]));
    };
    const c = document.createElement('div');
    document.body.appendChild(c);
    render(App as any, c);
    await tick();
    setFlip!(true);
    await tick();
    const spans = c.querySelectorAll('span');
    expect(spans.length).toBe(2);
    expect([spans[0].textContent, spans[1].textContent].sort()).toEqual(['B2', 'C']);
    document.body.removeChild(c);
  });

  test('keyed child keeps state across positional shifts', async () => {
    let setFlip: ((v: boolean) => void) | null = null;
    const Stateful: any = ({ id }: any) => {
      const [n] = useState(id * 100);
      return h('span', null, 's' + n);
    };
    const App: any = () => {
      const [flip, setState] = useState(false);
      setFlip = setState;
      return h('div', null,
        ...(flip
          ? [h('span', null, 'head'), h(Stateful as any, { id: 1, key: 'k1' }), h(Stateful as any, { id: 2, key: 'k2' })]
          : [h(Stateful as any, { id: 1, key: 'k1' }), h(Stateful as any, { id: 2, key: 'k2' })]));
    };
    const c = document.createElement('div');
    document.body.appendChild(c);
    render(App as any, c);
    await tick();
    setFlip!(true);
    await tick();
    const spans = c.querySelectorAll('span');
    expect(spans.length).toBe(3);
    expect(spans[1].textContent).toBe('s100');
    expect(spans[2].textContent).toBe('s200');
    document.body.removeChild(c);
  });

  test('removed keyed child runs effect cleanup exactly once', async () => {
    let cleaned = 0;
    let setGo: ((v: boolean) => void) | null = null;
    const Item: any = ({ id }: any) => {
      useEffect(() => () => { cleaned++; }, []);
      return h('span', { key: 'k' + id }, 'i' + id);
    };
    const App: any = () => {
      const [go, setState] = useState(false);
      setGo = setState;
      return h('div', null, ...(go ? [h(Item as any, { id: 2, key: 'k2' })] : [h(Item as any, { id: 1, key: 'k1' }), h(Item as any, { id: 2, key: 'k2' })]));
    };
    const c = document.createElement('div');
    document.body.appendChild(c);
    render(App as any, c);
    await tick();
    setGo!(true);
    await tick();
    expect(cleaned).toBe(1);
    expect(c.querySelectorAll('span').length).toBe(1);
    document.body.removeChild(c);
  });
});
